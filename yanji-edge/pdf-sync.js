var YanjiPDFSync = (() => {
  let saving = false;
  const fields = ["annotationType","annotationText","annotationComment","annotationColor","annotationPageLabel","annotationSortIndex","annotationPosition"];
  const managed = data => Object.fromEntries(fields.map(key=>[key,data[key]]));
  async function scan(pageId,attachmentKey) {
    const page = await getPage(pageId);
    if(!page?.binding) throw Error("请先关联 Zotero 文献。");
    await Z.connect();
    if(page.binding.serverID!==Z.connection.serverID) throw Error("当前 Zotero 文献库已改变，请重新关联。");
    const pages = await S.linked(page.binding), settings = await getSettings(), requests = new Map();
    for(const annotation of pages.flatMap(page=>page.annotations)) {
      const english = Y.alignedEnglish(annotation);
      for(const segment of annotation.segments.filter(segment=>!segment.translated)) english.push(segment.quote);
      for(const text of new Set(english)) {
        const id = (await digest(annotation.id+"\n"+text)).slice(0,32);
        const category = settings.categories.find(category=>category.id===annotation.category);
        const chinese = [...new Set(annotation.segments.flatMap(segment=>(segment.sentencePairs||[]).filter(pair=>pair.english.includes(text)).map(pair=>pair.chinese)))].join(" ");
        requests.set(id,{id,text,chinese,comment:annotation.comment,color:category.color,url:annotation.url});
      }
    }
    if(!requests.size) throw Error("中文标注请先保存对应英文句对；已有英文划线可直接定位 PDF。");
    const result = await Z.locatePDF({parentItemKey:page.binding.itemKey,attachmentKey,sentences:[...requests.values()].map(({id,text})=>({id,text}))});
    if(!result.rows) return result;
    const token = crypto.randomUUID();
    const rows = result.rows.map(row=>({...requests.get(row.id),matches:row.matches}));
    const plan = {token,serverID:Z.connection.serverID,parentItemKey:page.binding.itemKey,attachmentKey:result.attachmentKey,hash:result.hash,rows};
    await chrome.storage.session.set({pdfPlan:plan});
    return {token,attachmentKey:result.attachmentKey,choices:result.choices,rows};
  }
  async function savePlan(token,selections) {
    const {pdfPlan:plan} = await chrome.storage.session.get("pdfPlan");
    if(!plan || plan.token!==token) throw Error("PDF 定位结果已过期，请重新定位。");
    await Z.connect();
    if(plan.serverID!==Z.connection.serverID) throw Error("Zotero 文献库已改变，请重新定位。");
    if(!Array.isArray(selections) || selections.some(row=>!plan.rows.some(source=>source.id===row.id&&Number.isInteger(row.index)&&row.index>=0&&row.index<source.matches.length))) throw Error("请选择有效的 PDF 匹配位置。");
    const file = await Z.locatePDF({parentItemKey:plan.parentItemKey,attachmentKey:plan.attachmentKey,sentences:plan.rows.map(({id,text})=>({id,text})),verifyHash:plan.hash});
    if(!file.hashMatches) throw Error("PDF 文件已经更换，请重新定位。");
    if(!Array.isArray(file.annotationKeys)) throw Error("请将 Zotero 的研迹配套插件升级至 0.1.2 或更新版本，再写入 PDF。");
    const children = await Promise.all(file.annotationKeys.map(key=>Z.read(`${Z.library}/items/${key}`)));
    let written = 0, unchanged = 0, conflicts = 0;
    for(const selected of [...new Map(selections.map(row=>[row.id,row])).values()]) {
      const row = plan.rows.find(row=>row.id===selected.id), match = row.matches[selected.index];
      const marker = "研迹句对:"+row.id, linkKey = `pdfLink:${plan.serverID}:${plan.attachmentKey}:${row.id}`;
      const baseline = (await chrome.storage.local.get(linkKey))[linkKey];
      const matches = children.filter(item=>item.data.itemType==="annotation"&&!item.data.deleted&&item.data.tags.some(tag=>tag.tag===marker));
      if(matches.length>1 || !matches.length&&baseline) { conflicts++; continue; }
      let current = matches[0];
      const data = {annotationType:"highlight",annotationText:row.text,annotationComment:`<p>${Y.escape(row.chinese)}</p>${row.comment?`<p>${Y.escape(row.comment).replace(/\n/g,"<br/>")}</p>`:""}<p>${Y.escape(row.url)}</p>`,annotationColor:row.color,annotationPageLabel:match.pageLabel,annotationSortIndex:match.sortIndex,annotationPosition:JSON.stringify(match.position)};
      const wanted = await digest(JSON.stringify(data));
      if(current) {
        const actual = await digest(JSON.stringify(managed(current.data)));
        if(actual===wanted) { await chrome.storage.local.set({[linkKey]:{key:current.key,hash:actual}}); unchanged++; continue; }
        if(!baseline || baseline.key!==current.key || baseline.hash!==actual) { conflicts++; continue; }
        await Z.write(`${Z.library}/items/${current.key}`,"PATCH",data,{"If-Unmodified-Since-Version":String(current.version)});
      } else {
        const alphabet="23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
        const key=[...crypto.getRandomValues(new Uint8Array(8))].map(n=>alphabet[n%alphabet.length]).join("");
        await Z.write(`${Z.library}/items`,"POST",[{key,version:0,itemType:"annotation",parentItem:plan.attachmentKey,...data,tags:[{tag:"研迹PDF标注"},{tag:marker}],relations:{}}]);
        current={key};
      }
      const saved = await Z.read(`${Z.library}/items/${current.key}`);
      await chrome.storage.local.set({[linkKey]:{key:saved.key,hash:await digest(JSON.stringify(managed(saved.data)))}});
      written++;
    }
    return {written,unchanged,conflicts,attachmentKey:plan.attachmentKey};
  }
  async function save(token,selections) {
    if(saving) throw Error("PDF 标注正在写入，请等待完成。");
    saving = true;
    try {return await savePlan(token,selections);}
    finally {saving = false;}
  }
  async function preview(token,id,index) {
    const {pdfPlan:plan} = await chrome.storage.session.get("pdfPlan");
    const row=plan?.rows.find(row=>row.id===id);
    if(!plan || plan.token!==token || !Number.isInteger(index) || !row?.matches[index]) throw Error("请选择有效的 PDF 位置。");
    return Z.locatePDF({parentItemKey:plan.parentItemKey,attachmentKey:plan.attachmentKey,sentences:[{id:row.id,text:row.text}],preview:row.matches[index].position});
  }
  return {scan,save,preview};
})();
