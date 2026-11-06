var YanjiPDFDownload = (() => {
  const prefix = "pdfDownloadJob:";
  const flights = new Map();
  const starts = new Map();
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
      if (!download || download.state === "in_progress") return;
      try {
        if (download.state !== "complete") throw Error("下载中断：" + (download.error || "请重试"));
        if (download.byExtensionId !== chrome.runtime.id) throw Error("下载来源不属于研迹。");
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
    const id = await chrome.downloads.download({url:url.href, filename:"研迹临时/" + plan.temporaryName, conflictAction:"uniquify", saveAs:false});
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
    return id === undefined ? null : (await chrome.storage.local.get(prefix + id))[prefix + id] || null;
  }
  let listening = false;
  function listen() {
    if (!chrome.downloads || listening) return;
    listening = true;
    chrome.downloads.onChanged.addListener(delta => {
      if (delta.state || delta.error) settle(delta.id).catch(error => console.error("PDF 下载状态更新失败", error));
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
