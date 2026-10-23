(() => {
  const area = chrome.storage.local;
  let migration;
  const parentKey = binding => binding ? `parent:${binding.serverID}:${binding.itemKey}` : null;
  function summary(page) {
    const counts = new Map();
    for (const row of page.annotations) counts.set(row.category, (counts.get(row.category) || 0) + 1);
    return { id: page.id, url: page.url, title: page.title, doi: page.doi, count: page.annotations.length, categories: Object.fromEntries(counts), updatedAt: page.updatedAt, binding: page.binding };
  }
  async function rebuild() {
    const keys = (await area.getKeys()).filter(key => key.startsWith("page:"));
    const parents = new Map();
    for (let offset = 0; offset < keys.length; offset += 10) {
      const pages = Object.values(await area.get(keys.slice(offset, offset + 10)));
      const writes = {};
      for (const page of pages) {
        writes["meta:" + page.id] = summary(page);
        const key = parentKey(page.binding);
        if (key) { if (!parents.has(key)) parents.set(key, []); parents.get(key).push(page.id); }
      }
      await area.set(writes);
    }
    for (const [key, ids] of parents) await area.set({ [key]: ids });
    await area.set({ indexVersion: 1, dataRevision: crypto.randomUUID() });
  }
  async function ready() {
    if (migration) return migration;
    if ((await area.get("indexVersion")).indexVersion === 1) return;
    if (!migration) migration = rebuild().finally(() => { migration = null; });
    return migration;
  }
  async function write(page, extra = {}) {
    const key = "meta:" + page.id;
    const previous = (await area.get(key))[key];
    const before = parentKey(previous?.binding), after = parentKey(page.binding);
    const writes = { ...extra, ["page:" + page.id]: page, [key]: summary(page), dataRevision: crypto.randomUUID() };
    if (before !== after) {
      const keys = [before, after].filter(Boolean);
      const parents = await area.get(keys);
      if (before) writes[before] = (parents[before] || []).filter(id => id !== page.id);
      if (after) writes[after] = [...new Set([...(parents[after] || []), page.id])];
    }
    await area.set(writes);
    return page;
  }
  async function summaries() {
    const keys = (await area.getKeys()).filter(key => key.startsWith("meta:"));
    return Object.values(await area.get(keys));
  }
  async function linked(binding) {
    const key = parentKey(binding);
    const ids = (await area.get(key))[key] || [];
    return Object.values(await area.get(ids.map(id => "page:" + id))).filter(page => parentKey(page.binding) === key);
  }
  async function manifest() {
    const data = await area.get(["settings", "dataRevision"]);
    return { format: "yanji-backup", version: 1, exportedAt: new Date().toISOString(), settings: Yanji.settingsWithDefaults(data.settings), revision: data.dataRevision };
  }
  globalThis.YanjiStore = { ready, write, summaries, linked, manifest };
})();
