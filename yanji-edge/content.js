(() => {
  if (globalThis.__yanjiLoaded) return;
  globalThis.__yanjiLoaded = true;
  const Y = Yanji, A = YanjiAnchor;
  let page, settings, pending, rendered = [], expanded = false, editing = null, restoreTimer, currentURL = "";
  let lastRestoreMS = 0, restoreCount = 0;
  const host = document.createElement("div");
  host.id = "yanji-root";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host{${Object.entries(Y.uiColors).map(([name,value])=>name+":"+value).join(";")};all:initial;font:14px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;color:var(--text)}
*{box-sizing:border-box}button,select,textarea{font:inherit;color:inherit}button{cursor:pointer;background:color-mix(in srgb,var(--bg) 80%,transparent);border:.5px solid var(--control-line);border-radius:4px;padding:4px 8px;min-height:var(--button-size,28px);font-size:12px}button:hover{background:var(--bg)}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:.5px solid var(--text);outline-offset:3px}button:disabled{cursor:wait;color:var(--muted)}button.primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}button.danger{color:var(--error)}button.swatch{display:inline-flex;gap:6px;align-items:center}.dot{width:10px;height:10px;border-radius:2px;flex:none}.menu,.editor{position:fixed;background:rgb(var(--panel-rgb) / var(--popup-opacity,.88));border:.5px solid var(--control-line);border-radius:8px;padding:8px;box-shadow:0 3px 12px var(--shadow);z-index:2147483647;max-width:calc(100vw - 20px);max-height:calc(100vh - 20px);resize:both;overflow:auto}.menu{min-width:220px;min-height:78px;padding-bottom:10px}.menu[hidden],.editor[hidden],.toast[hidden]{display:none}.tools{display:flex;gap:4px;align-items:center;margin-bottom:8px}.tools strong{margin-right:auto}.tools .close{margin-left:0}.icon{display:inline-flex;align-items:center;justify-content:center;width:var(--button-size,28px);padding:4px;background:transparent;border-color:transparent;flex:none}.menu-actions{float:right;display:flex;gap:2px;margin-left:6px}.categories{display:block;line-height:0}.categories button{line-height:1.5;vertical-align:top;margin:0 4px 4px 0}.editor{min-width:260px;min-height:300px;right:20px;top:80px}.editor label{display:block;font-size:12px;margin:12px 0 6px;color:var(--muted)}.editor select,.editor textarea{width:100%;border:.5px solid var(--control-line);border-radius:4px;padding:8px;background:color-mix(in srgb,var(--bg) 90%,transparent)}.editor textarea{min-height:96px;resize:vertical}.excerpt{max-height:96px;overflow:auto;font-size:14px;color:var(--muted);background:var(--ground);padding:8px;margin:8px 0;white-space:pre-wrap}.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}.hint{font-size:12px;color:var(--muted)}.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);max-width:min(580px,calc(100vw - 30px));padding:10px 16px;background:var(--accent);color:var(--on-accent);border-radius:4px;z-index:2147483647}.toast button{background:transparent;border:0;color:inherit;padding:0 0 0 12px;text-decoration:underline}.nav{position:fixed;right:3px;top:0;height:100vh;width:24px;pointer-events:none;z-index:2147483645}.nav button{position:absolute;width:22px;height:22px;min-height:22px;padding:5px;border:0;background:transparent;pointer-events:auto}.nav i{display:block;width:11px;height:11px;border-radius:50%;border:.5px solid var(--control-line)}strong{font-weight:600}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  </style><div class="menu" hidden role="toolbar" aria-label="选择标注分类"></div><section class="editor" hidden role="dialog" aria-label="编辑标注"><div class="tools"><strong>批注</strong><button class="icon" data-do="copy" title="复制摘录；Shift+点击包含英文句对和批注" aria-label="复制摘录">${Y.icon("copy")}</button><button class="icon close" data-do="cancel" title="关闭" aria-label="关闭">${Y.icon("close")}</button></div><div class="excerpt"></div><label for="yj-category">分类</label><select id="yj-category"></select><label for="yj-comment">我的批注</label><textarea id="yj-comment" placeholder="记录想法…"></textarea><div class="actions"><button class="primary" data-do="save">保存</button><span class="hint">Ctrl + Enter</span><button class="icon danger" data-do="delete" title="删除标注" aria-label="删除标注">${Y.icon("trash")}</button></div></section><div class="nav" aria-label="标注段落导航"></div><div class="toast" hidden role="status" aria-live="polite"></div>`;
  document.documentElement.append(host);
  const menu = shadow.querySelector(".menu"), editor = shadow.querySelector(".editor"), toast = shadow.querySelector(".toast");
  const style = document.createElement("style");
  style.id = "yanji-highlights";
  document.documentElement.append(style);
  const send = async message => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  };
  let toastTimer;
  function notice(message, undoToken) {
    toast.textContent = message;
    if (undoToken) {
      const button = document.createElement("button"); button.textContent = "撤销";
      button.onclick = async () => {
        button.disabled = true;
        try { const restored = await send({ type: "ANN_UNDO", token: undoToken }); if (restored.id === Y.pageID(metadata())) { page = restored; restore(); } notice("已撤销删除"); }
        catch (error) { report(error); }
      };
      toast.append(button);
    }
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, undoToken ? 8000 : 5500);
  }
  const report = error => { console.error("研迹", error); notice(error.message); };
  function metadata() {
    const meta = names => names.map(name => document.querySelector(`meta[name="${name}" i],meta[property="${name}" i]`)?.content).find(Boolean);
    const value = meta(["citation_doi", "dc.identifier.doi", "prism.doi"]);
    let doi = value && /^https?:\/\//.test(value) ? Y.doi(value) : value || "";
    if (!doi) {
      const identifier = meta(["dc.identifier"]);
      if (identifier && /10\.\d{4,9}\//.test(identifier)) doi = Y.doi(identifier);
    }
    if (!doi) {
      const link = document.querySelector('a[href^="https://doi.org/"],a[href^="http://dx.doi.org/"]');
      if (link) doi = Y.doi(link.href);
    }
    return { url: Y.cleanURL(location.href), title: Y.normalize(meta(["citation_title", "dc.title", "og:title"]) || document.title), doi: Y.doi(doi) };
  }
  function categoryButton(category) {
    return `<button class="swatch" data-category="${category.id}" title="${Y.escape(category.meaning || category.name)}"><i class="dot" style="background:${category.color}"></i>${Y.escape(category.name)}</button>`;
  }
  function showMenu() {
    const categories = expanded || settings.toolbarExpanded ? settings.categories : settings.categories.slice(0, settings.quickCount);
    menu.innerHTML = `<div class="menu-actions"><button class="icon" data-do="comment" title="批注" aria-label="批注">${Y.icon("comment")}</button><button class="icon" data-do="copy" title="复制" aria-label="复制">${Y.icon("copy")}</button><button class="icon" data-do="close" title="关闭" aria-label="关闭">${Y.icon("close")}</button></div><div class="categories">` + categories.map(categoryButton).join("") + (!expanded && !settings.toolbarExpanded && settings.categories.length > categories.length ? `<button class="icon" data-do="more" title="更多分类" aria-label="更多分类">${Y.icon("more")}</button>` : "") + "</div>";
    applyPopupSettings();
    const rect = pending.range.getBoundingClientRect();
    menu.style.left = "10px";
    menu.style.top = "10px";
    menu.hidden = false;
    const size = menu.getBoundingClientRect();
    menu.style.left = Math.max(10, Math.min(rect.left, innerWidth - size.width - 10)) + "px";
    menu.style.top = Math.max(10, Math.min(innerHeight - size.height - 10, rect.bottom + size.height + 16 < innerHeight ? rect.bottom + 9 : rect.top - size.height - 9)) + "px";
  }
  async function saveSelection(category, withComment = false) {
    if (!pending) return;
    const capture = pending;
    pending = null;
    menu.hidden = true;
    page = await send({ type: "ANN_SAVE", meta: metadata(), annotation: { quote: capture.quote, segments: capture.segments, category, comment: "" } });
    getSelection().removeAllRanges();
    restore();
    if (withComment) edit(page.annotations.at(-1).id);
    else notice("已保存到浏览器，" + settings.categories.find(row => row.id === category).name);
  }
  function edit(id) {
    const annotation = page.annotations.find(row => row.id === id);
    if (!annotation) throw new Error("标注已不存在，请刷新。");
    editing = id;
    menu.hidden = true;
    editor.querySelector(".excerpt").textContent = annotation.quote;
    editor.querySelector("select").innerHTML = settings.categories.map(row => `<option value="${row.id}">${Y.escape(row.name)}</option>`).join("");
    editor.querySelector("select").value = annotation.category;
    editor.querySelector("textarea").value = annotation.comment;
    applyPopupSettings();
    editor.hidden = false;
    editor.querySelector("textarea").focus();
  }
  async function saveEdit() {
    page = await send({ type: "ANN_UPDATE", pageId: page.id, id: editing, category: editor.querySelector("select").value, comment: editor.querySelector("textarea").value });
    editor.hidden = true;
    editing = null;
    restore();
    notice("批注已保存在浏览器，更新笔记后写入 Zotero。");
  }
  function restore() {
    if (!page || !settings) return;
    const started = performance.now();
    for (const category of settings.categories) CSS.highlights.delete("yanji-" + category.id);
    rendered = [];
    if (!page.annotations.length) {
      shadow.querySelector(".nav").replaceChildren();
      lastRestoreMS = performance.now() - started;
      restoreCount++;
      return;
    }
    const index = A.indexBlocks();
    const highlights = new Map(settings.categories.map(row => [row.id, new Highlight()]));
    const located = [];
    for (const annotation of page.annotations) {
      let first;
      for (const segment of annotation.segments) {
        const result = A.resolve(segment, index);
        if (result && !first) first = result;
        if (result?.range) {
          highlights.get(annotation.category).add(result.range);
          rendered.push({ range: result.range, id: annotation.id });
        }
        if (result) for (const english of new Set((segment.sentencePairs || []).flatMap(pair => pair.english))) {
          const range = A.findRange(result.block, english, "", "", index.originalRanges, true);
          if (range) { highlights.get(annotation.category).add(range); rendered.push({ range, id: annotation.id }); }
        }
      }
      if (first) located.push({ annotation, ...first });
    }
    style.textContent = settings.categories.map(row => `::highlight(yanji-${row.id}){${settings.style !== "underline" ? `background-color:${row.color}55;` : ""}${settings.style !== "highlight" ? `text-decoration:underline;text-decoration-color:${row.color};text-decoration-thickness:2px;` : ""}}`).join("\n") + ".yanji-paragraph-focus{outline:.5px solid "+Y.uiColors["--focus"]+"!important;outline-offset:5px!important;}";
    for (const [id, highlight] of highlights) CSS.highlights.set("yanji-" + id, highlight);
    const nav = shadow.querySelector(".nav");
    nav.replaceChildren();
    if (settings.navDots) {
      const height = Math.max(document.documentElement.scrollHeight, innerHeight);
      for (const row of located) {
        const category = settings.categories.find(value => value.id === row.annotation.category);
        const button = document.createElement("button");
        button.title = category.name + "，" + row.annotation.quote.slice(0, 90);
        button.setAttribute("aria-label", "定位 " + button.title);
        button.style.top = Math.min(innerHeight - 28, Math.max(20, (row.block.getBoundingClientRect().top + scrollY) / height * (innerHeight - 35))) + "px";
        button.innerHTML = `<i style="background:${category.color}"></i>`;
        button.addEventListener("click", () => locate(row.annotation.id));
        nav.append(button);
      }
    }
    const id = /(?:^|&)yanji=([^&]+)/.exec(location.hash.slice(1))?.[1];
    if (id && !host.dataset.located && page.annotations.some(row => row.id === decodeURIComponent(id))) {
      const result = locate(decodeURIComponent(id));
      if (result.found) host.dataset.located = id;
    }
    lastRestoreMS = performance.now() - started;
    restoreCount++;
  }
  function locate(id) {
    const annotation = page.annotations.find(row => row.id === id);
    if (!annotation) return { found: false, message: "这台浏览器没有此标注的定位数据，请先导入研迹备份。" };
    const index = A.indexBlocks();
    const results = annotation.segments.map(segment => A.resolve(segment, index)).filter(Boolean);
    if (!results.length) { notice("未找到原段落，摘录仍完整保留。可尝试打开正文或展开折叠内容。"); return { found: false, message: "未找到原段落" }; }
    const result = results[0];
    result.block.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    result.block.classList.add("yanji-paragraph-focus");
    setTimeout(() => result.block.classList.remove("yanji-paragraph-focus"), 2800);
    const message = result.status === "exact" ? "已定位到标注段落" : "已定位原文段落，译文已变化，历史摘录已保留";
    notice(message);
    return { found: true, status: result.status, message };
  }
  async function load() {
    const result = await send({ type: "PAGE_GET", meta: metadata() });
    page = result.page;
    settings = result.settings;
    currentURL = location.href.split("#")[0];
    applyPopupSettings();
    restore();
    send({ type: "PAGE_OPEN", meta: metadata() }).catch(report);
  }
  function applyPopupSettings() {
    host.style.setProperty("--popup-opacity", settings.toolbarOpacity);
    host.style.setProperty("--button-size", settings.buttonSize + "px");
    for (const [node, prefix] of [[menu, "toolbar"], [editor, "editor"]]) {
      node.style.width = settings[prefix + "Width"] + "px";
      node.style.height = settings[prefix + "Height"] ? settings[prefix + "Height"] + "px" : "auto";
    }
  }
  let resizing;
  shadow.addEventListener("pointerdown", event => {
    const node = event.target.closest(".menu,.editor");
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (event.clientX >= rect.right - 18 && event.clientY >= rect.bottom - 18) resizing = { node, width: rect.width, height: rect.height };
    else if (node === menu && event.target.closest("button")) event.preventDefault();
  });
  addEventListener("pointerup", () => {
    if (!resizing) return;
    const { node, width, height } = resizing;
    resizing = null;
    const rect = node.getBoundingClientRect();
    if (Math.abs(rect.width - width) < 2 && Math.abs(rect.height - height) < 2) return;
    send({ type: "POPUP_SIZE", popup: node === menu ? "menu" : "editor", width: Math.round(rect.width), height: Math.round(rect.height) }).catch(report);
  });
  menu.addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;
    try {
      if (button.dataset.category) await saveSelection(button.dataset.category);
      else if (button.dataset.do === "more") { expanded = true; showMenu(); }
      else if (button.dataset.do === "comment") await saveSelection(settings.defaultCategory, true);
      else if (button.dataset.do === "copy") { await navigator.clipboard.writeText(Y.copyAnnotation({quote:pending.quote,segments:pending.segments,comment:""},event.shiftKey)); notice("已复制摘录"); }
      else menu.hidden = true;
    } catch (error) { report(error); }
  });
  editor.addEventListener("click", async event => {
    const action = event.target.closest("button")?.dataset.do;
    try {
      if (action === "copy") { const annotation=page.annotations.find(row=>row.id===editing); await navigator.clipboard.writeText(Y.copyAnnotation(annotation,event.shiftKey)); notice(event.shiftKey?"已复制双语摘录与批注":"已复制摘录"); }
      else if (action === "save") await saveEdit();
      else if (action === "cancel") { editor.hidden = true; editing = null; }
      else if (action === "delete") {
        const result = await send({ type: "ANN_DELETE", pageId: page.id, id: editing });
        page = result.page;
        editor.hidden = true;
        editing = null;
        restore();
        notice("标注已删除", result.undoToken);
      }
    } catch (error) { report(error); }
  });
  shadow.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !editor.hidden) { event.preventDefault(); saveEdit().catch(report); }
  });
  document.addEventListener("pointerup", event => {
    if (event.composedPath().includes(host) || !settings) return;
    setTimeout(async () => {
      const selection = getSelection();
      if (!selection.rangeCount || selection.isCollapsed || !Y.normalize(selection.toString())) return;
      const selectedElement = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
      if (selectedElement.closest("input,textarea,[contenteditable='true']")) return;
      try {
        const range = selection.getRangeAt(0).cloneRange();
        pending = { quote: selection.toString().trim(), range, segments: A.capture(range) };
        expanded = false;
        if (settings.continuous) await saveSelection(settings.defaultCategory);
        else showMenu();
      } catch (error) { report(error); }
    }, 20);
  });
  document.addEventListener("click", event => {
    if (event.composedPath().includes(host) || !getSelection().isCollapsed) return;
    const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
    const match = caret && rendered.find(row => row.range.isPointInRange(caret.startContainer, caret.startOffset));
    if (match) { edit(match.id); send({ type: "ANN_FOCUS", pageId:page.id, id:match.id }).catch(report); }
    else menu.hidden = true;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") { menu.hidden = true; editor.hidden = true; }
    if (settings?.shortcuts && event.altKey && /^[1-9]$/.test(event.key) && pending && !event.target.closest("input,textarea,[contenteditable='true']")) {
      const category = settings.categories[Number(event.key) - 1];
      if (category) { event.preventDefault(); saveSelection(category.id).catch(report); }
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === "CONTEXT") {
      const reply = () => respond({ ok: true, data: { meta: metadata(), page, settings, diagnostics: { lastRestoreMS, restoreCount, renderedRanges: rendered.length, annotationBytes: new TextEncoder().encode(JSON.stringify(page.annotations)).byteLength, pageJSHeapBytes: performance.memory?.usedJSHeapSize || null } } });
      if (page) reply();
      else { initialLoad.then(reply, error => respond({ ok: false, error: error.message })); return true; }
      return;
    }
    if (message.type === "LOCATE") { respond({ ok: true, data: locate(message.id) }); return; }
    if (message.type === "EDIT") { edit(message.id); respond({ ok: true, data: true }); return; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) {
      const previous = settings;
      settings = Y.settingsWithDefaults(changes.settings.newValue);
      applyPopupSettings();
      if (JSON.stringify(previous.categories) !== JSON.stringify(settings.categories) || previous.style !== settings.style || previous.navDots !== settings.navDots) restore();
    }
    if (page && changes["page:" + page.id]) {
      const next = changes["page:" + page.id].newValue;
      const changed = JSON.stringify(page.annotations) !== JSON.stringify(next.annotations);
      page = next;
      if (editing && !page.annotations.some(row => row.id === editing)) { editor.hidden = true; editing = null; }
      if (changed) restore();
    }
  });
  const observer = new MutationObserver(mutations => {
    if (document.hidden) return;
    if (!mutations.some(mutation => !host.contains(mutation.target) && mutation.target !== style && !style.contains(mutation.target))) return;
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      if (currentURL !== location.href.split("#")[0]) load().catch(report);
      else restore();
    }, 500);
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  addEventListener("hashchange", () => { delete host.dataset.located; restore(); });
  addEventListener("visibilitychange", () => { if (!document.hidden) restore(); });
  addEventListener("resize", () => { clearTimeout(restoreTimer); restoreTimer = setTimeout(restore, 200); });
  const initialLoad = load();
  globalThis.YanjiPage = { metadata, ready: initialLoad, notice, hasAnnotations: () => !!page?.annotations.length };
  initialLoad.catch(report);
})();
