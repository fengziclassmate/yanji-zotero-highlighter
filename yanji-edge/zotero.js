(() => {
  const base = "http://127.0.0.1:23119/api/";
  const library = "users/0";
  const tag = "研迹网页标注";
  let connection;
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(base + path, { ...options, headers: { "Zotero-API-Version": "3", "Zotero-Allowed-Request": "true", ...options.headers }, signal: AbortSignal.timeout(options.authorizing ? 120000 : 20000) });
    } catch (error) {
      throw Object.assign(new Error(options.authorizing ? "Zotero 授权未完成。请在 Zotero 窗口确认后重试。" : "连接不到 Zotero。请打开 Zotero 10，并启用：设置 → 高级 → 允许此计算机上的其他应用程序与 Zotero 通信。", { cause: error }), { code: "OFFLINE" });
    }
    const body = await response.text();
    const data = body && /^[\[{]/.test(body.trim()) ? JSON.parse(body) : body;
    return { response, data };
  }
  async function connect() {
    const result = await request("");
    if (!result.response.ok) throw new Error(`Zotero 本地接口返回 ${result.response.status}。请检查本地通信设置。`);
    const serverID = result.response.headers.get("Zotero-Server-ID");
    if (!serverID) throw new Error("本地接口没有提供 Zotero 10 的实例标识，请确认 Zotero 版本。");
    const saved = (await chrome.storage.local.get("zoteroAuth")).zoteroAuth;
    connection = { serverID, key: saved?.serverID === serverID ? saved.key : null, remember: saved?.serverID === serverID };
    return { serverID };
  }
  async function read(path, allow404 = false) {
    const { response, data } = await request(path);
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`读取 Zotero 失败（${response.status}）：${typeof data === "string" ? data.slice(0, 180) : JSON.stringify(data)}`);
    return data;
  }
  async function authorize() {
    const { response, data } = await request("local/authorize", { method: "POST", authorizing: true, headers: { "Content-Type": "application/json", "Zotero-Server-ID": connection.serverID }, body: JSON.stringify({ appName: "研迹 · 网页标注" }) });
    if (!response.ok) throw new Error(response.status === 403 ? "你未允许研迹写入 Zotero，标注仍保存在浏览器中。" : `Zotero 授权失败（${response.status}）。`);
    connection.key = data.key;
    connection.remember = data.remember;
    if (data.remember) await chrome.storage.local.set({ zoteroAuth: { serverID: connection.serverID, key: data.key } });
  }
  async function write(path, method, body, headers = {}, interactive = true) {
    const requireAuthorization = async () => {
      if (!interactive) throw Object.assign(new Error("已关联，点击更新笔记以授权写入。"), { code: "AUTH_REQUIRED" });
      await authorize();
    };
    if (!connection.key) await requireAuthorization();
    const send = () => request(path, { method, headers: { "Content-Type": "application/json", "Zotero-Server-ID": connection.serverID, "Zotero-API-Key": connection.key, ...headers }, body: JSON.stringify(body) });
    let result = await send();
    if (result.response.status === 401) {
      await chrome.storage.local.remove("zoteroAuth");
      connection.key = null;
      await requireAuthorization();
      result = await send();
    }
    if (!connection.remember) connection.key = null;
    if (!result.response.ok) {
      const error = new Error(result.response.status === 412 ? "写入前笔记已被修改，已停止覆盖。请刷新后重试。" : `写入 Zotero 失败（${result.response.status}）：${JSON.stringify(result.data).slice(0, 220)}`);
      error.code = result.response.status === 412 ? "CONFLICT" : "API_ERROR";
      throw error;
    }
    if (result.data?.failed && Object.keys(result.data.failed).length) throw new Error("Zotero 拒绝保存：" + JSON.stringify(result.data.failed));
    return result.data;
  }
  const candidates = (items, exactDOI) => {
    const rows = items.filter(item => !["attachment", "note", "annotation"].includes(item.data.itemType) && !item.data.deleted);
    return rows.map(item => ({ key: item.key, title: item.data.title, doi: item.data.DOI || "", date: item.data.date || "", authors: (item.data.creators || []).map(author => author.lastName || author.name).filter(Boolean).slice(0, 3).join("、"), exact: !!exactDOI && Yanji.doi(item.data.DOI) === Yanji.doi(exactDOI) })).sort((a, b) => Number(b.exact) - Number(a.exact));
  };
  const search = async (query, exactDOI = "") => candidates(await read(`${library}/items/top?format=json&limit=100&qmode=everything&q=${encodeURIComponent(query)}`), exactDOI);
  async function findDOI(doi) {
    const found = new Map();
    for (let start = 0; ; start += 100) {
      const items = await read(`${library}/items/top?format=json&limit=100&start=${start}&qmode=everything&q=${encodeURIComponent(Yanji.doi(doi))}`);
      for (const row of candidates(items, doi)) if (row.exact) found.set(row.key, row);
      if (items.length < 100) break;
    }
    return [...found.values()];
  }
  globalThis.YanjiZotero = { connect, read, write, search, findDOI, library, tag, get connection() { return connection; } };
})();
