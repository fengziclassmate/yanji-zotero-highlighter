(() => {
  const node = id => document.getElementById(id);
  const send = async message => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result.ok) throw Error(result.error);
    return result.data;
  };
  let config, providers, selected;
  function status(text, kind = "") { node("translation-status").textContent = text; node("translation-status").className = "status " + kind; }
  function remember() {
    if (["niutrans", "googlecloud", "azure"].includes(selected)) config.credentials[selected] = { key: node("translation-key").value.trim(), ...(selected === "azure" ? { region: node("translation-region").value.trim().toLowerCase() } : {}) };
  }
  function paint() {
    selected = node("translation-provider").value;
    const needsKey = !["google", "edge"].includes(selected);
    node("translation-key-field").hidden = !needsKey;
    node("translation-key").value = config.credentials[selected]?.key || "";
    node("translation-region-field").hidden = selected !== "azure";
    node("translation-region").value = config.credentials[selected]?.region || "";
    node("translation-hint").textContent = !needsKey ? "实验网页接口，可能限流或无法连接。" : selected === "azure" ? "支持 Azure 免费层。密钥仅保存在本机，不随备份和共享配置导出。" : "密钥仅保存在本机，不随备份和共享配置导出。";
  }
  async function save(test = false) {
    remember();
    config.provider = selected;
    config.enabled = node("translation-enabled").checked;
    if ((test || config.enabled) && !["google", "edge"].includes(selected) && !config.credentials[selected]?.key) throw Error("请填写 API Key。");
    if (test || config.enabled || config.credentials[selected]?.key) {
      const allowed = await chrome.permissions.request({ origins: [providers[selected].origin] });
      if (!allowed) throw Error("需要允许访问所选翻译服务。");
    }
    await send({ type: "REF_SETTINGS_SAVE", config });
  }
  node("translation-provider").onchange = () => { remember(); paint(); status("未保存"); };
  node("translation-form").onsubmit = async event => {
    event.preventDefault();
    try { await save(); status("已保存", "success"); }
    catch (error) { status(error.message, "error"); }
  };
  node("translation-test").onclick = async () => {
    node("translation-test").disabled = true;
    try { await save(true); status("正在测试…"); const text = await send({ type: "REF_TEST" }); status(text, "success"); }
    catch (error) { status(error.message, "error"); }
    finally { node("translation-test").disabled = false; }
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes.referenceTranslation;
    if (area === "local" && change && node("translation-enabled").checked === (change.oldValue?.enabled || false)) node("translation-enabled").checked = change.newValue.enabled;
  });
  send({ type: "REF_SETTINGS_GET" }).then(result => {
    config = result.config;
    providers = result.providers;
    node("translation-provider").replaceChildren(...Object.entries(providers).map(([id, value]) => new Option(value.name, id)));
    node("translation-provider").value = config.provider;
    node("translation-enabled").checked = config.enabled;
    paint();
  }).catch(error => status(error.message, "error"));
})();
