const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');

(async()=>{
 const workspace=path.resolve('work'),profile=path.join(workspace,'sidebar-layout-profile-'+Date.now());
 const server=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});s.end('<!doctype html><meta charset="utf-8"><meta name="citation_title" content="Sidebar layout fixture"><title>Sidebar layout fixture</title><h1>Sidebar layout fixture</h1><p>Synthetic article for sidebar layout verification.</p>')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const sourceURL='http://127.0.0.1:'+server.address().port+'/article';
 const context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,args:['--disable-extensions-except='+path.resolve('yanji-edge'),'--load-extension='+path.resolve('yanji-edge')]});
 const errors=[],zoteroRequests=[],reports=[];
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('http://127.0.0.1:23119/**',route=>{zoteroRequests.push(route.request().url());return route.abort()});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{
   await chrome.storage.local.set({settings:{...Yanji.defaults,autoSyncOnOpen:false},referenceTranslation:{enabled:false,recommendedEnabled:false,citedByEnabled:false}});
   YanjiZotero.connect=async()=>({serverID:'layout-fixture'});YanjiZotero.findDOI=async()=>[];
   YanjiZotero.read=async()=>{throw Error('Unexpected Zotero read in layout fixture')};
   YanjiZotero.write=async()=>{throw Error('Unexpected Zotero write in layout fixture')};
  });
  const article=await context.newPage();await article.goto(sourceURL);await article.waitForSelector('#yanji-root',{state:'attached'});
  const panel=await context.newPage();const panelURL='chrome-extension://'+new URL(worker.url()).host+'/panel.html';
  await panel.goto(panelURL);await worker.evaluate(async url=>chrome.tabs.update((await chrome.tabs.query({})).find(t=>t.url===url).id,{active:true}),sourceURL);
  async function fixtures(width,zoom){
   await panel.setViewportSize({width,height:1200});await worker.evaluate(zoom=>chrome.storage.local.set({'uiZoom:panel':zoom}),zoom);await panel.reload();
   await panel.waitForFunction(()=>document.querySelector('#title').textContent==='Sidebar layout fixture');
   await panel.evaluate(()=>{
    const chinese='综合考虑空间可达性、活动网络和群体差异，可以识别城市活动空间的多种结构。分析结果需要同时检验不同时间尺度、样本选择和测量误差的影响。';
    const english='A reproducible interpretation of activity spaces requires consistent spatial definitions, comparative evidence, and sensitivity checks across observation periods. ';
    const make=(id,category,quote,comment,translated,pairs=[])=>({id,category,quote,comment,url:page.url,createdAt:1,updatedAt:1,segments:[{index:Number(id.slice(-1)),heading:'Methods and reproducibility / 方法与可复现性',translated,original:english.repeat(3),text:chinese,sentencePairs:pairs}]});
    page={...page,title:'Understanding complex activity spaces: A comparative framework for multilingual research notes, long article titles and reproducible interpretation',doi:'10.0000/sidebarmetadataverification-with-a-very-long-unbroken-document-identifier-2026-abcdef0123456789',binding:{serverID:'layout-fixture',itemKey:'PAPER001',title:'Linked literature fixture',via:'doi'},match:{status:'linked'},sync:{status:'synced',noteKey:'NOTE0001',count:3,unchanged:true},annotations:[
     make('annotation1','content',chinese.repeat(3),'需要检查样本选择和空间尺度对结论的影响，并与同条件下的基线比较。\n第二点：核对变量定义及复现实验。',true,[{index:0,chinese,english:[english]}]),
     make('annotation2','challenge',english.repeat(4)+'unbroken_identifier_'.repeat(8),'Long English terminology and identifiers should wrap without pushing controls outside the sidebar.',false),
     make('annotation3','terms','可解释性、可迁移性与稳健性','保留术语，随后在 PDF 中核对。',true)
    ]};
    settings=Yanji.settingsWithDefaults({});annotationsCollapsed=false;annotationPage=0;expandedQuotes.clear();paint();status('#connection-status','已连接','success');
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{self.fixtureCopied=value}},configurable:true});
   });
   await panel.waitForFunction(()=>document.querySelectorAll('.annotation').length===3&&!document.querySelector('#bookmark-article').hidden);
   await panel.evaluate(()=>{document.querySelector('#return-source').hidden=false;document.querySelector('#resume-reading').hidden=false;document.querySelector('main').scrollTop=0});
   await panel.evaluate(()=>new Promise(requestAnimationFrame));
  }
  async function audit(width,zoom,state){
   const result=await panel.evaluate(()=>{
    const scale=parseFloat(document.documentElement.style.zoom)/100;
    const containers=[document.documentElement,document.body,document.querySelector('main'),...document.querySelectorAll('main>.section')];
    const overflow=containers.filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>({node:n.id||n.className||n.tagName,scroll:n.scrollWidth,client:n.clientWidth}));
    const targets=[...document.querySelectorAll('button,summary')].filter(n=>n.getClientRects().length&&!n.closest('[hidden]')&&getComputedStyle(n).visibility!=='hidden');
    const small=targets.map(n=>{const r=n.getBoundingClientRect();return{id:n.id||n.dataset.action||n.textContent.trim(),width:r.width/scale,height:r.height/scale}}).filter(r=>r.width<31.5||r.height<31.5);
    return{overflow,small};
   });
   reports.push({width,zoom,state,...result});
  }
  for(const width of [320,390,480])for(const zoom of [110,150,200]){
   await fixtures(width,zoom);await audit(width,zoom,'collapsed');
   if(zoom===110&&(width===320||width===390))await panel.screenshot({path:path.join(workspace,'sidebar-'+width+'.png')});
   const card=panel.locator('.annotation').first(),expander=card.locator('[data-action="expand"]');
   assert.equal(await expander.isVisible(),true,'Long excerpt retains its expand control');
   await expander.click();assert.equal(await card.evaluate(n=>n.classList.contains('quote-expanded')),true);
   await card.locator('details.edit>summary').click();await card.locator('textarea').waitFor({state:'visible'});
   await card.locator('details.source>summary').click();await card.locator('.source .original').waitFor({state:'visible'});
   await audit(width,zoom,'expanded');
   if(width===390&&zoom===110){await card.scrollIntoViewIfNeeded();await panel.screenshot({path:path.join(workspace,'sidebar-annotation-390.png')})}
   await expander.click();assert.equal(await card.evaluate(n=>n.classList.contains('quote-expanded')),false);
  }
  fs.writeFileSync(path.join(workspace,'sidebar-layout-report.json'),JSON.stringify({reports,errors,zoteroRequests},null,2));
  const bad=reports.filter(r=>r.overflow.length||r.small.length);console.log(JSON.stringify({cases:reports.length,failures:bad,errors,zoteroRequests},null,2));
  assert.equal(zoteroRequests.length,0,'Never contact the real Zotero instance');assert.deepEqual(errors,[]);assert.equal(bad.length,0,'Sidebar overflow or controls below 32 CSS px');
  console.log('PASS sidebar layout, target sizes and expandable content at 320/390/480 widths and 110/150/200% zoom');
 }finally{await context.close();await new Promise(resolve=>server.close(resolve));if(path.dirname(profile)!==workspace||!path.basename(profile).startsWith('sidebar-layout-profile-'))throw Error('Unsafe test-profile cleanup');fs.rmSync(profile,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
