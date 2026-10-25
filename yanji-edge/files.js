(() => {
  const request = async message => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  };
  async function exportFile(mode, progress) {
    const meta = await request({ type: "BACKUP_META",pdfLinks:mode==="json" });
    const keys = (await chrome.storage.local.getKeys()).filter(key => key.startsWith("page:")).sort();
    const { revision, ...header } = meta;
    const chunks = mode === "json" ? [new Blob([JSON.stringify(header).slice(0, -1) + ',"pages":['])] : [];
    let first = true;
    for (let offset = 0; offset < keys.length; offset += 10) {
      const pages = Object.values(await chrome.storage.local.get(keys.slice(offset, offset + 10)));
      const parts = [];
      for (const page of pages) {
        parts.push(mode === "json" ? (first ? "" : ",") + JSON.stringify(page) : (first ? "" : "\n\n---\n\n") + Yanji.markdown(page, page.annotations, meta.settings));
        first = false;
      }
      chunks.push(new Blob(parts));
      progress(Math.min(offset + 10, keys.length), keys.length);
    }
    await request({ type: "BACKUP_CHECK", revision });
    if (mode === "json") chunks.push(new Blob(["]}"]));
    return new Blob(chunks, { type: mode === "json" ? "application/json" : "text/markdown;charset=utf-8" });
  }
  async function restore(backup, progress) {
    if (backup?.format !== "yanji-backup" || backup.version !== 1 || !Array.isArray(backup.pages)) throw new Error("这不是有效的研迹备份文件。");
    const token = await request({ type: "IMPORT_BEGIN", settings: backup.settings,pdfLinks:backup.pdfLinks });
    let count = 0;
    try {
      for (const page of backup.pages) {
        const text = JSON.stringify(page), size = 2 * 1024 * 1024;
        for (let offset = 0, sequence = 0; offset < text.length; offset += size, sequence++) {
          await request({ type: "IMPORT_CHUNK", token, sequence, text: text.slice(offset, offset + size), last: offset + size >= text.length });
        }
        count++;
        progress(count, backup.pages.length);
      }
      return count;
    } catch (error) {
      throw new Error(`导入中断，已合并 ${count} 篇：${error.message} 原有内容仍保留，可重新导入继续合并。`, { cause: error });
    } finally { await request({ type: "IMPORT_END", token }); }
  }
  globalThis.YanjiFiles = { exportFile, restore };
})();
