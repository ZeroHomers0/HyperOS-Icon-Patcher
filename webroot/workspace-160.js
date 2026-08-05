(() => {
  const byId = (id) => document.getElementById(id);
  let current = "patch";

  function storageGet(key) {
    try { return localStorage.getItem(key); }
    catch { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); }
    catch {}
  }

  function showLocalPreviewNotice() {
    if (typeof ksu !== "undefined") return;
    const target = byId("stitchTarget");
    const source = byId("stitchSource");
    target.replaceChildren(Object.assign(document.createElement("option"), { textContent: "仅在 KernelSU WebUI 中读取", disabled: true }));
    source.replaceChildren(Object.assign(document.createElement("option"), { textContent: "仅在 KernelSU WebUI 中读取", disabled: true }));
    byId("stitchThemeInfo").textContent = "电脑端仅用于预览界面；主题扫描、图标预览和缝合需要在 KernelSU WebUI 中运行。";
    byId("stitchThemeState").textContent = "设备端可用";
    byId("stitchIconState").textContent = "设备端可用";
    byId("stitchEmpty").textContent = "连接 KernelSU 设备后，这里会显示目标主题与源主题的双列图标对照。";
  }

  function activate(mode) {
    const stitch = mode === "stitch";
    current = stitch ? "stitch" : "patch";
    byId("patchWorkspace").hidden = stitch;
    byId("stitchWorkspace").hidden = !stitch;
    byId("modePatch").classList.toggle("is-active", !stitch);
    byId("modeStitch").classList.toggle("is-active", stitch);
    byId("modePatch").setAttribute("aria-selected", String(!stitch));
    byId("modeStitch").setAttribute("aria-selected", String(stitch));
    storageSet("hip-workspace", current);
    if (stitch) showLocalPreviewNotice();
    window.dispatchEvent(new CustomEvent("hip-workspace-changed", { detail: { mode: current } }));
  }

  byId("modePatch").addEventListener("click", () => activate("patch"));
  byId("modeStitch").addEventListener("click", () => activate("stitch"));
  window.HIPWorkspace = { activate, current: () => current };
  activate(storageGet("hip-workspace") === "stitch" ? "stitch" : "patch");
})();
