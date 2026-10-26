(() => {
  const Y = Yanji;
  const providers = {
    niutrans: { name: "小牛翻译", origin: "https://api.niutrans.com/*" },
    google: { name: "Google 翻译（免 Key，实验）", origin: "https://translate.googleapis.com/*" },
    edge: { name: "微软 Edge（免 Key，实验）", origin: "https://edge.microsoft.com/*" },
    googlecloud: { name: "Google Cloud", origin: "https://translation.googleapis.com/*" },
    azure: { name: "微软 Azure", origin: "https://api.cognitive.microsofttranslator.com/*" }
  };
  let queue = Promise.resolve(), lastRequest = 0;
  const flights = new Map(), controllers = new Set();
  const config = async () => (await chrome.storage.local.get("referenceTranslation")).referenceTranslation || { enabled: false, provider: "niutrans", credentials: {} };
  const state = value => ({ enabled: value.enabled, provider: value.provider, name: providers[value.provider].name, origin: providers[value.provider].origin, configured: ["google", "edge"].includes(value.provider) || !!value.credentials[value.provider]?.key });
  function validate(value) {
    if (!value || typeof value.enabled !== "boolean" || !providers[value.provider]) throw Error("翻译设置无效。");
    const credentials = {};
    for (const id of ["niutrans", "googlecloud", "azure"]) {
      const row = value.credentials?.[id];
      if (!row) continue;
      if (typeof row.key !== "string" || row.key.length > 2048 || (row.region && !/^[a-z0-9-]{1,60}$/.test(row.region))) throw Error("API Key 或区域格式无效。");
      credentials[id] = { key: row.key.trim(), ...(id === "azure" ? { region: row.region === "global" ? "" : row.region || "" } : {}) };
    }
    return { enabled: value.enabled, provider: value.provider, credentials };
  }
  async function save(value) {
    const next = validate(value);
    for (const controller of controllers) controller.abort();
    await chrome.storage.local.set({ referenceTranslation: next });
    return state(next);
  }
  async function requireService(value) {
    const info = state(value);
    if (!info.configured) throw Error("请先在翻译设置中填写 API Key。");
    if (!(await chrome.permissions.contains({ origins: [info.origin] }))) throw Error("请在翻译设置中允许访问所选服务。");
  }
  async function request(value, text) {
    const { provider } = value, credential = value.credentials[provider] || {};
    let url, options;
    if (provider === "niutrans") {
      url = "https://api.niutrans.com/NiuTransServer/translation";
      options = { method: "POST", body: new URLSearchParams({ from: "auto", to: "zh", apikey: credential.key, src_text: text }) };
    } else if (provider === "google") {
      url = "https://translate.googleapis.com/translate_a/single?" + new URLSearchParams({ client: "gtx", sl: "auto", tl: "zh-CN", dt: "t", q: text });
      options = {};
    } else if (provider === "edge") {
      url = "https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false";
      options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify([text]) };
    } else if (provider === "googlecloud") {
      url = "https://translation.googleapis.com/language/translate/v2";
      options = { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": credential.key }, body: JSON.stringify({ q: text, target: "zh-CN", format: "text" }) };
    } else {
      url = "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans";
      options = { method: "POST", headers: { "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": credential.key, ...(credential.region ? { "Ocp-Apim-Subscription-Region": credential.region } : {}) }, body: JSON.stringify([{ Text: text }]) };
    }
    const controller = new AbortController();
    controllers.add(controller);
    try {
      let response;
      try { response = await fetch(url, { ...options, credentials: "omit", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) }); }
      catch (error) { throw Error(controller.signal.aborted ? "翻译已停止。" : "连接翻译服务失败或超时，请检查网络。", { cause: error }); }
      if (!response.ok) throw Error(`翻译服务返回 HTTP ${response.status}，请检查密钥、额度和网络。`);
      let data;
      try { data = await response.json(); } catch { throw Error("翻译服务返回了无效数据，请稍后重试。"); }
      if (!data || typeof data !== "object") throw Error("翻译服务返回了无效数据。");
      if (data.error_code || data.error) {
        const message = String(data.error_msg || data.error?.message || "翻译服务拒绝请求").slice(0, 180);
        throw Error(credential.key ? message.replaceAll(credential.key, "[已隐藏]") : message);
      }
      const translated = provider === "niutrans" ? data.tgt_text : provider === "google" ? (Array.isArray(data[0]) ? data[0].map(row => row?.[0] || "").join("") : undefined) : provider === "googlecloud" ? data.data?.translations?.[0]?.translatedText : data[0]?.translations?.[0]?.text;
      if (typeof translated !== "string" || !translated.trim() || translated.length > 12000) throw Error("翻译服务未返回有效译文。");
      return translated.trim();
    } finally { controllers.delete(controller); }
  }
  async function translate(text, test = false) {
    if (typeof text !== "string" || !text.trim() || text.length > 2000) throw Error("参考文献标题须为 1–2000 个字符。");
    const initial = await config();
    if (!test && !initial.enabled) throw Error("参考文献翻译已关闭。");
    await requireService(initial);
    const key = "referenceCache:" + await digest(initial.provider + "\n" + Y.normalize(text));
    if (flights.has(key)) return flights.get(key);
    const work = async () => {
      const current = await config();
      if (current.provider !== initial.provider || (!test && !current.enabled)) throw Error("参考文献翻译已关闭或服务已切换。");
      const cached = (await chrome.storage.local.get(key))[key];
      if (!test && cached && Date.now() - cached.at < 30 * 86400000) return cached.text;
      const wait = Math.max(0, 600 - (Date.now() - lastRequest));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      const latest = await config();
      if (latest.provider !== initial.provider || (!test && !latest.enabled)) throw Error("参考文献翻译已关闭或服务已切换。");
      lastRequest = Date.now();
      const translated = await request(latest, text);
      const index = (await chrome.storage.local.get("referenceCacheIndex")).referenceCacheIndex || {};
      index[key] = Date.now();
      const expired = Object.keys(index).sort((a, b) => index[a] - index[b]).slice(0, Math.max(0, Object.keys(index).length - 1000));
      for (const name of expired) delete index[name];
      if (expired.length) await chrome.storage.local.remove(expired);
      await chrome.storage.local.set({ [key]: { text: translated, at: Date.now() }, referenceCacheIndex: index });
      return translated;
    };
    const task = queue.then(work, work).finally(() => flights.delete(key));
    queue = task;
    flights.set(key, task);
    return task;
  }
  globalThis.YanjiReferencesService = { providers, config, state, save, translate, requireService };
})();
