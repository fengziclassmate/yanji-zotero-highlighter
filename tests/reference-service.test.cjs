const assert=require('node:assert/strict'),crypto=require('node:crypto');
require('../yanji-edge/shared.js');
global.digest=async text=>crypto.createHash('sha256').update(text).digest('hex');
const storage={},calls=[];
global.chrome={storage:{local:{get:async key=>Object.fromEntries((Array.isArray(key)?key:[key]).filter(k=>k in storage).map(k=>[k,structuredClone(storage[k])])),set:async values=>Object.assign(storage,structuredClone(values)),remove:async keys=>{for(const k of [].concat(keys))delete storage[k]}}},permissions:{contains:async()=>true}};
let response,active=0,maxActive=0;
global.fetch=async(url,options)=>{calls.push({url,options});maxActive=Math.max(maxActive,++active);try{if(response)return await response(url,options);if(url.includes('niutrans'))return Response.json({tgt_text:'小牛示例译文'});if(url.includes('translate_a'))return Response.json([[['谷歌示例译文','source']]]);if(url.includes('translation.googleapis'))return Response.json({data:{translations:[{translatedText:'Cloud 示例译文'}]}});return Response.json([{translations:[{text:'微软示例译文'}]}]);}finally{active--}};
require('../yanji-edge/reference-service.js');
const R=YanjiReferencesService;
(async()=>{
 assert.equal((await R.config()).enabled,false);
 for(const provider of Object.keys(R.providers)){
  await R.save({enabled:true,provider,credentials:{niutrans:{key:'test-niu'},googlecloud:{key:'test-google'},azure:{key:'test-azure',region:'eastasia'}}});
  const before=calls.length,text='A unique reference title for '+provider;
  const [first,second]=await Promise.all([R.translate(text),R.translate(text)]);
  assert.equal(first,second);assert.equal(calls.length,before+1,'Identical in-flight titles share one request');
  assert.equal(await R.translate(text),first);assert.equal(calls.length,before+1,'Stored cache avoids repeated requests');
  const call=calls.at(-1);assert.equal(call.options.credentials,'omit');
  if(provider==='niutrans'){assert.equal(call.options.body.get('apikey'),'test-niu');assert.equal(call.options.body.get('src_text'),text);assert.ok(!call.url.includes('test-niu'))}
  if(provider==='azure'){assert.equal(call.options.headers['Ocp-Apim-Subscription-Region'],'eastasia');assert.equal(JSON.parse(call.options.body)[0].Text,text)}
  if(provider==='edge')assert.deepEqual(JSON.parse(call.options.body),[text]);
  if(provider==='googlecloud')assert.equal(call.options.headers['X-Goog-Api-Key'],'test-google');
  assert.ok(!JSON.stringify(R.state(await R.config())).includes('test-'));
 }
 assert.equal(maxActive,1,'Requests are serialized across services');
 await R.save({enabled:true,provider:'azure',credentials:{azure:{key:'test-azure',region:'global'}}});assert.equal((await R.config()).credentials.azure.region,'');
 response=async()=>new Response('<html>Service unavailable</html>');await assert.rejects(R.translate('Invalid JSON response should remain an actionable error'),/无效数据/);
 await R.save({enabled:true,provider:'google',credentials:{}});response=async()=>Response.json({changed:'format'});await assert.rejects(R.translate('Changed service format should not render invalid output'),/未返回有效译文/);
 await R.save({enabled:true,provider:'niutrans',credentials:{niutrans:{key:'test-secret'}}});
 response=async()=>Response.json({error_code:'bad',error_msg:'Rejected test-secret'});
 await assert.rejects(R.translate('A title rejected by the configured service'),error=>error.message==='Rejected [已隐藏]');
 response=(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
 const cancelled=R.translate('A title cancelled when translation is disabled');
 const failure=assert.rejects(cancelled,/翻译已停止/);
 while(active===0)await new Promise(r=>setTimeout(r,25));
 await R.save({enabled:false,provider:'niutrans',credentials:{niutrans:{key:'test-secret'}}});await failure;
 await assert.rejects(R.translate('A title after disabling'),/已关闭/);
 response=undefined;
 await R.save({enabled:true,provider:'niutrans',credentials:{niutrans:{key:'test-secret'}}});
 storage.referenceCacheIndex=Object.fromEntries(Array.from({length:1000},(_,i)=>['referenceCache:old-'+i,i]));
 await R.translate('A title for bounded persistent cache verification');
 assert.equal(Object.keys(storage.referenceCacheIndex).length,1000);
 await assert.rejects(R.save({enabled:true,provider:'unknown',credentials:{}}),/翻译设置无效/);
 console.log('PASS reference services: five provider protocols, masked credentials, cache and deduplication, global request limit, cancellation and 1000-entry bound');
})().catch(error=>{console.error(error);process.exitCode=1});
