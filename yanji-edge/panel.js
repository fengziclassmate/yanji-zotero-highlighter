const Y = Yanji;
const $ = selector => document.querySelector(selector);
let page, settings, tabId, noteKey, loadSequence = 0, annotationPage = 0, archiveOffset = 0, archiveSequence = 0;
let sentenceAnnotation, sentenceRows = [], sentenceRow = 0;
const expandedQuotes = new Set();
let undoTimer, focusTimer, annotationsCollapsed = false;
$("#annotation-chevron").innerHTML=Y.icon("down");
function applyAnnotationVisibility(){
 $("#annotation-content").hidden=annotationsCollapsed;
 $("#category-filters").hidden=annotationsCollapsed||!page?.annotations.length;
 $("#toggle-annotations").setAttribute("aria-expanded",String(!annotationsCollapsed));
 $("#toggle-annotations").title=annotationsCollapsed?"展开标注区域":"折叠标注区域";
 if(!annotationsCollapsed)updateQuoteFolds();
}
function setAnnotationsCollapsed(value){
 annotationsCollapsed=value;applyAnnotationVisibility();
 if(page)chrome.storage.local.set({["annotationCollapsed:"+page.id]:value}).catch(error=>report("#page-status",error));
}
$("#toggle-annotations").onclick=()=>setAnnotationsCollapsed(!annotationsCollapsed);
const send = async message => {
  const result = await chrome.runtime.sendMessage(message);
  if (!result.ok) { const error = new Error(result.error); error.code = result.code; throw error; }
  return result.data;
};
function status(selector, text, kind = "") { const node = $(selector); node.textContent = text; node.className = "status " + kind; }
const report = (selector, error) => { console.error(error); status(selector, error.message, "error"); };
function paint() {
  if (!page) return;
  $("#zotero-section").hidden=false;$("#annotation-section").hidden=false;$("#reference-tools").hidden=false;
  $("#copy-title").disabled=false;$("#copy-folder-title").disabled=false;
  $("#title").textContent = page.title || "未命名文章";
  $("#source").textContent = page.doi ? "DOI " + page.doi : new URL(page.url).hostname || "本地文章";
  $("#copy-doi").hidden = !page.doi;
  $("#query").value = page.doi || page.title;
  $("#binding").textContent = page.binding ? page.binding.title : "尚未关联文献";

  $("#sync").disabled = !page.annotations.length && !page.sync?.noteKey;
  paintConnection();
  $("#count").textContent = `${page.annotations.length} 条标注`;
  const filter = $("#filter").value;
  $("#filter").innerHTML = '<option value="">全部分类</option>' + settings.categories.map(row => `<option value="${row.id}">${Y.escape(row.name)} (${page.annotations.filter(annotation => annotation.category === row.id).length})</option>`).join("");
  $("#filter").value = filter;
  paintCategoryFilters();
  paintAnnotations();
  applyAnnotationVisibility();
  document.dispatchEvent(new Event("yanji-context-changed"));
}
function paintCategoryFilters() {
  $("#category-filters").hidden = annotationsCollapsed || !page.annotations.length;
  $("#category-filters").innerHTML = settings.categories.map(category => {
    const count = page.annotations.filter(row => row.category === category.id).length;
    return `<button class="category-chip" data-category="${category.id}" aria-pressed="${$("#filter").value === category.id}" aria-label="筛选 ${Y.escape(category.name)}" title="${Y.escape([category.name,category.meaning,`${count} 条`].filter(Boolean).join("，"))}"><i class="swatch" style="background:${category.color}"></i>${count ? `<span>${count}</span>` : ""}</button>`;
  }).join("");
}
$("#category-filters").onclick = event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  $("#filter").value = $("#filter").value === button.dataset.category ? "" : button.dataset.category;
  annotationPage = 0; paintCategoryFilters(); paintAnnotations();
};
function updateQuoteFolds() {
  for (const card of document.querySelectorAll(".annotation")) {
    const text = card.querySelector(".quote-text"), button = card.querySelector('[data-action="expand"]');
    const expanded = card.classList.contains("quote-expanded");
    const comment=card.querySelector(".comment");
    button.hidden = !expanded && text.scrollHeight <= text.clientHeight + 1 && (!comment || comment.scrollHeight<=comment.clientHeight+1);
    button.title = expanded ? "收起摘录与批注" : "展开摘录与批注";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-expanded", String(expanded));
  }
}
new ResizeObserver(updateQuoteFolds).observe($("#annotations"));
function focusAnnotation(id) {
  const annotation = page?.annotations.find(row => row.id === id);
  if (!annotation) return;
  if(annotationsCollapsed)setAnnotationsCollapsed(false);
  expandedQuotes.add(id);
  let card = [...document.querySelectorAll(".annotation")].find(row => row.dataset.id === id);
  if (!card) {
    if ($("#filter").value && $("#filter").value !== annotation.category) $("#filter").value = "";
    const rows = page.annotations.filter(row => !$("#filter").value || row.category === $("#filter").value).sort((a,b)=>a.segments[0].index-b.segments[0].index);
    annotationPage = Math.floor(rows.findIndex(row=>row.id===id)/50);
    paintCategoryFilters(); paintAnnotations();
    card = [...document.querySelectorAll(".annotation")].find(row => row.dataset.id === id);
  } else { card.classList.add("quote-expanded"); updateQuoteFolds(); }
  card.scrollIntoView({ block: "center", behavior: "auto" });
  card.classList.add("annotation-focused");
  clearTimeout(focusTimer); focusTimer = setTimeout(()=>card.classList.remove("annotation-focused"),1500);
}
function offerUndo(token) {
  clearTimeout(undoTimer); $("#undo-toast").hidden = false;
  $("#undo-delete").disabled = false;
  $("#undo-delete").onclick = async () => {
    $("#undo-delete").disabled = true;
    try { const restored = await send({type:"ANN_UNDO",token}); if (page?.id===restored.id) { page=restored;paint(); } $("#undo-toast").hidden=true; }
    catch(error){report("#page-status",error);}
  };
  undoTimer=setTimeout(()=>{$("#undo-toast").hidden=true;},8000);
}
function paintConnection() {
  $("#binding").hidden=!page.binding||(page.binding.via==='doi'||Y.normalize(page.binding.title).toLowerCase()===Y.normalize(page.title).toLowerCase());
  const state = page.match?.status;
  status("#match-status", page.binding ? (page.binding.via === "doi" ? "DOI 已关联" : "已手动关联") : state === "ambiguous" ? "DOI 对应多篇文献，请选择。" : state === "waiting" ? "待入库，标注已缓存" : state === "no_doi" ? "无 DOI，请手动关联" : "未关联，标注已缓存");
  $("#match-results").innerHTML = !page.binding && state === "ambiguous" ? page.match.candidates.map(row => `<button class="result" data-key="${row.key}">${Y.escape(row.title)}<small>${Y.escape([row.authors, row.date, row.key].filter(Boolean).join("，"))}，关联并更新</small></button>`).join("") : "";
  if (page.sync?.status === "synced") {
    noteKey = page.sync.noteKey;
    $("#open-note").hidden = false;
    status("#sync-status", (page.sync.unchanged ? `内容未变化，${page.sync.count} 条` : `已写入笔记，${page.sync.count} 条`), "success");
  } else if (page.sync?.status === "error") {
    status("#sync-status", page.sync.code === "AUTH_REQUIRED" ? "点击更新笔记，授权写入 Zotero。" : page.sync.message, page.sync.code === "AUTH_REQUIRED" ? "" : "error");
    $("#force-sync").hidden = page.sync.code !== "MANAGED_CONFLICT";
  } else status("#sync-status", page.sync?.status === "pending" ? "本机已保存，待更新笔记" : "");
}
function paintAnnotations() {
  const rows = page.annotations.filter(row => !$("#filter").value || row.category === $("#filter").value).sort((a, b) => a.segments[0].index - b.segments[0].index);
  $("#count").textContent = $("#filter").value ? `${rows.length} / ${page.annotations.length} 条标注` : `${rows.length} 条标注`;
  annotationPage = Math.max(0, Math.min(annotationPage, Math.ceil(rows.length / 50) - 1));
  $("#annotation-pages").hidden = rows.length <= 50;
  $("#ann-page").textContent = `${annotationPage + 1} / ${Math.ceil(rows.length / 50)}`;
  $("#ann-prev").disabled = annotationPage === 0;
  $("#ann-next").disabled = (annotationPage + 1) * 50 >= rows.length;
  $("#annotations").innerHTML = rows.length ? rows.slice(annotationPage * 50, (annotationPage + 1) * 50).map(annotation => {
    const category = settings.categories.find(row => row.id === annotation.category);
    const original = [...new Set(annotation.segments.filter(segment => segment.translated).map(segment => segment.original))].join("\n\n");
    return `<article class="annotation${expandedQuotes.has(annotation.id) ? " quote-expanded" : ""}" data-id="${Y.escape(annotation.id)}"><div class="annotation-header"><i class="swatch" style="background:${category.color}"></i><span>${Y.escape(category.name)}</span><span class="heading-label">${Y.escape(annotation.segments[0].heading || "正文")}</span></div><p class="quote"><span class="quote-text">${Y.escape(annotation.quote)}</span><span class="quote-actions"><button class="icon" data-action="expand" title="展开完整摘录" aria-label="展开完整摘录" hidden>${Y.icon("down")}</button><button class="icon quote-copy" data-action="copy" title="复制摘录；Shift+点击包含英文句对和批注" aria-label="复制摘录">${Y.icon("copy")}</button></span></p>${annotation.comment ? `<p class="comment">${Y.escape(annotation.comment)}</p>` : ""}<div class="annotation-actions"><div class="original-row">${original ? (Y.alignedEnglish(annotation).length ? '<details class="source"><summary>对应英文</summary><div class="detail-body"></div></details>' : '<button class="locate-button source-link" data-action="original">原文段落</button>') : '<span class="muted">正文段落</span>'}${original ? `<button class="locate-button" data-action="align" title="中英句对齐" aria-label="中英句对齐">${annotation.segments.some(row => row.sentencePairs?.length) ? "已对齐" : "对齐"}</button>` : ""}<button class="locate-button" data-action="locate" title="定位段落" aria-label="定位段落">${Y.icon("locate")}</button></div><div class="edit-row"><details class="edit"><summary>分类与批注</summary><div class="detail-body"></div></details><button class="icon danger" data-action="delete" title="删除标注" aria-label="删除标注">${Y.icon("trash")}</button></div></div></article>`;
  }).join("") : '<p class="empty">' + (page.annotations.length ? "此分类暂无标注" : "选中正文，选择分类开始标注。") + "</p>";
  updateQuoteFolds();
}
async function load() {
  const sequence = ++loadSequence;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (!tab?.url || !/^(https?:|file:)/.test(tab.url)) {
    $("#title").textContent = "请打开文章正文";
    status("#page-status", "浏览器设置页、扩展商店和内置 PDF 阅读器不支持网页标注。可从下方打开已保存的文章。");
    page = null;
    document.dispatchEvent(new Event("yanji-context-changed"));
    $("#source").textContent="";$("#copy-doi").hidden=true;
    $("#zotero-section").hidden=true;$("#annotation-section").hidden=true;$("#reference-tools").hidden=true;
    $("#copy-title").disabled=true;$("#copy-folder-title").disabled=true;
    $("#sync").disabled = true;
    await loadArchive();
    return;
  }
  let result;
  try { result = await chrome.tabs.sendMessage(tab.id, { type: "CONTEXT" }); }
  catch (error) { throw new Error("文章页尚未加载研迹。安装或更新扩展后，请刷新文章页；本地 HTML 还需在扩展详情中允许访问文件网址。", { cause: error }); }
  if (sequence !== loadSequence) return;
  if (!result?.ok || !result.data.page) throw new Error("读取文章失败，请刷新文章页。");
  if (page?.id !== result.data.page.id) { annotationPage = 0; expandedQuotes.clear(); }
  const savedArea=await chrome.storage.local.get("annotationCollapsed:"+result.data.page.id);
  if(sequence!==loadSequence)return;
  annotationsCollapsed=savedArea["annotationCollapsed:"+result.data.page.id]===true;
  page = result.data.page;
  settings = result.data.settings;
  noteKey = null;
  $("#open-note").hidden = true;
  $("#force-sync").hidden = true;
  status("#page-status", "");
  paint();
  await loadArchive();
}
async function loadArchive(offset = 0) {
  const sequence = ++archiveSequence;
  if (!$("#archive").open) return;
  const result = await send({ type: "PAGES", offset, exclude: page?.id });
  if (sequence !== archiveSequence) return;
  archiveOffset = offset;
  $("#saved-pages").innerHTML = result.items.map(row => `<button data-url="${Y.escape(row.url)}">${Y.escape(row.title)}<small>${row.count} 条标注${row.binding ? "，已关联 Zotero" : ""}</small></button>`).join("") || '<p class="muted">暂无其他已保存文章。</p>';
  $("#archive-pages").hidden = result.total <= 50;
  $("#archive-count").textContent = `${offset + 1}–${offset + result.items.length} / ${result.total}`;
  $("#archive-prev").disabled = offset === 0;
  $("#archive-next").disabled = result.next === null;
}
async function search() {
  if (!$("#query").value.trim()) return;
  $("#search").disabled = true;
  status("#search-status", "正在查询本机 Zotero…");
  try {
    const rows = await send({ type: "SEARCH", query: $("#query").value.trim(), doi: page.doi });
    status("#search-status", rows.length ? `${rows.length} 篇文献` : "未找到，可换标题关键词或稍后重试。");
    $("#results").innerHTML = rows.map(row => `<button class="result" data-key="${row.key}">${row.exact ? "DOI 匹配，" : ""}${Y.escape(row.title)}<small>${Y.escape([row.authors, row.date].filter(Boolean).join("，"))}</small></button>`).join("");
  } catch (error) { report("#search-status", error); }
  finally { $("#search").disabled = false; }
}
async function sync(force = false) {
  if (!page || (!page.annotations.length && !page.sync?.noteKey)) return;
  $("#sync").disabled = true;
  $("#force-sync").hidden = true;
  status("#sync-status", "正在更新…");
  try {
    const result = await send({ type: "SYNC", pageId: page.id, force });
    noteKey = result.noteKey;
    $("#open-note").hidden = false;
    status("#sync-status", (result.unchanged ? `内容未变化，${result.count} 条` : `已写入笔记，${result.count} 条`), "success");
  } catch (error) {
    report("#sync-status", error);
    if (error.code === "MANAGED_CONFLICT") $("#force-sync").hidden = false;
  } finally { $("#sync").disabled = !page || (!page.annotations.length && !page.sync?.noteKey); }
}
$("#options").innerHTML = Y.icon("settings");
$("#connect").innerHTML = Y.icon("refresh");
$("#preview").innerHTML = Y.icon("preview");
$("#open-note").innerHTML = Y.icon("external");
$("#close-preview").innerHTML = Y.icon("close");
$("#close-sentences").innerHTML = Y.icon("close");
$("#close-original").innerHTML = Y.icon("close");
$("#close-original").onclick = () => $("#original-dialog").close();
$("#original-dialog").onclose = () => $("#original-body").replaceChildren();
$("#copy-title").innerHTML = Y.icon("copy");
$("#copy-folder-title").innerHTML = Y.icon("folder");
$("#copy-doi").innerHTML = Y.icon("copy");
for(const [id,folder] of [["copy-title",false],["copy-folder-title",true]]) $("#"+id).onclick = async () => {
  if(!page)return;
  try {await navigator.clipboard.writeText(folder?Y.folderTitle(page.title):page.title);status("#page-status",folder?"已复制文件夹名称":"已复制完整标题");}
  catch(error){report("#page-status",error);}
};
$("#copy-doi").onclick = async () => {
  if (!page?.doi) return;
  try { await navigator.clipboard.writeText(page.doi); $("#copy-doi").title = "已复制"; }
  catch (error) { report("#page-status", error); }
};
$("#options").onclick = () => send({ type: "OPTIONS_OPEN", display: { left: screen.availLeft, top: screen.availTop, width: screen.availWidth, height: screen.availHeight } }).catch(error => report("#page-status", error));
$("#connect").onclick = async () => {
  status("#connection-status", "正在连接…");
  try {
    const allowed = await chrome.permissions.request({origins:chrome.runtime.getManifest().host_permissions});
    if(!allowed) throw Error("需要允许访问本机 Zotero 接口，才能关联和更新文献。");
    await send({ type: "CONNECT" }); status("#connection-status", "Zotero 已连接", "success");
  }
  catch (error) { report("#connection-status", error); }
};
$("#search").onclick = search;
$("#query").onkeydown = event => { if (event.key === "Enter") search(); };
$("#results").onclick = async event => {
  const key = event.target.closest("button")?.dataset.key;
  if (!key) return;
  try { page = await send({ type: "BIND", pageId: page.id, page, itemKey: key }); $("#binding-details").open = false; paint(); status("#sync-status", "已关联文献，可以预览并更新笔记。"); }
  catch (error) { report("#search-status", error); }
};
$("#match-results").onclick = async event => {
  const key = event.target.closest("button")?.dataset.key;
  if (!key) return;
  try { page = await send({ type: "BIND", pageId: page.id, page, itemKey: key }); paint(); await sync(); }
  catch (error) { report("#sync-status", error); }
};
$("#sync").onclick = () => sync();
$("#force-sync").onclick = () => { if (confirm("重新生成这份专用笔记的摘录区？摘录区中的手动修改会被替换，文末“我的总结”会保留。")) sync(true); };
$("#filter").onchange = () => { annotationPage = 0; paintCategoryFilters(); paintAnnotations(); };
$("#ann-prev").onclick = () => { annotationPage--; paintAnnotations(); };
$("#ann-next").onclick = () => { annotationPage++; paintAnnotations(); };
$("#archive").ontoggle = () => { if ($("#archive").open) loadArchive().catch(error => report("#page-status", error)); };
$("#archive-prev").onclick = () => loadArchive(archiveOffset - 50).catch(error => report("#page-status", error));
$("#archive-next").onclick = () => loadArchive(archiveOffset + 50).catch(error => report("#page-status", error));
$("#open-note").onclick = () => chrome.tabs.create({ url: `zotero://select/library/items/${noteKey}` });
$("#preview").onclick = () => {
  if (!page) return;
  try {
    const preview = Y.planNote(settings, { title: page.binding?.title || page.title }, page.annotations);
    $("#preview-body").innerHTML = `<p class="muted">${preview.length.toLocaleString()} / ${Y.noteLimit.toLocaleString()} 字符</p>` + preview.html;
    $("#preview-dialog").showModal();
  } catch (error) { report("#sync-status", error); }
};
$("#annotations").addEventListener("toggle", event => {
  const details = event.target;
  if (!details.open || details.dataset.loaded) return;
  const annotation = page.annotations.find(row => row.id === details.closest(".annotation").dataset.id);
  const body = details.querySelector(".detail-body");
  if (details.classList.contains("source")) {
    const text = document.createElement("p"); text.className = "original";
    text.textContent = Y.alignedEnglish(annotation).join("\n\n");
    body.append(text);
    const full = document.createElement("button"); full.className = "locate-button"; full.dataset.action = "original"; full.textContent = "完整段落";
    body.append(full);
  } else body.innerHTML = `<label class="edit-label">分类</label><select aria-label="标注分类">${settings.categories.map(row => `<option value="${row.id}" ${row.id === annotation.category ? "selected" : ""}>${Y.escape(row.name)}</option>`).join("")}</select><label class="edit-label">我的批注</label><textarea aria-label="我的批注">${Y.escape(annotation.comment)}</textarea><button data-action="save">保存修改</button>`;
  details.dataset.loaded = "1";
}, true);
$("#close-preview").onclick = () => $("#preview-dialog").close();
function openSentences(annotation) {
  sentenceAnnotation = annotation.id;
  sentenceRows = annotation.segments.flatMap((segment, segmentIndex) => {
    if (!segment.translated) return [];
    const candidates = Y.sentences(segment.original);
    const suggestions = YanjiRules.suggest(segment);
    return Y.sentences(segment.quote, "zh").map((chinese, index) => {
      const saved=segment.sentencePairs?.find(pair=>pair.index===index);
      return {segmentIndex,index,chinese,candidates,english:[...(saved?.english||suggestions[index].english)],suggestion:suggestions[index],origin:saved?"saved":suggestions[index].english.length?"suggested":"empty"};
    });
  });
  sentenceRow = 0;
  $("#chinese-sentence").innerHTML = sentenceRows.map((row, index) => `<option value="${index}">第 ${index + 1} 句</option>`).join("");
  status("#sentence-status", "");
  paintSentences();
  $("#sentence-dialog").showModal();
}
function paintSentences() {
  const row = sentenceRows[sentenceRow];
  $("#chinese-excerpt").textContent = row.chinese;
  $("#sentence-origin").textContent = {saved:"已保存",suggested:"规则预选",manual:"手动选择",empty:"未预选"}[row.origin];
  $("#sentence-origin").title = row.origin==="suggested"?row.suggestion.reason:"";
  $("#english-candidates").innerHTML = row.candidates.map((text, index) => `<label class="sentence-candidate"><input type="checkbox" value="${index}" ${row.english.includes(text) ? "checked" : ""}><span>${Y.escape(text)}</span></label>`).join("");
  const chosen=$("#english-candidates input:checked");
  if(chosen) $("#english-candidates").scrollTop=chosen.closest("label").offsetTop-$("#english-candidates").offsetTop;
}
function collectSentences() {
  const row = sentenceRows[sentenceRow];
  row.english = [...$("#english-candidates").querySelectorAll("input:checked")].map(input => row.candidates[Number(input.value)]);
}
$("#chinese-sentence").onchange = () => { collectSentences(); sentenceRow = Number($("#chinese-sentence").value); paintSentences(); };
$("#english-candidates").onchange = () => { sentenceRows[sentenceRow].origin="manual";$("#sentence-origin").textContent="手动选择"; };
$("#suggest-sentences").onclick = () => { const row=sentenceRows[sentenceRow];row.english=[...row.suggestion.english];row.origin=row.english.length?"suggested":"empty";paintSentences(); };
$("#close-sentences").onclick = () => $("#sentence-dialog").close();
$("#save-sentences").onclick = async () => {
  collectSentences();
  try {
    const annotation = page?.annotations.find(row => row.id === sentenceAnnotation);
    if (!annotation) throw new Error("当前文章已切换，请回到原文章保存句对。");
    const pairs = annotation.segments.map((segment, index) => sentenceRows.filter(row => row.segmentIndex === index && row.english.length).map(({ index, chinese, english }) => ({ index, chinese, english })));
    page = await send({ type: "ANN_ALIGN", pageId: page.id, id: sentenceAnnotation, pairs });
    $("#sentence-dialog").close(); paint(); status("#sync-status", "句对已保存在本机，待更新笔记");
  } catch (error) { report("#sentence-status", error); }
};
$("#annotations").onclick = async event => {
  if (!page) return;
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest(".annotation"), id = card.dataset.id;
  const annotation = page.annotations.find(row => row.id === id);
  try {
    if (button.dataset.action === "expand") {
      if (expandedQuotes.has(id)) expandedQuotes.delete(id); else expandedQuotes.add(id);
      card.classList.toggle("quote-expanded", expandedQuotes.has(id)); updateQuoteFolds();
    } else if (button.dataset.action === "original") {
      $("#original-body").replaceChildren(...[...new Set(annotation.segments.filter(row => row.translated).map(row => row.original))].map(original => {
        const text = document.createElement("p"); text.className = "original"; text.textContent = original; return text;
      }));
      $("#original-dialog").showModal();
    } else if (button.dataset.action === "align") openSentences(annotation);
    else if (button.dataset.action === "locate") {
      if (Y.cleanURL(annotation.url) === Y.cleanURL((await chrome.tabs.get(tabId)).url)) {
        const result = await chrome.tabs.sendMessage(tabId, { type: "LOCATE", id });
        status("#page-status", result.data.message, result.data.found ? "" : "error");
      } else await chrome.tabs.create({ url: Y.returnURL(annotation) });
    } else if (button.dataset.action === "copy") {
      await navigator.clipboard.writeText(Y.copyAnnotation(annotation,event.shiftKey));
      status("#page-status",event.shiftKey ? "已复制双语摘录与批注" : "已复制摘录");
    } else if (button.dataset.action === "save") {
      page = await send({ type: "ANN_UPDATE", pageId: page.id, id, category: card.querySelector("select").value, comment: card.querySelector("textarea").value });
      paint(); status("#sync-status", "修改已保存在浏览器，点击更新笔记写入 Zotero。");
    } else if (button.dataset.action === "delete") {
      const result = await send({ type: "ANN_DELETE", pageId: page.id, id }); page=result.page; paint(); offerUndo(result.undoToken); status("#sync-status", "待更新笔记");
    }
  } catch (error) { report("#page-status", error); }
};
$("#annotations").onkeydown = event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && event.target.matches("textarea")) { event.preventDefault(); event.target.closest(".annotation").querySelector('[data-action="save"]').click(); }
};
$("#saved-pages").onclick = event => { const url = event.target.closest("button")?.dataset.url; if (url) chrome.tabs.create({ url }); };
chrome.runtime.onMessage.addListener((message,sender)=>{ if(message.type==="ANN_FOCUS" && sender.tab?.id===tabId && message.pageId===page?.id) focusAnnotation(message.id); });
chrome.tabs.onActivated.addListener(() => load().catch(error => report("#page-status", error)));
chrome.tabs.onUpdated.addListener((id, change) => { if (id === tabId && change.status === "complete") load().catch(error => report("#page-status", error)); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !page) return;
  if(changes["annotationCollapsed:"+page.id]){annotationsCollapsed=changes["annotationCollapsed:"+page.id].newValue===true;applyAnnotationVisibility();}
  if (changes.settings) { settings = Y.settingsWithDefaults(changes.settings.newValue); paint(); }
  if (changes["page:" + page.id]) {
    const next = changes["page:" + page.id].newValue;
    const edited = JSON.stringify(page.annotations) !== JSON.stringify(next.annotations);
    page = next;
    if (edited) { paint(); status("#sync-status", "本机已保存，待更新笔记"); }
    else { $("#binding").textContent = page.binding?.title || "尚未关联文献"; paintConnection(); }
  }
});
load().catch(error => report("#page-status", error));
