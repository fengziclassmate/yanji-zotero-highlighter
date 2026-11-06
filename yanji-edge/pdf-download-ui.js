(() => {
  let documentInfo, libraryInfo, article, sourceTab, job, opening = 0;
  const $d = id => document.getElementById("download-" + id);
  $d("open").innerHTML = Y.icon("download");
  $d("close").innerHTML = Y.icon("close");
  $d("root").innerHTML = Y.icon("folder");
  const show = (text, kind = "") => status("#download-status", text, kind);
  function preview() {
    try {
      $d("filename").value = YanjiPDFDocument.filename({state:$d("state").value, important:$d("important").checked, date:$d("date").value.trim(), dateType:$d("date-type").value, journal:$d("journal").value, keywords:$d("keywords").value, title:documentInfo.title});
      show("");
    } catch (error) { $d("filename").value = ""; show(error.message); }
  }
  function folders() {
    $d("root-path").textContent = libraryInfo.root || "选择文献库根目录";
    $d("root-path").title = libraryInfo.root;
    $d("folder").innerHTML = '<option value="__choose__" disabled>选择保存文件夹</option>' + libraryInfo.folders.map(folder => `<option value="${Y.escape(folder)}">${Y.escape(folder || "根目录")}</option>`).join("");
    $d("folder").value = libraryInfo.folder ?? "__choose__";
    $d("journal").value = libraryInfo.abbreviation;
    $d("save").disabled = !libraryInfo.root;
  }
  function paintJob() {
    if (!job) return;
    $d("save").disabled = job.state === "downloading" || !libraryInfo?.root;
    if (job.state === "downloading") show("正在下载；如 Edge 询问，请选择“保存”。");
    else if (job.state === "error") show(job.error, "error");
    else show(job.result.warning || (job.result.attachmentKey ? "已保存并关联到 Zotero" : "PDF 已保存"), job.result.warning ? "error" : "success");
    $d("saved").hidden = job.state !== "complete";
    $d("saved-path").textContent = job.result?.path || "";
    $d("view").hidden = !job.result?.attachmentKey;
  }
  $d("open").onclick = async () => {
    if (!page) return;
    const sequence = ++opening;
    article = structuredClone(page); sourceTab = tabId; job = null;
    $d("form").reset(); $d("save").disabled = true; $d("saved").hidden = true;
    show("读取 PDF 信息…"); $d("dialog").showModal();
    try {
      const response = await chrome.tabs.sendMessage(sourceTab, {type:"PDF_DOCUMENT"});
      if (!response?.ok) throw Error(response?.error || "请刷新文章页后重试。");
      documentInfo = response.data;
      const [info, latest] = await Promise.all([send({type:"PDF_DOWNLOAD_INFO", pageId:article.id, meta:article, document:documentInfo}), send({type:"PDF_DOWNLOAD_LATEST", pageId:article.id})]);
      if (sequence !== opening || !$d("dialog").open) return;
      libraryInfo = info; job = latest;
      folders();
      $d("url").value = documentInfo.sources[0]?.url || "";
      $d("sources").innerHTML = documentInfo.sources.map(source => `<option value="${Y.escape(source.url)}">${Y.escape(source.label)}</option>`).join("");
      $d("date").value = documentInfo.published;
      $d("link").disabled = !info.binding; $d("link").checked = !!info.binding;
      $d("binding").textContent = info.binding?.title || (info.ambiguous ? "DOI 匹配多条文献，请先在侧栏选择；本次可仅保存 PDF。" : "未关联 Zotero，本次仅保存 PDF。");
      preview(); paintJob();
    } catch (error) { show(error.message, "error"); }
  };
  $d("close").onclick = () => $d("dialog").close();
  $d("root").onclick = async () => {
    $d("root").disabled = true;
    try {
      show("请在 Zotero 弹出的窗口选择目录");
      const result = await send({type:"PDF_DOWNLOAD_ROOT"});
      if (!result.cancelled) { libraryInfo = await send({type:"PDF_DOWNLOAD_INFO", pageId:article.id, meta:article, document:documentInfo}); folders(); preview(); }
      else show("");
    } catch (error) { show(error.message, "error"); }
    finally { $d("root").disabled = false; }
  };
  for (const name of ["state", "important", "date", "date-type", "journal", "keywords"]) $d(name).addEventListener("input", () => {
    if (name === "date-type") $d("date").value = documentInfo[$d("date-type").value];
    preview();
  });
  $d("folder").onchange = () => {
    const leaf = $d("folder").value.split("/").at(-1).replace(/^\d+[-_ ]*/, "");
    if (leaf) $d("journal").value = leaf;
    preview();
  };
  $d("form").onsubmit = async event => {
    event.preventDefault();
    $d("save").disabled = true;
    try {
      if ($d("folder").value === "__choose__") throw Error("请选择保存文件夹。");
      const granted = await chrome.permissions.request({permissions:["downloads"]});
      if (!granted) throw Error("未允许下载文件。");
      show("准备下载…");
      const result = await send({type:"PDF_DOWNLOAD_START", pageId:article.id, meta:article, tabId:sourceTab, url:$d("url").value, folder:$d("folder").value, filename:$d("filename").value.trim(), journal:documentInfo.journal, abbreviation:$d("journal").value.trim(), link:$d("link").checked});
      if (result.existing) { job = {state:"complete", result}; }
      else job = await send({type:"PDF_DOWNLOAD_LATEST", pageId:article.id});
      paintJob();
    } catch (error) { show(error.message, "error"); $d("save").disabled = false; }
  };
  $d("view").onclick = () => chrome.tabs.create({url:`zotero://open-pdf/library/items/${job.result.attachmentKey}`});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !$d("dialog").open) return;
    for (const [key, change] of Object.entries(changes)) if (key.startsWith("pdfDownloadJob:") && change.newValue?.pageId === article?.id) { job = change.newValue; paintJob(); }
  });
  document.addEventListener("yanji-context-changed", () => { $d("open").disabled = !page || !/^https?:/.test(page.url); });
})();
