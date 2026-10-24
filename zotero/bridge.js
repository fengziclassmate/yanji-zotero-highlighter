var YanjiPDFBridge = (() => {
  const path = "/yanji/pdf/locate";
  let busy = false;
  async function locate(data) {
    if (!/^[A-Z0-9]{8}$/.test(data.parentItemKey) || !Array.isArray(data.sentences) || !data.sentences.length || data.sentences.length > 500 || data.sentences.some(row=>typeof row.id!=="string" || row.id.length>80 || typeof row.text!=="string" || !YanjiPDFCore.normalize(row.text) || row.text.length>10000)) throw Error("PDF 定位请求格式无效，单次最多 500 句。");
    const parent = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID,data.parentItemKey);
    if (!parent || !parent.isRegularItem() || parent.deleted) throw Error("未找到对应文献。");
    const attachments = (await Zotero.Items.getAsync(parent.getAttachments())).filter(item=>item.isPDFAttachment()&&!item.deleted);
    if (!attachments.length) throw Error("这篇文献尚无 PDF 附件；请先导入 PDF。");
    const choices = attachments.map(item=>({key:item.key,title:item.getField("title")}));
    if (!data.attachmentKey && attachments.length > 1) return { choices };
    const attachment = data.attachmentKey ? attachments.find(item=>item.key===data.attachmentKey) : attachments[0];
    if (!attachment) throw Error("请选择属于这篇文献的 PDF。");
    if (!(await attachment.getFilePathAsync())) throw Error("PDF 尚未下载到本机，请先在 Zotero 中打开一次。");
    const hash = await attachment.attachmentHash;
    if(data.verifyHash) {
      const markers = new Set(data.sentences.map(row=>"研迹句对:"+row.id));
      const annotationKeys = attachment.getAnnotations().filter(item=>!item.deleted&&item.getTags().some(tag=>markers.has(tag.tag))).map(item=>item.key);
      return {hashMatches:hash===data.verifyHash,annotationKeys};
    }
    let reader = await Zotero.Reader.open(attachment.id,null,{openInBackground:!data.preview});
    if (!reader) reader = Zotero.Reader._readers.find(reader=>reader.itemID===attachment.id&&!reader._isTabClosed);
    if (!reader) throw Error("请先在 Zotero 中打开这份 PDF，再重试定位。");
    await reader._initPromise;
    const view = reader._internalReader._primaryView;
    await view.initializedPromise;
    if(data.preview) { await reader.navigate({position:data.preview}); return {previewed:true}; }
    const document = view._iframeWindow.PDFViewerApplication.pdfDocument;
    if (!document?.getPageData) throw Error("当前 Zotero PDF 接口不兼容，请更新研迹配套插件。");
    const rows = await YanjiPDFCore.locate(data.sentences,document.numPages,pageIndex=>document.getPageData(Components.utils.cloneInto({pageIndex},view._iframeWindow)));
    for (const row of rows) for (const match of row.matches) match.pageLabel = view._getPageLabel(match.position.pageIndex,true);
    if (hash !== await attachment.attachmentHash) throw Error("PDF 在定位过程中发生变化，请重新定位。");
    return { attachmentKey:attachment.key,hash,choices,rows };
  }
  function Endpoint() {}
  Endpoint.prototype = {
    supportedMethods:["POST"],supportedDataTypes:["application/json"],
    async init({headers,data}) {
      if (!headers["zotero-allowed-request"] || headers.origin && !/^chrome-extension:\/\/[a-z]+$/.test(headers.origin)) return [403,"application/json",JSON.stringify({error:"仅接受本机研迹扩展请求。"})];
      if (busy) return [409,"application/json",JSON.stringify({error:"PDF 正在定位，请等待完成。"})];
      busy = true;
      try { return [200,"application/json",JSON.stringify(await locate(data))]; }
      catch (error) { Zotero.logError(error); return [400,"application/json",JSON.stringify({error:error.message})]; }
      finally { busy = false; }
    }
  };
  return { start(){Zotero.Server.Endpoints[path]=Endpoint;},stop(){delete Zotero.Server.Endpoints[path];} };
})();
