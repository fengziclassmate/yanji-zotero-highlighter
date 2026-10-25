var YanjiPDFSync = (() => {
  let saving = false;
  const fields = ["annotationType","annotationText","annotationComment","annotationColor","annotationPageLabel","annotationSortIndex","annotationPosition"];
  const managed = data => Object.fromEntries(fields.map(key=>[key,data[key]]));
  const markerID = tag => /^研迹句对:([a-f0-9]{32})$/.exec(tag)?.[1];
  const linkKey = (pdf,id) => `pdfLink:${Z.connection.serverID}:${pdf}:${id}`;
  async function remember(pdf,id,value) {
    const key=linkKey(pdf,id),current=(await chrome.storage.local.get(key))[key];
    if(current?.key===value.key&&current.hash===value.hash&&!!current.unverified===!!value.unverified)return;
    await chrome.storage.local.set({[key]:value,dataRevision:crypto.randomUUID()});
  }
  function legacyComment(text) {
    if(!/^(?:<p>(?:[^<]|<br\s*\/?\s*>)*<\/p>)+$/i.test(text)) return null;
    const decode=text=>text.replace(/&(amp|lt|gt|quot|#39);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[name]);
    const paragraphs=[...text.matchAll(/<p>((?:[^<]|<br\s*\/?\s*>)*)<\/p>/gi)].map(match=>decode(match[1].replace(/<br\s*\/?\s*>/gi,'\n')));
    if(!/^(?:https?:\/\/|file:\/\/\/)\S+$/.test(paragraphs.at(-1)))return null;
    paragraphs.pop();
    return paragraphs.filter(Boolean).join('\n\n');
  }
  const cleanTags = tags => tags.filter(tag=>tag.tag!=="研迹PDF标注"&&!markerID(tag.tag));
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
        requests.set(id,{id,text,chinese,comment:annotation.comment,color:category.color});
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
    const keys=plan.rows.flatMap(row=>[linkKey(plan.attachmentKey,row.id),`pdfPortable:${plan.attachmentKey}:${row.id}`]);
    const links=await chrome.storage.local.get(keys);
    const baselineFor=id=>links[linkKey(plan.attachmentKey,id)]||links[`pdfPortable:${plan.attachmentKey}:${id}`];
    const itemKeys=new Set([...file.annotationKeys,...plan.rows.map(row=>baselineFor(row.id)?.key).filter(Boolean)]);
    const children = (await Promise.all([...itemKeys].map(key=>Z.read(`${Z.library}/items/${key}`,true)))).filter(item=>item&&!item.data.deleted&&item.data.itemType==='annotation'&&item.data.parentItem===plan.attachmentKey);
    let written = 0, unchanged = 0, conflicts = 0;
    for(const selected of [...new Map(selections.map(row=>[row.id,row])).values()]) {
      const row = plan.rows.find(row=>row.id===selected.id), match = row.matches[selected.index];
      const marker = "研迹句对:"+row.id, baseline=baselineFor(row.id);
      const matches = children.filter(item=>item.key===baseline?.key||item.data.tags.some(tag=>tag.tag===marker));
      if(matches.length>1 || !matches.length&&baseline) { conflicts++; continue; }
      let current = matches[0];
      const data = {annotationType:"highlight",annotationText:row.text,annotationComment:[row.chinese,row.comment].filter(Boolean).join('\n\n'),annotationColor:row.color.toLowerCase(),annotationPageLabel:match.pageLabel,annotationSortIndex:match.sortIndex,annotationPosition:JSON.stringify(match.position)};
      const wanted = await digest(JSON.stringify(data));
      if(current) {
        const actual = await digest(JSON.stringify(managed(current.data)));
        const tags=cleanTags(current.data.tags),tagsChanged=tags.length!==current.data.tags.length;
        if(actual===wanted&&!tagsChanged) { await remember(plan.attachmentKey,row.id,{key:current.key,hash:actual}); unchanged++; continue; }
        if(actual!==wanted&&(!baseline||baseline.unverified||baseline.key!==current.key||baseline.hash!==actual)) {
          if(tagsChanged) {
            await remember(plan.attachmentKey,row.id,baseline||{key:current.key,hash:actual,unverified:true});
            await Z.write(`${Z.library}/items/${current.key}`,"PATCH",{tags},{"If-Unmodified-Since-Version":String(current.version)});
          }
          conflicts++; continue;
        }
        await Z.write(`${Z.library}/items/${current.key}`,"PATCH",{...data,tags},{"If-Unmodified-Since-Version":String(current.version)});
      } else {
        const alphabet="23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
        const key=[...crypto.getRandomValues(new Uint8Array(8))].map(n=>alphabet[n%alphabet.length]).join("");
        await Z.write(`${Z.library}/items`,"POST",[{key,version:0,itemType:"annotation",parentItem:plan.attachmentKey,...data,tags:[],relations:{}}]);
        current={key};
      }
      let saved = await Z.read(`${Z.library}/items/${current.key}`);
      const tags=cleanTags(saved.data.tags);
      if(tags.length!==saved.data.tags.length) {
        await Z.write(`${Z.library}/items/${saved.key}`,"PATCH",{tags},{"If-Unmodified-Since-Version":String(saved.version)});
        saved=await Z.read(`${Z.library}/items/${saved.key}`);
      }
      await remember(plan.attachmentKey,row.id,{key:saved.key,hash:await digest(JSON.stringify(managed(saved.data)))});
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
  async function repairLegacy() {
    await Z.connect();
    const prefix=`pdfLink:${Z.connection.serverID}:`,keys=(await chrome.storage.local.getKeys()).filter(key=>key.startsWith(prefix)||key.startsWith('pdfPortable:'));
    const links=await chrome.storage.local.get(keys),byItem=new Map();
    for(const name of [...keys.filter(key=>key.startsWith('pdfPortable:')),...keys.filter(key=>key.startsWith(prefix))]) {
      const value=links[name];
      const parts=name.split(':');byItem.set(value.key,{pdf:parts.at(-2),id:parts.at(-1),value});
    }
    const owned=[];
    for(let start=0;;start+=100){const rows=await Z.read(`${Z.library}/items?format=json&itemType=annotation&tag=${encodeURIComponent('研迹PDF标注')}&limit=100&start=${start}`);owned.push(...rows);if(rows.length<100)break;}
    const items=new Map(owned.map(item=>[item.key,item]));
    for(const key of byItem.keys())if(!items.has(key)){const item=await Z.read(`${Z.library}/items/${key}`,true);if(item)items.set(key,item);}
    let repaired=0;
    for(const item of items.values()) {
      if(item.data.itemType!=='annotation'||item.data.deleted)continue;
      const known=byItem.get(item.key),ids=item.data.tags.map(tag=>markerID(tag.tag)).filter(Boolean);
      const before=await digest(JSON.stringify(managed(item.data))),patch={};
      const comment=legacyComment(item.data.annotationComment),tags=cleanTags(item.data.tags);
      if(comment!==null&&comment!==item.data.annotationComment)patch.annotationComment=comment;
      if(tags.length!==item.data.tags.length)patch.tags=tags;
      // Preserve the old hash for manual edits, so a later sync still stops at the conflict.
      const canAdvance=known&&!known.value.unverified&&known.value.hash===before;
      if(Object.keys(patch).length){await Z.write(`${Z.library}/items/${item.key}`,'PATCH',patch,{'If-Unmodified-Since-Version':String(item.version)});repaired++;}
      const saved=Object.keys(patch).length?await Z.read(`${Z.library}/items/${item.key}`):item;
      const hash=canAdvance?await digest(JSON.stringify(managed(saved.data))):known?.value.hash||before;
      const unverified=!known||known.value.unverified;
      for(const id of new Set([...ids,...(known?[known.id]:[])]))await remember(item.data.parentItem,id,{key:item.key,hash,...(unverified?{unverified:true}:{})});
    }
    return {inspected:items.size,repaired};
  }
  return {scan,save,preview,repairLegacy};
})();
