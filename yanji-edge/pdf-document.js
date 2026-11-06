(() => {
  const clean = text => String(text || "").replace(/\s+/g, " ").trim();
  function pdfURL(value) {
    const url=new URL(value);
    const doi=url.hostname==="journals.sagepub.com"&&/^\/doi\/(?:(?:abs|full|pdf|epdf|epub|reader)\/)?(10\.[^?#]+?)\/?$/.exec(url.pathname)?.[1];
    if(doi){url.pathname="/doi/pdf/"+doi;url.searchParams.delete("download")}
    return url;
  }
  function date(value) {
    const text = clean(value);
    const english = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(text);
    if (english) {
      const month = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(english[2].slice(0,3).toLowerCase()) + 1;
      return month ? english[3] + String(month).padStart(2,"0") + english[1].padStart(2,"0") : "";
    }
    if (/^\d{8}$/.test(text)) return text;
    const match = text.match(/^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?/);
    return match ? match[1] + (match[2] ? match[2].padStart(2, "0") : "") + (match[3] ? match[3].padStart(2, "0") : "") : "";
  }
  function filename({state = "T", important = false, date: day, dateType = "published", journal, keywords = "", title}) {
    if (!["T", "G", "L"].includes(state) || !["published", "accepted"].includes(dateType)) throw Error("文献状态或日期类型无效。");
    if (!/^\d{4}(?:\d{2}(?:\d{2})?)?$/.test(day)) throw Error("日期请填写年份或年月日，例如 2026 或 20261106。");
    if (day.length >= 6 && (+day.slice(4,6) < 1 || +day.slice(4,6) > 12) || day.length === 8 && (+day.slice(6) < 1 || +day.slice(6) > new Date(Date.UTC(+day.slice(0,4), +day.slice(4,6), 0)).getUTCDate())) throw Error("日期无效。");
    if (!clean(journal) || !clean(title)) throw Error("请填写期刊简称和标题。");
    const safe = value => clean(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
    return `${important ? "S" : ""}${state}_${day}${dateType === "accepted" ? "a" : ""}_${safe(journal)}_（${safe(keywords)}）${safe(title).replace(/[. ]+$/, "")}.pdf`;
  }
  function describe(root = document) {
    const meta = names => names.map(name => root.querySelector(`meta[name="${name}" i],meta[property="${name}" i]`)?.content).find(Boolean) || "";
    if (!meta(["citation_title","dc.title","og:title"]) && /Just a moment|Security verification|Access Denied|Verifying your browser|Verify you are human|请稍[候后]/i.test(root.title)) return {title:clean(root.title),journal:"",abbreviation:"",published:"",accepted:"",sources:[],blocked:true};
    const sources = new Map();
    const articleURL = new URL(root.URL || root.baseURI), sciencedirect = /(^|\.)sciencedirect\.com$/i.test(articleURL.hostname);
    const articlePII = sciencedirect && /\/science\/article\/pii\/([^/]+)/.exec(articleURL.pathname)?.[1];
    const ieee = articleURL.hostname === "ieeexplore.ieee.org";
    const ieeeID = ieee && (/\/document\/(\d+)/.exec(articleURL.pathname)?.[1] || articleURL.searchParams.get("arnumber"));
    const taylorDOI = /(^|\.)tandfonline\.com$/i.test(articleURL.hostname) && /^\/doi\/(?:full|abs|pdf|epdf)\/(10\.[^?#]+)/.exec(articleURL.pathname)?.[1];
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
        ieeeMetadata = Object.fromEntries(["pdfUrl","publicationTitle","displayPublicationDate","publicationYear","volume","issue","startPage","endPage"].filter(key => typeof parsed[key] === "string").map(key => [key,parsed[key]]));
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
    return {
      title:clean(meta(["citation_title", "dc.title", "og:title"]) || root.title),
      journal:clean(meta(["citation_journal_title", "citation_conference_title", "prism.publicationName", "dc.source"]) || ieeeMetadata.publicationTitle),
      abbreviation:clean(meta(["citation_journal_abbrev", "citation_journal_abbreviation", "prism.abbreviation"])),
      published:date(meta(["citation_publication_date", "citation_date", "dc.date", "prism.publicationDate"]) || ieeeMetadata.displayPublicationDate || ieeeMetadata.publicationYear),
      accepted:date(meta(["citation_acceptance_date", "citation_accepted_date", "dc.date.accepted", "dcterms.dateAccepted"])),
      canonical:root.querySelector('link[rel="canonical"]')?.href||articleURL.href,
      hasMetadata:!!(meta(["citation_title","dc.title"])||ieeeMetadata.publicationTitle),
      itemType:meta(["citation_conference_title"])&&!meta(["citation_journal_title"])||ieeeMetadata.isJournal===false?"conferencePaper":/(^|\.)arxiv\.org$/i.test(articleURL.hostname)?"preprint":"journalArticle",
      authors:authors.length?authors:ieeeMetadata.authors||[],
      volume:clean(meta(["citation_volume"])||ieeeMetadata.volume),issue:clean(meta(["citation_issue"])||ieeeMetadata.issue),
      pages:firstPage+(lastPage&&lastPage!==firstPage?"-"+lastPage:""),issn:clean(meta(["citation_issn"])),
      sources:[...sources.values()].slice(0, 12)
    };
  }
  async function articleTab(tab) {
    const url = new URL(tab.url);
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
  globalThis.YanjiPDFDocument = {describe, filename, date, readTab, articleTab, pdfURL};
})();
