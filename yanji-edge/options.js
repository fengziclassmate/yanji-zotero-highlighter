const Y = Yanji;
const $ = selector => document.querySelector(selector);
let settings, loadedWidth, sizesReset = false;
const send = async message => { const result = await chrome.runtime.sendMessage(message); if (!result.ok) throw new Error(result.error); return result.data; };
function status(selector, text, kind = "") { $(selector).textContent = text; $(selector).className = "status " + kind; }
function readRows() {
  settings.categories = [...document.querySelectorAll(".category-row[data-id]")].map(row => ({ id: row.dataset.id, color: row.querySelector('[type="color"]').value, name: row.querySelector(".name").value.trim(), meaning: row.querySelector(".meaning").value.trim() }));
}
function paintCategories() {
  $("#categories").innerHTML = settings.categories.map((row, index) => `<div class="category-row" data-id="${row.id}"><input type="color" value="${row.color}" aria-label="${Y.escape(row.name)} 颜色"><input class="name" value="${Y.escape(row.name)}" aria-label="分类名称" maxlength="60" required><input class="meaning" value="${Y.escape(row.meaning)}" placeholder="添加含义…" aria-label="分类含义" maxlength="500"><div class="category-tools"><button class="icon" type="button" data-do="up" title="上移" aria-label="上移 ${Y.escape(row.name)}" ${index === 0 ? "disabled" : ""}>${Y.icon("up")}</button><button class="icon" type="button" data-do="down" title="下移" aria-label="下移 ${Y.escape(row.name)}" ${index === settings.categories.length - 1 ? "disabled" : ""}>${Y.icon("down")}</button><button class="icon" type="button" data-do="delete" title="删除分类" aria-label="删除 ${Y.escape(row.name)}">${Y.icon("trash")}</button></div></div>`).join("");
  const selected = $("#defaultCategory").value || settings.defaultCategory;
  $("#defaultCategory").innerHTML = settings.categories.map(row => `<option value="${row.id}">${Y.escape(row.name)}</option>`).join("");
  $("#defaultCategory").value = settings.categories.some(row => row.id === selected) ? selected : settings.categories[0]?.id;
  updateStylePreview();
}
async function load() {
  settings = await send({ type: "SETTINGS_GET" });
  loadedWidth = settings.toolbarWidth;
  sizesReset = false;
  paintCategories();
  for (const key of ["defaultCategory", "quickCount", "style", "noteTitle", "buttonSize", "toolbarWidth"]) $("#" + key).value = settings[key];
  $("#toolbarOpacity").value = Math.round(settings.toolbarOpacity * 100);
  for (const key of ["navDots", "badge", "continuous", "shortcuts", "showEnglish", "toolbarExpanded", "autoSyncOnOpen"]) $("#" + key).checked = settings[key];
  updateOutputs();
  updateStylePreview();
}
$("#categories").addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  readRows();
  const index = settings.categories.findIndex(row => row.id === button.closest(".category-row").dataset.id);
  if (button.dataset.do === "delete") {
    if (settings.categories.length === 1) return status("#save-status", "请至少保留一个分类。", "error");
    settings.categories.splice(index, 1);
  } else {
    const target = index + (button.dataset.do === "up" ? -1 : 1);
    [settings.categories[index], settings.categories[target]] = [settings.categories[target], settings.categories[index]];
  }
  paintCategories();
  status("#save-status", "有未保存的分类修改。");
});
$("#add-category").onclick = () => { readRows(); settings.categories.push({ id: "category-" + crypto.randomUUID().slice(0, 8), name: "新分类", color: Y.uiColors["--disabled"], meaning: "" }); paintCategories(); };
$("#settings-form").onsubmit = async event => {
  event.preventDefault();
  try {
    readRows();
    for (const key of ["defaultCategory", "style", "noteTitle"]) settings[key] = $("#" + key).value;
    settings.quickCount = Number($("#quickCount").value);
    if (!sizesReset) {
      const current = await send({ type: "SETTINGS_GET" });
      for (const key of ["toolbarHeight", "editorWidth", "editorHeight"]) settings[key] = current[key];
      if (Number($("#toolbarWidth").value) === loadedWidth) $("#toolbarWidth").value = current.toolbarWidth;
    }
    for (const key of ["buttonSize", "toolbarWidth"]) settings[key] = Number($("#" + key).value);
    settings.toolbarOpacity = Number($("#toolbarOpacity").value) / 100;
    for (const key of ["navDots", "badge", "continuous", "shortcuts", "showEnglish", "toolbarExpanded", "autoSyncOnOpen"]) settings[key] = $("#" + key).checked;
    settings = await send({ type: "SETTINGS_SAVE", settings });
    loadedWidth = settings.toolbarWidth;
    sizesReset = false;
    status("#save-status", "已保存", "success");
  } catch (error) { status("#save-status", error.message, "error"); }
};
function download(text, filename, type) {
  const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$("#export-backup").onclick = async () => {
  $("#export-backup").disabled = true;
  try { const blob = await YanjiFiles.exportFile("json", (done, total) => status("#backup-status", `导出 ${done} / ${total} 篇`)); download(blob, `研迹备份-${new Date().toISOString().slice(0, 10)}.json`); status("#backup-status", "完整备份已导出", "success"); }
  catch (error) { status("#backup-status", error.message, "error"); }
  finally { $("#export-backup").disabled = false; }
};
$("#import-backup").onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    const count = await YanjiFiles.restore(backup, (done, total) => status("#backup-status", `导入 ${done} / ${total} 篇`));
    await load();
    status("#backup-status", `已合并 ${count} 篇文章。刷新对应网页即可恢复标注。`, "success");
  } catch (error) { status("#backup-status", "导入失败：" + error.message, "error"); }
  event.target.value = "";
};
for (const name of ["backup", "config"]) document.querySelector(`label[for="import-${name}"]`).onkeydown = event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); $("#import-" + name).click(); } };
$("#export-markdown").onclick = async () => {
  $("#export-markdown").disabled = true;
  try { const blob = await YanjiFiles.exportFile("markdown", (done, total) => status("#backup-status", `导出 ${done} / ${total} 篇`)); download(blob, "研迹摘录.md"); status("#backup-status", "已按分类导出 Markdown 列表。", "success"); }
  catch (error) { status("#backup-status", error.message, "error"); }
  finally { $("#export-markdown").disabled = false; }
};
load().catch(error => status("#save-status", error.message, "error"));
function updateOutputs() { $("#opacity-value").textContent = $("#toolbarOpacity").value + "%"; $("#size-value").textContent = $("#buttonSize").value + " px"; $("#quickCount").disabled = $("#toolbarExpanded").checked; }
$("#toolbarOpacity").oninput = updateOutputs;
$("#buttonSize").oninput = updateOutputs;
$("#toolbarExpanded").onchange = updateOutputs;
$("#reset-size").onclick = () => { sizesReset = true; for (const key of ["toolbarWidth", "toolbarHeight", "editorWidth", "editorHeight"]) settings[key] = Y.defaults[key]; $("#toolbarWidth").value = settings.toolbarWidth; status("#save-status", "尺寸已重置，请保存。"); };
$("#settings-form").addEventListener("input", () => { status("#save-status", "未保存"); updateStylePreview(); });
function updateStylePreview() {
  const color = document.querySelector(`.category-row[data-id="${$("#defaultCategory").value}"] input[type="color"]`).value;
  const style = $("#style").value;
  const sample = $("#style-preview");
  sample.style.backgroundColor = style === "underline" ? "transparent" : color + "55";
  sample.style.textDecorationLine = style === "highlight" ? "none" : "underline";
  sample.style.textDecorationColor = color;
}
$("#style").onchange = updateStylePreview;
$("#defaultCategory").onchange = updateStylePreview;
function switchTab(id) {
  for (const panel of document.querySelectorAll(".tab-panel")) panel.hidden = panel.id !== id;
  for (const button of document.querySelectorAll("[data-tab]")) { if (button.dataset.tab === id) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); }
  $(".savebar").hidden = id === "sharing-tab";
}
document.querySelector(".settings-tabs").onclick = event => { const id = event.target.closest("button")?.dataset.tab; if (id) switchTab(id); };
if (location.hash === "#backup") { switchTab("sharing-tab"); $("#backup").open = true; }
$("#export-config").onclick = async () => {
  try { const config = await send({ type: "CONFIG_EXPORT" }); download(JSON.stringify(config, null, 2), "研迹课题组配置.json", "application/json"); status("#config-status", "已导出已保存的偏好，不含标注、文献关联或授权。", "success"); }
  catch (error) { status("#config-status", error.message, "error"); }
};
$("#import-config").onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try { await send({ type: "CONFIG_IMPORT", config: JSON.parse(await file.text()) }); await load(); status("#config-status", "配置已应用", "success"); }
  catch (error) { status("#config-status", "导入失败：" + error.message, "error"); }
  event.target.value = "";
};
