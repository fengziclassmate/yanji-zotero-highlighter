(() => {
  if (globalThis.YanjiReferences) return;
  const Y = Yanji;
  const roots = '[role="doc-bibliography"],#references,#references-section,#reference-list,#bibliography,.bibliography,.ref-list,.references,.references-container,.c-article-references__list';
  const rows = 'li,[role="doc-biblioentry"],.reference-container,.reference,.csl-entry,.ref,.cit';
  const titles = '.contribution .title,.ref-title,.article-title,.articleTitle,.reference-title,.cit-article-title,.hlFld-Title,[data-testid="reference-title"],[itemprop="headline"],[itemtype$="/ScholarlyArticle"]>[itemprop="name"],[itemtype$="/Book"]>[itemprop="name"]';
  const excluded = '[data-yanji-ref-translation],.immersive-translate-target-wrapper,.immersive-translate-target-inner,[data-immersive-translate-translation-element],script,style,button';
  const records = new Map();
  let config = { enabled: false }, generation = 0, working = false, pending = [], lastError = "", timer, currentURL = location.href;
  const send = async message => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result.ok) throw Error(result.error);
    return result.data;
  };
  function sourceText(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, { acceptNode: text => text.parentElement.closest(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const pieces = [];
    while (walker.nextNode()) pieces.push(walker.currentNode.textContent);
    return Y.normalize(pieces.join(""));
  }
  const eligible = text => text.length >= 3 && text.length <= 2000 && /[a-z]{2}/i.test(text) && (text.match(/[\u3400-\u9fff]/g)?.length || 0) < text.length / 5 && !/^https?:|^doi\b/i.test(text);
  function collect() {
    const found = new Map();
    for (const root of document.querySelectorAll(roots)) {
      for (const title of root.querySelectorAll(titles)) {
        if (title.closest(excluded)) continue;
        const entry = title.closest(rows), text = sourceText(title);
        if (entry && root.contains(entry) && !found.has(entry) && eligible(text)) found.set(entry, text);
      }
      for (const entry of root.querySelectorAll(rows)) {
        if (found.has(entry) || entry.closest(excluded) || entry.querySelector(rows)) continue;
        const text = sourceText(entry), quote = [...text.matchAll(/["“]([^"”]{3,2000})["”]/g)].map(match => match[1]).find(eligible);
        if (quote) { found.set(entry, quote); continue; }
        const link = [...entry.querySelectorAll('a[href]')].filter(node => !node.closest(excluded)).map(sourceText).find(value => eligible(value) && (value.match(/[a-z]{2,}/gi)?.length || 0) >= 3 && !/^(?:view|show|open|download|find|read|visit|access|available)\b|google scholar|crossref|full text|web of science|pubmed/i.test(value));
        if (link) found.set(entry, link);
      }
    }
    return found;
  }
  const progress = () => ({ enabled: config.enabled, found: records.size, done: [...records.values()].filter(row => row.done).length, error: lastError });
  function notify() { send({ type: "REF_PROGRESS", progress: progress() }).catch(error => console.error("研迹参考文献", error)); }
  function clear() {
    generation++;
    observer.disconnect();
    visible.disconnect();
    clearTimeout(timer);
    for (const row of records.values()) row.node?.remove();
    records.clear();
    pending = [];
    lastError = "";
  }
  async function pump() {
    if (working || !config.enabled || document.hidden || lastError) return;
    working = true;
    try {
      while (pending.length && config.enabled && !document.hidden && !lastError) {
        const row = pending.shift(), run = generation;
        if (!row.entry.isConnected || records.get(row.entry) !== row) continue;
        try {
          const text = await send({ type: "REF_TRANSLATE", text: row.title });
          if (run !== generation || !row.entry.isConnected || records.get(row.entry) !== row) continue;
          const node = document.createElement("span");
          node.dataset.yanjiRefTranslation = "";
          node.className = "notranslate";
          node.setAttribute("translate", "no");
          node.lang = "zh-CN";
          node.style.cssText = `display:block;margin:4px 0 0;font:inherit;line-height:1.65;color:${Y.uiColors["--muted"]}`;
          node.textContent = text;
          row.entry.append(node);
          row.node = node;
          row.done = true;
        } catch (error) { if (run === generation) { console.error("研迹参考文献", error); lastError = error.message; } }
        notify();
      }
    } finally { working = false; }
    if (pending.length && config.enabled && !document.hidden && !lastError) pump();
  }
  const visible = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const row = records.get(entry.target);
      if (entry.isIntersecting && row && !row.queued) { row.queued = true; pending.push(row); visible.unobserve(entry.target); }
    }
    pump();
  }, { rootMargin: "400px" });
  function scan() {
    if (!config.enabled || document.hidden) return;
    if (location.href !== currentURL) { clear(); currentURL = location.href; observer.observe(document.body, { childList: true, characterData: true, subtree: true }); }
    const found = collect();
    for (const [entry, row] of records) if (!entry.isConnected || found.get(entry) !== row.title) { row.node?.remove(); visible.unobserve(entry); records.delete(entry); }
    for (const [entry, title] of found) if (!records.has(entry)) { const row = { entry, title, queued: false, done: false }; records.set(entry, row); visible.observe(entry); }
    notify();
  }
  const observer = new MutationObserver(mutations => {
    if (document.hidden || !mutations.some(mutation => !(mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement).closest(excluded) && (mutation.type === "characterData" || [...mutation.addedNodes, ...mutation.removedNodes].some(node => node.nodeType !== Node.ELEMENT_NODE || !node.matches('[data-yanji-ref-translation]'))))) return;
    clearTimeout(timer);
    timer = setTimeout(scan, 350);
  });
  function apply(next) {
    clear();
    config = { enabled: next.enabled, provider: next.provider };
    if (config.enabled) { observer.observe(document.body, { childList: true, characterData: true, subtree: true }); scan(); }
    else notify();
  }
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.referenceTranslation) apply(changes.referenceTranslation.newValue); });
  chrome.runtime.onMessage.addListener((message, sender, respond) => { if (message.type === "REFERENCE_STATUS") respond({ ok: true, data: progress() }); });
  addEventListener("visibilitychange", () => { if (!document.hidden && config.enabled) { scan(); pump(); } });
  globalThis.YanjiReferences = { collect, sourceText, progress };
  send({ type: "REF_STATE" }).then(apply).catch(error => console.error("研迹参考文献", error));
})();
