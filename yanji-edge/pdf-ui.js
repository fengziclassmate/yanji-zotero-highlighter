let pdfPlan;
$("#pdf-close").innerHTML = Y.icon("close");
$("#pdf-scan").innerHTML = Y.icon("refresh");
$("#pdf-close").onclick = () => $("#pdf-dialog").close();
$("#pdf-open").onclick = () => {
  if(!page) return;
  pdfPlan = null;
  $("#pdf-results").replaceChildren(); $("#pdf-save").disabled = true; $("#pdf-view").hidden = true;
  $("#pdf-attachment").innerHTML = '<option value="">自动选择唯一 PDF</option>';
  $("#pdf-file-name").hidden=true;$("#pdf-attachment").hidden=true;
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
    $("#pdf-attachment").hidden=result.choices.length===1;
    $("#pdf-file-name").hidden=result.choices.length!==1;
    $("#pdf-file-name").textContent=result.choices[0].title;$("#pdf-file-name").title=result.choices[0].title;
    if(!result.rows) { status("#pdf-status","这篇文献有多份 PDF，请选择后定位。"); return; }
    pdfPlan = result; $("#pdf-attachment").value = result.attachmentKey;
    $("#pdf-results").innerHTML = result.rows.map((row,index)=>`<article class="pdf-match"><p class="quote">${Y.escape(row.chinese||row.text)}</p>${row.chinese?`<p class="original">${Y.escape(row.text)}</p>`:""}<div class="pdf-targets">${row.matches.length===1?`<label class="check"><input type="checkbox" data-pdf-row="${Y.escape(row.id)}" value="0" checked>第 ${Y.escape(row.matches[0].pageLabel)} 页${row.matches[0].position.nextPageRects?" 跨页":""}</label>`:row.matches.length?`<select data-pdf-row="${Y.escape(row.id)}" aria-label="第 ${index+1} 句 PDF 位置"><option value="">选择位置</option>${row.matches.map((match,i)=>`<option value="${i}">第 ${Y.escape(match.pageLabel)} 页 / 位置 ${i+1}${match.position.nextPageRects?" 跨页":""}</option>`).join("")}</select>`:'<span class="muted">未找到对应文字</span>'}${row.matches.length>1?'<button class="quiet" data-pdf-view="'+Y.escape(row.id)+'">查看位置</button>':""}</div></article>`).join("");
    $("#pdf-save").disabled = !result.rows.some(row=>row.matches.length);
    status("#pdf-status",[result.rows.filter(row=>row.matches.length===1).length+" 句可写入",...[[result.rows.filter(row=>row.matches.length>1).length,"句需选择"],[result.rows.filter(row=>!row.matches.length).length,"句未找到"]].filter(([count])=>count).map(([count,text])=>count+" "+text)].join("，"));
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
  const selections = [...$("#pdf-results").querySelectorAll("[data-pdf-row]")].filter(control=>control.type==="checkbox"?control.checked:control.value!=="").map(control=>({id:control.dataset.pdfRow,index:Number(control.value)}));
  if(!selections.length) { status("#pdf-status","请选择至少一个 PDF 位置。"); return; }
  $("#pdf-save").disabled = true;
  try {
    const result = await send({type:"PDF_SAVE",token:pdfPlan.token,selections});
    status("#pdf-status",`已写入 ${result.written} 条，沿用 ${result.unchanged} 条${result.conflicts?`，${result.conflicts} 条需核对，未覆盖`:""}`,"success");
    $("#pdf-view").hidden = false;
  } catch(error) { report("#pdf-status",error); }
  finally { $("#pdf-save").disabled = false; }
};
$("#pdf-view").onclick = () => { if(pdfPlan) chrome.tabs.create({url:`zotero://open-pdf/library/items/${pdfPlan.attachmentKey}`}); };
