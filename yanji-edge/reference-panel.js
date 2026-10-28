(() => {
  const node = id => document.getElementById(id);
  const send = async message => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result.ok) throw Error(result.error);
    return result.data;
  };
  let state;
  const choices = [["reference-enabled", "references"], ["recommended-enabled", "recommended"], ["cited-by-enabled", "citedBy"]];
  function show(progress) {
    node("reference-status").textContent = progress.error || (progress.enabled ? `${progress.done} / ${progress.found}` : "");
    node("reference-status").className = "status " + (progress.error ? "error" : "");
  }
  async function refresh() {
    state = await send({ type: "REF_STATE" });
    for (const [id, area] of choices) { node(id).checked = state[Yanji.translationScopes[area]]; node(id).title = state.name; }
    if (!choices.some(([, area]) => state[Yanji.translationScopes[area]])) { show({ enabled: false }); return; }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!/^(https?:|file:)/.test(tab?.url || "")) return;
    const result = await chrome.tabs.sendMessage(tab.id, { type: "REFERENCE_STATUS" });
    if (result?.ok) show(result.data);
  }
  const report = error => { console.error("研迹参考文献", error); node("reference-status").textContent = error.message; node("reference-status").className = "status error"; };
  node("reference-options").innerHTML = Yanji.icon("settings");
  node("reference-options").onclick = () => send({ type: "OPTIONS_OPEN", section: "translation", display: { left: screen.availLeft, top: screen.availTop, width: screen.availWidth, height: screen.availHeight } }).catch(report);
  for (const [id, area] of choices) node(id).onchange = async () => {
    const enabled = node(id).checked;
    node(id).disabled = true;
    try {
      if (enabled && !state.configured) throw Error("请先打开翻译设置，填写 API Key。");
      if (enabled && !(await chrome.permissions.request({ origins: [state.origin] }))) throw Error("需要允许访问所选翻译服务。");
      state = await send({ type: "REF_TOGGLE", enabled, area });
      if (!choices.some(([, scope]) => state[Yanji.translationScopes[scope]])) show({ enabled: false });
    } catch (error) { node(id).checked = !enabled; report(error); }
    finally { node(id).disabled = false; }
  };
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.referenceTranslation) refresh().catch(report); });
  chrome.tabs.onActivated.addListener(() => refresh().catch(report));
  chrome.runtime.onMessage.addListener((message, sender) => { if (message.type === "REF_PROGRESS" && sender.tab?.id === tabId) show(message.progress); });
  refresh().catch(report);
})();
