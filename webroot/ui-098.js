(() => {
  const byId = (id) => document.getElementById(id);
  const makeSpinner = () => Object.assign(document.createElement("span"), {
    className: "loading-spinner"
  });

  for (const button of ["reloadApps", "cacheReload"].map(byId).filter(Boolean)) {
    let startedAt = 0;
    let stopTimer = 0;
    const start = () => {
      clearTimeout(stopTimer);
      startedAt = Date.now();
      button.classList.add("is-refreshing");
      button.replaceChildren(makeSpinner());
    };
    const stop = () => {
      const delay = Math.max(0, 420 - (Date.now() - startedAt));
      clearTimeout(stopTimer);
      if (button.classList.contains("is-refreshing") && !button.querySelector(".loading-spinner")) {
        button.replaceChildren(makeSpinner());
      }
      stopTimer = setTimeout(() => {
        button.classList.remove("is-refreshing");
        button.textContent = "↻";
      }, delay);
    };
    button.addEventListener("click", start, true);
    new MutationObserver(() => button.disabled ? start() : stop())
      .observe(button, { attributes: true, attributeFilter: ["disabled"] });
  }

  let callbackIndex = 0;
  const execBackend = (operation) => new Promise((resolve, reject) => {
    const callback = `hip_ui_callback_${Date.now()}_${callbackIndex++}`;
    window[callback] = (errno, stdout, stderr) => {
      delete window[callback];
      const output = String(stdout || "").trim();
      if (errno !== 0 || output.startsWith("ERROR:")) reject(new Error(output || stderr || `命令失败：${errno}`));
      else resolve(output);
    };
    try {
      ksu.exec(
        `sh /data/adb/modules/hyper_icon_patcher/scripts/backend.sh ${operation}`,
        "{}",
        callback
      );
    } catch (error) {
      delete window[callback];
      reject(error);
    }
  });

  const launcherButton = byId("refreshLauncher");
  launcherButton.addEventListener("click", async () => {
    launcherButton.disabled = true;
    launcherButton.classList.add("button-loading");
    launcherButton.replaceChildren(makeSpinner(), "正在刷新系统桌面…");
    const log = byId("log");
    try {
      await execBackend("refresh");
      log.textContent = `[${new Date().toLocaleTimeString()}] 系统桌面已刷新，图标会重新载入\n${log.textContent}`.slice(0, 6000);
    } catch (error) {
      log.textContent = `[${new Date().toLocaleTimeString()}] 桌面刷新失败：${error.message}\n${log.textContent}`.slice(0, 6000);
    } finally {
      launcherButton.classList.remove("button-loading");
      launcherButton.textContent = "刷新系统桌面图标";
      launcherButton.disabled = false;
    }
  });
})();
