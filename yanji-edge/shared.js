(() => {
  // Radix Colors light scales: Slate 1–12 for chrome; Green/Red/Amber 11 for status.
  const uiColors={"--bg":"#fcfcfd","--ground":"#f9f9fb","--element":"#f0f0f3","--hover":"#e8e8ec","--selected":"#e0e1e6","--line":"#d9d9e0","--control-line":"#cdced6","--focus":"#b9bbc6","--disabled":"#8b8d98","--muted":"#60646c","--text":"#1c2024","--accent":"#1c2024","--accent-hover":"#60646c","--on-accent":"#fff","--success":"#218358","--error":"#ce2c31","--warning":"#ab6400","--scrim":"#00083046","--shadow":"#00002d17","--panel-rgb":"252 252 253"};
  const categories = [
    ["content", "Content", "#ffd400"], ["challenge", "Challenge", "#7BC289"],
    ["cons", "Cons", "#2ea8e5"], ["worth", "Worth", "#f19837"],
    ["cite-useful", "Cite_Useful", "#e56eee"], ["terms", "Terms", "#a28ae5"],
    ["jot", "Jot", "#aaaaaa"], ["unclear", "Unclear", "#ff6666"],
    ["mark", "Mark", "#953984"]
  ].map(([id, name, color]) => ({ id, name, color, meaning: "" }));
  const defaults = {
    categories, defaultCategory: "content", quickCount: 3, style: "both",
    navDots: true, badge: true, continuous: false, shortcuts: false,
    noteTitle: "网页阅读标注", autoSyncOnOpen: true,
    toolbarExpanded: true, toolbarOpacity: 0.88, buttonSize: 28,
    toolbarWidth: 340, toolbarHeight: 0, editorWidth: 360, editorHeight: 0
  };
  const settingsWithDefaults = saved => ({ ...structuredClone(defaults), ...saved });
  const configSettings = saved => Object.fromEntries(Object.keys(defaults).map(key => [key, structuredClone(saved[key] ?? defaults[key])]));
  const icon = name => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({ back: '<path d="m10 5-7 7 7 7M3 12h18"/>', bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>', resume: '<path d="M3 4v5h5"/><path d="M4 9a9 9 0 1 1-1 7M12 7v5l3 2"/>', folder: '<path d="M3 7V4h6l3 3h9v13H3Z"/>', preview: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', external: '<path d="M14 3h7v7M21 3 10 14"/><path d="M10 3H3v18h18v-7"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>', comment: '<path d="M20 11a8 8 0 0 1-8 8H4l1-5a8 8 0 1 1 15-3Z"/><path d="M8 9h8M8 13h5"/>', settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--bg)"/><circle cx="15" cy="17" r="3" fill="var(--bg)"/>', up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>', trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>', refresh: '<path d="M20 7v5h-5M4 17v-5h5M5.5 8a7 7 0 0 1 11.5-3l3 3M4 16l3 3a7 7 0 0 0 11.5-3"/>', locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>' })[name]}</svg>`;
  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
  const folderTitle = value => {
    let name = normalize(value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")).replace(/[. ]+$/, "");
    if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?: *\.|$)/i.test(name)) name = "_" + name;
    return name || "未命名";
  };
  const sentences = (value, locale = "en") => [...new Intl.Segmenter(locale, { granularity: "sentence" }).segment(value)].map(row => normalize(row.segment)).filter(Boolean);
  const doi = value => normalize(value).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)/i, "").toLowerCase();
  const cleanURL = value => {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  };
  const pageID = page => page.doi ? "doi:" + doi(page.doi) : "url:" + cleanURL(page.url);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const returnURL = annotation => {
    const url = new URL(annotation.url);
    url.hash = "yanji=" + encodeURIComponent(annotation.id);
    return url.href;
  };
  const summaryTitle = "我的总结";
  const splitNote = html => {
    const match = /<h2\b[^>]*>\s*我的总结(?:（手写保留）)?\s*<\/h2>/i.exec(html);
    if (!match) throw new Error("这份笔记缺少手写总结分隔标题，已停止覆盖。请恢复该标题或使用新的专用笔记。");
    const legacyHeading = match[0].includes("（手写保留）");
    return { managed: html.slice(0, match.index), manual: match[0].replace("（手写保留）", "") + html.slice(match.index + match[0].length), legacyHeading };
  };
  const alignedEnglish = annotation => [...new Set(annotation.segments.flatMap(segment => (segment.sentencePairs || []).flatMap(pair => pair.english)))];
  const renderManaged = (settings, parent, annotations) => {
    const ordered = [...annotations].sort((a, b) => a.url.localeCompare(b.url) || a.segments[0].index - b.segments[0].index || a.createdAt.localeCompare(b.createdAt));
    let html = `<h1>${escape(settings.noteTitle)}</h1><p>${escape(parent.title)}</p><p>网页摘录由研迹更新；手写内容请放在文末“${summaryTitle}”下。</p>`;
    for (const category of settings.categories) {
      const rows = ordered.filter(annotation => annotation.category === category.id);
      if (!rows.length) continue;
      html += `<h2>${escape(category.name)}</h2>`;
      if (category.meaning) html += `<p>${escape(category.meaning)}</p>`;
      for (const annotation of rows) {
        html += `<blockquote><p><span style="background-color:${category.color}55;">${escape(annotation.quote).replace(/\n/g, "<br/>")}</span></p></blockquote>`;
        if (annotation.comment) html += `<p><strong>我的批注：</strong>${escape(annotation.comment).replace(/\n/g, "<br/>")}</p>`;
        const english = alignedEnglish(annotation);
        if (english.length) html += `<p>${escape(english.join(" "))}</p>`;
        const position = [...new Set(annotation.segments.map(segment => segment.heading || `正文第 ${segment.index + 1} 段`))].join("；");
        html += `<p>位置：${escape(position)} <a href="${escape(returnURL(annotation))}">返回网页段落</a></p>`;
      }
    }
    return html;
  };
  const noteLimit = 200000;
  const planNote = (settings, parent, annotations, manual = `<h2>${summaryTitle}</h2><p></p>`) => {
    const managed = renderManaged(settings, parent, annotations);
    const html = managed + manual;
    if (html.length <= noteLimit) return { managed, html, length: html.length };
    throw Object.assign(new Error("中文摘录、已确认英文、批注与手写总结已超过一份笔记的安全长度。内容仍在本机；请导出备份或减少这篇文献的笔记内容后更新。"), { code: "NOTE_TOO_LONG" });
  };
  const markdown = (page, annotations, settings) => {
    let text = `# ${page.title}\n\n${page.url}\n`;
    for (const category of settings.categories) {
      const rows = annotations.filter(annotation => annotation.category === category.id);
      if (!rows.length) continue;
      text += `\n## ${category.name}\n\n`;
      for (const row of rows) {
        text += `- ${row.quote.replace(/\n/g, "\n  ")}\n${row.comment ? "  想法：" + row.comment.replace(/\n/g, "\n  ") + "\n" : ""}`;
        const english = alignedEnglish(row);
        if (english.length) text += `  ${english.join(" ")}\n`;
        text += `  [返回网页段落](${returnURL(row)})\n`;
      }
    }
    return text;
  };
  const validateSettings = settings => {
    settings = configSettings(settings);
    if (!Array.isArray(settings.categories) || !settings.categories.length || settings.categories.length > 30) throw new Error("请保留 1–30 个分类。");
    const ids = new Set();
    for (const category of settings.categories) {
      if (!/^[a-z0-9-]{1,60}$/.test(category.id) || ids.has(category.id)) throw new Error("分类标识无效或重复。");
      ids.add(category.id);
      if (typeof category.name !== "string" || !category.name.trim() || category.name.length > 60) throw new Error("分类名称不能为空，且不超过 60 字。");
      if (!/^#[a-f0-9]{6}$/i.test(category.color)) throw new Error("颜色须为六位十六进制颜色。");
      if (typeof category.meaning !== "string" || category.meaning.length > 500) throw new Error("分类说明不能超过 500 字。");
    }
    if (!ids.has(settings.defaultCategory)) throw new Error("请选择有效的默认分类。");
    if (!Number.isInteger(settings.quickCount) || settings.quickCount < 1 || settings.quickCount > 9) throw new Error("快捷分类数量应为 1–9。");
    if (!["both", "highlight", "underline"].includes(settings.style)) throw new Error("划线样式无效。");
    if (!settings.noteTitle?.trim() || settings.noteTitle.length > 100) throw new Error("笔记标题不能为空，且不超过 100 字。");
    for (const field of ["navDots", "badge", "continuous", "shortcuts", "autoSyncOnOpen", "toolbarExpanded"]) if (typeof settings[field] !== "boolean") throw new Error("偏好设置格式不正确。");
    for (const [field, min, max] of [["toolbarOpacity", .5, 1], ["buttonSize", 24, 36], ["toolbarWidth", 220, 800], ["toolbarHeight", 0, 640], ["editorWidth", 260, 800], ["editorHeight", 0, 800]]) if (!Number.isFinite(settings[field]) || settings[field] < min || settings[field] > max) throw new Error("浮窗尺寸或透明度无效。");
    return settings;
  };
  const validateAnnotation = (annotation, categoryIDs, saved = false) => {
    if (!annotation || typeof annotation.quote !== "string" || !annotation.quote.trim() || annotation.quote.length > 50000 || typeof annotation.comment !== "string" || annotation.comment.length > 10000 || !categoryIDs.has(annotation.category) || !Array.isArray(annotation.segments) || !annotation.segments.length || annotation.segments.length > 200) throw new Error("标注内容或分类无效。");
    for (const segment of annotation.segments) {
      if (!segment || !Number.isInteger(segment.index) || segment.index < 0 || typeof segment.translated !== "boolean") throw new Error("标注的段落定位格式无效。");
      for (const key of ["quote", "original", "paragraphText", "heading", "before", "after", "prefix", "suffix", "elementId"]) if (typeof segment[key] !== "string" || segment[key].length > 200000) throw new Error("标注的段落定位内容无效。");
      if (segment.translationStart !== undefined && (!Number.isInteger(segment.translationStart) || !Number.isInteger(segment.translationEnd) || segment.translationStart < 0 || segment.translationEnd <= segment.translationStart || segment.translationEnd > segment.paragraphText.length)) throw new Error("译文位置格式无效。");
      if (segment.sentencePairs !== undefined) validatePairs(segment, segment.sentencePairs);
    }
    if (saved && (typeof annotation.id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(annotation.id) || typeof annotation.url !== "string" || !/^(https?:|file:)/.test(annotation.url) || typeof annotation.title !== "string" || !Number.isFinite(Date.parse(annotation.createdAt)) || !Number.isFinite(Date.parse(annotation.updatedAt)))) throw new Error("备份中的标注身份或来源无效。");
    return annotation;
  };
  function validatePairs(segment, pairs) {
    if (!Array.isArray(pairs)) throw new Error("中英句对格式无效。");
    const indices = new Set();
    for (const pair of pairs) {
      if (!Number.isInteger(pair.index) || pair.index < 0 || indices.has(pair.index) || typeof pair.chinese !== "string" || !pair.chinese || !segment.quote.includes(pair.chinese) || !Array.isArray(pair.english) || !pair.english.length || pair.english.some(text => typeof text !== "string" || !text || !segment.original.includes(text))) throw new Error("中英句对必须来自这条标注和对应英文段落。");
      indices.add(pair.index);
    }
    return pairs;
  }
  const copyAnnotation = (annotation, bilingual = false) => bilingual ? [annotation.quote, alignedEnglish(annotation).join("\n"), annotation.comment ? "我的批注：" + annotation.comment : ""].filter(Boolean).join("\n\n") : annotation.quote;
  const readingURL = value => {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) throw new Error("文章链接须为 HTTP 或 HTTPS 地址。");
    url.hash = "";
    const scopus = url.hostname === "scopus.com" || url.hostname.endsWith(".scopus.com");
    if (((url.hostname === "sciencedirect.com" || url.hostname.endsWith(".sciencedirect.com")) && url.pathname.startsWith("/science/article/")) || (scopus && url.pathname.startsWith("/pages/publications/"))) url.search = "";
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || (scopus && /^(?:sid|txGid|sessionSearchId)$/i.test(key))) url.searchParams.delete(key);
    return url.href;
  };
  const translationScopes = { references: "enabled", recommended: "recommendedEnabled", citedBy: "citedByEnabled" };
  globalThis.Yanji = { defaults, uiColors, translationScopes, copyAnnotation, readingURL, settingsWithDefaults, configSettings, icon, normalize, folderTitle, sentences, alignedEnglish, validatePairs, doi, cleanURL, pageID, escape, returnURL, summaryTitle, splitNote, renderManaged, planNote, noteLimit, markdown, validateSettings, validateAnnotation };
})();
