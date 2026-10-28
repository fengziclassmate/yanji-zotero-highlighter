(() => {
  if (globalThis.YanjiReading) return;
  const Y = Yanji, A = YanjiAnchor, instance = crypto.randomUUID(), buttons = new Map();
  let meta, info, contextPromise, scanTimer, pointTimer, lastSavedY = -1, interacted = false;
  const send = async message => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result.ok) throw Error(result.error);
    return result.data;
  };
  const report = error => { console.error("研迹阅读", error); YanjiPage.notice(error.message); };
  const sheet = document.createElement("style"); sheet.id = "yanji-reading-style";
  sheet.textContent = `[data-yanji-save]{float:right;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;min-width:24px;margin:0 0 0 6px;padding:4px;border:.5px solid transparent;border-radius:3px;background:${Y.uiColors["--bg"]};color:${Y.uiColors["--muted"]};cursor:pointer;opacity:0;vertical-align:middle}.yanji-reading-title:hover>[data-yanji-save],.yanji-reading-title:focus-within>[data-yanji-save],[data-yanji-save][aria-pressed=true]{opacity:1}[data-yanji-save]:hover{background:${Y.uiColors["--element"]};color:${Y.uiColors["--text"]}}[data-yanji-save]:focus-visible{outline:.5px solid ${Y.uiColors["--text"]};outline-offset:2px}[data-yanji-save][aria-pressed=true] svg{fill:currentColor}[data-yanji-save] svg{width:16px;height:16px;pointer-events:none}`;
  document.documentElement.append(sheet);
  function setSaved(record, saved) {
    record.saved = saved; record.button.setAttribute("aria-pressed", String(saved));
    record.button.title = saved ? "移出稍后读" : "加入稍后读";
    record.button.setAttribute("aria-label", record.button.title);
  }
  function snapshot() {
    const root = document.querySelector("article, main, [role=main]") || document.body;
    const rect = root.getBoundingClientRect();
    let source;
    for (const y of [Math.min(180, innerHeight/3), Math.min(300, innerHeight/2)]) {
      const element = document.elementFromPoint(Math.max(24,Math.min(innerWidth-24,rect.left+rect.width*.4)),y);
      if (!element || element.closest("#yanji-root")) continue;
      const block = A.paragraph(element);
      if (block && root.contains(block)) { source = A.originalBlock(block,element.closest(A.translated)); break; }
    }
    return { ratio: Math.max(0,Math.min(1,scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight))), elementId: source?.id || "", prefix: source ? A.text(source,true).slice(0,200) : "" };
  }
  function restore(point) {
    if (!point) throw Error("没有上次阅读位置。");
    let block = point.elementId && document.getElementById(point.elementId);
    if (block && point.prefix && !A.text(block,true).startsWith(point.prefix)) block = null;
    if (!block && point.prefix) {
      const matches = [...document.querySelectorAll(A.blocks)].filter(element => !element.closest(A.translated) && !element.closest("#yanji-root") && A.text(element,true).startsWith(point.prefix));
      if (matches.length === 1) block = matches[0];
    }
    if (block && !block.getClientRects().length) {
      const next = block.nextElementSibling;
      const translated = block.querySelector(A.translated) || (next?.matches(A.translated) ? next : next?.querySelector(A.translated));
      block = translated?.getClientRects().length ? translated : null;
    }
    if (block) block.scrollIntoView({block:"start",behavior:"auto"});
    else scrollTo({top:point.ratio*Math.max(0,document.documentElement.scrollHeight-innerHeight),behavior:"auto"});
    YanjiPage.notice(block ? "已返回阅读段落" : "已返回接近上次的位置");
    return { paragraph: !!block };
  }
  const isArticle = () => (YanjiPage.hasAnnotations() || !!document.querySelector('meta[name="citation_title" i],meta[name="citation_doi" i],meta[name="dc.identifier.doi" i]')) && !((location.hostname === "scopus.com" || location.hostname.endsWith(".scopus.com")) && /^\/(?:results|pages\/results)(?:\/|$)/.test(location.pathname));
  async function savePosition() {
    if (!interacted || !isArticle() || !meta || Math.abs(scrollY-lastSavedY)<80 || scrollY<100 || Y.pageID(YanjiPage.metadata()) !== Y.pageID(meta)) return;
    const point = snapshot();
    await send({type:"READ_POINT",meta,point}); lastSavedY = scrollY;
  }
  async function refreshContext() {
    meta = YanjiPage.metadata();
    const current = meta;
    const result = await send({type:"READ_CONTEXT",meta:current,instance});
    if (meta !== current) return;
    info = result;
    await send({type:"READING_CHANGED"});
    if (result.restore) requestAnimationFrame(()=>{try{restore(result.restore);}catch(error){report(error);}});
  }
  async function scan() {
    if (document.hidden) return;
    const nextMeta = YanjiPage.metadata();
    if (!meta || Y.pageID(nextMeta) !== Y.pageID(meta)) { interacted=false;lastSavedY=-1;contextPromise=refreshContext(); }
    const targets = YanjiReferences.collectBookmarkTitles(), added = [];
    for (const [entry, record] of buttons) if (!entry.isConnected || !record.button.isConnected || targets.get(entry)?.title !== record.title) { record.button.remove(); buttons.delete(entry); }
    for (const [entry, target] of targets) {
      if (buttons.has(entry) || (!target.url && !entry.matches("a[href]"))) continue;
      const url = Y.readingURL(target.url || entry.href), mount = target.mount || entry.parentElement;
      const button = document.createElement("button");button.type="button";button.dataset.yanjiSave="";button.innerHTML=Y.icon("bookmark");button.disabled=true;
      button.addEventListener("pointerup",event=>event.stopPropagation());
      const record={button,url,title:target.title,saved:false};setSaved(record,false);
      button.onclick=async event=>{
        event.preventDefault();event.stopPropagation();button.disabled=true;
        try{const result=await send({type:"READ_TOGGLE",url,title:record.title,saved:!record.saved});setSaved(record,result.saved);}
        catch(error){report(error);}finally{button.disabled=false;}
      };
      mount.classList.add("yanji-reading-title");mount.prepend(button);buttons.set(entry,record);added.push(record);
    }
    if (added.length) {
      const saved = new Set(await send({type:"READ_STATUS",urls:[...new Set(added.map(row=>row.url))]}));
      for (const record of added) {setSaved(record,saved.has(record.url));record.button.disabled=false;}
    }
  }
  const own = '[data-yanji-save],[data-yanji-ref-translation],#yanji-root,#yanji-reading-style';
  const observer = new MutationObserver(mutations=>{
    if (!mutations.some(mutation=>!(mutation.target.nodeType===Node.ELEMENT_NODE?mutation.target:mutation.target.parentElement)?.closest(own) && (mutation.type==="characterData" || mutation.removedNodes.length || [...mutation.addedNodes].some(node=>node.nodeType!==Node.ELEMENT_NODE||!node.matches(own)))))return;
    clearTimeout(scanTimer);scanTimer=setTimeout(()=>scan().catch(report),400);
  });
  for (const type of ["wheel","touchstart","pointerdown","keydown"]) addEventListener(type,event=>{
    if(event.isTrusted&&!event.composedPath().some(node=>node.id==="yanji-root")&&!event.target.closest?.('input,textarea,[contenteditable="true"]'))interacted=true;
  },{passive:true});
  addEventListener("scroll",()=>{clearTimeout(pointTimer);pointTimer=setTimeout(()=>savePosition().catch(report),1200);},{passive:true});
  addEventListener("pagehide",()=>{savePosition().catch(error=>console.error("研迹阅读位置",error));});
  addEventListener("visibilitychange",()=>{if(document.hidden)savePosition().catch(report);else scan().catch(report);});
  document.addEventListener("click",event=>{
    if(event.defaultPrevented||!(location.hostname === "sciencedirect.com" || location.hostname.endsWith(".sciencedirect.com")))return;
    const link=event.target.closest?.("a[href]");
    if(!link)return;
    const destination=new URL(link.href);if(destination.hostname!=="scopus.com"&&!destination.hostname.endsWith(".scopus.com"))return;
    send({type:"READ_TRAIL",meta:YanjiPage.metadata(),href:link.href,point:snapshot()}).catch(error=>console.error("研迹来源",error));
  },true);
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(!["READ_RESUME","READ_RESTORE"].includes(message.type))return;
    (contextPromise||Promise.resolve()).then(()=>restore(message.type==="READ_RESTORE"?message.point:info?.resume)).then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));return true;
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local")return;
    for(const [key,change] of Object.entries(changes))if(key.startsWith("later:")){const url=(change.newValue||change.oldValue).url;for(const record of buttons.values())if(record.url===url)setSaved(record,!!change.newValue);}
  });
  globalThis.YanjiReading={snapshot,restore};
  contextPromise=YanjiPage.ready.then(async()=>{await refreshContext();observer.observe(document.body,{childList:true,characterData:true,subtree:true});await scan();});
  contextPromise.catch(report);
})();
