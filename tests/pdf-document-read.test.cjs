const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
  const tabs=new Map([[1,{frozen:true}],[2,{discarded:true}],[3,{}]]),activations=[];let pending=false,cleared=0;
  const scope={chrome:{tabs:{get:async id=>tabs.get(id),update:async id=>{activations.push(id);Object.assign(tabs.get(id),{frozen:false,discarded:false})},sendMessage:async id=>{assert.ok(!tabs.get(id).frozen);return pending?new Promise(()=>{}):{ok:true}}}},setTimeout:fn=>setTimeout(fn,10),clearTimeout:id=>{cleared++;clearTimeout(id)}};
  vm.runInNewContext(fs.readFileSync('yanji-edge/pdf-document.js','utf8'),scope);
  for(const id of [1,2,3])assert.equal((await scope.YanjiPDFDocument.readTab(id)).ok,true);
  assert.deepEqual(activations,[1,2],'Only frozen or discarded tabs should be activated');
  pending=true;await assert.rejects(scope.YanjiPDFDocument.readTab(3),/文章页未响应/);
  assert.equal(cleared,4,'Clear all request timers on either success or timeout');
  console.log('PASS frozen/discarded article activation and bounded PDF metadata read');
})().catch(error=>{console.error(error);process.exitCode=1});
