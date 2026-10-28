(() => {
  if (globalThis.YanjiReferences) return;
  const Y = Yanji;
  const roots = '[role="doc-bibliography"],#references,#references-section,#reference-list,#bibliography,.bibliography,.ref-list,.references,.references-container,.c-article-references__list';
  const rows = 'li,[role="doc-biblioentry"],.reference-container,.reference,.csl-entry,.ref,.cit';
  const titles = '.contribution .title,.ref-title,.article-title,.articleTitle,.reference-title,.cit-article-title,.hlFld-Title,[data-testid="reference-title"],[itemprop="headline"],[itemtype$="/ScholarlyArticle"]>[itemprop="name"],[itemtype$="/Book"]>[itemprop="name"]';
  const excluded = '[data-yanji-ref-translation],.immersive-translate-target-wrapper,.immersive-translate-target-inner,[data-immersive-translate-translation-element],script,style,button';
  const relatedAreas = {
    recommended: '#recommended-articles,[data-section-name="recommended-articles"]',
    citedBy: '#cited-by,#citing-articles,[data-section-name="cited-by"]'
  };
  const records = new Map();
  let config = { enabled: false }, generation = 0, working = false, pending = [], lastError = "", timer, currentURL = location.href;
  const send = async message => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result.ok) throw Object.assign(Error(result.error), { code: result.code });
    return result.data;
  };
  function sourceText(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, { acceptNode: text => text.parentElement.closest(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const pieces = [];
    while (walker.nextNode()) pieces.push(walker.currentNode.textContent);
    return Y.normalize(pieces.join(""));
  }
  const eligible = text => text.length >= 3 && text.length <= 2000 && /[a-z]{2}/i.test(text) && (text.match(/[\u3400-\u9fff]/g)?.length || 0) < text.length / 5 && !/^https?:|^doi\b/i.test(text);
  const enabled = area => !!config[Y.translationScopes[area]];
  const active = () => Object.keys(Y.translationScopes).some(enabled);
  function collectRelatedTitles() {
    const found = new Map();
    for (const [area, selector] of Object.entries(relatedAreas)) {
      for (const root of document.querySelectorAll(selector)) {
        for (const candidate of root.querySelectorAll('a[id$="-title"],.related-article-card .article-title,.related-article-card h3')) {
          const entry = candidate.matches("a") ? candidate : candidate.querySelector("a") || candidate;
          if (entry.closest(excluded) || found.has(entry)) continue;
          const text = sourceText(entry);
          if (eligible(text)) found.set(entry, { title: text, area });
        }
      }
    }
    if ((location.hostname === "scopus.com" || location.hostname.endsWith(".scopus.com")) && /^\/(?:results|pages\/results)(?:\/|$)/.test(location.pathname)) {
      for (const entry of document.querySelectorAll('table h3 a[href*="/pages/publications/"]')) {
        if (entry.closest(excluded)) continue;
        const text = sourceText(entry);
        if (eligible(text)) found.set(entry, { title: text, area: "citedBy", mount: entry.closest("h3") });
      }
    }
    return found;
  }
  function collectReferenceTitles() {
    const found = new Map();
    for (const root of document.querySelectorAll(roots)) {
      for (const title of root.querySelectorAll(titles)) {
        if (title.closest(excluded)) continue;
        const entry = title.closest(rows), text = sourceText(title);
        if (entry && root.contains(entry) && !found.has(entry) && eligible(text)) found.set(entry, { title: text, area: "references" });
      }
      for (const entry of root.querySelectorAll(rows)) {
        if (found.has(entry) || entry.closest(excluded) || entry.querySelector(rows)) continue;
        const text = sourceText(entry), quote = [...text.matchAll(/["“]([^"”]{3,2000})["”]/g)].map(match => match[1]).find(eligible);
        if (quote) { found.set(entry, { title: quote, area: "references" }); continue; }
        const link = [...entry.querySelectorAll('a[href]')].filter(node => !node.closest(excluded)).map(sourceText).find(value => eligible(value) && (value.match(/[a-z]{2,}/gi)?.length || 0) >= 3 && !/^(?:view|show|open|download|find|read|visit|access|available)\b|google scholar|crossref|full text|web of science|pubmed/i.test(value));
        if (link) found.set(entry, { title: link, area: "references" });
      }
    }
    return found;
  }
  function collect() {
    const found = enabled("references") ? collectReferenceTitles() : new Map();
    for (const [entry, source] of collectRelatedTitles()) if (enabled(source.area)) found.set(entry,source);
    return found;
  }
  function collectBookmarkTitles() {
    const found = collectRelatedTitles(), handled = new Set();
    const referenceLink = (row,candidate) => {
      const links = [...row.querySelectorAll("a[href]")].filter(a=>/^https?:/.test(a.href) && !a.getAttribute("href").startsWith("#"));
      const direct = candidate?.matches("a[href]") ? candidate : candidate?.querySelector("a[href]");
      return (links.includes(direct) ? direct : null) || links.find(a=>/^https?:\/\/(?:dx\.)?doi\.org\//i.test(a.href)) || links.find(a=>/\/science\/article\//.test(a.href) || /^view at publisher$/i.test(sourceText(a)));
    };
    for (const root of document.querySelectorAll(roots)) for (const candidate of root.querySelectorAll(titles)) {
      if (candidate.closest(excluded)) continue;
      const row = candidate.closest(rows), title = sourceText(candidate);
      if (!row || !title || title.length > 2000 || handled.has(row)) continue;
      const link = referenceLink(row,candidate);
      if (link) {found.set(candidate, { title, url: link.href, mount: candidate.matches("a") ? candidate.parentElement : candidate, area: "references" });handled.add(row);}
    }
    for(const [row,reference] of collectReferenceTitles()) if(!handled.has(row)) {
      const link=referenceLink(row,null);
      if(link)found.set(row,{title:reference.title,url:link.href,mount:row,area:"references"});
    }
    return found;
  }
  const progress = () => ({ enabled: active(), found: records.size, done: [...records.values()].filter(row => row.done).length, error: lastError });
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
    if (working || !active() || document.hidden || lastError) return;
    working = true;
    try {
      while (pending.length && active() && !document.hidden && !lastError) {
        const row = pending.shift(), run = generation;
        if (!row.entry.isConnected || records.get(row.entry) !== row) continue;
        try {
          const text = await send({ type: "REF_TRANSLATE", text: row.title, area: row.area });
          if (run !== generation || !row.entry.isConnected || records.get(row.entry) !== row) continue;
          const node = document.createElement("span");
          node.dataset.yanjiRefTranslation = "";
          node.className = "notranslate";
          node.setAttribute("translate", "no");
          node.lang = "zh-CN";
          node.style.cssText = `display:block;margin:4px 0 0;font:inherit;line-height:1.65;color:${Y.uiColors["--muted"]}`;
          node.textContent = text;
          (row.mount || row.entry).append(node);
          row.node = node;
          row.done = true;
        } catch (error) { if (run === generation && records.get(row.entry) === row && enabled(row.area) && error.code !== "TRANSLATION_CANCELLED") { console.error("研迹文献翻译", error); lastError = error.message; } }
        notify();
      }
    } finally { working = false; }
    if (pending.length && active() && !document.hidden && !lastError) pump();
  }
  const visible = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const row = records.get(entry.target);
      if (entry.isIntersecting && row && !row.queued) { row.queued = true; pending.push(row); visible.unobserve(entry.target); }
    }
    pump();
  }, { rootMargin: "400px" });
  function scan() {
    if (!active() || document.hidden) return;
    if (location.href !== currentURL) { clear(); currentURL = location.href; observer.observe(document.body, { childList: true, characterData: true, subtree: true }); }
    const found = collect();
    for (const [entry, row] of records) if (!entry.isConnected || (row.node && !row.node.isConnected) || found.get(entry)?.title !== row.title || found.get(entry)?.area !== row.area || found.get(entry)?.mount !== row.mount) { row.node?.remove(); visible.unobserve(entry); records.delete(entry); }
    for (const [entry, source] of found) if (!records.has(entry)) { const row = { entry, ...source, queued: false, done: false }; records.set(entry, row); visible.observe(entry); }
    notify();
    pump();
  }
  const observer = new MutationObserver(mutations => {
    if (document.hidden || !mutations.some(mutation => !(mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement)?.closest(excluded) && (mutation.type === "characterData" || [...mutation.addedNodes, ...mutation.removedNodes].some(node => node.nodeType !== Node.ELEMENT_NODE || !node.matches('[data-yanji-ref-translation]'))))) return;
    clearTimeout(timer);
    timer = setTimeout(scan, 350);
  });
  function apply(next, serviceChanged = true) {
    if (serviceChanged) clear();
    config = { enabled: next.enabled, recommendedEnabled: next.recommendedEnabled || false, citedByEnabled: next.citedByEnabled || false, provider: next.provider };
    lastError = "";
    if (active()) { observer.observe(document.body, { childList: true, characterData: true, subtree: true }); scan(); }
    else { clear(); notify(); }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes.referenceTranslation;
    if (area === "local" && change) apply(change.newValue, change.oldValue?.provider !== change.newValue.provider || JSON.stringify(change.oldValue?.credentials) !== JSON.stringify(change.newValue.credentials));
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => { if (message.type === "REFERENCE_STATUS") respond({ ok: true, data: progress() }); });
  addEventListener("visibilitychange", () => { if (!document.hidden && active()) scan(); });
  globalThis.YanjiReferences = { collect, collectRelatedTitles, collectBookmarkTitles, sourceText, progress };
  send({ type: "REF_STATE" }).then(apply).catch(error => console.error("研迹参考文献", error));
})();
