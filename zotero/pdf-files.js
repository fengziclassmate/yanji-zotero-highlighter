var YanjiPDFFiles = (() => {
  const pref = "extensions.yanji.pdfFiles.";
  const plans = new Map();
  let busy = false;
  const get = key => Zotero.Prefs.get(pref + key, true);
  const set = (key, value) => Zotero.Prefs.set(pref + key, value, true);
  const mappings = () => JSON.parse(get("journals") || "{}");
  const rootPath = () => get("root") || "";
  function parent(key) {
    if (!key) return null;
    if (!/^[A-Z0-9]{8}$/.test(key)) throw Error("文献条目无效。");
    const item = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, key);
    if (!item || item.deleted || !item.isRegularItem()) throw Error("未找到对应 Zotero 文献，请重新关联。");
    return item;
  }
  async function directory(relative = "") {
    const root = rootPath();
    if (!root) throw Error("请先选择文献库根目录。");
    if (typeof relative !== "string" || relative.length > 1000 || relative.split(/[\\/]/).some(part => part === ".." || part === ".") || PathUtils.isAbsolute(relative)) throw Error("保存位置须在文献库根目录内。");
    const parts = relative.split(/[\\/]/).filter(Boolean);
    let path = root;
    for (const part of parts) {
      if (/[<>:"|?*\u0000-\u001f]/.test(part)) throw Error("保存目录无效。");
      path = PathUtils.join(path, part);
      const stat = await IOUtils.stat(path, {followSymlinks:false});
      if (stat.type !== "directory" || stat.isSymlink) throw Error("请选择文献库中的普通文件夹。");
    }
    if ((await IOUtils.stat(path)).type !== "directory") throw Error("保存文件夹不存在。");
    return path;
  }
  async function info(data) {
    const root = rootPath(), folders = [""];
    if (root) {
      async function walk(path, relative, depth) {
        for (const child of await IOUtils.getChildren(path)) {
          const name = PathUtils.filename(child), stat = await IOUtils.stat(child, {followSymlinks:false});
          if (name.startsWith(".") || stat.type !== "directory" || stat.isSymlink) continue;
          const next = relative ? relative + "/" + name : name;
          folders.push(next);
          if (depth < 2) await walk(child, next, depth + 1);
        }
      }
      await walk(root, "", 0);
    }
    folders.sort((a,b) => a.localeCompare(b,"zh-CN",{numeric:true}));
    const saved = mappings()[data.journal], normalize = value => value.replace(/^\d+[-_ ]*/, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
    const matched = data.abbreviation ? folders.filter(folder => normalize(folder.split("/").at(-1)) === normalize(data.abbreviation)) : [];
    return {root, folders, folder:saved && folders.includes(saved.folder) ? saved.folder : matched.length === 1 ? matched[0] : null, abbreviation:saved?.abbreviation || data.abbreviation || ""};
  }
  async function pickRoot() {
    const {FilePicker} = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
    const picker = new FilePicker();
    picker.init(Zotero.getMainWindow(), "选择文献库根目录", picker.modeGetFolder);
    if (rootPath()) picker.displayDirectory = rootPath();
    if (await picker.show() !== picker.returnOK) return {cancelled:true};
    if (picker.file !== rootPath()) { set("root", picker.file); set("journals", "{}"); }
    return {root:rootPath()};
  }
  function filename(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 220 || /[<>:"/\\|?*\u0000-\u001f]/.test(value) || !/\.pdf$/i.test(value) || /[. ]\.pdf$/i.test(value) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw Error("PDF 文件名无效或过长，请在文件名框中缩短后重试。");
    return value;
  }
  async function prepare(data) {
    for (const [token, plan] of plans) if (Date.now() - plan.at > 3600000) plans.delete(token);
    const target = PathUtils.join(await directory(data.folder), filename(data.filename));
    const item = parent(data.parentItemKey);
    if (await IOUtils.exists(target)) {
      if (item) for (const file of await Zotero.Items.getAsync(item.getAttachments())) {
        if (!file.deleted && file.isPDFAttachment() && await file.getFilePathAsync() === target) return {existing:true, path:target, attachmentKey:file.key};
      }
      throw Error("同名 PDF 已存在，未覆盖。请调整文件名，或在 Zotero 中关联已有文件。");
    }
    if (typeof data.journal !== "string" || data.journal.length > 500 || typeof data.abbreviation !== "string" || data.abbreviation.length > 100) throw Error("期刊信息无效。");
    const token = Zotero.Utilities.randomString(32);
    plans.set(token, {target, parentItemKey:data.parentItemKey || "", journal:data.journal, abbreviation:data.abbreviation, folder:data.folder, at:Date.now(), running:false});
    return {token, temporaryName:`yanji-${token}.pdf`};
  }
  async function finish(data) {
    const plan = plans.get(data.token);
    if (!plan || Date.now() - plan.at > 3600000) throw Error("下载任务已过期，请重新保存 PDF。");
    if (plan.result) return plan.result;
    if (plan.running) throw Error("这份 PDF 正在入库，请稍候。");
    if (typeof data.path !== "string" || !PathUtils.isAbsolute(data.path) || PathUtils.filename(data.path) !== `yanji-${data.token}.pdf`) throw Error("下载临时文件不属于本次任务。");
    plan.running = true;
    try {
      const header = new TextDecoder("latin1").decode(await IOUtils.read(data.path, {maxBytes:1024}));
      if (!header.includes("%PDF-")) throw Error("下载结果不是 PDF，可能返回了登录或验证页面。请先在网页中确认 PDF 可以打开。");
      // Recheck the directory and collisions after the browser finishes downloading.
      await directory(plan.folder);
      if (await IOUtils.exists(plan.target)) {
        if (await Zotero.Utilities.Internal.md5Async(data.path) !== await Zotero.Utilities.Internal.md5Async(plan.target)) throw Error("保存位置已出现不同内容的同名文件，未覆盖。");
      } else await IOUtils.copy(data.path, plan.target, {noOverwrite:true});
      const item = parent(plan.parentItemKey);
      let attachmentKey = "", warning = "";
      if (item) {
        try {
          const attachments = await Zotero.Items.getAsync(item.getAttachments());
          let attachment;
          for (const file of attachments) if (!file.deleted && file.isPDFAttachment() && await file.getFilePathAsync() === plan.target) { attachment = file; break; }
          if (!attachment) attachment = await Zotero.Attachments.linkFromFile({file:plan.target, parentItemID:item.id, contentType:"application/pdf", title:"PDF"});
          attachmentKey = attachment.key;
        } catch (error) { Zotero.logError(error); warning = "PDF 已保存，关联 Zotero 失败：" + error.message; }
      }
      if (plan.journal) { const saved = mappings(); saved[plan.journal] = {folder:plan.folder, abbreviation:plan.abbreviation}; set("journals", JSON.stringify(saved)); }
      plan.result = {path:plan.target, attachmentKey, warning};
      await IOUtils.remove(data.path);
      return plan.result;
    } finally { plan.running = false; }
  }
  const path = "/yanji/pdf/files";
  function Endpoint() {}
  Endpoint.prototype = {
    supportedMethods:["POST"], supportedDataTypes:["application/json"],
    async init({headers, data}) {
      const request = {headers:new Headers(headers), searchParams:new URLSearchParams()};
      if (!headers["zotero-allowed-request"] || headers.origin && !/^chrome-extension:\/\/[a-z]+$/.test(headers.origin)) return [403,"application/json",JSON.stringify({error:"仅接受本机扩展请求。"})];
      if (request.headers.get("Zotero-Server-ID") !== Zotero.Server.LocalAPI.getServerID()) return [409,"application/json",JSON.stringify({error:"Zotero 文献库已改变，请重新连接。"})];
      const rejected = await new Zotero.Server.LocalAPI.Root()._authenticateWriteRequest(request);
      if (rejected) return rejected;
      if (!data || !["info", "root", "prepare", "finish"].includes(data.action)) return [400,"application/json",JSON.stringify({error:"PDF 保存操作无效。"})];
      if (busy) return [409,"application/json",JSON.stringify({error:"PDF 正在保存，请等待完成。"})];
      busy = true;
      try {
        const result = await ({info, root:pickRoot, prepare, finish}[data.action])(data);
        return [200,"application/json",JSON.stringify(result)];
      } catch (error) { Zotero.logError(error); return [400,"application/json",JSON.stringify({error:error.message})]; }
      finally { busy = false; }
    }
  };
  return {info, prepare, finish, start(){Zotero.Server.Endpoints[path] = Endpoint;}, stop(){delete Zotero.Server.Endpoints[path]; plans.clear();}};
})();
