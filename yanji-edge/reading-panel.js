(() => {
  const node = id => document.getElementById(id);
  let offset = 0, next = null, sequence = 0;
  node("return-source").innerHTML = Yanji.icon("back");
  node("resume-reading").innerHTML = Yanji.icon("resume");
  async function refreshContext() {
    const run = ++sequence;
    node("return-source").hidden = true; node("resume-reading").hidden = true;
    if (!page) return;
    const info = await send({ type: "READ_INFO", tabId, meta: { url: page.url, title: page.title, doi: page.doi } });
    if (run !== sequence) return;
    node("return-source").hidden = !info.source;
    node("return-source").title = info.source ? "返回来源文章：" + info.source.title : "返回来源文章";
    node("resume-reading").hidden = !info.resume;
    node("resume-reading").title = info.resume ? "继续上次阅读：" + new Date(info.resume.savedAt).toLocaleString() : "继续上次阅读";
  }
  async function refreshList(requested = offset) {
    const result = await send({ type: "READ_LIST", offset: requested, countOnly: !node("reading-list").open });
    node("reading-list-count").textContent = result.count ? String(result.count) : "";
    if (!node("reading-list").open) return;
    offset = result.offset; next = result.next;
    node("reading-list-items").innerHTML = result.items.map(row => `<div class="reading-list-item"><button class="reading-open" data-url="${Yanji.escape(row.url)}" title="${Yanji.escape(row.title)}">${Yanji.escape(row.title)}</button><button class="icon" data-remove="${Yanji.escape(row.url)}" data-title="${Yanji.escape(row.title)}" title="移出稍后读" aria-label="移出稍后读">${Yanji.icon("bookmark")}</button></div>`).join("") || '<p class="muted">在推荐或被引标题旁点书签，即可加入。</p>';
    node("reading-list-pages").hidden = result.count <= 50;
    node("reading-list-prev").disabled = offset === 0;
    node("reading-list-next").disabled = next === null;
    node("reading-list-page").textContent = `${Math.floor(offset/50)+1} / ${Math.max(1,Math.ceil(result.count/50))}`;
  }
  const reportReading = error => report("#page-status", error);
  node("return-source").onclick = () => send({ type: "READ_SOURCE", tabId }).catch(reportReading);
  node("resume-reading").onclick = async () => {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: "READ_RESUME" });
      if (!result.ok) throw Error(result.error);
    } catch (error) { reportReading(error); }
  };
  node("reading-list").ontoggle = () => { if (node("reading-list").open) refreshList().catch(reportReading); };
  node("reading-list-prev").onclick = () => refreshList(Math.max(0, offset-50)).catch(reportReading);
  node("reading-list-next").onclick = () => refreshList(next).catch(reportReading);
  node("reading-list-items").onclick = async event => {
    const remove = event.target.closest("[data-remove]"), open = event.target.closest("[data-url]");
    try {
      if (remove) await send({ type: "READ_TOGGLE", url: remove.dataset.remove, title: remove.dataset.title, saved: false });
      else if (open) await send({ type: "READ_OPEN", url: open.dataset.url });
    } catch (error) { reportReading(error); }
  };
  document.addEventListener("yanji-context-changed", () => refreshContext().catch(reportReading));
  chrome.runtime.onMessage.addListener((message, sender) => { if (message.type === "READING_CHANGED" && sender.tab?.id === tabId) refreshContext().catch(reportReading); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && Object.keys(changes).some(key => key.startsWith("later:"))) refreshList().catch(reportReading); });
  refreshContext().catch(reportReading); refreshList(0).catch(reportReading);
})();
