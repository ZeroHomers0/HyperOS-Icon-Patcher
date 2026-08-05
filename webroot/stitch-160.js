import { execBackend } from "./backend-client.js?v=160";

(() => {
  const byId = (id) => document.getElementById(id);
  const exec = execBackend;
  if (typeof globalThis.ksu === "undefined") return;
  const validPackage = (value) => typeof value === "string" && value.length > 0 && value.length <= 255 && !/^[.-]/.test(value) && /^[A-Za-z0-9._-]+$/.test(value);
  let themes = [];
  let rows = [];
  let labels = new Map();
  let selectedPackages = new Set();
  let catalog = null;
  let catalogGeneration = 0;
  let catalogBusy = false;
  let applying = false;
  let scanned = false;
  let previewObserver;
  let previewQueue = [];
  let previewActive = 0;
  const previewUrls = new Map();

  const notify = (message) => window.HIPNotify ? window.HIPNotify(message, true) : window.alert(message);
  function log(message) {
    const target = byId("log");
    target.textContent = `[${new Date().toLocaleTimeString()}] ${message}\n${target.textContent}`.slice(0, 6000);
  }

  function setState(id, text, state = "") {
    const target = byId(id);
    target.textContent = text;
    target.className = `step-state${state ? ` ${state}` : ""}`;
  }

  function invalidateResult() {
    if (applying) return;
    setState("stitchApplyState", "尚未缝合");
    byId("stitchResult").hidden = true;
  }

  function decodeLabel(value) {
    try { return new TextDecoder().decode(Uint8Array.from(atob(value || ""), (char) => char.charCodeAt(0))); }
    catch { return ""; }
  }

  function selectedTheme(selectId) {
    const name = byId(selectId).value;
    return themes.find((theme) => theme.name === name);
  }

  function populateThemeSelect(select, selectedName) {
    select.replaceChildren(
      Object.assign(document.createElement("option"), { value: "", textContent: themes.length ? "请选择主题" : "没有发现图标主题" }),
      ...themes.map((theme) => Object.assign(document.createElement("option"), {
        value: theme.name,
        textContent: `${theme.label || "未知主题"} · ${new Date(theme.mtime * 1000).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`
      }))
    );
    if (themes.some((theme) => theme.name === selectedName)) select.value = selectedName;
  }

  function updateThemeOptionStates() {
    const targetName = byId("stitchTarget").value;
    const sourceName = byId("stitchSource").value;
    byId("stitchTarget").querySelectorAll("option").forEach((option) => {
      option.disabled = Boolean(option.value && option.value === sourceName);
    });
    byId("stitchSource").querySelectorAll("option").forEach((option) => {
      option.disabled = Boolean(option.value && option.value === targetName);
    });
  }

  function clearPreviewState() {
    previewObserver?.disconnect();
    previewObserver = undefined;
    previewQueue = [];
    for (const url of previewUrls.values()) URL.revokeObjectURL(url);
    previewUrls.clear();
  }

  function decodeBase64(value) {
    const binary = atob(String(value || "").replace(/\s/g, ""));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  function enqueuePreview(task) {
    previewQueue.push(task);
    pumpPreviewQueue();
  }

  function pumpPreviewQueue() {
    while (previewActive < 4 && previewQueue.length) {
      const task = previewQueue.shift();
      previewActive++;
      Promise.resolve().then(task).catch(() => {}).finally(() => {
        previewActive--;
        pumpPreviewQueue();
      });
    }
  }

  async function loadPreview(image, themeName, packageName, generation) {
    if (generation !== catalogGeneration || !image.isConnected) return;
    const key = `${themeName}\t${packageName}`;
    if (previewUrls.has(key)) {
      image.src = previewUrls.get(key);
      image.dataset.loaded = "true";
      return;
    }
    const encoded = await exec("stitch_preview", themeName, packageName);
    if (generation !== catalogGeneration || !image.isConnected) return;
    const bytes = decodeBase64(encoded);
    if (!bytes.length) throw new Error("主题图标预览为空");
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    previewUrls.set(key, url);
    image.src = url;
    image.dataset.loaded = "true";
  }

  function observePreviews(generation) {
    previewObserver?.disconnect();
    const images = [...byId("stitchList").querySelectorAll("img[data-theme][data-package]")];
    if (!("IntersectionObserver" in window)) {
      images.forEach((image) => enqueuePreview(() => loadPreview(image, image.dataset.theme, image.dataset.package, generation)));
      return;
    }
    previewObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        previewObserver?.unobserve(entry.target);
        enqueuePreview(() => loadPreview(entry.target, entry.target.dataset.theme, entry.target.dataset.package, generation));
      }
    }, { rootMargin: "160px" });
    images.forEach((image) => previewObserver.observe(image));
  }

  function visibleRows() {
    const kind = byId("stitchKind").value;
    const query = byId("stitchSearch").value.trim().toLowerCase();
    return rows.filter((row) => {
      if (kind !== "all" && row.kind !== kind) return false;
      const label = labels.get(row.packageName) || row.packageName;
      return !query || `${label} ${row.packageName}`.toLowerCase().includes(query);
    });
  }

  function selectionCounts() {
    let added = 0;
    let replaced = 0;
    for (const row of rows) {
      if (!selectedPackages.has(row.packageName)) continue;
      if (row.kind === "add") added++;
      else replaced++;
    }
    return { added, replaced, total: added + replaced };
  }

  function updateSelectionState() {
    const counts = selectionCounts();
    byId("stitchCatalogInfo").textContent = catalog
      ? `已选择 ${counts.total} 个 · 新增 ${counts.added} · 覆盖 ${counts.replaced}`
      : "等待读取主题图标";
    byId("stitchClearSelection").disabled = counts.total === 0 || applying;
    byId("stitchSelectVisible").disabled = !visibleRows().length || applying;
    byId("stitchApply").disabled = counts.total === 0 || catalogBusy || applying;
    byId("stitchApply").textContent = applying ? "正在缝合…" : counts.total ? `缝合 ${counts.total} 个图标` : "请先选择图标";
    setState("stitchIconState", catalog ? `${counts.total} 个已选择` : "等待主题", counts.total ? "is-ready" : "");
  }

  function previewNode(themeName, packageName, placeholder = "") {
    const cell = document.createElement("div");
    cell.className = "stitch-preview";
    if (placeholder) {
      const empty = document.createElement("span");
      empty.className = "stitch-preview-empty";
      empty.textContent = placeholder;
      cell.append(empty);
      return cell;
    }
    const image = document.createElement("img");
    image.alt = "";
    image.dataset.theme = themeName;
    image.dataset.package = packageName;
    const cached = previewUrls.get(`${themeName}\t${packageName}`);
    if (cached) {
      image.src = cached;
      image.dataset.loaded = "true";
    }
    cell.append(image);
    return cell;
  }

  function renderRows() {
    previewObserver?.disconnect();
    const target = selectedTheme("stitchTarget");
    const source = selectedTheme("stitchSource");
    const visible = visibleRows();
    const nodes = visible.map((row) => {
      const item = document.createElement("label");
      item.className = `stitch-item stitch-${row.kind}`;
      const head = document.createElement("div");
      head.className = "stitch-item-head";
      const checkbox = Object.assign(document.createElement("input"), {
        type: "checkbox",
        checked: selectedPackages.has(row.packageName)
      });
      checkbox.onchange = () => {
        checkbox.checked ? selectedPackages.add(row.packageName) : selectedPackages.delete(row.packageName);
        invalidateResult();
        updateSelectionState();
      };
      const meta = document.createElement("div");
      meta.className = "stitch-item-meta";
      const name = document.createElement("strong");
      name.textContent = labels.get(row.packageName) || row.packageName;
      const detail = document.createElement("small");
      detail.textContent = row.packageName;
      meta.append(name, detail);
      const badge = document.createElement("span");
      badge.className = `stitch-badge ${row.kind}`;
      badge.textContent = row.kind === "add" ? "新增" : "覆盖";
      head.append(checkbox, meta, badge);
      const compare = document.createElement("div");
      compare.className = "stitch-compare";
      compare.append(
        row.kind === "add" ? previewNode("", row.packageName, "待新增") : previewNode(target.name, row.packageName),
        previewNode(source.name, row.packageName)
      );
      item.append(head, compare);
      return item;
    });
    byId("stitchList").replaceChildren(...nodes);
    byId("stitchEmpty").hidden = visible.length > 0;
    if (!visible.length) {
      byId("stitchEmpty").textContent = rows.length ? "当前筛选下没有图标" : "两个主题中没有可缝合的已安装应用图标";
    }
    if (target && source) observePreviews(catalogGeneration);
    updateSelectionState();
  }

  async function loadAppLabels(generation) {
    const details = [];
    for (let offset = 0; offset < rows.length; offset += 40) {
      if (generation !== catalogGeneration) return;
      const packages = rows.slice(offset, offset + 40).map((row) => row.packageName);
      try {
        const value = JSON.parse(ksu.getPackagesInfo(JSON.stringify(packages)));
        if (Array.isArray(value)) details.push(...value);
      } catch {}
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    if (generation !== catalogGeneration) return;
    labels = new Map(details.filter((app) => validPackage(app?.packageName)).map((app) => [app.packageName, String(app.appLabel || app.packageName).slice(0, 256)]));
    renderRows();
  }

  function selectedPairIsValid() {
    const target = selectedTheme("stitchTarget");
    const source = selectedTheme("stitchSource");
    return Boolean(target && source && target.name !== source.name);
  }

  async function loadCatalog() {
    const generation = ++catalogGeneration;
    clearPreviewState();
    rows = [];
    labels.clear();
    selectedPackages.clear();
    catalog = null;
    renderRows();
    updateThemeOptionStates();
    const target = selectedTheme("stitchTarget");
    const source = selectedTheme("stitchSource");
    if (!selectedPairIsValid()) {
      byId("stitchThemeInfo").textContent = themes.length < 2 ? "至少需要两个已下载的图标主题" : "请选择两个不同的主题";
      setState("stitchThemeState", "未选择");
      return;
    }
    localStorage.setItem("hip-stitch-target", target.name);
    localStorage.setItem("hip-stitch-source", source.name);
    byId("stitchThemeInfo").textContent = `正在比较“${target.label || target.name}”与“${source.label || source.name}”`;
    setState("stitchThemeState", "读取中", "is-busy");
    catalogBusy = true;
    updateSelectionState();
    try {
      const value = JSON.parse(await exec("stitch_catalog", target.name, source.name));
      if (generation !== catalogGeneration) return;
      if (!value || typeof value.targetFingerprint !== "string" || typeof value.sourceFingerprint !== "string" || !Array.isArray(value.rows)) {
        throw new Error("设备返回的主题图标目录无效");
      }
      if (value.rows.length > 10000) throw new Error("主题图标目录超过安全上限");
      rows = value.rows.filter((row) => validPackage(row?.packageName) && ["add", "replace"].includes(row?.kind));
      catalog = value;
      selectedPackages = new Set(rows.filter((row) => row.kind === "add").map((row) => row.packageName));
      const addCount = selectedPackages.size;
      const replaceCount = rows.length - addCount;
      byId("stitchThemeInfo").textContent = `目标：${target.label || target.name} · 源：${source.label || source.name}`;
      setState("stitchThemeState", "已选择", "is-ready");
      byId("stitchCatalogInfo").textContent = `可新增 ${addCount} 个 · 可覆盖 ${replaceCount} 个`;
      renderRows();
      loadAppLabels(generation);
      log(`主题图标比较完成 · 新增 ${addCount} 个 · 可覆盖 ${replaceCount} 个`);
    } catch (error) {
      if (generation !== catalogGeneration) return;
      setState("stitchThemeState", "读取失败", "is-error");
      byId("stitchThemeInfo").textContent = error.message;
      notify(`读取图标缝合目录失败：${error.message}`);
    } finally {
      if (generation === catalogGeneration) {
        catalogBusy = false;
        updateSelectionState();
      }
    }
  }

  async function scanThemes(refreshCatalog = true) {
    const targetBefore = byId("stitchTarget").value || localStorage.getItem("hip-stitch-target") || "";
    const sourceBefore = byId("stitchSource").value || localStorage.getItem("hip-stitch-source") || "";
    try {
      themes = (await exec("scan_cache")).split(/\r?\n/).filter(Boolean).map((line) => {
        const [name, size, mtime, label] = line.split("\t");
        return { name, size: Number(size), mtime: Number(mtime), label: decodeLabel(label) };
      });
      populateThemeSelect(byId("stitchTarget"), targetBefore || themes[0]?.name || "");
      let sourceName = sourceBefore || themes.find((theme) => theme.name !== byId("stitchTarget").value)?.name || "";
      if (sourceName === byId("stitchTarget").value) sourceName = themes.find((theme) => theme.name !== sourceName)?.name || "";
      populateThemeSelect(byId("stitchSource"), sourceName);
      updateThemeOptionStates();
      scanned = true;
      if (refreshCatalog) await loadCatalog();
    } catch (error) {
      themes = [];
      populateThemeSelect(byId("stitchTarget"), "");
      populateThemeSelect(byId("stitchSource"), "");
      setState("stitchThemeState", "扫描失败", "is-error");
      notify(`主题扫描失败：${error.message}`);
    }
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    return btoa(binary);
  }

  async function applyStitch() {
    if (applying || !catalog || !selectedPairIsValid()) return;
    const target = selectedTheme("stitchTarget");
    const source = selectedTheme("stitchSource");
    const counts = selectionCounts();
    if (!counts.total) return notify("请至少选择一个要缝合的图标");
    if (!confirm(`请确认本次图标缝合：\n\n目标主题：${target.label || target.name}\n源主题：${source.label || source.name}\n新增图标：${counts.added} 个\n覆盖已有：${counts.replaced} 个\n\n源主题不会被修改。`)) return;
    applying = true;
    setState("stitchApplyState", "处理中", "is-busy");
    byId("stitchResult").hidden = true;
    updateSelectionState();
    let sessionId = "";
    try {
      sessionId = (await exec("stitch_begin", target.name, source.name, catalog.targetFingerprint, catalog.sourceFingerprint)).replace(/^OK:/, "");
      const manifest = `${[...selectedPackages].sort().join("\n")}\n`;
      const encoded = bytesToBase64(new TextEncoder().encode(manifest));
      for (let offset = 0; offset < encoded.length; offset += 48000) {
        await exec("stitch_upload_chunk", sessionId, encoded.slice(offset, offset + 48000));
      }
      const lines = (await exec("stitch_apply", sessionId)).split(/\r?\n/);
      sessionId = "";
      const result = lines[0].split(":");
      const selected = Number(result[1] || 0);
      const added = Number(result[2] || 0);
      const replaced = Number(result[3] || 0);
      byId("stitchResult").textContent = `已将“${source.label || source.name}”中的 ${selected} 个图标缝合到“${target.label || target.name}”：新增 ${added} 个，覆盖 ${replaced} 个。`;
      byId("stitchResult").hidden = false;
      setState("stitchApplyState", "已完成", "is-ready");
      window.HIPToast?.("图标缝合完成");
      log(`图标缝合完成 · 新增 ${added} 个 · 覆盖 ${replaced} 个`);
      await scanThemes(true);
    } catch (error) {
      if (sessionId) await exec("stitch_clear", sessionId).catch(() => {});
      setState("stitchApplyState", "缝合失败", "is-error");
      notify(`图标缝合失败：${error.message}`);
    } finally {
      applying = false;
      updateSelectionState();
    }
  }

  byId("stitchTarget").onchange = () => { invalidateResult(); loadCatalog(); };
  byId("stitchSource").onchange = () => { invalidateResult(); loadCatalog(); };
  byId("stitchSwap").onclick = () => {
    const target = byId("stitchTarget").value;
    byId("stitchTarget").value = byId("stitchSource").value;
    byId("stitchSource").value = target;
    invalidateResult();
    loadCatalog();
  };
  byId("stitchKind").onchange = renderRows;
  let searchTimer;
  byId("stitchSearch").oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderRows, 120);
  };
  byId("stitchSelectVisible").onclick = () => {
    visibleRows().forEach((row) => selectedPackages.add(row.packageName));
    invalidateResult();
    renderRows();
  };
  byId("stitchClearSelection").onclick = () => {
    selectedPackages.clear();
    invalidateResult();
    renderRows();
  };
  byId("stitchApply").onclick = applyStitch;
  byId("stitchOpenTheme").onclick = async () => {
    try { await exec("open_theme_manager"); }
    catch (error) { notify(`无法打开主题商店：${error.message}`); }
  };

  window.addEventListener("hip-workspace-changed", (event) => {
    if (event.detail?.mode === "stitch" && !scanned) scanThemes(true);
  });
  if (window.HIPWorkspace?.current() === "stitch" && !scanned) scanThemes(true);
})();
