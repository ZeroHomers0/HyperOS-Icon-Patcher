(() => {
  const byId = (id) => document.getElementById(id);
  const script = "/data/adb/modules/hyper_icon_patcher/scripts/backend.sh";
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  let callbackIndex = 0;
  let themes = [];
  let indexPromise = Promise.resolve(false);
  let inspectGeneration = 0;
  let scanPromise;
  let patching = false;
  let rescanOnResume = false;
  let themeStoreWasHidden = false;
  let themeStoreOpenedAt = 0;

  function notify(message) {
    if (window.HIPNotify) window.HIPNotify(message, true);
    else window.alert(message);
  }

  function log(message) {
    const target = byId("log");
    target.textContent = `[${new Date().toLocaleTimeString()}] ${message}\n${target.textContent}`.slice(0, 6000);
  }

  function exec(operation, ...args) {
    return new Promise((resolve, reject) => {
      const callback = `hip_cache_${Date.now()}_${callbackIndex++}`;
      const timeoutMs = operation === "fast_patch" ? 240000 : operation === "scan_cache" ? 90000 : 60000;
      const timer = setTimeout(() => {
        delete window[callback];
        reject(new Error("设备命令响应超时，请稍后重试"));
      }, timeoutMs);
      window[callback] = (errno, stdout, stderr) => {
        clearTimeout(timer);
        delete window[callback];
        const output = String(stdout || "").trim();
        if (errno !== 0 || output.startsWith("ERROR:")) {
          const errorLine = output.split(/\r?\n/).find((line) => line.startsWith("ERROR:"));
          reject(new Error((errorLine || output).replace(/^ERROR:/, "") || stderr || `命令失败：${errno}`));
        } else resolve(output);
      };
      try {
        ksu.exec(["sh", script, operation, ...args.map(quote)].join(" "), "{}", callback);
      } catch (error) {
        clearTimeout(timer);
        delete window[callback];
        reject(error);
      }
    });
  }

  const sizeText = (size) => size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`;
  function decodeLabel(value) {
    try { return new TextDecoder().decode(Uint8Array.from(atob(value || ""), (char) => char.charCodeAt(0))); }
    catch { return ""; }
  }

  function selected() {
    return themes.find((theme) => theme.name === byId("cacheSelect").value);
  }

  function renderSelection(detail = "") {
    const theme = selected();
    byId("cacheSelectedInfo").textContent = theme
      ? `主题：${theme.label || "未知主题"} · ${sizeText(theme.size)} · ${new Date(theme.mtime * 1000).toLocaleString()}${detail}`
      : "请选择一个待修补主题";
  }

  function setStepState(id, text, state = "") {
    const target = byId(id);
    target.textContent = text;
    target.className = `step-state${state ? ` ${state}` : ""}`;
  }

  function inspectSelectedTheme(showError = true) {
    const theme = selected();
    const generation = ++inspectGeneration;
    if (!theme) {
      renderSelection();
      indexPromise = Promise.resolve(false);
      return indexPromise;
    }
    localStorage.setItem("hip-last-theme", theme.name);
    renderSelection(" · 正在读取索引…");
    setStepState("themeStepState", "读取中", "is-busy");
    setStepState("patchStepState", "尚未修补");
    byId("patchResult").hidden = true;
    indexPromise = (async () => {
      try {
        const index = JSON.parse(await exec("inspect_cache", theme.name));
        if (generation !== inspectGeneration) return false;
        if (!index?.prefix || !Number.isInteger(index.entryCount) || index.entryCount < 0) throw new Error("手机端返回的主题索引无效");
        window.HIP.loadCacheIndex(index, theme.label || theme.name, theme.name);
        renderSelection(` · ${index.entryCount} 个图标条目`);
        setStepState("themeStepState", "已选择", "is-ready");
        log(`已选择待修补主题：${theme.label || theme.name} · ${index.entryCount} 个图标条目`);
        return true;
      } catch (error) {
        if (generation !== inspectGeneration) return false;
        renderSelection(" · 索引读取失败");
        setStepState("themeStepState", "读取失败", "is-error");
        if (showError) notify(`读取主题失败：${error.message}`);
        return false;
      }
    })();
    return indexPromise;
  }

  async function scan() {
    if (scanPromise) return scanPromise;
    scanPromise = (async () => {
      const startedAt = Date.now();
      setStepState("themeStepState", "扫描中", "is-busy");
      try {
        themes = (await exec("scan_cache")).split(/\r?\n/).filter(Boolean).map((line) => {
          const [name, size, mtime, label] = line.split("\t");
          return { name, size: Number(size), mtime: Number(mtime), label: decodeLabel(label) };
        });
        const labelCounts = new Map();
        for (const theme of themes) {
          const label = theme.label || "未知主题";
          labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
        }
        byId("cacheSelect").replaceChildren(...themes.map((theme, index) => {
          const option = document.createElement("option");
          const label = theme.label || "未知主题";
          const duplicate = labelCounts.get(label) > 1;
          const time = new Date(theme.mtime * 1000).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
          const suffix = theme.name.replace(/\.mrc$/i, "").slice(-6);
          option.value = theme.name;
          option.textContent = `${index === 0 ? "最近 · " : ""}${label}${duplicate ? ` · ${time} · ${suffix}` : ""}`;
          return option;
        }));
        const previous = localStorage.getItem("hip-last-theme") || localStorage.getItem("hip-last-component");
        if (themes.some((theme) => theme.name === previous)) byId("cacheSelect").value = previous;
        byId("cacheInfo").textContent = themes.length ? `发现 ${themes.length} 个主题` : "没有发现图标主题，请先从主题商店下载";
        log(`主题扫描完成 · ${themes.length} 个 · ${Date.now() - startedAt}ms`);
        await inspectSelectedTheme(false);
      } catch (error) {
        themes = [];
        byId("cacheInfo").textContent = error.message;
        renderSelection();
        setStepState("themeStepState", "扫描失败", "is-error");
        notify(`主题扫描失败：${error.message}`);
      }
    })();
    try { return await scanPromise; }
    finally { scanPromise = undefined; }
  }

  byId("cacheSelect").addEventListener("change", () => inspectSelectedTheme(true));
  window.addEventListener("hip-patch-input-changed", () => {
    setStepState("patchStepState", "尚未修补");
    byId("patchResult").hidden = true;
  });
  document.querySelectorAll('input[name="patchMode"]').forEach((input) =>
    input.addEventListener("change", () => window.dispatchEvent(new Event("hip-patch-input-changed"))));

  byId("cachePatch").addEventListener("click", async () => {
    // 从点击开始锁定；后端 fast_patch 还会用设备端互斥锁防住多 WebUI 并发。
    if (patching) return;
    const theme = selected();
    if (!theme) return notify("请先选择待修补主题");
    const button = byId("cachePatch");
    patching = true;
    button.disabled = true;
    button.textContent = "正在修补…";
    setStepState("patchStepState", "处理中", "is-busy");
    byId("patchResult").hidden = true;
    try {
      if (!await indexPromise) {
        setStepState("patchStepState", "等待主题", "is-error");
        notify("当前主题索引尚未读取成功，请重新选择主题");
        return;
      }
      const flow = window.HIP?.flowStatus?.();
      if (!flow?.sourceLoaded || flow.sourceName !== theme.name) {
        setStepState("patchStepState", "等待主题", "is-error");
        notify("当前主题信息尚未就绪，请重新选择主题");
        return;
      }
      const groupId = window.HIPGroups?.selectedId?.();
      if (!groupId) {
        setStepState("patchStepState", "等待修补组", "is-error");
        notify("请先创建并选择一个修补组");
        return;
      }
      const groupName = window.HIPGroups?.selectedName?.() || "当前修补组";
      const groupCount = window.HIPGroups?.selectedCount?.() || 0;
      const mode = document.querySelector('input[name="patchMode"]:checked')?.value || "missing";
      if (mode === "replace" && !confirm(`将使用修补组“${groupName}”修补主题“${theme.label || theme.name}”。\n${groupCount} 个组内图标中的同名图标将覆盖主题原图，是否继续？`)) {
        setStepState("patchStepState", "已取消");
        return;
      }
      const prefix = window.HIP?.drawablePrefix?.();
      if (!prefix) {
        setStepState("patchStepState", "主题无效", "is-error");
        notify("主题图标目录尚未识别，请重新选择主题");
        return;
      }
      const operationLines = (await exec("fast_patch", theme.name, prefix, groupId, mode)).split(/\r?\n/);
      const build = operationLines[0].split(":");
      const iconCount = Number(build[1] || 0);
      const entryCount = Number(build[2] || 0);
      const modeText = mode === "missing" ? "仅补全缺失图标" : "覆盖同名图标";
      if (entryCount === 0) {
        await exec("clear_transfer").catch(() => {});
        byId("patchResult").textContent = `无需修补：“${theme.label || theme.name}”已经包含修补组“${groupName}”中的全部图标。`;
        byId("patchResult").hidden = false;
        setStepState("patchStepState", "无需修补", "is-ready");
        log(`无需修补：${theme.label || theme.name} · ${groupName} · 0 个新增条目`);
        window.HIPToast?.("当前主题已包含全部组内图标");
        return;
      }
      const patch = operationLines[1] || "OK";
      byId("patchResult").textContent = `已使用“${groupName}”修补主题“${theme.label || theme.name}”｜${modeText}｜处理 ${iconCount} 个｜写入 ${entryCount} 个。`;
      byId("patchResult").hidden = false;
      setStepState("patchStepState", "已完成", "is-ready");
      log(`修补完成：处理 ${iconCount} 个自定义图标 · 写入 ${entryCount} 个主题条目 · ${patch.replace(/^OK:/, "")}`);
      if (window.HIPToast) window.HIPToast("主题修补完成");
    } catch (error) {
      setStepState("patchStepState", "修补失败", "is-error");
      notify(`修补主题失败：${error.message}`);
    } finally {
      patching = false;
      button.disabled = false;
      button.textContent = "修补主题";
    }
  });

  byId("cacheOpen").addEventListener("click", async () => {
    rescanOnResume = true;
    themeStoreWasHidden = false;
    themeStoreOpenedAt = Date.now();
    try { await exec("open_theme_manager"); log("已请求打开主题商店"); }
    catch (error) {
      rescanOnResume = false;
      notify(`无法打开主题商店：${error.message}`);
    }
  });

  async function scanAfterThemeStore() {
    if (!rescanOnResume) return;
    if (document.hidden) {
      themeStoreWasHidden = true;
      return;
    }
    if (!themeStoreWasHidden && Date.now() - themeStoreOpenedAt < 1000) return;
    rescanOnResume = false;
    await scan();
  }
  document.addEventListener("visibilitychange", scanAfterThemeStore);
  window.addEventListener("focus", scanAfterThemeStore);

  setTimeout(scan, 800);
})();
