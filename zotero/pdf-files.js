var YanjiPDFFiles = (() => {
  const pref = "extensions.yanji.pdfFiles.";
  const plans = new Map();
  let busy = false;
  const get = key => Zotero.Prefs.get(pref + key, true);
  const set = (key, value) => Zotero.Prefs.set(pref + key, value, true);
  const mappings = () => JSON.parse(get("journals") || "{}");
  const kindMappings=()=>JSON.parse(get("kindFolders")||"{}");
  const rootPath = () => get("root") || "";
  const readerAvailable=()=>Zotero.isWin&&typeof YanjiPDFReader!=="undefined";
  const journalKey = value => value.normalize("NFKC").replace(/&(?:amp;)?/gi," and ").toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
  const folderLabel = value => value.replace(/^(?:\d+[-_\s]+|【[^】]*】|\[[^\]]*\])+/,"").trim();
  function journalAliases(journal, abbreviation) {
    const scores = new Map(), add = (value, score) => { const key = journalKey(value); if(key) scores.set(key,Math.max(scores.get(key)||0,score)); };
    const words = journal.replace(/&(?:amp;)?/gi," and ").match(/[\p{L}\p{N}]+/gu) || [];
    const meaningful = words.filter(word => !/^(?:a|an|and|the|of|on|in|for|to|with|by|at)$/i.test(word));
    const unbranded = meaningful.filter((word,index) => index || !/^(?:IEEE|ISPRS)$/i.test(word));
    const initials = values => values.map(word => /^(?:[A-Z]{2,6}|npj)$/.test(word) ? word : word[0]).join("");
    add(journal,100); add(abbreviation,95); add(meaningful.join(""),98);
    add(initials(meaningful),90); add(meaningful.map(word=>word[0]).join(""),85);
    if(unbranded.length !== meaningful.length){ add(unbranded.join(""),97); add(initials(unbranded),88); }
    return {scores, short:unbranded.length===1 ? unbranded[0] : initials(unbranded)};
  }
  function fileCodeCounts(files) {
    const codes = new Map();
    for(const file of files){
      const code = /^[^_]+_\d{4}(?:\d{2}(?:\d{2})?)?a?_([^_]+)_/i.exec(file)?.[1];
      if(!code) continue;
      const key=journalKey(code), existing=codes.get(key);
      if(existing) existing.count++; else codes.set(key,{value:code,count:1});
    }
    return codes;
  }
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
    if(data.journal!==undefined && (typeof data.journal!=="string"||data.journal.length>500) || data.abbreviation!==undefined && (typeof data.abbreviation!=="string"||data.abbreviation.length>100)) throw Error("期刊信息无效。");
    const bound = parent(data.parentItemKey);
    const journal = (data.journal || bound?.getField("publicationTitle") || "").trim();
    const abbreviation = (data.abbreviation || bound?.getField("journalAbbreviation") || "").trim();
    const articleKind=data.articleKind||"research";
    if(!["research","review","dataset"].includes(articleKind))throw Error("文献类型无效。");
    const root = rootPath(), folders = [""], records = [];
    if (root) {
      async function walk(path, relative, depth) {
        const record = {path,relative,label:folderLabel(PathUtils.filename(path)),files:[],hasChildren:false};
        records.push(record);
        for (const child of await IOUtils.getChildren(path)) {
          const name = PathUtils.filename(child), stat = await IOUtils.stat(child, {followSymlinks:false});
          if(name.startsWith(".") || stat.isSymlink || ["研迹临时","研迹测试"].includes(name)) continue;
          if(stat.type!=="directory") { if(/\.pdf$/i.test(name)&&record.files.length<24) record.files.push(name); continue; }
          record.hasChildren=true;
          if(depth===3) continue;
          const next = relative ? relative + "/" + name : name;
          folders.push(next);
          await walk(child, next, depth + 1);
        }
      }
      await walk(root, "", 0);
    }
    folders.sort((a,b) => a.localeCompare(b,"zh-CN",{numeric:true}));
    const savedEntries=mappings(), saved=savedEntries[journal] || Object.entries(savedEntries).find(([name])=>journalKey(name)===journalKey(journal))?.[1];
    const aliases=journalAliases(journal,abbreviation);
    const pathKey=value=>{const key=value.replace(/\\/g,"/").replace(/\/$/,"");return Zotero.isWin?key.toLowerCase():key;};
    const byPath=new Map(records.map(record=>[pathKey(record.path),record]));
    const byFolder=new Map(records.map(record=>[record.relative,record]));
    const categoryRoots={};
    for(const[kind,pattern]of Object.entries({review:/^(?:surveys?|reviews?|综述)$/i,dataset:/^(?:datasource|datasets?|data|数据集|数据源)$/i})){
      const found=records.filter(row=>row.relative&&pattern.test(row.label));
      const explicit=kind==='dataset'?found.filter(row=>!/^data$/i.test(row.label)):found;
      const candidates=explicit.length?explicit:found;
      if(candidates.length===1)categoryRoots[kind]=candidates[0].relative;
    }
    async function itemFolders(item) {
      const result=new Set();
      for(const file of await Zotero.Items.getAsync(item.getAttachments())) {
        if(file.deleted||!file.isPDFAttachment()) continue;
        const filename=await file.getFilePathAsync();
        if(!filename) continue;
        const record=byPath.get(pathKey(PathUtils.parent(filename)));
        if(record) result.add(record.relative);
      }
      return result;
    }
    let selected=saved&&byFolder.get(saved.folder);
    if(!selected&&bound){const paths=await itemFolders(bound);if(paths.size===1)selected=byFolder.get([...paths][0]);}
    if(!selected){
      const ranked=records.filter(record=>record.relative&&(!record.hasChildren||record.files.length)).map(record=>{
        let score=aliases.scores.get(journalKey(record.label))||0;
        const codes=fileCodeCounts(record.files);
        if(codes.size===1)score=Math.max(score,(aliases.scores.get([...codes.keys()][0])||0)-5);
        return {record,score};
      }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score);
      if(ranked.length && (ranked.length===1||ranked[0].score>ranked[1].score)) selected=ranked[0].record;
    }
    if(!selected&&journal&&root){
      const search=new Zotero.Search(); search.libraryID=Zotero.Libraries.userLibraryID;
      search.addCondition("publicationTitle","is",journal);
      const ids=await search.search(), paths=new Set();
      for(const item of await Zotero.Items.getAsync(ids.slice(0,20))) if(item.isRegularItem()&&!item.deleted) for(const folder of await itemFolders(item)) paths.add(folder);
      if(paths.size===1)selected=byFolder.get([...paths][0]);
    }
    let short=saved?.abbreviation||abbreviation;
    if(selected&&!saved?.abbreviation){
      const key=journalKey(selected.label), codes=fileCodeCounts(selected.files);
      const matching=[...codes.entries()].filter(([key])=>aliases.scores.has(key)).map(([,code])=>code);
      const learned=(matching.length?matching:codes.size===1?[...codes.values()]:[]).sort((a,b)=>b.count-a.count)[0];
      short=aliases.scores.has(key)&&/^(?:[A-Z0-9]{1,12}|npj[A-Z0-9]+)$/.test(selected.label) ? selected.label : learned?.value||abbreviation||aliases.short||selected.label;
    }
    if(articleKind!=="research"){
      const remembered=kindMappings()[articleKind+"|"+journalKey(journal)],base=categoryRoots[articleKind];
      const inside=row=>base&&row&&(row.relative===base||row.relative.startsWith(base+"/"));
      if(remembered&&byFolder.has(remembered))selected=byFolder.get(remembered);
      else if(!inside(selected)){
        const ranked=records.filter(row=>inside(row)&&row.relative!==base).map(row=>({row,score:aliases.scores.get(journalKey(row.label))||0})).filter(row=>row.score>0).sort((a,b)=>b.score-a.score);
        if(ranked.length&&(ranked.length===1||ranked[0].score>ranked[1].score))selected=ranked[0].row;
        else{
          const general=records.filter(row=>inside(row)&&row.relative!==base&&!row.relative.slice(base.length+1).includes('/')&&/^(?:八仙过海|其他|综合|misc|general|others?)$/i.test(row.label));
          selected=general.length===1?general[0]:byFolder.get(base);
        }
      }
    }
    return {root,folders,journal,folder:selected?selected.relative:null,abbreviation:short,categoryRoots,classifiedFolders:true,autoImport:typeof YanjiPDFImport!=="undefined",localImport:true,pickStatus:true,readerSave:readerAvailable()};
  }
  async function pickRoot() {
    const {FilePicker} = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
    const picker = new FilePicker();
    picker.init(Zotero.getMainWindow(), "选择文献库根目录", picker.modeGetFolder);
    if (rootPath()) picker.displayDirectory = rootPath();
    if (await picker.show() !== picker.returnOK) return {cancelled:true};
    if (picker.file !== rootPath()) { set("root", picker.file); set("journals", "{}");set("kindFolders","{}"); }
    return {root:rootPath()};
  }
  function filename(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 220 || /[<>:"/\\|?*\u0000-\u001f]/.test(value) || !/\.pdf$/i.test(value) || /[. ]\.pdf$/i.test(value) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw Error("PDF 文件名无效或过长，请在文件名框中缩短后重试。");
    return value;
  }
  async function verifyPDF(path) {
    const header=new TextDecoder("latin1").decode(await IOUtils.read(path,{maxBytes:1024}));
    if(!header.includes("%PDF-"))throw Error("下载结果不是 PDF，可能返回了登录或验证页面。请先在网页中确认 PDF 可以打开。");
  }
  async function prepare(data) {
    for (const [token, plan] of plans) if (Date.now() - plan.at > 3600000) plans.delete(token);
    const target = PathUtils.join(await directory(data.folder), filename(data.filename));
    const item = parent(data.parentItemKey);
    if(data.autoImport!==undefined&&typeof data.autoImport!=="boolean")throw Error("自动入库选项无效。");
    const metadata=data.autoImport?YanjiPDFImport.metadata(data.metadata):null;
    if (await IOUtils.exists(target)) {
      if(data.autoImport&&data.existingPath===target){await verifyPDF(target);return{existing:true,path:target,...await YanjiPDFImport.add(target,metadata,data.parentItemKey),autoImport:true};}
      if (item) for (const file of await Zotero.Items.getAsync(item.getAttachments())) {
        if (!file.deleted && file.isPDFAttachment() && await file.getFilePathAsync() === target) return {existing:true, path:target, attachmentKey:file.key};
      }
      throw Error("同名 PDF 已存在，未覆盖。请调整文件名，或在 Zotero 中关联已有文件。");
    }
    if (typeof data.journal !== "string" || data.journal.length > 500 || typeof data.abbreviation !== "string" || data.abbreviation.length > 100) throw Error("期刊信息无效。");
    const articleKind=data.articleKind||"research";
    if(!["research","review","dataset"].includes(articleKind))throw Error("文献类型无效。");
    const token = Zotero.Utilities.randomString(32);
    const temporaryName=data.filename.slice(0,-4).slice(0,116).replace(/[\uD800-\uDBFF]$/,"").replace(/[. ]+$/,"")+".pdf";
    plans.set(token, {target, temporaryName, autoImport:data.autoImport===true, metadata, parentItemKey:data.parentItemKey || "", journal:data.journal, abbreviation:data.abbreviation, folder:data.folder,articleKind, at:Date.now(), running:false});
    return {token, temporaryName:token+"/"+temporaryName,autoImport:data.autoImport===true,localImport:true,pickStatus:true,readerSave:readerAvailable()};
  }
  function pickStatus(data) {
    const plan = plans.get(data.token);
    if (!plan || Date.now() - plan.at > 3600000) throw Error("保存任务已过期，请重新选择 PDF。");
    if(plan.error)throw Error(plan.error);
    if (plan.result) return plan.result;
    return plan.cancelled?{cancelled:true}:{pending:true};
  }
  function pick(data) {
    const state=pickStatus(data),plan=plans.get(data.token);
    if(!state.pending||plan.picking)return state;
    if([...plans.values()].some(row=>row.picking||row.reading))throw Error("请先完成当前 PDF 的保存操作。");
    plan.picking=true;
    (async()=>{
      const {FilePicker} = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
      const picker = new FilePicker();
      picker.init(Zotero.getMainWindow(), "选择从 PDF 阅读器保存的文件", picker.modeOpen);
      picker.appendFilter("PDF", "*.pdf");
      if (await picker.show() !== picker.returnOK) {plan.cancelled=true;return;}
      await finish({token:data.token,path:picker.file},true);
    })().catch(error=>{plan.error=error.message;Zotero.logError(error)}).finally(()=>{plan.picking=false});
    return state;
  }
  function reader(data) {
    if(!readerAvailable())throw Error("请安装 Windows 版研迹配套插件 0.4.0，以自动调用 Edge 阅读器。");
    const state=pickStatus(data),plan=plans.get(data.token);
    if(!state.pending||plan.reading)return state;
    if([...plans.values()].some(row=>row.picking||row.reading))throw Error("请先完成当前 PDF 的保存操作。");
    plan.reading=true;
    (async()=>{
      const path=await YanjiPDFReader.save({token:data.token,temporaryName:plan.temporaryName,url:data.url});
      await finish({token:data.token,path});
    })().catch(error=>{plan.error=error.message;Zotero.logError(error)}).finally(()=>{plan.reading=false});
    return state;
  }
  async function finish(data, localFile = false) {
    const plan = plans.get(data.token);
    if (!plan || Date.now() - plan.at > 3600000) throw Error("下载任务已过期，请重新保存 PDF。");
    if (plan.result) return plan.result;
    if (plan.running) throw Error("这份 PDF 正在入库，请稍候。");
    if (typeof data.path !== "string" || !PathUtils.isAbsolute(data.path)) throw Error("下载临时文件不属于本次任务。");
    const staging=PathUtils.parent(data.path);
    if(!localFile&&(PathUtils.filename(data.path)!==plan.temporaryName||PathUtils.filename(staging)!==data.token||PathUtils.filename(PathUtils.parent(staging))!=="研迹临时")) throw Error("下载临时文件不属于本次任务。");
    plan.running = true;
    try {
      await verifyPDF(data.path);
      // Recheck the directory and collisions after the browser finishes downloading.
      await directory(plan.folder);
      if (await IOUtils.exists(plan.target)) {
        if (await Zotero.Utilities.Internal.md5Async(data.path) !== await Zotero.Utilities.Internal.md5Async(plan.target)) throw Error("保存位置已出现不同内容的同名文件，未覆盖。");
      } else await IOUtils.copy(data.path, plan.target, {noOverwrite:true});
      const item = parent(plan.parentItemKey);
      let attachmentKey = "", warning = "", imported={};
      if(plan.autoImport){
        try{imported=await YanjiPDFImport.add(plan.target,plan.metadata,plan.parentItemKey);attachmentKey=imported.attachmentKey;warning=imported.warning||"";}
        catch(error){Zotero.logError(error);warning="PDF 已保存，自动入库失败："+error.message;}
      } else if (item) {
        try {
          const attachments = await Zotero.Items.getAsync(item.getAttachments());
          let attachment;
          for (const file of attachments) if (!file.deleted && file.isPDFAttachment() && await file.getFilePathAsync() === plan.target) { attachment = file; break; }
          if (!attachment) attachment = await Zotero.Attachments.linkFromFile({file:plan.target, parentItemID:item.id, contentType:"application/pdf", title:"PDF"});
          attachmentKey = attachment.key;
        } catch (error) { Zotero.logError(error); warning = "PDF 已保存，关联 Zotero 失败：" + error.message; }
      }
      if (plan.journal) {
        const saved=mappings(),old=Object.entries(saved).find(([name])=>journalKey(name)===journalKey(plan.journal))?.[1];
        for(const name of Object.keys(saved))if(journalKey(name)===journalKey(plan.journal))delete saved[name];
        saved[plan.journal]=plan.articleKind==='research'?{folder:plan.folder,abbreviation:plan.abbreviation}:{...old,abbreviation:plan.abbreviation};set("journals",JSON.stringify(saved));
        if(plan.articleKind!=='research'){const kinds=kindMappings();kinds[plan.articleKind+'|'+journalKey(plan.journal)]=plan.folder;set('kindFolders',JSON.stringify(kinds))}
      }
      plan.result = {...imported,path:plan.target, attachmentKey, warning};
      if(!localFile){await IOUtils.remove(data.path);await IOUtils.remove(staging);}
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
      if (!data || !["info", "root", "prepare", "finish", "pick", "pick-status", "reader"].includes(data.action)) return [400,"application/json",JSON.stringify({error:"PDF 保存操作无效。"})];
      if (busy) return [409,"application/json",JSON.stringify({error:"PDF 正在保存，请等待完成。"})];
      busy = true;
      try {
        const result = await ({info, root:pickRoot, prepare, finish, pick,"pick-status":pickStatus,reader}[data.action])(data);
        return [200,"application/json",JSON.stringify(result)];
      } catch (error) { Zotero.logError(error); return [400,"application/json",JSON.stringify({error:error.message})]; }
      finally { busy = false; }
    }
  };
  return {info, prepare, finish, pick, pickStatus, reader, start(){Zotero.Server.Endpoints[path] = Endpoint;}, stop(){delete Zotero.Server.Endpoints[path]; plans.clear();}};
})();
