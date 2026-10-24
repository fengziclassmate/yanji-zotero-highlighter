var YanjiPDFCore = (() => {
  const normalize = text => text.normalize("NFKC").toLowerCase().replace(/\u00ad/g, "").replace(/\s+/g," ").trim();
  function pageText(page, pageIndex) {
    let text = "", map = [];
    for (let index = 0; index < page.chars.length; index++) {
      const char = page.chars[index];
      const hyphen = char.lineBreakAfter && char.u === "-";
      const value = hyphen ? "" : char.u.normalize("NFKC").toLowerCase().replace(/\u00ad/g,"") + (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter ? " " : "");
      for (const unit of value) {
        const normalized = /\s/.test(unit) ? " " : unit;
        if (normalized === " " && text.endsWith(" ")) continue;
        text += normalized;
        for(let i=0;i<normalized.length;i++) map.push({ pageIndex, index, rect: char.rect, height:(page.viewBox?.[3]||1000)-(page.viewBox?.[1]||0) });
      }
    }
    return { text, map };
  }
  function positionOf(chars) {
    const pages = [...new Set(chars.map(char => char.pageIndex))];
    if (pages.length > 2 || pages.length === 2 && pages[1] !== pages[0] + 1) return null;
    const rectangles = pageIndex => {
      const result = [];
      for (const char of chars.filter(char => char.pageIndex === pageIndex)) {
        const [x1,y1,x2,y2] = char.rect;
        const rect = [Math.min(x1,x2),Math.min(y1,y2),Math.max(x1,x2),Math.max(y1,y2)];
        const last = result.at(-1);
        if (last && Math.abs(last[1]-rect[1]) < .5 && Math.abs(last[3]-rect[3]) < .5 && rect[0] >= last[0] && rect[0]-last[2] < 15) last[2] = Math.max(last[2],rect[2]);
        else if (!last || JSON.stringify(last) !== JSON.stringify(rect)) result.push(rect);
      }
      return result;
    };
    const position = { pageIndex: pages[0], rects: rectangles(pages[0]) };
    if (pages.length === 2) position.nextPageRects = rectangles(pages[1]);
    return position;
  }
  async function locate(requests, count, getPage) {
    const rows = requests.map(row => ({ id: row.id, needle: normalize(row.text), matches: [] }));
    const tailSize = Math.max(...rows.map(row => row.needle.length));
    let tail = { text: "", map: [] };
    for (let pageIndex = 0; pageIndex < count; pageIndex++) {
      const page = await getPage(pageIndex), current = pageText(page,pageIndex);
      const text = tail.text + current.text, map = tail.map.concat(current.map);
      for (const row of rows) {
        for (let start = text.indexOf(row.needle); start !== -1 && row.matches.length < 6; start = text.indexOf(row.needle,start+1)) {
          const end = start + row.needle.length;
          if (end <= tail.text.length) continue;
          if (/^[\p{L}\p{N}]/u.test(row.needle) && /[\p{L}\p{N}]/u.test(text[start-1]||"") || /[\p{L}\p{N}]$/u.test(row.needle) && /[\p{L}\p{N}]/u.test(text[end]||"")) continue;
          const chars = map.slice(start,end), position = positionOf(chars);
          if (!position) continue;
          const first = chars[0];
          const top = Math.max(0,first.height-first.rect[3]);
          row.matches.push({ position, pageLabel:String(first.pageIndex+1), sortIndex:[String(first.pageIndex).padStart(5,"0"),String(first.index).padStart(6,"0"),String(Math.floor(top)).padStart(5,"0")].join("|") });
        }
      }
      tail = { text: text.slice(-tailSize), map: map.slice(-tailSize) };
    }
    return rows.map(({id,matches})=>({id,matches}));
  }
  return { normalize, locate };
})();
