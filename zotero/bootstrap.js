var scope;
async function startup({ rootURI }) {
  await Zotero.initializationPromise;
  scope = { Zotero };
  Services.scriptloader.loadSubScript(rootURI + "pdf-core.js", scope);
  Services.scriptloader.loadSubScript(rootURI + "bridge.js", scope);
  scope.YanjiPDFBridge.start();
}
function shutdown() { scope?.YanjiPDFBridge.stop(); scope = null; }
function install() {}
function uninstall() {}
