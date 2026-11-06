var YanjiPDFDownload = (() => {
  const prefix = "pdfDownloadJob:";
  const flights = new Map();
  const starts = new Map();
  async function pdfSource(url, tabId) {
    if (!/(^|\.)sciencedirect\.com$/i.test(url.hostname) || !/\/pdfft\/?$/.test(url.pathname)) return {url:url.href};
    const pii = /\/science\/article\/pii\/([^/]+)\/pdfft/.exec(url.pathname)?.[1];
    if (!pii) throw Error("ScienceDirect PDF 地址无效。");
    const isPDF = value => {
      if (!value || !URL.canParse(value)) return false;
      const parsed = new URL(value);
      const signed = parsed.searchParams.get("X-Amz-Date");
      if (signed) {
        const parts = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(signed);
        if (!parts) return false;
        const start = Date.UTC(+parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5], +parts[6]);
        if (!(start + Number(parsed.searchParams.get("X-Amz-Expires")) * 1000 > Date.now() + 10000)) return false;
      }
      return parsed.protocol === "https:" && /(^|\.)sciencedirectassets\.com$/i.test(parsed.hostname) && parsed.pathname.includes("1-s2.0-" + pii + "/") && /\.pdf$/i.test(parsed.pathname);
    };
    const source = await chrome.tabs.get(tabId), sourceURL = new URL(source.url);
    if (!/(^|\.)sciencedirect\.com$/i.test(sourceURL.hostname) || /\/science\/article\/pii\/([^/]+)/.exec(sourceURL.pathname)?.[1] !== pii) throw Error("PDF 链接不属于当前文章，请返回文章页重试。");
    const tabs = await chrome.tabs.query({windowId:source.windowId});
    const existing = tabs.find(tab => tab.status === "complete" && isPDF(tab.url));
    if (existing) return {url:existing.url};
    const document = await chrome.tabs.sendMessage(tabId, {type:"PDF_DOCUMENT"});
    if (!document?.ok) throw Error("读取网页 PDF 入口失败，请刷新文章页。");
    const current = document.data.sources.find(row => {
      const parsed = new URL(row.url);
      return parsed.hostname === url.hostname && parsed.pathname === url.pathname;
    });
    const pending = tabs.find(tab => {
      if (tab.id === tabId || !URL.canParse(tab.url || "")) return false;
      const parsed = new URL(tab.url);
      return parsed.hostname === url.hostname && parsed.pathname === url.pathname || /(^|\.)sciencedirectassets\.com$/i.test(parsed.hostname) && parsed.pathname === "/craft/capi/cfts/init" && (parsed.searchParams.get("p") || "").includes("1-s2.0-" + pii + "/");
    });
    const preview = pending || await chrome.tabs.create({url:current?.url || url.href, active:false, openerTabId:tabId, windowId:source.windowId});
    return new Promise((resolve,reject) => {
      function clean() { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(updated); chrome.tabs.onRemoved.removeListener(removed); }
      function inspect(tab) { if (tab.status === "complete" && isPDF(tab.url)) { clean(); resolve({url:tab.url, closeTabId:pending ? undefined : preview.id}); } }
      function updated(id, change, tab) { if (id === preview.id) inspect(tab); }
      function removed(id) { if (id === preview.id) { clean(); reject(Error("PDF 页面已关闭，请重试。")); } }
      const timer = setTimeout(() => {
        clean();
        chrome.tabs.update(preview.id,{active:true}).then(
          () => reject(Error("请在已打开的 PDF 页面完成网站验证，再返回文章重新保存。")),
          () => reject(Error("PDF 页面已关闭，请重试。"))
        );
      }, 30000);
      chrome.tabs.onUpdated.addListener(updated); chrome.tabs.onRemoved.addListener(removed);
      chrome.tabs.get(preview.id).then(inspect, error => { clean(); reject(error); });
    });
  }
  async function context(meta, pageId) {
    await Z.connect();
    let page = await getPage(pageId);
    if (!page) {
      page = (await pageGet(meta)).page;
      await mutate(() => S.write(page));
    }
    if (!page.binding && page.doi) page = await matchDOI(page.id);
    if (page.binding && page.binding.serverID !== Z.connection.serverID) throw Error("当前 Zotero 文献库已改变，请重新关联。");
    return page;
  }
  const bridge = data => Z.write("../yanji/pdf/files", "POST", data, {}, true, 120000);
  async function info(message) {
    const page = await context(message.meta, message.pageId);
    const result = await bridge({action:"info", journal:message.document.journal, abbreviation:message.document.abbreviation});
    return {...result, binding:page.binding, ambiguous:page.match?.status === "ambiguous"};
  }
  async function settle(id) {
    if (flights.has(id)) return flights.get(id);
    const task = (async () => {
      const key = prefix + id, job = (await chrome.storage.local.get(key))[key];
      if (!job || job.state !== "downloading") return;
      const [download] = await chrome.downloads.search({id});
      if (!download || download.state === "in_progress" && !/text\/html|application\/xhtml/i.test(download.mime || "")) return;
      try {
        if (download.byExtensionId !== chrome.runtime.id) throw Error("下载来源不属于研迹。");
        if (/text\/html|application\/xhtml/i.test(download.mime || "")) {
          if (download.state === "in_progress") await chrome.downloads.cancel(id);
          throw Error("网站返回了网页而非 PDF，请先完成 PDF 页验证后重试。");
        }
        if (download.state !== "complete") throw Error(["SERVER_FORBIDDEN", "SERVER_UNAUTHORIZED"].includes(download.error) ? "网站拒绝了下载，请先在网页打开 PDF，再返回文章重新保存。" : "下载中断：" + (download.error || "请重试"));
        await Z.connect();
        if (job.serverID !== Z.connection.serverID) throw Error("Zotero 文献库已改变，PDF 暂留浏览器下载目录。");
        const result = await bridge({action:"finish", token:job.token, path:download.filename});
        await chrome.storage.local.set({[key]:{...job, state:"complete", result, updatedAt:Date.now()}});
      } catch (error) {
        console.error("PDF 保存失败", error);
        await chrome.storage.local.set({[key]:{...job, state:"error", error:error.message, updatedAt:Date.now()}});
      }
      await mutate(async () => {
        const pending = (await chrome.storage.local.get("pdfDownloadPending")).pdfDownloadPending || [];
        await chrome.storage.local.set({pdfDownloadPending:pending.filter(value => value !== id)});
      });
    })().finally(() => flights.delete(id));
    flights.set(id, task);
    return task;
  }
  async function startOne(message) {
    if (!await chrome.permissions.contains({permissions:["downloads"]})) throw Error("请允许研迹下载文件后重试。");
    const previous = await latest(message.pageId);
    if (previous?.state === "downloading") return {id:previous.id};
    const url = new URL(message.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw Error("PDF 链接须为 HTTP 或 HTTPS 地址。");
    const page = await context(message.meta, message.pageId);
    const parentItemKey = message.link ? page.binding?.itemKey : "";
    if (message.link && !parentItemKey) throw Error("请先关联对应 Zotero 文献，或取消关联选项，仅保存 PDF。");
    const plan = await bridge({action:"prepare", folder:message.folder, filename:message.filename, journal:message.journal, abbreviation:message.abbreviation, parentItemKey});
    if (plan.existing) return plan;
    const source = await pdfSource(url, message.tabId);
    listen();
    let id;
    try {
      id = await chrome.downloads.download({url:source.url, filename:"研迹临时/" + plan.temporaryName, conflictAction:"uniquify", saveAs:false});
    } finally { if (source.closeTabId) await chrome.tabs.remove(source.closeTabId); }
    const job = {id, pageId:page.id, token:plan.token, serverID:Z.connection.serverID, state:"downloading", filename:message.filename, updatedAt:Date.now()};
    await mutate(async () => {
      const pending = (await chrome.storage.local.get("pdfDownloadPending")).pdfDownloadPending || [];
      await chrome.storage.local.set({[prefix + id]:job, ["pdfDownloadPage:" + page.id]:id, pdfDownloadPending:[...pending,id]});
      if (previous?.state === "complete") await chrome.storage.local.remove(prefix + previous.id);
    });
    await settle(id);
    return {id};
  }
  function start(message) {
    if (starts.has(message.pageId)) return starts.get(message.pageId);
    const task = startOne(message).finally(() => starts.delete(message.pageId));
    starts.set(message.pageId, task);
    return task;
  }
  async function latest(pageId) {
    const id = (await chrome.storage.local.get("pdfDownloadPage:" + pageId))["pdfDownloadPage:" + pageId];
    if (id === undefined) return null;
    if (await chrome.permissions.contains({permissions:["downloads"]})) await settle(id);
    return (await chrome.storage.local.get(prefix + id))[prefix + id] || null;
  }
  let listening = false;
  function listen() {
    if (!chrome.downloads || listening) return;
    listening = true;
    chrome.downloads.onChanged.addListener(delta => {
      if (delta.state || delta.error || delta.mime) settle(delta.id).catch(error => console.error("PDF 下载状态更新失败", error));
    });
  }
  async function resume() {
    if (!await chrome.permissions.contains({permissions:["downloads"]})) return;
    const pending = (await chrome.storage.local.get("pdfDownloadPending")).pdfDownloadPending || [];
    const keys = pending.map(id => prefix + id);
    for (const job of Object.values(await chrome.storage.local.get(keys))) if (job.state === "downloading") await settle(job.id);
  }
  resume().catch(error => console.error("恢复 PDF 下载失败", error));
  listen();
  chrome.permissions.onAdded.addListener(() => { listen(); resume().catch(error => console.error("恢复 PDF 下载失败", error)); });
  return {info, start, latest, root:() => bridge({action:"root"}), settle};
})();
