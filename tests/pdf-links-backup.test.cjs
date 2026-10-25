const vm=require('vm'),fs=require('fs'),assert=require('node:assert/strict');require('../yanji-edge/shared.js');
(async()=>{
 const id='a'.repeat(32),suffix='PDFKEY22:'+id;
 const data={settings:Yanji.defaults,dataRevision:'revision',zoteroAuth:{serverID:'current',key:'private-authorization'},['pdfPortable:'+suffix]:{key:'ANNKEY22',hash:'a'.repeat(64)},['pdfLink:old:'+suffix]:{key:'ANNKEY22',hash:'b'.repeat(64)},['pdfLink:current:'+suffix]:{key:'ANNKEY22',hash:'c'.repeat(64)}};
 const scope={Yanji,chrome:{storage:{local:{getKeys:async()=>Object.keys(data),get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]))}}}};
 vm.createContext(scope);vm.runInContext(fs.readFileSync('yanji-edge/store.js','utf8'),scope);const store=scope.YanjiStore;
 const header=await store.manifest(true);assert.equal(header.pdfLinks[suffix].hash,'c'.repeat(64));assert.ok(!JSON.stringify(header).includes('private-authorization'));assert.equal((await store.manifest()).pdfLinks,undefined);
 const restored=store.validatePDFLinks(JSON.parse(JSON.stringify(header.pdfLinks)));assert.equal(restored['pdfPortable:'+suffix].key,'ANNKEY22');assert.equal(restored['pdfPortable:'+suffix].hash,'c'.repeat(64));assert.equal(Object.keys(store.validatePDFLinks()).length,0);
 header.pdfLinks[suffix].unverified=true;assert.equal(store.validatePDFLinks(header.pdfLinks)['pdfPortable:'+suffix].unverified,true);
 assert.throws(()=>store.validatePDFLinks({bad:{key:'ANNKEY22',hash:'c'.repeat(64)}}));assert.throws(()=>store.validatePDFLinks({[suffix]:{key:'not-a-key',hash:'x'}}));
 console.log('PASS hidden PDF links backup: portable IDs, current-library priority, old backup compatibility, validation and no authorization leakage');
})().catch(e=>{console.error(e);process.exitCode=1});
