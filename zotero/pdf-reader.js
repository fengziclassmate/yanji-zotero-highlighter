var YanjiPDFReader = (() => {
  const {setTimeout,clearTimeout}=ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  let rootURI;
  const active = new Set();
  async function save({token,temporaryName,url}) {
    if(!Zotero.isWin)throw Error("自动调用 Edge 阅读器目前需要 Windows。");
    if(!/^[A-Za-z0-9]{32}$/.test(token)||typeof temporaryName!=="string"||/[\\/]/.test(temporaryName))throw Error("PDF 保存任务无效。");
    if(!URL.canParse(url)||!/^https?:$/.test(new URL(url).protocol)||new URL(url).username||new URL(url).password)throw Error("PDF 地址无效。");
    const base=Zotero.getTempDirectory().path;
    const work=PathUtils.join(base,"研迹阅读器",token),staging=PathUtils.join(base,"研迹临时",token);
    const {NetUtil}=ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
    const scriptText=await new Promise((resolve,reject)=>NetUtil.asyncFetch({uri:rootURI+"reader-save.ps1",loadUsingSystemPrincipal:true},(stream,status)=>{
      if(status!==0){reject(Error("无法读取阅读器保存脚本（"+status+"）"));return}
      try{resolve(NetUtil.readInputStreamToString(stream,stream.available(),{charset:"UTF-8"}))}catch(error){reject(error)}
    }));
    await IOUtils.makeDirectory(work,{createAncestors:true,ignoreExisting:true});
    await IOUtils.makeDirectory(staging,{createAncestors:true,ignoreExisting:true});
    const script=PathUtils.join(base,"研迹阅读器","reader-save.ps1");
    await IOUtils.writeUTF8(script,"\uFEFF"+scriptText);
    const request=PathUtils.join(work,"request.json"),result=PathUtils.join(work,"result.json"),outputPath=PathUtils.join(staging,temporaryName);
    await IOUtils.writeUTF8(request,JSON.stringify({url,outputPath,resultPath:result}));
    const {Subprocess}=ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
    let process,timer;
    try{
      process=await Subprocess.call({command:PathUtils.join(Services.env.get("SystemRoot"),"System32","WindowsPowerShell","v1.0","powershell.exe"),arguments:["-NoLogo","-NoProfile","-NonInteractive","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File",script,"-RequestPath",request],stderr:"pipe"});
      active.add(process);
      const streams=Promise.all([process.stdout.readString(),process.stderr.readString()]);
      const status=await Promise.race([process.wait(),new Promise((resolve,reject)=>{timer=setTimeout(()=>{Promise.resolve(process.kill()).then(()=>reject(Error("阅读器保存超时，请检查 PDF 是否已加载。")),reject)},60000)})]);
      const [,stderr]=await streams;
      if(!await IOUtils.exists(result))throw Error("阅读器保存未完成："+(stderr.trim().slice(0,300)||"未返回保存结果"));
      const response=await IOUtils.readJSON(result);
      if(!response.ok||status.exitCode!==0)throw Error(response.error||"阅读器保存失败。");
      return outputPath;
    }finally{
      clearTimeout(timer);if(process)active.delete(process);
      await IOUtils.remove(request,{ignoreAbsent:true});await IOUtils.remove(result,{ignoreAbsent:true});await IOUtils.remove(work,{ignoreAbsent:true});
    }
  }
  return {save,start(uri){rootURI=uri},stop(){for(const process of active)process.kill();active.clear()}};
})();
