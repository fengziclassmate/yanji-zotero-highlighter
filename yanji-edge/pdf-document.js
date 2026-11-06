(() => {
  const clean = text => String(text || "").replace(/\s+/g, " ").trim();
  function date(value) {
    const match = clean(value).match(/^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?/);
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
    const sources = new Map();
    function add(value, label) {
      if (!value || !URL.canParse(value, root.baseURI)) return;
      const url = new URL(value, root.baseURI);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return;
      url.hash = "";
      if (!sources.has(url.href)) sources.set(url.href, {url:url.href, label:clean(label) || "PDF"});
    }
    add(meta(["citation_pdf_url", "wkhealth_pdf_url"]), "文章 PDF");
    for (const link of root.querySelectorAll('a[href]')) {
      if (link.closest('#yanji-root, .bibliography, .references, .ref-list, #references, #bibliography, #recommended-articles, #cited-by, #citing-articles')) continue;
      const href = link.getAttribute("href");
      if (href.startsWith("#")) continue;
      if (/(?:supplement|supporting|附件|补充材料)/i.test(link.textContent + " " + href)) continue;
      if (link.type === "application/pdf" || /\.pdf(?:[?#]|$)|\/pdfft(?:[?#]|$)/i.test(href)) add(href, link.textContent);
    }
    return {
      title:clean(meta(["citation_title", "dc.title", "og:title"]) || root.title),
      journal:clean(meta(["citation_journal_title", "prism.publicationName", "dc.source"])),
      abbreviation:clean(meta(["citation_journal_abbrev", "citation_journal_abbreviation", "prism.abbreviation"])),
      published:date(meta(["citation_publication_date", "citation_date", "dc.date", "prism.publicationDate"])),
      accepted:date(meta(["citation_acceptance_date", "citation_accepted_date", "dc.date.accepted", "dcterms.dateAccepted"])),
      sources:[...sources.values()].slice(0, 12)
    };
  }
  globalThis.YanjiPDFDocument = {describe, filename, date};
})();
