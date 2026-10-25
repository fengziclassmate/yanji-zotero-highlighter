(() => {
  const Y = Yanji;
  const spans = (text,locale) => [...new Intl.Segmenter(locale,{granularity:"sentence"}).segment(text)].map(row=>({text:row.segment.trim(),start:row.index+row.segment.length-row.segment.trimStart().length,end:row.index+row.segment.trimEnd().length})).filter(row=>row.text);
  const features = text => {
    const value=text.normalize("NFKC");
    return {numbers:new Set((value.match(/\d+(?:[.,]\d+)*(?:%)?/g)||[]).map(n=>n.replace(/,(?=\d{3}(?:\D|$))/g,""))),terms:new Set((value.match(/\b[A-Z][A-Z0-9-]+\b/g)||[]).map(term=>term.toLowerCase())),length:value.replace(/\s/g,"").length};
  };
  function suggest(segment) {
    const english=Y.sentences(segment.original), quote=Y.normalize(segment.quote);
    let paragraph=Y.normalize(segment.paragraphText);
    if(Number.isInteger(segment.translationStart)) paragraph=paragraph.slice(segment.translationStart,segment.translationEnd);
    else if(paragraph.startsWith(Y.normalize(segment.original))) paragraph=paragraph.slice(Y.normalize(segment.original).length).trim();
    const full=spans(paragraph,"zh").map((row,index)=>({...row,index})), quoted=spans(quote,"zh"), offset=paragraph.indexOf(quote);
    const sample=segment.original.slice(0,1000),latin=(sample.match(/[A-Za-z]/g)||[]).length,han=(sample.match(/\p{Script=Han}/gu)||[]).length;
    if(!latin||han>latin) return quoted.map(()=>({english:[],reason:""}));
    const located=offset>=0&&offset===paragraph.lastIndexOf(quote);
    const sourceFeatures=english.map(features);
    const ratio=paragraph.length ? segment.original.replace(/\s/g,"").length/paragraph.replace(/\s/g,"").length : 0;
    return quoted.map(sentence=>{
      const context=located?full.filter(row=>row.end>offset+sentence.start&&row.start<offset+sentence.end):[];
      const signal=features(context.length?context.map(row=>row.text).join(" "):sentence.text);
      const estimated=context.length?((context[0].index+context.at(-1).index+1)/2)*english.length/full.length-.5:null;
      const expected=context.length?signal.length*ratio:0;
      const ranked=[];
      for(let start=0;start<english.length;start++) {
        const anchor=sourceFeatures[start];
        const anchorHit=[...signal.numbers].some(n=>anchor.numbers.has(n))||[...signal.terms].some(term=>anchor.terms.has(term));
        if(estimated!==null&&Math.abs(start-estimated)>4&&!anchorHit) continue;
        for(let count=1;count<=Math.min(3,english.length-start);count++) {
          const group=english.slice(start,start+count), f=features(group.join(" "));
          const required=signal.numbers.size+signal.terms.size;
          const hits=[...signal.numbers].filter(n=>f.numbers.has(n)).length+[...signal.terms].filter(term=>f.terms.has(term)).length;
          const complete=hits===required;
          const length=expected?Math.exp(-Math.abs(Math.log((f.length+1)/(expected+1)))):0;
          const position=estimated===null?0:1/(1+Math.abs(start+(count-1)/2-estimated));
          const score=(required?4*hits/required:0)+2*position+1.2*length-(required&&!complete?2:0)-.18*(count-1);
          ranked.push({english:group,score,length,complete,required,start,count});
        }
      }
      ranked.sort((a,b)=>b.score-a.score);
      const best=ranked[0], gap=best?best.score-(ranked[1]?.score||0):0;
      if(!best||!best.complete) return {english:[],reason:""};
      const anchored=best.required>0&&gap>.55;
      const ordered=context.length===1&&full.length===english.length&&best.count===1&&best.start===context[0].index&&best.length>.45&&gap>.3;
      if(!anchored&&!ordered) return {english:[],reason:""};
      return {english:best.english,reason:anchored?(signal.numbers.size&&signal.terms.size?"数字与缩写":signal.numbers.size?"数字":"缩写"):"句序与长度"};
    });
  }
  globalThis.YanjiRules={suggest};
})();
