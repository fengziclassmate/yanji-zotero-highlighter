var YanjiPDFImport = (() => {
  const pref="extensions.yanji.pdfFiles.imports";
  const doi=value=>value.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,"").toLowerCase();
  const text=value=>value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
  function metadata(value) {
    if(!value||typeof value!=="object")throw Error("缺少文献元数据。");
    const limits={title:5000,doi:300,url:4000,journal:500,date:100,volume:100,issue:100,pages:100,issn:100};
    const result={};
    for(const[key,max]of Object.entries(limits)){
      const field=value[key]??"";
      if(typeof field!=="string"||field.length>max)throw Error("文献元数据格式无效。");
      result[key]=field.trim();
    }
    result.doi=doi(result.doi);
    if(result.doi&&!/^10\.\d{4,9}\/\S+$/.test(result.doi))throw Error("DOI 格式无效。");
    if(result.url&&(!URL.canParse(result.url)||!/^https?:$/.test(new URL(result.url).protocol)||new URL(result.url).username||new URL(result.url).password))throw Error("文献来源地址无效。");
    const authors=value.authors??[];
    if(!Array.isArray(authors)||authors.length>100||authors.some(name=>typeof name!=="string"||name.length>500))throw Error("作者信息格式无效。");
    result.authors=authors.map(name=>name.trim()).filter(Boolean);
    result.itemType=["journalArticle","conferencePaper","preprint"].includes(value.itemType)?value.itemType:"journalArticle";
    result.hasMetadata=value.hasMetadata===true;
    return result;
  }
  async function search(field,operator,value) {
    const s=new Zotero.Search();s.libraryID=Zotero.Libraries.userLibraryID;s.addCondition(field,operator,value);
    const ids=await s.search();
    const rows=(await Zotero.Items.getAsync(ids.slice(0,100))).filter(item=>item.isRegularItem()&&!item.deleted);
    return {rows,overflow:ids.length>100};
  }
  async function matches(meta) {
    if(meta.doi){const found=await search("DOI","contains",meta.doi);const rows=found.rows.filter(item=>doi(item.getField("DOI")||"")===meta.doi);if(rows.length||found.overflow)return{rows,ambiguous:found.overflow||rows.length>1};}
    if(meta.url){const found=await search("url","is",meta.url);if(found.rows.length||found.overflow)return{rows:found.rows,ambiguous:found.overflow||found.rows.length>1};}
    const title=text(meta.title);
    if(title.length<30)return{rows:[],ambiguous:false};
    let found=await search("title","is",meta.title);
    if(!found.rows.length){const word=(meta.title.match(/[\p{L}\p{N}]+/gu)||[]).sort((a,b)=>b.length-a.length)[0];found=await search("title","contains",word);}
    const year=meta.date.match(/(?:19|20)\d{2}/)?.[0];
    const rows=found.rows.filter(item=>{
      const otherDOI=doi(item.getField("DOI")||""),otherYear=item.getField("date").match(/(?:19|20)\d{2}/)?.[0];
      return text(item.getField("title"))===title&&(!meta.hasMetadata||item.itemType===meta.itemType)&&!(meta.doi&&otherDOI&&meta.doi!==otherDOI)&&!(year&&otherYear&&year!==otherYear);
    });
    return{rows,ambiguous:found.overflow||rows.length>1};
  }
  async function description(attachment) {
    if(!attachment||attachment.deleted||!attachment.isPDFAttachment())return null;
    const parent=attachment.parentItemID?await Zotero.Items.getAsync(attachment.parentItemID):null;
    if(parent?.deleted)return null;
    return{attachmentKey:attachment.key,parentItemKey:parent?.key||"",parentTitle:parent?.getField("title")||"",stored:[Zotero.Attachments.LINK_MODE_IMPORTED_FILE,Zotero.Attachments.LINK_MODE_IMPORTED_URL].includes(attachment.attachmentLinkMode)};
  }
  async function sameFile(parent,hash) {
    for(const attachment of await Zotero.Items.getAsync(parent.getAttachments())){
      if(attachment.deleted||!attachment.isPDFAttachment())continue;
      if(await attachment.getFilePathAsync()&&await attachment.attachmentHash===hash)return attachment;
    }
    return null;
  }
  async function add(path,meta,preferredKey) {
    const hash=await Zotero.Utilities.Internal.md5Async(path);
    const index=JSON.parse(Zotero.Prefs.get(pref,true)||"{}"),key=Zotero.Server.LocalAPI.getServerID()+":"+hash;
    const remembered=index[key]&&Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID,index[key]);
    const previous=await description(remembered);
    if(previous&&(!preferredKey||previous.parentItemKey===preferredKey))return{...previous,reused:true};
    let parent=preferredKey?Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID,preferredKey):null;
    if(parent&&(!parent.isRegularItem()||parent.deleted))throw Error("目标文献已不存在。");
    if(parent&&previous&&!previous.parentItemKey){
      const duplicate=await sameFile(parent,hash);
      if(duplicate){index[key]=duplicate.key;Zotero.Prefs.set(pref,JSON.stringify(index),true);return{...await description(duplicate),reused:true};}
      remembered.parentItemID=parent.id;await remembered.saveTx();return{...await description(remembered),reused:true};
    }
    if(!parent){
      // Query stored hash metadata, rather than reading every PDF in the library.
      const ids=await Zotero.DB.columnQueryAsync("SELECT a.itemID FROM itemAttachments a JOIN items i ON i.itemID=a.itemID WHERE i.libraryID=? AND a.contentType='application/pdf' AND a.storageHash=? AND a.itemID NOT IN (SELECT itemID FROM deletedItems) LIMIT 21",[Zotero.Libraries.userLibraryID,hash]);
      const existing=[];
      for(const attachment of await Zotero.Items.getAsync(ids)){const value=await description(attachment);if(value){const file=await attachment.getFilePathAsync();if(!file||!await IOUtils.exists(file)||await attachment.attachmentHash===hash)existing.push({attachment,value});}}
      if(existing.length===1){index[key]=existing[0].attachment.key;Zotero.Prefs.set(pref,JSON.stringify(index),true);return{...existing[0].value,reused:true};}
      const found=await matches(meta);
      if(found.rows.length===1&&!found.ambiguous)parent=found.rows[0];
      else if(found.ambiguous||existing.length>1){
        if(existing.length>1)return{attachmentKey:"",parentItemKey:"",parentTitle:"",stored:true,warning:"PDF 已在文库中，匹配多条文献，请先在 Zotero 确认归属。"};
        const attachment=await Zotero.Attachments.importFromFile({file:path,libraryID:Zotero.Libraries.userLibraryID,contentType:"application/pdf"});
        index[key]=attachment.key;Zotero.Prefs.set(pref,JSON.stringify(index),true);
        return{...await description(attachment),warning:"PDF 已作为独立附件加入文库，匹配多条文献，请在 Zotero 确认归属。"};
      }
    }
    let created;
    if(!parent&&meta.hasMetadata&&meta.title){
      parent=new Zotero.Item(meta.itemType);parent.libraryID=Zotero.Libraries.userLibraryID;
      parent.setField("title",meta.title);
      for(const field of ["DOI","url","date"]) {const value=field==="DOI"?meta.doi:field==="date"?meta.date.replace(/^(\d{4})(\d{2})(\d{2})$/,"$1-$2-$3").replace(/^(\d{4})(\d{2})$/,"$1-$2"):meta.url;if(value)parent.setField(field,value);}
      if(meta.journal)parent.setField(meta.itemType==="conferencePaper"?"proceedingsTitle":meta.itemType==="preprint"?"repository":"publicationTitle",meta.journal);
      if(meta.itemType==="journalArticle")for(const field of ["volume","issue","pages","ISSN"]){const value=field==="ISSN"?meta.issn:meta[field];if(value)parent.setField(field,value);}
      if(meta.itemType==="conferencePaper"&&meta.pages)parent.setField("pages",meta.pages);
      if(meta.authors.length)parent.setCreators(meta.authors.map(name=>Zotero.Utilities.cleanAuthor(name,"author",name.includes(","))));
      await parent.saveTx();created=parent;
    }
    if(parent){const duplicate=await sameFile(parent,hash);if(duplicate){index[key]=duplicate.key;Zotero.Prefs.set(pref,JSON.stringify(index),true);return{...await description(duplicate),reused:true};}}
    let attachment;
    try{attachment=await Zotero.Attachments.importFromFile({file:path,libraryID:Zotero.Libraries.userLibraryID,parentItemID:parent?.id,contentType:"application/pdf"});}
    catch(error){if(created&&!created.getAttachments().length&&!created.getNotes().length)await created.eraseTx();throw error;}
    index[key]=attachment.key;Zotero.Prefs.set(pref,JSON.stringify(index),true);
    if(!parent)Zotero.RecognizeDocument.autoRecognizeItems([attachment]).catch(error=>Zotero.logError(error));
    return{...await description(attachment),message:parent?"": "PDF 已加入文库，可在 Zotero 查看识别结果。"};
  }
  return{metadata,add};
})();
