(() => {
  let documentInfo, libraryInfo, article, sourceTab, job, opening = 0, autoImport = false;
  const $d = id => document.getElementById("download-" + id);
  $d("open").innerHTML = Y.icon("download");
  $d("close").innerHTML = Y.icon("close");
  $d("root").innerHTML = Y.icon("folder");
  const show = (text, kind = "") => status("#download-status", text, kind);
  const stateFields={reading:'state',importance:'importance',priority:'priority',publication:'publication'};
  const paperStatus=()=>Object.fromEntries(Object.entries(stateFields).map(([key,id])=>[key,$d(id).value]));
  function paintStates(saved={}){
    const config=settings.paperStates||Y.defaults.paperStates;
    for(const[key,id]of Object.entries(stateFields)){
      $d(id).innerHTML=config[key].map(row=>`<option value="${Y.escape(row.code)}">${Y.escape([row.code,row.label].filter(Boolean).join(' '))}</option>`).join('');
      $d(id).value=config[key].some(row=>row.code===saved[key])?saved[key]:config[key][0].code;
    }
  }
  function importChoice(){
    $d("link-label").textContent=libraryInfo?.binding?"关联到 Zotero 文献":"自动加入 Zotero 文库";
    $d("binding").textContent=libraryInfo?.binding?.title||(libraryInfo?.ambiguous?"匹配多条文献，请先在侧栏选择。":$d("link").checked?"保存后加入“我的文库”":"未关联 Zotero，本次仅保存 PDF。");
    $d("save").textContent=job?.state==="complete"&&$d("link").checked&&!job.result.attachmentKey&&$d("filename").value.trim()===job.filename?"加入 Zotero":"保存 PDF";
  }
  function preview() {
    try {
      $d("filename").value = YanjiPDFDocument.filename({prefix:Y.paperPrefix(paperStatus(),settings.paperStates||Y.defaults.paperStates), date:$d("date").value.trim(), dateType:$d("date-type").value, journal:$d("journal").value, keywords:$d("keywords").value, title:documentInfo.title});
      show("");
      importChoice();
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
    $d("local").disabled = job.state === "downloading" || !libraryInfo?.root;
    if (job.state === "downloading") show(job.phase === "saving" ? "正在保存到文献库…" : "正在下载；如 Edge 询问，请选择“保存”。");
    else if (job.state === "error") show(job.error, "error");
    else show(job.result.warning || job.result.message || (job.result.attachmentKey ? job.result.stored?"已保存并加入 Zotero":"已保存并关联到 Zotero" : "PDF 已保存"), job.result.warning ? "error" : "success");
    $d("saved").hidden = job.state !== "complete";
    $d("saved-path").textContent = job.result?.path || "";
    $d("view").hidden = !job.result?.attachmentKey;
    importChoice();
  }
  $d("open").onclick = async () => {
    if (!page) return;
    const sequence = ++opening;
    article = structuredClone(page); sourceTab = tabId; job = null;libraryInfo=null;
    $d("form").reset(); $d("save").disabled = true; $d("saved").hidden = true;
    $d("local").hidden=true;
    $d("link").disabled=true;
    $d("kind").disabled=true;
    show("读取 PDF 信息…"); $d("dialog").showModal();
    try {
      const response = await YanjiPDFDocument.readTab(sourceTab);
      if(sequence!==opening||!$d("dialog").open)return;
      if (!response?.ok) throw Error(response?.error || "请刷新文章页后重试。");
      documentInfo = response.data;
      $d("kind").value=documentInfo.articleKind||"research";
      if (documentInfo.blocked) throw Error("请先完成网页登录或验证，再重新打开保存 PDF。");
      const [info, latest, preference] = await Promise.all([send({type:"PDF_DOWNLOAD_INFO", pageId:article.id, meta:article, document:documentInfo}), send({type:"PDF_DOWNLOAD_LATEST", pageId:article.id}),chrome.storage.local.get("pdfAutoImport")]);
      if (sequence !== opening || !$d("dialog").open) return;
      libraryInfo = info; job = latest;autoImport=preference.pdfAutoImport===true;
      paintStates(article.paperStatus||Y.paperStatuses(job?.filename,settings.paperStates||Y.defaults.paperStates));
      $d("kind").disabled=false;
      $d("local").hidden=!info.localImport;$d("local").disabled=!info.root;
      documentInfo.journal=info.journal||documentInfo.journal;
      folders();
      $d("url").value = documentInfo.sources[0]?.url || "";
      $d("sources").innerHTML = documentInfo.sources.map(source => `<option value="${Y.escape(source.url)}">${Y.escape(source.label)}</option>`).join("");
      $d("date-type").value=documentInfo.accepted?"accepted":"published";
      $d("date").value = documentInfo.accepted||documentInfo.published;
      $d("link").disabled = false; $d("link").checked = !!info.binding||autoImport;
      preview(); paintJob();
      if($d("kind").value!=="research"&&!info.classifiedFolders){$d("save").disabled=true;throw Error("请将 Zotero 研迹配套插件更新至 0.5.0，以分类保存综述和数据集。");}
      if(autoImport&&!info.autoImport){$d("save").disabled=true;throw Error("请将 Zotero 研迹配套插件更新至 0.3.0，以使用自动入库。");}
    } catch (error) { show(error.message, "error"); }
  };
  $d("link").onchange=async()=>{
    if(!libraryInfo?.binding){
      if($d("link").checked&&!libraryInfo?.autoImport){$d("link").checked=false;show("请先更新 Zotero 研迹配套插件至 0.3.0。","error");return;}
      autoImport=$d("link").checked;await chrome.storage.local.set({pdfAutoImport:autoImport});
    }
    importChoice();
  };
  $d("filename").addEventListener("input",importChoice);
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
  for (const name of ["state", "importance", "priority", "publication", "date", "date-type", "journal", "keywords"]) $d(name).addEventListener("input", () => {
    if (name === "date-type") $d("date").value = documentInfo[$d("date-type").value];
    preview();
    if(Object.values(stateFields).includes(name))send({type:'PAPER_STATUS',pageId:article.id,statuses:paperStatus()}).then(saved=>{article.paperStatus=saved},error=>show(error.message,'error'));
  });
  $d("folder").onchange = () => {
    const group=Object.entries(libraryInfo.categoryRoots||{}).find(([,root])=>$d("folder").value===root||$d("folder").value.startsWith(root+"/"));
    if(group){$d("kind").value=group[0];documentInfo.articleKind=group[0];preview();return;}
    const leaf = $d("folder").value.split("/").at(-1).replace(/^\d+[-_ ]*/, "");
    if (leaf) $d("journal").value = leaf;
    preview();
  };
  $d("kind").onchange=async()=>{
    const kind=$d("kind").value,code=$d("journal").value,sequence=opening;
    documentInfo.articleKind=kind;$d("save").disabled=true;
    try{
      const info=await send({type:"PDF_DOWNLOAD_INFO",pageId:article.id,meta:article,document:{...documentInfo,articleKind:kind}});
      if(sequence!==opening||!$d("dialog").open||kind!==$d("kind").value)return;
      if(kind!=="research"&&!info.classifiedFolders)throw Error("请将 Zotero 研迹配套插件更新至 0.5.0，以分类保存综述和数据集。");
      libraryInfo=info;folders();if(code)$d("journal").value=code;preview();paintJob();
    }catch(error){show(error.message,"error")}
  };
  async function save(localFile = false) {
    $d("save").disabled = true;
    $d("local").disabled = true;
    try {
      if ($d("folder").value === "__choose__") throw Error("请选择保存文件夹。");
      const reader=!localFile&&libraryInfo.readerSave===true&&/Edg\//.test(navigator.userAgent);
      if(!localFile&&!reader){const granted = await chrome.permissions.request({permissions:["downloads"]});if (!granted) throw Error("未允许下载文件。");}
      show("准备下载…");
      const importing=$d("link").checked&&(!libraryInfo.binding||autoImport);
      const metadata=importing?{title:documentInfo.title,doi:article.doi||"",url:documentInfo.canonical||article.url,journal:documentInfo.journal,date:documentInfo.published,authors:documentInfo.authors||[],itemType:documentInfo.itemType,hasMetadata:documentInfo.hasMetadata,volume:documentInfo.volume,issue:documentInfo.issue,pages:documentInfo.pages,issn:documentInfo.issn}:undefined;
      const result = await send({type:"PDF_DOWNLOAD_START", pageId:article.id, meta:article, tabId:sourceTab, url:$d("url").value, folder:$d("folder").value,createFolder:libraryInfo.newFolder===$d("folder").value, filename:$d("filename").value.trim(), journal:documentInfo.journal, abbreviation:$d("journal").value.trim(),articleKind:$d("kind").value, link:$d("link").checked&&!!libraryInfo.binding,autoImport:importing,metadata,localFile,reader});
      if(result.cancelled){show("已取消选择 PDF");return;}
      if (result.existing) { job = {state:"complete", result}; }
      else job = await send({type:"PDF_DOWNLOAD_LATEST", pageId:article.id});
      paintJob();
    } catch (error) { show(error.message, "error"); }
    finally {if(job?.state!=="downloading"){$d("save").disabled=false;$d("local").disabled=false;}}
  }
  $d("form").onsubmit = event => {event.preventDefault();save();};
  $d("local").onclick = () => save(true);
  $d("view").onclick = () => chrome.tabs.create({url:`zotero://open-pdf/library/items/${job.result.attachmentKey}`});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && $d("dialog").open) {
      const text = changes["pdfDownloadStart:" + article?.id]?.newValue;
      if (text) show(text);
    }
    if(area!=="local")return;
    if(changes.pdfAutoImport){autoImport=changes.pdfAutoImport.newValue===true;if($d("dialog").open&&!libraryInfo?.binding){$d("link").checked=autoImport;importChoice();}}
    if (!$d("dialog").open) return;
    for (const [key, change] of Object.entries(changes)) if (key.startsWith("pdfDownloadJob:") && change.newValue?.pageId === article?.id) { job = change.newValue; paintJob(); }
  });
  document.addEventListener("yanji-context-changed", () => { $d("open").disabled = !page || !/^https?:/.test(page.url); });
})();
