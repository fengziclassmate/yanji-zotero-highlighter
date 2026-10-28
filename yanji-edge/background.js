importScripts("shared.js", "zotero.js", "reading-store.js", "store.js", "pdf-sync.js", "reference-service.js");
const Y = Yanji;
const Z = YanjiZotero;
const S = YanjiStore;
let storageQueue = Promise.resolve();
const syncLocks = new Set();
const mutate = fn => { const task = storageQueue.then(fn, fn); storageQueue = task; return task; };
const getSettings = async () => Y.settingsWithDefaults((await chrome.storage.local.get("settings")).settings);
const getPage = async id => (await chrome.storage.local.get("page:" + id))["page:" + id] || null;
const linkID = binding => `link:${binding.serverID}:${binding.itemKey}`;
const sameBinding = (a, b) => a?.serverID === b.serverID && a?.itemKey === b.itemKey;
const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
async function updateBadge(tabId, page, settings) {
  if (tabId == null) return;
  await chrome.action.setBadgeText({ tabId, text: settings.badge && page?.annotations.length ? String(page.annotations.length) : "" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#333333" });
}
async function pageGet(meta, tabId) {
  if (!meta || typeof meta.url !== "string" || !/^(https?:|file:)/.test(meta.url)) throw new Error("文章地址无效。");
  const id = Y.pageID(meta);
  const page = await getPage(id) || { id, url: meta.url, title: meta.title, doi: meta.doi || "", annotations: [], updatedAt: "", binding: null };
  const settings = await getSettings();
  await updateBadge(tabId, page, settings);
  return { page, settings };
}
const matchFlights = new Map();
const openFlights = new Map();
async function setPageState(id, patch) {
  return mutate(async () => {
    const page = await getPage(id);
    if (!page) throw new Error("请先保存一条标注。");
    Object.assign(page, patch);
    await chrome.storage.local.set({ ["page:" + id]: page });
    return page;
  });
}
function matchDOI(id) {
  if (matchFlights.has(id)) return matchFlights.get(id);
  const task = (async () => {
    const page = await getPage(id);
    if (page?.binding) return page;
    if (!page?.doi) return setPageState(id, { match: { status: "no_doi" } });
    await Z.connect();
    const rows = await Z.findDOI(page.doi);
    return mutate(async () => {
      const latest = await getPage(id);
      if (latest.binding) return latest;
      latest.match = { status: rows.length === 1 ? "linked" : rows.length ? "ambiguous" : "waiting", candidates: rows, checkedAt: new Date().toISOString() };
      delete latest.sync;
      if (rows.length === 1) latest.binding = { serverID: Z.connection.serverID, itemKey: rows[0].key, title: rows[0].title, via: "doi" };
      await S.write(latest);
      return latest;
    });
  })().finally(() => matchFlights.delete(id));
  matchFlights.set(id, task);
  return task;
}
function pageOpen(id) {
  if (openFlights.has(id)) return openFlights.get(id);
  const task = (async () => {
    let page = await getPage(id);
    if (!page || (!page.annotations.length && !page.sync?.noteKey)) return page;
    try {
      page = await matchDOI(id);
      if (page.binding && (await getSettings()).autoSyncOnOpen) {
        const synced = await syncPage(id, false, false);
        page = await setPageState(id, { sync: { ...synced, status: "synced", at: new Date().toISOString() } });
      }
    } catch (error) {
      page = await setPageState(id, { sync: { status: "error", code: error.code || "ERROR", message: error.message } });
    }
    return page;
  })().finally(() => openFlights.delete(id));
  openFlights.set(id, task);
  return task;
}
async function syncPage(id, force, interactive = true) {
  await S.ready();
  const page = await getPage(id);
  if (!page?.binding) throw new Error("请先关联 Zotero 文献。");
  await Z.connect();
  const binding = page.binding;
  if (binding.serverID !== Z.connection.serverID) throw new Error("当前 Zotero 文献库已改变，请重新关联文献。");
  const lock = linkID(binding);
  if (syncLocks.has(lock)) throw new Error("这篇文献正在更新，请等待本次写入完成。");
  syncLocks.add(lock);
  try {
    const parent = await Z.read(`${Z.library}/items/${binding.itemKey}`);
    if (["note", "attachment", "annotation"].includes(parent.data.itemType) || parent.data.deleted) throw new Error("关联条目不是有效的文献，请重新关联。");
    const pages = await S.linked(binding);
    const annotations = [...new Map(pages.flatMap(row => row.annotations).map(row => [row.id, row])).values()];
    const settings = await getSettings();
    let link = (await chrome.storage.local.get(lock))[lock];
    const children = await Z.read(`${Z.library}/items/${binding.itemKey}/children?format=json`);
    const notes = children.filter(row => row.data.itemType === "note" && !row.data.deleted && row.data.tags.some(value => value.tag === Z.tag));
    if (notes.length > 1) throw new Error("这篇文献存在多份研迹笔记，请在 Zotero 中确认保留哪一份后重试。");
    let note = notes[0];
    if (link?.noteKey && !note) note = await Z.read(`${Z.library}/items/${link.noteKey}`, true);
    if (note && (note.data.deleted || note.data.parentItem !== binding.itemKey || !note.data.tags.some(value => value.tag === Z.tag))) throw new Error("原专用笔记已移入回收站，或归属、标记已改变，已停止覆盖。请先在 Zotero 中恢复或检查这份笔记。");
    let manual = `<h2>${Y.summaryTitle}</h2><p></p>`;
    if (note) {
      const parts = Y.splitNote(note.data.note);
      manual = parts.manual;
      if (!force && (!link?.lastManaged || parts.managed !== link.lastManaged)) {
        const error = new Error("Zotero 中的摘录区已被手动修改，或本机缺少上次写入记录。请先查看笔记；确认后可重建摘录区，文末手写总结会保留。");
        error.code = "MANAGED_CONFLICT";
        throw error;
      }
    }
    const plan = Y.planNote(settings, { title: parent.data.title }, annotations, manual);
    const { managed, html, length } = plan;
    const contentHash = await digest(managed);
    if (note) {
      const parts = Y.splitNote(note.data.note);
      if (link?.contentHash === contentHash && parts.managed === link.lastManaged && !parts.legacyHeading) return { noteKey: note.key, unchanged: true, count: annotations.length, length };
      await Z.write(`${Z.library}/items/${note.key}`, "PATCH", { note: html }, { "If-Unmodified-Since-Version": String(note.version) }, interactive);
    } else {
      const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
      const key = link?.noteKey || [...crypto.getRandomValues(new Uint8Array(8))].map(value => alphabet[value % alphabet.length]).join("");
      link = { noteKey: key };
      await chrome.storage.local.set({ [lock]: link });
      await Z.write(`${Z.library}/items`, "POST", [{ key, version: 0, itemType: "note", parentItem: binding.itemKey, note: html, tags: [{ tag: Z.tag }], relations: {} }], {}, interactive);
      note = { key };
    }
    const saved = await Z.read(`${Z.library}/items/${note.key}`);
    const savedParts = Y.splitNote(saved.data.note);
    await chrome.storage.local.set({ [lock]: { noteKey: note.key, lastManaged: savedParts.managed, contentHash, syncedAt: new Date().toISOString(), count: annotations.length } });
    return { noteKey: note.key, count: annotations.length, unchanged: false, length };
  } finally { syncLocks.delete(lock); }
}
async function handle(message, sender) {
  const internal = sender.url?.startsWith(chrome.runtime.getURL(""));
  const { type } = message;
  if (type === "ANN_FOCUS" || type === "READING_CHANGED") return true;
  if (type.startsWith("READ_")) {
    const R = YanjiReadingStore;
    if (!internal && !/^(https?:|file:)/.test(sender.tab?.url || "")) throw Error("阅读操作来源无效。");
    if (["READ_INFO", "READ_LIST", "READ_OPEN", "READ_SOURCE"].includes(type) && !internal) throw Error("此操作仅限研迹界面。");
    if (type === "READ_CONTEXT") return mutate(() => R.context(message.meta, message.instance, sender.tab));
    if (type === "READ_INFO") return R.info(message.tabId, message.meta);
    if (type === "READ_POINT") return mutate(() => R.savePoint(message.meta, message.point));
    if (type === "READ_TRAIL") return mutate(() => R.captureTrail(message.meta, message.href, message.point, sender.tab));
    if (type === "READ_STATUS") return R.status(message.urls);
    if (type === "READ_TOGGLE") return mutate(() => R.toggle(message.url, message.title, message.saved));
    if (type === "READ_LIST") return R.list(Number.isInteger(message.offset) && message.offset >= 0 ? message.offset : 0, !!message.countOnly);
    if (type === "READ_OPEN") return R.open(message.url);
    if (type === "READ_SOURCE") return R.returnSource(message.tabId);
    throw Error("未知阅读操作。");
  }
  if (type === "OPTIONS_OPEN") {
    if (!internal || ![undefined, "", "translation", "backup"].includes(message.section) || !["left", "top", "width", "height"].every(key => Number.isFinite(message.display?.[key]))) throw Error("设置入口无效。");
    return openOptions(message.section, message.display);
  }
  if (type.startsWith("REF_")) {
    const R = YanjiReferencesService;
    if (!internal && !/^https?:|^file:/.test(sender.tab?.url || "")) throw Error("翻译操作来源无效。");
    if (["REF_SETTINGS_GET", "REF_SETTINGS_SAVE", "REF_TOGGLE", "REF_TEST"].includes(type) && !internal) throw Error("翻译设置仅限扩展内部界面。");
    if (type === "REF_SETTINGS_GET") return { config: await R.config(), providers: R.providers };
    if (type === "REF_STATE") return R.state(await R.config());
    if (type === "REF_SETTINGS_SAVE") return mutate(() => R.save(message.config));
    if (type === "REF_TOGGLE") return mutate(async () => {
      if (typeof message.enabled !== "boolean") throw Error("翻译开关无效。");
      const area = message.area || "references";
      if (!Object.hasOwn(Y.translationScopes, area)) throw Error("翻译类别无效。");
      const config = await R.config();
      if (message.enabled) await R.requireService(config);
      return R.save({ ...config, [Y.translationScopes[area]]: message.enabled });
    });
    if (type === "REF_TRANSLATE") return R.translate(message.text, false, message.area || "references");
    if (type === "REF_TEST") return R.translate("Reference title translation for academic reading", true);
    if (type === "REF_PROGRESS") return true;
    throw Error("未知翻译操作。");
  }
  if (["CONNECT", "SEARCH", "BIND", "SYNC", "CHECK_DOI", "ANN_ALIGN", "PDF_SCAN", "PDF_SAVE", "PDF_PREVIEW", "SETTINGS_SAVE", "CONFIG_EXPORT", "CONFIG_IMPORT", "BACKUP_META", "BACKUP_CHECK", "IMPORT_BEGIN", "IMPORT_CHUNK", "IMPORT_END", "PAGES"].includes(type) && !internal) throw new Error("此操作仅限扩展内部界面。");
  await S.ready();
  if (type === "PDF_SCAN") return YanjiPDFSync.scan(message.pageId,message.attachmentKey);
  if (type === "PDF_SAVE") return YanjiPDFSync.save(message.token,message.selections);
  if (type === "PDF_PREVIEW") return YanjiPDFSync.preview(message.token,message.id,message.index);
  if (type === "PAGE_GET") return pageGet(message.meta, sender.tab?.id);
  if (type === "PAGE_OPEN") {
    const { page } = await pageGet(message.meta, sender.tab?.id);
    return pageOpen(page.id);
  }
  if (type === "SETTINGS_GET") return getSettings();
  if (type === "ANN_SAVE") return mutate(async () => {
    const { page, settings } = await pageGet(message.meta, sender.tab?.id);
    const annotation = message.annotation;
    Y.validateAnnotation(annotation, new Set(settings.categories.map(row => row.id)));
    const now = new Date().toISOString();
    page.annotations.push({ ...annotation, id: crypto.randomUUID(), url: message.meta.url, title: message.meta.title, createdAt: now, updatedAt: now });
    page.updatedAt = now;
    page.sync = { status: "pending", noteKey: page.sync?.noteKey };
    await S.write(page);
    await updateBadge(sender.tab?.id, page, settings);
    return page;
  });
  if (["ANN_UPDATE", "ANN_DELETE"].includes(type)) return mutate(async () => {
    const page = await getPage(message.pageId);
    const annotation = page?.annotations.find(row => row.id === message.id);
    if (!annotation) throw new Error("这条标注已不存在，请刷新页面。");
    let undoToken;
    if (type === "ANN_DELETE") {
      undoToken = crypto.randomUUID();
      await chrome.storage.session.set({ annotationUndo: { token: undoToken, pageId: page.id, annotation, index: page.annotations.indexOf(annotation), expiresAt: Date.now() + 8000 } });
      page.annotations = page.annotations.filter(row => row.id !== message.id);
    }
    else {
      const settings = await getSettings();
      if (!settings.categories.some(row => row.id === message.category) || typeof message.comment !== "string" || message.comment.length > 10000) throw new Error("分类或批注内容无效。");
      annotation.category = message.category;
      annotation.comment = message.comment;
      annotation.updatedAt = new Date().toISOString();
    }
    page.updatedAt = new Date().toISOString();
    page.sync = { status: "pending", noteKey: page.sync?.noteKey };
    await S.write(page);
    await updateBadge(sender.tab?.id, page, await getSettings());
    return undoToken ? { page, undoToken } : page;
  });
  if (type === "ANN_UNDO") return mutate(async () => {
    const undo = (await chrome.storage.session.get("annotationUndo")).annotationUndo;
    if (!undo || undo.token !== message.token || undo.expiresAt < Date.now()) throw Error("撤销时间已过，或已进行下一次删除。");
    const page = await getPage(undo.pageId);
    if (!(await getSettings()).categories.some(row => row.id === undo.annotation.category)) throw Error("原分类已删除，无法撤销。");
    if (!page.annotations.some(row => row.id === undo.annotation.id)) page.annotations.splice(Math.min(undo.index, page.annotations.length), 0, undo.annotation);
    page.updatedAt = new Date().toISOString();
    page.sync = { status: "pending", noteKey: page.sync?.noteKey };
    await S.write(page);
    await chrome.storage.session.remove("annotationUndo");
    await updateBadge(sender.tab?.id, page, await getSettings());
    return page;
  });
  if (type === "ANN_ALIGN") return mutate(async () => {
    const page = await getPage(message.pageId);
    const annotation = page?.annotations.find(row => row.id === message.id);
    if (!annotation) throw new Error("这条标注已不存在。");
    if (!Array.isArray(message.pairs) || message.pairs.length !== annotation.segments.length) throw new Error("中英句对格式无效。");
    message.pairs.forEach((pairs, index) => {
      const segment = annotation.segments[index];
      Y.validatePairs(segment, pairs);
      const chinese = Y.sentences(segment.quote, "zh"), english = new Set(Y.sentences(segment.original));
      if (pairs.some(pair => chinese[pair.index] !== pair.chinese || pair.english.some(text => !english.has(text)))) throw new Error("请选择当前候选列表中的完整句子。");
    });
    annotation.segments.forEach((segment, index) => { segment.sentencePairs = message.pairs[index]; });
    annotation.updatedAt = page.updatedAt = new Date().toISOString();
    page.sync = { status: "pending", noteKey: page.sync?.noteKey };
    return S.write(page);
  });
  if (type === "OPEN_PANEL") { await chrome.sidePanel.open({ tabId: sender.tab.id }); return true; }
  if (type === "CONNECT") return Z.connect();
  if (type === "SEARCH") { await Z.connect(); return Z.search(message.query, message.doi); }
  if (type === "BIND") return mutate(async () => {
    await Z.connect();
    const parent = await Z.read(`${Z.library}/items/${encodeURIComponent(message.itemKey)}`);
    if (["note", "annotation", "attachment"].includes(parent.data.itemType)) throw new Error("请选择文献父条目。");
    const page = await getPage(message.pageId) || message.page;
    if (!page || page.id !== message.pageId) throw new Error("请先打开文章。");
    page.binding = { serverID: Z.connection.serverID, itemKey: parent.key, title: parent.data.title, via: "manual" };
    page.match = { status: "linked" };
    delete page.sync;
    await S.write(page);
    return page;
  });
  if (type === "CHECK_DOI") return matchDOI(message.pageId);
  if (type === "SYNC") {
    if (openFlights.has(message.pageId)) await openFlights.get(message.pageId);
    const page = await matchDOI(message.pageId);
    if (!page.binding) throw Object.assign(new Error(page.match.status === "ambiguous" ? "DOI 对应多篇文献，请选择。" : page.match.status === "waiting" ? "尚未入库，标注已缓存。PDF 识别为文献后重新打开网页或更新笔记。" : "网页没有 DOI，请手动关联文献。"), { code: page.match.status === "ambiguous" ? "AMBIGUOUS" : "UNMATCHED" });
    const result = await syncPage(message.pageId, !!message.force);
    await setPageState(message.pageId, { sync: { ...result, status: "synced", at: new Date().toISOString() } });
    return result;
  }
  if (type === "POPUP_SIZE") return mutate(async () => {
    const settings = await getSettings();
    const prefix = message.popup === "menu" ? "toolbar" : message.popup === "editor" ? "editor" : null;
    if (!prefix) throw new Error("浮窗类型无效。");
    settings[prefix + "Width"] = message.width;
    settings[prefix + "Height"] = message.height;
    await chrome.storage.local.set({ settings: Y.validateSettings(settings) });
    return settings;
  });
  if (type === "CONFIG_EXPORT") return { format: "yanji-config", version: 1, settings: Y.configSettings(await getSettings()) };
  if (["SETTINGS_SAVE", "CONFIG_IMPORT"].includes(type)) return mutate(async () => {
    if (type === "CONFIG_IMPORT" && (message.config?.format !== "yanji-config" || message.config.version !== 1)) throw new Error("请选择研迹配置文件。");
    const settings = Y.validateSettings(type === "CONFIG_IMPORT" ? message.config.settings : message.settings);
    const ids = new Set(settings.categories.map(row => row.id));
    for (const page of await S.summaries()) if (Object.keys(page.categories).some(id => !ids.has(id))) throw new Error("被删除的分类还有标注，请先修改这些标注的分类。");
    await chrome.storage.local.set({ settings });
    return settings;
  });
  if (type === "PAGES") {
    const rows = (await S.summaries()).filter(row => row.id !== message.exclude).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const offset = Number.isInteger(message.offset) && message.offset >= 0 ? message.offset : 0;
    return { items: rows.slice(offset, offset + 50), total: rows.length, next: offset + 50 < rows.length ? offset + 50 : null };
  }
  if (type === "BACKUP_META") {
    const header = await S.manifest(message.pdfLinks);
    if (message.pdfLinks) header.readingData = await YanjiReadingStore.exportData();
    return header;
  }
  if (type === "BACKUP_CHECK") {
    if ((await chrome.storage.local.get("dataRevision")).dataRevision !== message.revision) throw new Error("备份期间标注发生变化，请重新导出。");
    return true;
  }
  if (type === "IMPORT_BEGIN") return mutate(async () => {
    const settings = Y.validateSettings(message.settings);
    const existingSettings = await getSettings();
    const merged = new Map(existingSettings.categories.map(row => [row.id, row]));
    for (const row of settings.categories) if (!merged.has(row.id)) merged.set(row.id, row);
    if (merged.size > 30) throw new Error("合并后超过 30 个分类，请先整理分类再导入。");
    const token = crypto.randomUUID();
    imports.set(token, { settings: { ...existingSettings, categories: [...merged.values()] }, ids: new Set(merged.keys()), parts: [], sequence: 0, count: 0,pdfLinks:S.validatePDFLinks(message.pdfLinks), reading: await YanjiReadingStore.validateData(message.readingData) });
    return token;
  });
  if (type === "IMPORT_END") return mutate(async()=>{
    const session=imports.get(message.token);
    if (session) await YanjiReadingStore.merge(session.reading);
    if(session&&Object.keys(session.pdfLinks).length)await chrome.storage.local.set({...session.pdfLinks,dataRevision:crypto.randomUUID()});
    imports.delete(message.token);return true;
  });
  if (type === "IMPORT_CHUNK") return mutate(async () => {
    const session = imports.get(message.token);
    if (!session) throw new Error("导入会话已中断，请重新选择备份；已合并的内容会保留。");
    if (typeof message.text !== "string" || message.text.length > 2 * 1024 * 1024 || message.sequence !== session.sequence) throw new Error("导入分块顺序或大小无效。");
    session.parts.push(message.text); session.sequence++;
    if (!message.last) return { count: session.count };
    const incoming = JSON.parse(session.parts.join(""));
    session.parts = []; session.sequence = 0;
    if (!incoming || typeof incoming.id !== "string" || typeof incoming.title !== "string" || !Array.isArray(incoming.annotations) || !/^(https?:|file:)/.test(incoming.url) || incoming.id !== Y.pageID(incoming)) throw new Error("备份中的文章数据无效。");
    for (const annotation of incoming.annotations) Y.validateAnnotation(annotation, session.ids, true);
    const current = await getPage(incoming.id);
    const annotations = new Map((current?.annotations || []).map(row => [row.id, row]));
    for (const row of incoming.annotations) if (!annotations.has(row.id) || row.updatedAt > annotations.get(row.id).updatedAt) annotations.set(row.id, row);
    const settings = await getSettings();
    const categories = new Map(settings.categories.map(row => [row.id, row]));
    for (const row of session.settings.categories) if (!categories.has(row.id)) categories.set(row.id, row);
    if (categories.size > 30) throw new Error("合并后超过 30 个分类，请先整理分类再导入。");
    await S.write({ ...incoming, ...current, annotations: [...annotations.values()], updatedAt: new Date().toISOString() }, { settings: { ...settings, categories: [...categories.values()] } });
    session.count++;
    return { count: session.count };
  });
  throw new Error("未知操作。");
}
const imports = new Map();
let optionsOpening;
async function rememberOptionsBounds(window) {
  if (window.state !== "normal") return;
  const { left, top, width, height } = window;
  await chrome.storage.local.set({ optionsWindowBounds: { left, top, width, height } });
}
async function openOptions(section, display) {
  if (optionsOpening) await optionsOpening;
  const task = (async () => {
    const base = chrome.runtime.getURL("options.html"), url = base + (section ? "#" + section : "");
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] });
    const owns = tab => (tab.pendingUrl || tab.url || "").split("#")[0] === base;
    const existing = windows.find(window => window.tabs.some(owns));
    if (existing) {
      const tab = existing.tabs.find(owns);
      await chrome.storage.session.set({ optionsWindowId: existing.id });
      await rememberOptionsBounds(existing);
      if (section && tab.url !== url) await chrome.tabs.update(tab.id, { url });
      await chrome.windows.update(existing.id, { focused: true });
      return { windowId: existing.id };
    }
    const saved = (await chrome.storage.local.get("optionsWindowBounds")).optionsWindowBounds;
    const width = Math.min(saved?.width || 1120, display.width - 32), height = Math.min(saved?.height || 880, display.height - 48);
    const left = Math.max(display.left, Math.min(saved?.left ?? display.left + Math.round((display.width - width) / 2), display.left + display.width - width));
    const top = Math.max(display.top, Math.min(saved?.top ?? display.top + Math.round((display.height - height) / 2), display.top + display.height - height));
    let created = await chrome.windows.create({ url, type: "popup", width, height, left, top });
    // Edge can replace small requested bounds with its default window size on creation.
    if (created.width !== width || created.height !== height || created.left !== left || created.top !== top) created = await chrome.windows.update(created.id, { width, height, left, top });
    await chrome.storage.session.set({ optionsWindowId: created.id });
    await rememberOptionsBounds(created);
    return { windowId: created.id };
  })();
  optionsOpening = task;
  try { return await task; } finally { if (optionsOpening === task) optionsOpening = null; }
}
chrome.windows.onBoundsChanged.addListener(window => {
  if (window.type !== "popup" || window.state !== "normal") return;
  chrome.storage.session.get("optionsWindowId").then(saved => {
    if (saved.optionsWindowId === window.id) return rememberOptionsBounds(window);
  }).catch(error => console.error("研迹设置窗口", error));
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(data => respond({ ok: true, data }), error => { console.error("研迹", error); respond({ ok: false, error: error.message, code: error.code || "ERROR" }); });
  return true;
});
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ settings: await getSettings() });
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error("研迹侧栏", error));
