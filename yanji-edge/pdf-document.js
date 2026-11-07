(() => {
  const clean = text => String(text || "").replace(/\s+/g, " ").trim();
  function pdfURL(value) {
    const url=new URL(value);
    const doi=url.hostname==="journals.sagepub.com"&&/^\/doi\/(?:(?:abs|full|pdf|epdf|epub|reader)\/)?(10\.[^?#]+?)\/?$/.exec(url.pathname)?.[1];
    if(doi){url.pathname="/doi/pdf/"+doi;url.searchParams.delete("download")}
    const wiley=url.hostname==="onlinelibrary.wiley.com"&&/^\/doi\/(?:(?:abs|full|pdf|epdf|pdfdirect)\/)?(10\.[^?#]+?)\/?$/.exec(url.pathname)?.[1];
    if(wiley){url.pathname="/doi/pdf/"+wiley;url.searchParams.delete("download")}
    return url;
  }
  function date(value) {
    const text = clean(value);
    const monthYear=/^([A-Za-z]+)\s+(\d{4})$/.exec(text);
    if(monthYear){const month=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(monthYear[1].slice(0,3).toLowerCase())+1;return month?monthYear[2]+String(month).padStart(2,"0"):"";}
    const monthFirst=/^([A-Za-z]+)\s*(\d{1,2}),?\s*(\d{4})$/.exec(text);
    if(monthFirst)return date(monthFirst[2]+" "+monthFirst[1]+" "+monthFirst[3]);
    const english = /^(\d{1,2})\s*([A-Za-z]+)\s*(\d{4})$/.exec(text);
    if (english) {
      const month = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(english[2].slice(0,3).toLowerCase()) + 1;
      return month ? english[3] + String(month).padStart(2,"0") + english[1].padStart(2,"0") : "";
    }
    if (/^\d{8}$/.test(text)) return text;
    const match = text.match(/^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?/);
    return match ? match[1] + (match[2] ? match[2].padStart(2, "0") : "") + (match[3] ? match[3].padStart(2, "0") : "") : "";
  }
  function history(root,host=new URL(root.URL||root.baseURI).hostname) {
    const copernicus=/(^|\.)copernicus\.org$/i.test(host);
    const mdpi=/(^|\.)mdpi\.com$/i.test(host),wiley=host==='onlinelibrary.wiley.com';
    const selector=mdpi?'.pubhistory,.article-history,.m-accordion__body':wiley?'.publication-history,.epub-sections':copernicus?'#article-dates,.article-dates':/(^|\.)sciencedirect\.com$/i.test(host)?'.author-group,#author-group,.article-history,.publication-history,#publication-history,.dates':/(^|\.)tandfonline\.com$/i.test(host)?'.itemPageRangeHistory,.articleHistory,.article-history':'.article-history,[data-testid="article-history"]';
    const excluded='#yanji-root,.references,.bibliography,.ref-list,#recommended-articles,#cited-by,script,style';
    const fields=[...root.querySelectorAll(selector)].filter(n=>!n.closest(excluded)).map(n=>n.textContent);
    if(/(^|\.)(sciencedirect|tandfonline)\.com$/i.test(host))for(const node of root.querySelectorAll('p,span,li,div')){
      const text=clean(node.textContent);
      if(node.children.length<=10&&text.length<500&&!node.closest(excluded)&&/^(?:Received|Accepted|Available\s+online|Published\s+online|First\s+published)\b/i.test(text))fields.push(text);
    }
    const text=fields.join('\n');
    const value=label=>{const match=new RegExp('(?:'+label+')\\s*[:：]?\\s*(\\d{1,2}\\s*[A-Za-z]+\\s*\\d{4}|[A-Za-z]+\\s+\\d{1,2},?\\s*\\d{4}|\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2})','i').exec(text);return match?date(match[1]):''};
    return {accepted:value('Accepted(?:\\s+on)?|接收日期|接受日期|录用日期'),published:value('Available\\s+online|Published\\s+online|First\\s+published(?:\\s+online)?|Version\\s+of\\s+Record\\s+online|在线发表|公开日期'+(copernicus||mdpi?'|Published':''))};
  }
  function filename({prefix, state = "T", important = false, date: day, dateType = "published", journal, keywords = "", title}) {
    if (prefix===undefined?!["T", "G", "L"].includes(state):typeof prefix!=="string"||!prefix||prefix.length>40||!/^[\p{L}\p{N}★↑!+]+(?:-[\p{L}\p{N}★↑!+]+)*$/u.test(prefix))throw Error("文献状态标识无效。");
    if (!["published", "accepted"].includes(dateType)) throw Error("日期类型无效。");
    if (!/^\d{4}(?:\d{2}(?:\d{2})?)?$/.test(day)) throw Error("日期请填写年份或年月日，例如 2026 或 20261106。");
    if (day.length >= 6 && (+day.slice(4,6) < 1 || +day.slice(4,6) > 12) || day.length === 8 && (+day.slice(6) < 1 || +day.slice(6) > new Date(Date.UTC(+day.slice(0,4), +day.slice(4,6), 0)).getUTCDate())) throw Error("日期无效。");
    if (!clean(journal) || !clean(title)) throw Error("请填写期刊简称和标题。");
    const safe = value => clean(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
    return `${prefix??((important?"S":"")+state)}_${day}${dateType === "accepted" ? "a" : ""}_${safe(journal)}_（${safe(keywords)}）${safe(title).replace(/[. ]+$/, "")}.pdf`;
  }
  function describe(root = document) {
    const meta = names => names.map(name => root.querySelector(`meta[name="${name}" i],meta[property="${name}" i]`)?.content).find(Boolean) || "";
    if (!meta(["citation_title","dc.title","og:title"]) && /Just a moment|Security verification|Access Denied|Problem processing your request|Verifying your browser|Verify you are human|请稍[候后]/i.test(root.title)) return {title:clean(root.title),journal:"",abbreviation:"",published:"",accepted:"",sources:[],blocked:true};
    const sources = new Map();
    const articleURL = new URL(root.URL || root.baseURI), sciencedirect = /(^|\.)sciencedirect\.com$/i.test(articleURL.hostname);
    const articlePII = sciencedirect && /\/science\/article\/pii\/([^/]+)/.exec(articleURL.pathname)?.[1];
    const ieee = articleURL.hostname === "ieeexplore.ieee.org";
    const ieeeID = ieee && (/\/document\/(\d+)/.exec(articleURL.pathname)?.[1] || articleURL.searchParams.get("arnumber"));
    const taylorDOI = /(^|\.)tandfonline\.com$/i.test(articleURL.hostname) && /^\/doi\/(?:full|abs|pdf|epdf)\/(10\.[^?#]+)/.exec(articleURL.pathname)?.[1];
    const wileyDOI=articleURL.hostname==='onlinelibrary.wiley.com'&&/^\/doi\/(?:(?:abs|full|pdf|epdf|pdfdirect)\/)?(10\.[^?#]+?)\/?$/.exec(articleURL.pathname)?.[1];
    const mdpi = /(^|\.)mdpi\.com$/i.test(articleURL.hostname) && /^(\/\d{4}-\d{4}\/(\d+)\/\d+\/(\d+))(?:\/|$)/.exec(articleURL.pathname);
    const natureID = /(^|\.)nature\.com$/i.test(articleURL.hostname) && /^\/articles\/([^/.]+)/.exec(articleURL.pathname)?.[1];
    const copernicus = /(^|\.)copernicus\.org$/i.test(articleURL.hostname) && /^\/articles\/(\d+)\/(\d+)\/(\d{4})\//.exec(articleURL.pathname);
    const reviewID = /(^|\.)openreview\.net$/i.test(articleURL.hostname) && articleURL.searchParams.get("id");
    const sagePDF=pdfURL(articleURL),sageDOI=articleURL.hostname==="journals.sagepub.com"&&/^\/doi\/pdf\/(10\..+)/.exec(sagePDF.pathname)?.[1];
    const natureButtons = natureID ? [...root.querySelectorAll('a[data-track-action="download pdf" i][href]')].map(link => new URL(link.href,root.baseURI)).filter(url => url.hostname === articleURL.hostname && [natureID + ".pdf",natureID + "_reference.pdf"].includes(url.pathname.split("/").at(-1))) : [];
    let ieeeMetadata = {};
    if (ieeeID) for (const script of root.querySelectorAll("script")) {
      const match = script.textContent.match(/(?:xplGlobal|global)\.document\.metadata\s*=\s*(\{[\s\S]*?\})\s*;/);
      if (!match) continue;
      try {
        const parsed = JSON.parse(match[1]);
        ieeeMetadata = Object.fromEntries(["pdfUrl","publicationTitle","displayPublicationDate","publicationDate","publicationYear","volume","issue","startPage","endPage"].filter(key => typeof parsed[key] === "string").map(key => [key,parsed[key]]));
        if(typeof parsed.isJournal==="boolean")ieeeMetadata.isJournal=parsed.isJournal;
        if(Array.isArray(parsed.authors))ieeeMetadata.authors=parsed.authors.slice(0,100).filter(author=>author&&typeof author==="object"||typeof author==="string").map(author=>typeof author==="string"?author:typeof author.name==="string"?author.name:[author.firstName,author.lastName].filter(value=>typeof value==="string").join(" ")).filter(Boolean);
      }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; console.warn("IEEE 页面元数据格式无效", error.message); }
      break;
    }
    function add(value, label, metadata = false) {
      if (!value || !URL.canParse(value, root.baseURI)) return;
      const url = pdfURL(new URL(value, root.baseURI));
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return;
      if(sageDOI&&(url.hostname!==articleURL.hostname||url.pathname!=="/doi/pdf/"+sageDOI))return;
      if (ieeeID) {
        if (url.hostname !== articleURL.hostname) return;
        const id = url.searchParams.get("arnumber");
        if (id && id !== ieeeID) return;
        if (url.pathname === "/stamp/stamp.jsp") {
          url.pathname = "/stampPDF/getPDF.jsp";
          url.searchParams.set("ref", "");
        }
        if (!id && !url.pathname.endsWith("/" + ieeeID + ".pdf")) return;
      }
      if (taylorDOI) {
        if (url.hostname !== articleURL.hostname || !["/doi/pdf/" + taylorDOI,"/doi/epdf/" + taylorDOI].includes(url.pathname)) return;
        url.pathname = "/doi/pdf/" + taylorDOI;
      }
      if(wileyDOI&&(url.hostname!==articleURL.hostname||url.pathname!=="/doi/pdf/"+wileyDOI))return;
      if (mdpi) {
        const gateway = url.hostname === articleURL.hostname && url.pathname === mdpi[1] + "/pdf";
        const deployed = /(^|\.)mdpi-res\.com$/i.test(url.hostname) && url.pathname.includes("/article_deploy/") && url.pathname.endsWith("-" + mdpi[2] + "-" + mdpi[3].padStart(5,"0") + ".pdf");
        if (!gateway && !deployed) return;
      }
      if (natureID) {
        const allowed = natureButtons.length ? natureButtons.some(button => url.hostname === button.hostname && url.pathname === button.pathname) : url.hostname === articleURL.hostname && url.pathname === "/articles/" + natureID + ".pdf";
        if (!allowed) return;
      }
      if (copernicus) {
        const filename = articleURL.hostname.split(".")[0] + "-" + copernicus.slice(1).join("-") + ".pdf";
        if (url.hostname !== articleURL.hostname || url.pathname !== "/articles/" + copernicus.slice(1).join("/") + "/" + filename) return;
      }
      if (reviewID) {
        if (url.hostname !== articleURL.hostname || !["/pdf","/attachment"].includes(url.pathname) || (!metadata && url.searchParams.get("id") !== reviewID)) return;
        if (url.pathname === "/attachment" && url.searchParams.get("name") !== "pdf") return;
      }
      if (articlePII && /(^|\.)sciencedirect\.com$/i.test(url.hostname)) {
        const pii = /\/science\/article\/pii\/([^/]+)/.exec(url.pathname)?.[1];
        if (pii && pii !== articlePII) return;
      }
      url.hash = "";
      if (!sources.has(url.href)) sources.set(url.href, {url:url.href, label:clean(label) || "PDF"});
    }
    for (const url of natureButtons) add(url.href, "文章 PDF");
    add(meta(["citation_pdf_url", "wkhealth_pdf_url"]), "文章 PDF", true);
    if (ieeeID) {
      for (const frame of root.querySelectorAll('iframe[src],frame[src],embed[src],object[data]')) add(frame.src || frame.data, "文章 PDF");
      add(ieeeMetadata.pdfUrl, "文章 PDF");
    }
    for (const link of root.querySelectorAll('a[href]')) {
      if (link.closest('#yanji-root, .bibliography, .references, .ref-list, #references, #bibliography, #recommended-articles, #cited-by, #citing-articles')) continue;
      const href = link.getAttribute("href");
      if (href.startsWith("#")) continue;
      if (/(?:supplement|supporting|附件|补充材料)/i.test(link.textContent + " " + href)) continue;
      if (link.type === "application/pdf" || /\.pdf(?:[?#]|$)|\/pdfft(?:[?#]|$)|\/doi\/(?:e?pdf)\/|\/pdf(?:[?#]|$)|\/stamp(?:PDF)?\/(?:stamp|getPDF)\.jsp(?:[?#]|$)/i.test(href)) add(href, link.textContent);
    }
    if (!sources.size) {
      if (ieeeID) add("/stampPDF/getPDF.jsp?tp=&arnumber=" + ieeeID + "&ref=", "文章 PDF");
      else if (taylorDOI) add("/doi/pdf/" + taylorDOI, "文章 PDF");
      else if (wileyDOI) add("/doi/pdf/" + wileyDOI, "文章 PDF");
      else if (mdpi) add(mdpi[1] + "/pdf", "文章 PDF");
      else if (reviewID && articleURL.pathname === "/forum") add("/pdf?id=" + encodeURIComponent(reviewID), "文章 PDF");
      else if(sageDOI)add("/doi/pdf/"+sageDOI,"文章 PDF");
    }
    const authors=[...root.querySelectorAll('meta[name="citation_author" i]')].map(node=>clean(node.content)).filter(Boolean).slice(0,100);
    if(!authors.length&&sciencedirect)for(const node of root.querySelectorAll('.author-group .author')){
      const name=[node.querySelector('.given-name'),node.querySelector('.surname')].filter(Boolean).map(part=>clean(part.textContent)).filter(Boolean).join(" ");
      if(name&&authors.length<100)authors.push(name);
    }
    if(!authors.length)authors.push(...meta(["citation_authors"]).split(";").map(clean).filter(Boolean).slice(0,100));
    const firstPage=meta(["citation_firstpage"])||ieeeMetadata.startPage||"",lastPage=meta(["citation_lastpage"])||ieeeMetadata.endPage||"";
    const dates=history(root),accepted=date(meta(["citation_acceptance_date","citation_accepted_date","dc.date.accepted","dcterms.dateAccepted"]));
    const published=date(meta(["citation_publication_date","citation_date","dc.date","prism.publicationDate"])||ieeeMetadata.displayPublicationDate||ieeeMetadata.publicationDate||ieeeMetadata.publicationYear);
    const online=date(meta(["citation_online_date","citation_first_online_date","prism.onlineDate","dc.date.available"]));
    const types=[meta(["citation_article_type","citation_type","dc.type","prism.genre"]),...[...root.querySelectorAll('.publication-type,.publicationType,.article-type,[data-testid="article-type"]')].filter(n=>!n.closest('#yanji-root,.references,.bibliography,.ref-list,#recommended-articles,#cited-by')).map(n=>clean(n.textContent))];
    const articleKind=types.some(t=>/^(?:review(?: article)?|literature review|systematic review|综述)$/i.test(t))?'review':types.some(t=>/^(?:data(?: article| paper| descriptor)|dataset|数据集|数据论文)$/i.test(t))?'dataset':'research';
    return {
      title:clean(meta(["citation_title", "dc.title", "og:title"]) || root.title),
      journal:clean(meta(["citation_journal_title", "citation_conference_title", "prism.publicationName", "dc.source"]) || ieeeMetadata.publicationTitle),
      abbreviation:clean(meta(["citation_journal_abbrev", "citation_journal_abbreviation", "prism.abbreviation"])),
      published:dates.published||online||published,
      accepted:dates.accepted||accepted,
      articleKind,
      sourceHost:articleURL.hostname,
      preferBrowserDownload:!!mdpi,
      canonical:root.querySelector('link[rel="canonical"]')?.href||articleURL.href,
      hasMetadata:!!(meta(["citation_title","dc.title"])||ieeeMetadata.publicationTitle),
      itemType:meta(["citation_conference_title"])&&!meta(["citation_journal_title"])||ieeeMetadata.isJournal===false?"conferencePaper":/(^|\.)arxiv\.org$/i.test(articleURL.hostname)?"preprint":"journalArticle",
      authors:authors.length?authors:ieeeMetadata.authors||[],
      volume:clean(meta(["citation_volume"])||ieeeMetadata.volume),issue:clean(meta(["citation_issue"])||ieeeMetadata.issue),
      pages:firstPage+(lastPage&&lastPage!==firstPage?"-"+lastPage:""),issn:clean(meta(["citation_issn"])),
      sources:[...sources.values()].slice(0, 12)
    };
  }
  async function prepare(root=document) {
    let info=describe(root);
    if(!info.accepted&&new URL(root.URL||root.baseURI).hostname==='onlinelibrary.wiley.com'){
      const details=root.querySelector('article[data-details]')?.getAttribute('data-details');
      if(!details)return info;
      const article=new URL(root.URL||root.baseURI),url=new URL(details,article),doi=/^\/doi\/(?:(?:abs|full)\/)?(10\..+?)\/?$/.exec(article.pathname)?.[1];
      if(url.origin!==article.origin||url.pathname!=='/action/ajaxShowPubInfo'||url.searchParams.get('doi')?.toLowerCase()!==doi?.toLowerCase())throw Error('期刊文章信息地址不匹配。');
      const response=await fetch(url.href,{credentials:'same-origin',signal:AbortSignal.timeout(6000)});
      if(!response.ok)throw Error('期刊文章信息读取失败（'+response.status+'）。');
      const parsed=new DOMParser().parseFromString(await response.text(),'text/html'),dates=history(parsed,article.hostname);
      return {...info,accepted:dates.accepted||info.accepted,published:dates.published||info.published};
    }
    if(info.accepted||!/(^|\.)sciencedirect\.com$/i.test(new URL(root.URL||root.baseURI).hostname))return info;
    const visible=n=>n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden';
    const candidates=[...root.querySelectorAll('.author-group button,#author-group button,button[data-aa-name="show-more"],button#show-more-btn')].filter(n=>visible(n)&&/^(?:show more|显示更多|展开更多)$/i.test(clean(n.textContent)));
    const buttons=candidates.length?candidates:[...root.querySelectorAll('button,[role="button"]')].filter(n=>visible(n)&&/^(?:show more|显示更多|展开更多)$/i.test(clean(n.textContent))&&!n.closest('#yanji-root,.references,.bibliography,.ref-list'));
    if(buttons.length!==1)return info;
    const button=buttons[0],expanded=button.getAttribute('aria-expanded');
    if(expanded==='true')return info;
    let observer,timer;
    try{
      await new Promise(resolve=>{
        const done=()=>{clearTimeout(timer);observer.disconnect();resolve()};
        observer=new MutationObserver(()=>{if(history(root).accepted)done()});
        observer.observe(root.body,{subtree:true,childList:true,characterData:true});
        timer=setTimeout(done,1800);button.click();if(history(root).accepted)done();
      });
      info=describe(root);
    }finally{
      clearTimeout(timer);observer?.disconnect();
      if(button.isConnected&&(button.getAttribute('aria-expanded')==='true'||/^(?:show less|收起)$/i.test(clean(button.textContent))))button.click();
    }
    return info;
  }
  async function articleTab(tab) {
    const url = new URL(tab.url);
    if(url.hostname==='onlinelibrary.wiley.com'&&/^\/doi\/(?:pdf|epdf|pdfdirect)\/10\./.test(url.pathname)){
      const article=(await chrome.tabs.query({windowId:tab.windowId})).find(row=>{
        if(!row.url||!URL.canParse(row.url))return false;
        const other=new URL(row.url);
        return other.hostname===url.hostname&&!/^\/doi\/(?:pdf|epdf|pdfdirect)\//.test(other.pathname)&&pdfURL(other).pathname===pdfURL(url).pathname;
      });
      if(!article)throw Error("请先打开这份 PDF 对应的文章正文页。");
      return article;
    }
    if(url.hostname==="journals.sagepub.com"&&/^\/doi\/pdf\/10\./.test(url.pathname)){
      const article=(await chrome.tabs.query({windowId:tab.windowId})).find(row=>{
        if(!row.url||!URL.canParse(row.url))return false;
        const other=new URL(row.url);
        return other.hostname===url.hostname&&other.pathname!==url.pathname&&pdfURL(other).pathname===url.pathname;
      });
      if(!article)throw Error("请先打开这份 PDF 对应的文章正文页。");
      return article;
    }
    const pii = /(^|\.)sciencedirectassets\.com$/i.test(url.hostname) && /\/1-s2\.0-([^/]+)\/main\.pdf$/i.exec(url.pathname)?.[1];
    if(!pii)return tab;
    const article=(await chrome.tabs.query({windowId:tab.windowId})).find(row=>{
      if(!row.url||!URL.canParse(row.url))return false;
      const u=new URL(row.url);
      return /(^|\.)sciencedirect\.com$/i.test(u.hostname)&&u.pathname.replace(/\/$/,"")==="/science/article/pii/"+pii;
    });
    if(!article)throw Error("请先打开这份 PDF 对应的文章正文页。");
    return article;
  }
  async function readTab(tabId, type = "PDF_DOCUMENT") {
    const tab = await chrome.tabs.get(tabId);
    if (tab.frozen || tab.discarded) await chrome.tabs.update(tabId, {active:true});
    let timer;
    try {
      return await Promise.race([
        chrome.tabs.sendMessage(tabId, {type}),
        new Promise((resolve,reject) => { timer = setTimeout(() => reject(Error("文章页未响应，请切回文章页并刷新后重试。")), 10000); })
      ]);
    } finally { clearTimeout(timer); }
  }
  globalThis.YanjiPDFDocument = {describe, prepare, filename, date, readTab, articleTab, pdfURL};
})();
