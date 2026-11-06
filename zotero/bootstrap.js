var scope;
async function startup({ rootURI }) {
  await Zotero.initializationPromise;
  scope = { Zotero, Services };
  Services.scriptloader.loadSubScript(rootURI + "pdf-core.js", scope);
  Services.scriptloader.loadSubScript(rootURI + "bridge.js", scope);
  Services.scriptloader.loadSubScript(rootURI + "pdf-import.js", scope);
  Services.scriptloader.loadSubScript(rootURI + "pdf-reader.js", scope);
  Services.scriptloader.loadSubScript(rootURI + "pdf-files.js", scope);
  scope.YanjiPDFReader.start(rootURI);
  scope.YanjiPDFBridge.start();
  scope.YanjiPDFFiles.start();
}
function shutdown() { scope?.YanjiPDFBridge.stop(); scope?.YanjiPDFFiles.stop(); scope?.YanjiPDFReader.stop(); scope = null; }
function install() {}
function uninstall() {}
