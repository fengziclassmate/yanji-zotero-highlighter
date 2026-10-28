(() => {
  const Y = Yanji, local = chrome.storage.local, session = chrome.storage.session;
  const laterKey = async url => "later:" + await digest(Y.readingURL(url));
  const readingID = meta => Y.pageID({ ...meta, url: /^https?:/.test(meta.url) ? Y.readingURL(meta.url) : meta.url });
  const pointKey = meta => "readpoint:" + readingID(meta);
  const validTitle = value => typeof value === "string" && value.trim() && value.length <= 2000;
  const validDate = value => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
  function validatePoint(point) {
    if (!point || !Number.isFinite(point.ratio) || point.ratio < 0 || point.ratio > 1 || typeof point.elementId !== "string" || point.elementId.length > 500 || typeof point.prefix !== "string" || point.prefix.length > 500) throw Error("阅读位置无效。");
    return { ratio: point.ratio, elementId: point.elementId, prefix: point.prefix };
  }
  async function list(offset = 0, countOnly = false) {
    const keys = (await local.getKeys()).filter(key => key.startsWith("later:"));
    if (countOnly) return { count: keys.length };
    const rows = Object.values(await local.get(keys)).sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.url.localeCompare(b.url));
    offset = Math.max(0, Math.min(offset, Math.max(0,Math.floor((rows.length-1)/50)*50)));
    return { count: rows.length, offset, items: rows.slice(offset, offset + 50), next: offset + 50 < rows.length ? offset + 50 : null };
  }
  async function status(urls) {
    if (!Array.isArray(urls) || urls.length > 1000 || urls.some(url => typeof url !== "string")) throw Error("收藏链接无效。");
    const keys = await Promise.all(urls.map(laterKey));
    return Object.values(await local.get(keys)).map(row => row.url);
  }
  async function toggle(url, title, saved) {
    url = Y.readingURL(url);
    if (!validTitle(title) || typeof saved !== "boolean") throw Error("稍后读条目无效。");
    const key = await laterKey(url);
    if (saved) await local.set({ [key]: { url, title: title.trim(), addedAt: new Date().toISOString() }, dataRevision: crypto.randomUUID() });
    else { await local.remove(key); await local.set({ dataRevision: crypto.randomUUID() }); }
    return { url, saved };
  }
  async function navigate(url, point) {
    url = Y.readingURL(url);
    const tabs = await chrome.tabs.query({});
    const found = tabs.find(tab => /^https?:/.test(tab.url || "") && Y.readingURL(tab.url) === url);
    if (found) {
      if (point && (found.discarded || found.status !== "complete")) await session.set({ ["readingRestore:" + found.id]: point });
      await chrome.tabs.update(found.id, { active: true });
      await chrome.windows.update(found.windowId, { focused: true });
      if (point && !found.discarded && found.status === "complete") await chrome.tabs.sendMessage(found.id, { type: "READ_RESTORE", point });
      return { tabId: found.id };
    }
    const created = await chrome.tabs.create({ url: point ? "about:blank" : url });
    if (point) { await session.set({ ["readingRestore:" + created.id]: point }); await chrome.tabs.update(created.id,{url}); }
    return { tabId: created.id };
  }
  async function open(url) {
    const key = await laterKey(url), record = (await local.get(key))[key];
    if (!record) throw Error("该文章已移出稍后读。");
    return navigate(record.url);
  }
  async function savePoint(meta, point) {
    if (!validTitle(meta?.title) || typeof meta.url !== "string" || !/^(https?:|file:)/.test(meta.url)) throw Error("文章信息无效。");
    const clean = validatePoint(point), key = pointKey(meta);
    await local.set({ [key]: { meta: { url: /^https?:/.test(meta.url) ? Y.readingURL(meta.url) : meta.url, title: meta.title, doi: meta.doi || "" }, ...clean, savedAt: new Date().toISOString() } });
    return true;
  }
  const target = value => {
    const url = new URL(value);
    return { host: url.hostname.replace(/^www\./, ""), ref: url.searchParams.get("eid") || /REF\(([^)]+)\)/.exec(url.searchParams.get("s") || "")?.[1] || "" };
  };
  async function captureTrail(meta, href, point, tab) {
    const sourceURL = Y.readingURL(meta.url), destination = target(href);
    const host = new URL(sourceURL).hostname;
    if (!(host === "sciencedirect.com" || host.endsWith(".sciencedirect.com")) || destination.host !== "scopus.com" || !validTitle(meta.title)) throw Error("来源链接无效。");
    const keys = (await session.getKeys()).filter(key => key.startsWith("readingTrailPending:")), pending = await session.get(keys);
    const active = keys.filter(key => pending[key].expiresAt > Date.now()).sort((a,b)=>pending[a].expiresAt-pending[b].expiresAt);
    await session.remove([...keys.filter(key=>pending[key].expiresAt<=Date.now()),...active.slice(0,Math.max(0,active.length-19))]);
    await session.set({ ["readingTrailPending:" + crypto.randomUUID()]: { url: sourceURL, title: meta.title, sourceTabId: tab.id, windowId: tab.windowId, point: validatePoint(point), destination, expiresAt: Date.now() + 120000 } });
    return true;
  }
  async function context(meta, instance, tab) {
    if (typeof instance !== "string" || instance.length > 80) throw Error("阅读会话无效。");
    const id = readingID(meta), entryKey = "readingEntry:" + tab.id, restoreKey = "readingRestore:" + tab.id;
    const current = await session.get([entryKey, restoreKey]);
    let entry = current[entryKey];
    if (entry?.instance !== instance || entry.pageId !== id) {
      entry = { instance, pageId: id, point: (await local.get(pointKey(meta)))[pointKey(meta)] || null };
      await session.set({ [entryKey]: entry });
    }
    const dest = target(meta.url), keys = (await session.getKeys()).filter(key => key.startsWith("readingTrailPending:"));
    const pending = await session.get(keys);
    const candidates = Object.entries(pending).filter(([, row]) => row.expiresAt > Date.now() && row.destination.host === dest.host && (!row.destination.ref || !dest.ref || row.destination.ref === dest.ref) && (row.sourceTabId === tab.openerTabId || row.windowId === tab.windowId)).sort((a, b) => b[1].expiresAt - a[1].expiresAt);
    const exact = candidates.filter(([, row]) => dest.ref && row.destination.ref === dest.ref);
    const matching = exact.length ? exact : candidates;
    const opener = matching.filter(([, row]) => row.sourceTabId === tab.openerTabId);
    const resolved = opener.length ? opener : matching;
    if (resolved.length && new Set(resolved.map(([, row])=>row.url)).size === 1) { await session.set({ ["readingTrail:" + tab.id]: resolved[0][1] }); await session.remove(resolved[0][0]); }
    if (current[restoreKey]) await session.remove(restoreKey);
    return { ...(await info(tab.id, meta)), restore: current[restoreKey] || null };
  }
  async function info(tabId, meta) {
    const data = await session.get(["readingEntry:" + tabId, "readingTrail:" + tabId]);
    const entry = data["readingEntry:" + tabId], trail = data["readingTrail:" + tabId];
    return { resume: entry?.pageId === readingID(meta) ? entry.point : null, source: trail?.destination.host === target(meta.url).host ? { title: trail.title, url: trail.url } : null };
  }
  async function returnSource(tabId) {
    const trail = (await session.get("readingTrail:" + tabId))["readingTrail:" + tabId];
    if (!trail) throw Error("当前页面没有来源文章。");
    return navigate(trail.url, trail.point);
  }
  async function exportData() {
    const keys = (await local.getKeys()).filter(key => key.startsWith("later:") || key.startsWith("readpoint:"));
    const data = await local.get(keys);
    return { later: keys.filter(key => key.startsWith("later:")).map(key => data[key]), positions: keys.filter(key => key.startsWith("readpoint:")).map(key => data[key]) };
  }
  async function validateData(data = { later: [], positions: [] }) {
    if (!data || !Array.isArray(data.later) || !Array.isArray(data.positions)) throw Error("阅读数据备份格式无效。");
    const writes = {};
    for (const row of data.later) {
      if (!validTitle(row?.title) || !validDate(row.addedAt)) throw Error("稍后读备份条目无效。");
      const url = Y.readingURL(row.url);
      writes[await laterKey(url)] = { url, title: row.title, addedAt: new Date(row.addedAt).toISOString() };
    }
    for (const row of data.positions) {
      if (!validTitle(row?.meta?.title) || typeof row.meta.url !== "string" || !/^(https?:|file:)/.test(row.meta.url) || (row.meta.doi !== undefined && typeof row.meta.doi !== "string") || !validDate(row.savedAt)) throw Error("阅读位置备份无效。");
      writes[pointKey(row.meta)] = { meta: { url: row.meta.url, title: row.meta.title, doi: row.meta.doi || "" }, ...validatePoint(row), savedAt: new Date(row.savedAt).toISOString() };
    }
    return writes;
  }
  async function merge(writes) {
    const existing = await local.get(Object.keys(writes)), changed = {};
    for (const [key, row] of Object.entries(writes)) if (!existing[key] || (row.addedAt || row.savedAt) > (existing[key].addedAt || existing[key].savedAt)) changed[key] = row;
    if (Object.keys(changed).length) await local.set({ ...changed, dataRevision: crypto.randomUUID() });
  }
  globalThis.YanjiReadingStore = { list, status, toggle, open, savePoint, captureTrail, context, info, returnSource, exportData, validateData, merge };
})();
