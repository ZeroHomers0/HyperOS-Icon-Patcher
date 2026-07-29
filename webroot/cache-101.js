(() => {
  const byId = (id) => document.getElementById(id);
  const script = "/data/adb/modules/hyper_icon_patcher/scripts/backend.sh";
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  let callbackIndex = 0;
  let themes = [];

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
      const timer = setTimeout(() => {
        delete window[callback];
        reject(new Error("设备命令响应超时，请稍后重试"));
      }, 60000);
      window[callback] = (errno, stdout, stderr) => {
        clearTimeout(timer);
        delete window[callback];
        const output = String(stdout || "").trim();
        if (errno !== 0 || output.startsWith("ERROR:")) {
          reject(new Error(output.replace(/^ERROR:/, "") || stderr || `命令失败：${errno}`));
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

  function renderSelection() {
    const theme = selected();
    const status = theme?.status === "changed" ? "主题商店已更新" : theme?.status === "patched" ? "已修补" : "未修改";
    byId("cacheSelectedInfo").textContent = theme
      ? `主题：${theme.label || "未知主题"} · ${sizeText(theme.size)} · ${status} · ${new Date(theme.mtime * 1000).toLocaleString()}`
      : "请选择一个主题商店图标主题";
  }

  async function scan(showError = false) {
    const startedAt = Date.now();
    byId("cacheReload").disabled = true;
    try {
      themes = (await exec("scan_cache")).split(/\r?\n/).filter(Boolean).map((line) => {
        const [name, size, mtime, status, label] = line.split("\t");
        return { name, size: Number(size), mtime: Number(mtime), status: status || "new", label: decodeLabel(label) };
      });
      byId("cacheSelect").replaceChildren(...themes.map((theme, index) => {
        const option = document.createElement("option");
        option.value = theme.name;
        option.textContent = `${index === 0 ? "最近 · " : ""}${theme.label || "未知主题"} · ${theme.status === "patched" ? "已修补" : theme.status === "changed" ? "已更新" : "未修改"}`;
        return option;
      }));
      const previous = localStorage.getItem("hip-last-theme") || localStorage.getItem("hip-last-component");
      if (themes.some((theme) => theme.name === previous)) byId("cacheSelect").value = previous;
      byId("cacheInfo").textContent = themes.length ? `发现 ${themes.length} 个主题` : "没有发现图标主题，请先从主题商店下载";
      renderSelection();
      log(`主题扫描完成 · ${themes.length} 个 · ${Date.now() - startedAt}ms`);
    } catch (error) {
      themes = [];
      byId("cacheInfo").textContent = error.message;
      if (showError) notify(`主题扫描失败：${error.message}`);
    } finally {
      byId("cacheReload").disabled = false;
    }
  }

  byId("cacheSelect").addEventListener("change", renderSelection);
  byId("cacheReload").addEventListener("click", () => scan(true));
  byId("cacheLoad").addEventListener("click", async () => {
    const theme = selected();
    if (!theme) return notify("请先选择一个主题");
    const button = byId("cacheLoad");
    button.disabled = true;
    try {
      const size = Number(await exec("prepare_cache", theme.name));
      if (!Number.isFinite(size) || size <= 0) throw new Error("主题为空或无法读取");
      if (size > 112e6) throw new Error("主题过大，超过 WebUI 安全读取限制");
      const chunks = [];
      const chunkSize = 240000;
      for (let offset = 0; offset < size; offset += chunkSize) {
        chunks.push(await exec("read_chunk", String(offset), String(Math.min(chunkSize, size - offset))));
        button.textContent = `加载 ${Math.min(100, Math.round((offset + chunkSize) / size * 100))}%`;
      }
      window.HIP.loadCacheSource(chunks.join("").replace(/\s/g, ""), theme.label || theme.name, theme.name);
      localStorage.setItem("hip-last-theme", theme.name);
      byId("selectedTheme").innerHTML = `<strong>${theme.label || "未知主题"}</strong><br>状态：已加载为待修补主题`;
      log(`已加载待修补主题：${theme.label || theme.name}`);
    } catch (error) {
      notify(`加载主题失败：${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = "加载待修补主题";
    }
  });

  byId("cachePatch").addEventListener("click", async () => {
    const theme = selected();
    if (!theme) return notify("请先选择并加载待修补主题");
    const flow = window.HIP?.flowStatus?.();
    if (!flow?.sourceLoaded || flow.sourceName !== theme.name) return notify("请先加载当前选中的待修补主题");
    const identity = window.HIP?.themeIdentity?.();
    const prefix = window.HIP?.drawablePrefix?.();
    if (!identity || !prefix) return notify("主题信息尚未就绪，请重新加载主题");
    const button = byId("cachePatch");
    button.disabled = true;
    button.textContent = "正在修补…";
    try {
      const build = (await exec("fast_merge", theme.name, prefix, identity)).split(":");
      const patch = await exec("patch_cache", theme.name);
      log(`修补完成：处理 ${Number(build[1] || 0)} 个自定义图标 · 写入 ${Number(build[2] || 0)} 个主题条目 · 备份：${patch.replace(/^OK:/, "")}`);
      if (window.HIPToast) window.HIPToast("主题修补完成");
      await scan();
    } catch (error) {
      notify(`修补主题失败：${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = "修补主题";
    }
  });

  byId("cacheRestore").addEventListener("click", async () => {
    const theme = selected();
    if (!theme) return notify("请先选择要恢复的主题");
    if (!confirm(`恢复“${theme.label || theme.name}”最近一次备份？`)) return;
    try {
      const result = await exec("restore_cache", theme.name);
      log(`已恢复主题：${result.replace(/^OK:/, "")}`);
      await scan();
    } catch (error) { notify(`恢复失败：${error.message}`); }
  });

  byId("cacheOpen").addEventListener("click", async () => {
    try { await exec("open_theme_manager"); log("已请求打开主题商店"); }
    catch (error) { notify(`无法打开主题商店：${error.message}`); }
  });

  setTimeout(scan, 800);
})();
