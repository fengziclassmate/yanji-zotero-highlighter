let pdfPlan;
$("#pdf-close").innerHTML = Y.icon("close");
$("#pdf-close").onclick = () => $("#pdf-dialog").close();
$("#pdf-open").onclick = () => {
  if(!page) return;
  pdfPlan = null;
  $("#pdf-results").replaceChildren(); $("#pdf-save").disabled = true; $("#pdf-view").hidden = true;
  $("#pdf-attachment").innerHTML = '<option value="">自动选择唯一 PDF</option>';
  status("#pdf-status",""); $("#pdf-dialog").showModal(); $("#pdf-scan").click();
};
$("#pdf-scan").onclick = async () => {
  const pageId = page?.id;
  $("#pdf-scan").disabled = true; $("#pdf-save").disabled = true; pdfPlan = null; $("#pdf-results").replaceChildren();
  status("#pdf-status","正在定位…");
  try {
    const result = await send({type:"PDF_SCAN",pageId,attachmentKey:$("#pdf-attachment").value||undefined});
    if(page?.id!==pageId) throw Error("文章已切换，请重新打开 PDF 标注。");
    $("#pdf-attachment").innerHTML = '<option value="">请选择 PDF</option>' + result.choices.map(item=>`<option value="${Y.escape(item.key)}">${Y.escape(item.title)}</option>`).join("");
    if(!result.rows) { status("#pdf-status","这篇文献有多份 PDF，请选择后定位。"); return; }
    pdfPlan = result; $("#pdf-attachment").value = result.attachmentKey;
    $("#pdf-results").innerHTML = result.rows.map((row,index)=>`<article class="pdf-match"><p>${Y.escape(row.chinese||row.text)}</p>${row.chinese?`<p class="original">${Y.escape(row.text)}</p>`:""}<select data-pdf-row="${Y.escape(row.id)}" aria-label="第 ${index+1} 句 PDF 位置"><option value="">${row.matches.length?"暂不写入":"未找到对应文字"}</option>${row.matches.map((match,i)=>`<option value="${i}" ${row.matches.length===1?"selected":""}>第 ${Y.escape(match.pageLabel)} 页${match.position.nextPageRects?" · 跨页":""} · 位置 ${i+1}</option>`).join("")}</select>${row.matches.length>1?'<button class="locate-button" data-pdf-view="'+Y.escape(row.id)+'">查看位置</button>':""}</article>`).join("");
    $("#pdf-save").disabled = !result.rows.some(row=>row.matches.length);
    status("#pdf-status",`${result.rows.filter(row=>row.matches.length===1).length} 句唯一匹配 · ${result.rows.filter(row=>row.matches.length>1).length} 句需选择 · ${result.rows.filter(row=>!row.matches.length).length} 句未找到`);
  } catch(error) { report("#pdf-status",error); }
  finally { $("#pdf-scan").disabled = false; }
};
$("#pdf-attachment").onchange = () => { pdfPlan = null; $("#pdf-save").disabled = true; $("#pdf-results").replaceChildren(); };
$("#pdf-results").onclick = async event => {
  const button = event.target.closest("[data-pdf-view]");
  if(!button || !pdfPlan) return;
  const select = button.closest(".pdf-match").querySelector("select"), row = pdfPlan.rows.find(row=>row.id===select.dataset.pdfRow);
  if(select.value==="") { status("#pdf-status","先选择一个位置再查看。"); return; }
  try {await send({type:"PDF_PREVIEW",token:pdfPlan.token,id:row.id,index:Number(select.value)});}
  catch(error) {report("#pdf-status",error);}
};
$("#pdf-save").onclick = async () => {
  if(!pdfPlan) return;
  const selections = [...$("#pdf-results").querySelectorAll("select[data-pdf-row]")].filter(select=>select.value!=="").map(select=>({id:select.dataset.pdfRow,index:Number(select.value)}));
  if(!selections.length) { status("#pdf-status","请选择至少一个 PDF 位置。"); return; }
  $("#pdf-save").disabled = true;
  try {
    const result = await send({type:"PDF_SAVE",token:pdfPlan.token,selections});
    status("#pdf-status",`已写入 ${result.written} 条 · 沿用 ${result.unchanged} 条${result.conflicts?` · ${result.conflicts} 条已在 Zotero 修改，未覆盖`:""}`,"success");
    $("#pdf-view").hidden = false;
  } catch(error) { report("#pdf-status",error); }
  finally { $("#pdf-save").disabled = false; }
};
$("#pdf-view").onclick = () => { if(pdfPlan) chrome.tabs.create({url:`zotero://open-pdf/library/items/${pdfPlan.attachmentKey}`}); };
