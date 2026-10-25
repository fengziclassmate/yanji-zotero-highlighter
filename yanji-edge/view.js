(() => {
  const root = document.documentElement;
  for (const [name,value] of Object.entries(Yanji.uiColors)) root.style.setProperty(name,value);
  const button = document.querySelector("#view-zoom");
  const view = document.body.classList.contains("panel-body") ? "panel" : "options";
  const key = "uiZoom:" + view;
  root.dataset.view = view;
  let zoom = 110;
  const layout = () => {
    const width = innerWidth / (zoom / 100);
    root.style.setProperty("--view-width",width+"px");
    root.style.setProperty("--view-height",innerHeight/(zoom/100)+"px");
    root.classList.toggle("ui-compact", width <= 650);
    root.classList.toggle("ui-wide", width >= 1200);
    root.classList.toggle("ui-tight",width<240);
  };
  function apply(value) {
    zoom = value;
    root.style.zoom = zoom + "%";
    root.style.setProperty("--ui-scale", zoom / 100);
    button.textContent = zoom + "%";
    button.setAttribute("aria-label", `界面缩放 ${zoom}%，点击恢复 100%`);
    layout();
  }
  function report(error) {
    console.error("研迹缩放", error);
    button.title = "缩放未保存：" + error.message;
  }
  function change(value) {
    apply(Math.max(80, Math.min(200, value)));
    chrome.storage.local.set({ [key]: zoom }).catch(report);
  }
  apply(zoom);
  chrome.storage.local.get(key).then(saved => {
    apply(saved[key] ?? 110);
    addEventListener("wheel", event => {
      if (!event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      change(zoom + (event.deltaY < 0 ? 10 : -10));
    }, { passive: false });
    addEventListener("keydown", event => {
      if (event.ctrlKey && event.key === "0") { event.preventDefault(); change(100); }
    });
    button.onclick = () => change(100);
  }).catch(report);
  addEventListener("resize", layout);
})();
