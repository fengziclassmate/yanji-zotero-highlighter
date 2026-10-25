(() => {
  const Y = Yanji;
  const blocks = "p, li, blockquote, td, figcaption, h1, h2, h3, h4, h5, h6, div[id^='sp'], .para, [data-imt-p]";
  const translated = ".immersive-translate-target-wrapper, .immersive-translate-target-inner, [data-immersive-translate-translation-element], .immersive-translate-target";
  const ignored = "script, style, noscript, textarea, input, [contenteditable='true'], #yanji-root";
  const element = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  function textNodes(root, originalOnly = false) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest(ignored) || (originalOnly && parent.closest(translated))) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    } });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }
  const text = (root, originalOnly = false) => Y.normalize(textNodes(root, originalOnly).map(node => node.textContent).join(""));
  function paragraph(node) {
    const el = element(node);
    const block = el.closest(blocks);
    if (block) return block;
    const translation = el.closest(translated);
    if (translation) return translation;
    return el.closest("div, section, article") || el;
  }
  function headings(block) {
    const preceding = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(heading => !heading.closest(translated) && (heading === block || heading.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING));
    return preceding.length ? text(preceding.at(-1), true) : "";
  }
  function allBlocks() {
    return indexBlocks().blocks;
  }
  function indexBlocks() {
    const elements = [], byText = new Map();
    for (const block of document.querySelectorAll(blocks + ", [data-immersive-translate-paragraph-id]")) {
      if (block.closest(ignored) || block.closest(translated)) continue;
      const original = text(block, true);
      if (!original) continue;
      elements.push(block);
      if (!byText.has(original)) byText.set(original, []);
      byText.get(original).push(block);
    }
    return { blocks: elements, byText, ranges: new WeakMap(), originalRanges: new WeakMap() };
  }
  function originalBlock(block, target) {
    if (!target) return block;
    if (text(block, true).length > 10 && !block.matches(translated) && !block.closest(translated)) return block;
    const owner = target.parentElement.closest(blocks);
    if (owner && text(owner, true).length > 10) return owner;
    const container = target.closest("[data-immersive-translate-paragraph-id]");
    const id = container?.getAttribute("data-immersive-translate-paragraph-id");
    if (id) {
      const peers = [...document.querySelectorAll(`[data-immersive-translate-paragraph-id="${CSS.escape(id)}"]`)];
      const source = peers.find(peer => !peer.closest(translated) && text(peer, true).length > 10);
      if (source) return source;
    }
    let current = block;
    for (let level = 0; level < 3 && current; level++, current = current.parentElement) {
      const previous = current.previousElementSibling;
      if (previous && !previous.closest(ignored) && !previous.closest(translated)) {
        const value = text(previous, true);
        if (value.length > 15 && /[a-z]{3}/i.test(value) && (value.match(/[\u4e00-\u9fff]/g)?.length || 0) < value.length / 5) return previous;
      }
    }
    return block;
  }
  function capture(range) {
    const grouped = new Map();
    const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
    for (const node of textNodes(root)) {
      if (!range.intersectsNode(node)) continue;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.length;
      if (start >= end) continue;
      const block = paragraph(node);
      if (!grouped.has(block)) grouped.set(block, { pieces: [], node });
      grouped.get(block).pieces.push(node.textContent.slice(start, end));
    }
    const candidates = allBlocks();
    const segments = [];
    for (const [block, { pieces, node }] of grouped) {
      const quote = Y.normalize(pieces.join(""));
      if (!quote) continue;
      const target = element(node).closest(translated);
      const blockTarget = block.matches(translated) ? block : block.closest(translated);
      const isTranslated = !!(target || blockTarget || textNodes(block).some(node => node.parentElement.closest(translated) && range.intersectsNode(node)));
      const source = originalBlock(block, target || blockTarget || (isTranslated ? block.querySelector(translated) : null));
      const index = candidates.indexOf(source);
      const paragraphText = text(block);
      const position = paragraphText.indexOf(quote);
      segments.push({ quote, original: text(source, true) || text(source), paragraphText,
        translated: isTranslated, index: Math.max(0, index), elementId: source.id || "",
        heading: headings(source), before: index > 0 ? text(candidates[index - 1], true) : "",
        after: index >= 0 && index + 1 < candidates.length ? text(candidates[index + 1], true) : "",
        prefix: position >= 0 ? paragraphText.slice(Math.max(0, position - 35), position) : "",
        suffix: position >= 0 ? paragraphText.slice(position + quote.length, position + quote.length + 35) : "" });
      if (isTranslated) {
        const translationText = text(target || blockTarget || block.querySelector(translated));
        const start = paragraphText.indexOf(translationText);
        if (translationText && start >= 0 && start === paragraphText.lastIndexOf(translationText)) Object.assign(segments.at(-1), {translationStart:start,translationEnd:start+translationText.length});
      }
    }
    if (!segments.length) throw new Error("没有找到可标注的正文文字。");
    return segments;
  }
  function findRange(root, quote, prefix = "", suffix = "", cache = new WeakMap(), originalOnly = false) {
    let indexed = cache.get(root);
    if (!indexed) {
      const nodes = textNodes(root, originalOnly).map(node => ({ node, value: node.textContent, compact: node.textContent.replace(/\s/g, "") }));
      indexed = { nodes, compact: nodes.map(row => row.compact).join("") };
      cache.set(root, indexed);
    }
    const { nodes, compact } = indexed;
    const needle = quote.replace(/\s/g, "");
    if (!needle) return null;
    const matches = [];
    let index = compact.indexOf(needle);
    while (index >= 0) {
      const left = prefix.replace(/\s/g, ""), right = suffix.replace(/\s/g, "");
      const score = Number(!!left && compact.slice(Math.max(0, index - left.length), index).endsWith(left)) + Number(!!right && compact.slice(index + needle.length).startsWith(right));
      matches.push({ index, score });
      index = compact.indexOf(needle, index + 1);
    }
    matches.sort((a, b) => b.score - a.score);
    if (!matches.length || (matches.length > 1 && matches[0].score === matches[1].score)) return null;
    const position = index => {
      for (const row of nodes) {
        if (index >= row.compact.length) { index -= row.compact.length; continue; }
        for (let offset = 0; offset < row.value.length; offset++) {
          if (/\s/.test(row.value[offset])) continue;
          if (index-- === 0) return { node: row.node, offset };
        }
      }
    };
    const start = position(matches[0].index), end = position(matches[0].index + needle.length - 1);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    return range;
  }
  function resolve(segment, index = indexBlocks()) {
    const candidates = index.blocks;
    const wanted = Y.normalize(segment.original);
    let matches = index.byText.get(wanted) || [];
    const identified = segment.elementId && document.getElementById(segment.elementId);
    if (identified && matches.includes(identified)) matches = [identified];
    if (matches.length > 1) {
      const ranked = matches.map(block => {
        const index = candidates.indexOf(block);
        const score = Number(!!segment.heading && headings(block) === segment.heading) +
          Number(!!segment.before && index > 0 && text(candidates[index - 1], true) === segment.before) +
          Number(!!segment.after && index + 1 < candidates.length && text(candidates[index + 1], true) === segment.after);
        return { block, score };
      }).sort((a, b) => b.score - a.score);
      matches = ranked[0].score > ranked[1].score ? [ranked[0].block] : [];
    }
    let block = matches[0];
    if (!block) {
      let translatedMatches = [...document.querySelectorAll(blocks)].filter(candidate => !candidate.closest(ignored) && text(candidate) === segment.paragraphText);
      if (!translatedMatches.length) translatedMatches = [...document.querySelectorAll(translated)].filter(candidate => !candidate.parentElement.closest(translated) && text(candidate) === segment.paragraphText);
      if (translatedMatches.length === 1) block = translatedMatches[0];
    }
    if (!block) return null;
    let roots = [block];
    if (segment.translated) {
      const nested = [...block.querySelectorAll(translated)].filter(node => !node.parentElement.closest(translated));
      const next = block.nextElementSibling;
      const siblingTargets = next ? (next.matches(translated) ? [next] : [...next.querySelectorAll(translated)]) : [];
      roots = [...nested, ...siblingTargets, block];
    }
    for (const root of roots) {
      const range = findRange(root, segment.quote, segment.prefix, segment.suffix, index.ranges);
      if (range) return { block, range, status: "exact" };
    }
    return { block, range: null, status: "paragraph" };
  }
  globalThis.YanjiAnchor = { capture, resolve, allBlocks, indexBlocks, text, textNodes, findRange, translated };
})();
