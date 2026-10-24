const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),crypto=require('crypto');
require('../yanji-edge/shared.js');const Y=globalThis.Yanji;
(async()=>{
 const local={},session={};const area=map=>({get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,map[k]])),set:async values=>Object.assign(map,structuredClone(values))});
 const notes=[],binding={serverID:'test-server',itemKey:'PARENT22'};let comment='原始批注',hashMatches=true,choices=false;
 const attachmentKey='PDFKEY22',position={pageIndex:0,rects:[[10,20,100,30]]};let writes=0;
 const scope={Yanji,Y,structuredClone,crypto:crypto.webcrypto,getPage:async()=>({binding}),getSettings:async()=>Y.defaults,digest:async text=>crypto.createHash('sha256').update(text).digest('hex'),chrome:{storage:{local:area(local),session:area(session)}},S:{linked:async()=>[{annotations:[{id:'source-annotation',quote:'中文摘录。',comment,url:'https://example.test/article',category:'content',segments:[{translated:true,sentencePairs:[{index:0,chinese:'中文摘录。',english:['English source sentence.']}]}]}]}]},Z:{connection:{serverID:binding.serverID},library:'users/0',connect:async()=>{},locatePDF:async data=>data.verifyHash?{hashMatches}:choices?{choices:[{key:attachmentKey,title:'First PDF'},{key:'OTHERPDF',title:'Second PDF'}]}:{attachmentKey,hash:'pdf-hash',choices:[{key:attachmentKey,title:'PDF'}],rows:data.sentences.map(row=>({id:row.id,matches:[{position,pageLabel:'1',sortIndex:'00000|000000|00700'}]}))},read:async path=>path.includes('children')?structuredClone(notes):structuredClone(notes.find(n=>path.endsWith(n.key))),write:async(path,method,data)=>{writes++;if(method==='POST'){for(const row of data)notes.push({key:row.key,version:1,data:structuredClone(row)})}else{const note=notes.find(n=>path.endsWith(n.key));Object.assign(note.data,structuredClone(data));note.version++}}}};
 vm.createContext(scope);vm.runInContext(fs.readFileSync('yanji-edge/pdf-sync.js','utf8'),scope);const sync=scope.YanjiPDFSync;
 const plan=await sync.scan('page');const select=[{id:plan.rows[0].id,index:0}];
 assert.equal((await sync.save(plan.token,select)).written,1);const key=notes[0].key;
 assert.equal((await sync.save(plan.token,select)).unchanged,1);assert.equal(writes,1);
 comment='更新批注';const update=await sync.scan('page');assert.equal((await sync.save(update.token,select)).written,1);assert.equal(notes.length,1);assert.equal(notes[0].key,key);assert.ok(notes[0].data.annotationComment.includes(comment));
 notes[0].data.annotationComment='在 Zotero 手写的评论';const conflict=await sync.scan('page');assert.equal((await sync.save(conflict.token,select)).conflicts,1);assert.equal(notes[0].data.annotationComment,'在 Zotero 手写的评论');
 hashMatches=false;await assert.rejects(sync.save(conflict.token,select),/已经更换/);hashMatches=true;
 const inFlight=sync.save(conflict.token,select);await assert.rejects(sync.save(conflict.token,select),/正在写入/);await inFlight;
 choices=true;assert.equal((await sync.scan('page')).choices.length,2);
 assert.equal(writes,2);console.log('PASS PDF sync: create, repeat idempotence, same annotation update, manual-edit conflict, changed file rejection, concurrent write lock and multiple PDFs');
})().catch(e=>{console.error(e);process.exitCode=1});
