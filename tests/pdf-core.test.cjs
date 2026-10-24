const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const scope={};vm.runInNewContext(fs.readFileSync('zotero/pdf-core.js','utf8'),scope);const C=scope.YanjiPDFCore;
const page=text=>({viewBox:[0,0,600,800],chars:[...text].map((u,i)=>({u,rect:[20+i*5,700,25+i*5,710],lineBreakAfter:false}))});
(async()=>{
 const pages=[page('Unique sentence. Repeated text.'),page('Repeated text. First half '),page('continues on this page. A ligature: ﬁnish.')];
 const rows=await C.locate([{id:'unique',text:'Unique sentence.'},{id:'repeat',text:'Repeated text.'},{id:'cross',text:'First half continues on this page.'},{id:'ligature',text:'finish.'},{id:'missing',text:'Never present.'}],3,i=>pages[i]);
 assert.equal(rows[0].matches.length,1);assert.equal(rows[0].matches[0].position.rects[0][0],20);assert.equal(rows[1].matches.length,2);assert.ok(rows[2].matches[0].position.nextPageRects);assert.equal(rows[3].matches.length,1);assert.equal(rows[4].matches.length,0);
 const p=page('inter-national');p.chars[5].lineBreakAfter=true;assert.equal((await C.locate([{id:'hyphen',text:'international'}],1,()=>p))[0].matches.length,1);
 console.log('PASS PDF core: unique/ambiguous/missing text, coordinates, cross-page ranges, ligatures and line-end hyphenation');
})().catch(e=>{console.error(e);process.exitCode=1});
