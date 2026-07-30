(() => {
  const byId = (id) => document.getElementById(id);
  const MAX_TOASTS = 3;
  const TOAST_DURATION = 3000;
  const makeSpinner = () => Object.assign(document.createElement("span"), {
    className: "loading-spinner"
  });

  const toastRegion = Object.assign(document.createElement("div"), {
    className: "toast-region"
  });
  toastRegion.setAttribute("role", "status");
  toastRegion.setAttribute("aria-live", "polite");
  document.body.appendChild(toastRegion);

  const showToast = (message) => {
    const toast = Object.assign(document.createElement("div"), {
      className: "toast",
      textContent: String(message || "操作失败")
    });
    toastRegion.appendChild(toast);
    while (toastRegion.childElementCount > MAX_TOASTS) toastRegion.firstElementChild.remove();
    setTimeout(() => {
      toast.classList.add("is-leaving");
      setTimeout(() => toast.remove(), 200);
    }, TOAST_DURATION);
  };

  const appendLog = (message) => {
    const log = byId("log");
    if (!log) return;
    log.textContent = `[${new Date().toLocaleTimeString()}] ${message}\n${log.textContent}`.slice(0, 6000);
  };

  const notifyError = (message, writeLog = false) => {
    const text = String(message?.message || message || "操作失败");
    if (writeLog) appendLog(text);
    const logPanel = byId("logPanel");
    if (logPanel) logPanel.open = true;
    showToast(text);
  };

  // 提供显式通知 API；alert 仅作为旧调用方的兼容入口。
  window.HIPToast = showToast;
  window.HIPNotify = notifyError;
  // 清除旧版本保存的整份 MRC 浏览器缓存；主题必须由用户显式加载。
  try { indexedDB.deleteDatabase("hyper-icon-patcher"); } catch {}
  window.alert = (message) => notifyError(message);
  window.addEventListener("error", (event) => {
    notifyError(`页面异常：${event.message || "未知错误"}`, true);
  });
  window.addEventListener("unhandledrejection", (event) => {
    notifyError(`操作异常：${event.reason?.message || event.reason || "未知错误"}`, true);
  });

  for (const button of ["reloadApps"].map(byId).filter(Boolean)) {
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
    const timeout = setTimeout(() => {
      delete window[callback];
      reject(new Error("设备命令响应超时，请稍后重试"));
    }, 60000);
    window[callback] = (errno, stdout, stderr) => {
      clearTimeout(timeout);
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
      clearTimeout(timeout);
      delete window[callback];
      reject(error);
    }
  });

  const openDialog = (id) => {
    const dialog = byId(id);
    if (dialog && !dialog.open) dialog.showModal();
  };
  byId("openAppPicker")?.addEventListener("click", () => openDialog("appPicker"));
  byId("openRecipeManager")?.addEventListener("click", () => {
    openDialog("recipeManager");
    window.dispatchEvent(new Event("hip-recipes-changed"));
  });
  document.querySelectorAll(".close-sheet").forEach((button) =>
    button.addEventListener("click", () => byId(button.dataset.close)?.close()));
  document.querySelectorAll("dialog").forEach((dialog) =>
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    }));
  window.addEventListener("hip-group-changed", (event) => {
    const chip = byId("activeGroupChip");
    if (!chip) return;
    const name = event.detail?.name;
    chip.textContent = name ? `当前修补组：${name}` : "尚未选择修补组";
    chip.hidden = !name;
  });

  const launcherButton = byId("refreshLauncher");
  launcherButton.addEventListener("click", async () => {
    launcherButton.disabled = true;
    launcherButton.classList.add("button-loading");
    launcherButton.replaceChildren(makeSpinner(), "正在重启系统桌面…");
    const log = byId("log");
    try {
      await execBackend("refresh");
      appendLog("系统桌面已重启，图标会重新载入");
    } catch (error) {
      notifyError(`桌面刷新失败：${error.message}`, true);
    } finally {
      launcherButton.classList.remove("button-loading");
      launcherButton.textContent = "重启系统桌面";
      launcherButton.disabled = false;
    }
  });
})();
