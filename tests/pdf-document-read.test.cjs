const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
  const tabs=new Map([[1,{frozen:true}],[2,{discarded:true}],[3,{}]]),activations=[];let pending=false,cleared=0;
  const scope={URL,chrome:{tabs:{get:async id=>tabs.get(id),update:async id=>{activations.push(id);Object.assign(tabs.get(id),{frozen:false,discarded:false})},query:async()=>[...tabs.values()],sendMessage:async id=>{assert.ok(!tabs.get(id).frozen);return pending?new Promise(()=>{}):{ok:true}}}},setTimeout:fn=>setTimeout(fn,10),clearTimeout:id=>{cleared++;clearTimeout(id)}};
  vm.runInNewContext(fs.readFileSync('yanji-edge/pdf-document.js','utf8'),scope);
  for(const id of [1,2,3])assert.equal((await scope.YanjiPDFDocument.readTab(id)).ok,true);
  assert.deepEqual(activations,[1,2],'Only frozen or discarded tabs should be activated');
  pending=true;await assert.rejects(scope.YanjiPDFDocument.readTab(3),/文章页未响应/);
  assert.equal(cleared,4,'Clear all request timers on either success or timeout');
  const article={id:4,windowId:1,url:'https://www.sciencedirect.com/science/article/pii/PAPER-01'},pdf={id:5,windowId:1,url:'https://pdf.sciencedirectassets.com/123/1-s2.0-PAPER-01/main.pdf'};tabs.set(4,article);tabs.set(5,pdf);
  assert.equal((await scope.YanjiPDFDocument.articleTab(pdf)).id,4,'PDF sidebar must retain the matching article metadata');
  assert.equal((await scope.YanjiPDFDocument.articleTab(article)).id,4);
  await assert.rejects(scope.YanjiPDFDocument.articleTab({...pdf,url:pdf.url.replace('PAPER-01','OTHER')}),/对应的文章正文页/);
  console.log('PASS frozen/discarded article activation and bounded PDF metadata read');
})().catch(error=>{console.error(error);process.exitCode=1});
