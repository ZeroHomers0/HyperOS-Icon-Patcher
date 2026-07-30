(() => {
  const byId = (id) => document.getElementById(id);
  const script = "/data/adb/modules/hyper_icon_patcher/scripts/backend.sh";
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  let callbackIndex = 0;
  let groups = [];
  let objectUrls = [];
  let selectedPackages = new Set();
  let previewObserver;
  let activeGroupId = "";
  let deleting = false;

  const notify = (message) => window.HIPNotify ? window.HIPNotify(message, true) : window.alert(message);
  function exec(operation, ...args) {
    return new Promise((resolve, reject) => {
      const callback = `hip_group_${Date.now()}_${callbackIndex++}`;
      const timeoutMs = ["group_clone", "recipe_delete_batch", "maintenance"].includes(operation) ? 180000 : 60000;
      const timer = setTimeout(() => { delete window[callback]; reject(new Error("设备命令响应超时")); }, timeoutMs);
      window[callback] = (errno, stdout, stderr) => {
        clearTimeout(timer);
        delete window[callback];
        const output = String(stdout || "").trim();
        if (errno !== 0 || output.startsWith("ERROR:")) reject(new Error(output.replace(/^ERROR:/, "") || stderr || `命令失败：${errno}`));
        else resolve(output);
      };
      try { ksu.exec(["sh", script, operation, ...args.map(quote)].join(" "), "{}", callback); }
      catch (error) { clearTimeout(timer); delete window[callback]; reject(error); }
    });
  }

  function decode(value) {
    try { return new TextDecoder().decode(Uint8Array.from(atob(value || ""), (char) => char.charCodeAt(0))); }
    catch { return ""; }
  }

  function checkedGroupName(value) {
    const name = String(value || "").trim();
    if (!name) throw new Error("请输入修补组名称");
    if (Array.from(name).length > 40) throw new Error("修补组名称最多 40 个字符");
    if (new TextEncoder().encode(name).length > 120) throw new Error("修补组名称编码后不能超过 120 字节");
    if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("修补组名称不能包含控制字符");
    return name;
  }

  function selectedId() {
    return byId("groupSelect")?.value || "";
  }

  function selectedGroup() {
    return groups.find((group) => group.id === selectedId());
  }

  function selectGroup(id) {
    if (!groups.some((group) => group.id === id)) id = "";
    byId("groupSelect").value = id;
    if (id) localStorage.setItem("hip-last-group", id);
    else localStorage.removeItem("hip-last-group");
    const group = selectedGroup();
    byId("groupInfo").textContent = group ? `${group.name} · ${group.count} 个图标` : "请选择或创建修补组";
    byId("groupStepState").textContent = group ? `${group.count} 个图标` : "未选择";
    byId("groupStepState").className = `step-state${group ? " is-ready" : ""}`;
    if (id !== activeGroupId) {
      activeGroupId = id;
      window.dispatchEvent(new Event("hip-patch-input-changed"));
    }
    window.dispatchEvent(new CustomEvent("hip-group-changed", { detail: group || null }));
    renderGroupList();
    if (byId("recipeManager").open) refreshIcons();
  }

  function renderGroupList() {
    const active = selectedId();
    byId("groupList").replaceChildren(...groups.map((group) => {
      const item = document.createElement("div");
      item.className = `group-item${group.id === active ? " is-active" : ""}`;
      const meta = document.createElement("div");
      meta.className = "group-item-meta";
      const name = document.createElement("strong");
      name.textContent = group.name;
      const detail = document.createElement("small");
      detail.textContent = `${group.count} 个图标`;
      meta.append(name, detail);
      meta.onclick = () => selectGroup(group.id);
      const actions = document.createElement("div");
      actions.className = "group-item-actions";
      const rename = Object.assign(document.createElement("button"), { textContent: "重命名" });
      rename.onclick = async () => {
        const input = prompt("修补组名称", group.name);
        if (input === null) return;
        try {
          const value = checkedGroupName(input);
          if (value === group.name) return;
          await exec("group_rename", group.id, value);
          await refreshGroups(group.id);
        }
        catch (error) { notify(`重命名失败：${error.message}`); }
      };
      const clone = Object.assign(document.createElement("button"), { textContent: "复制" });
      clone.onclick = async () => {
        const input = prompt("新修补组名称", `${group.name} 副本`);
        if (input === null) return;
        try {
          const value = checkedGroupName(input);
          const id = (await exec("group_clone", group.id, value)).replace(/^OK:/, "");
          await refreshGroups(id);
        } catch (error) { notify(`复制失败：${error.message}`); }
      };
      const remove = Object.assign(document.createElement("button"), { textContent: "删除", className: "danger" });
      remove.onclick = async () => {
        if (!confirm(`删除修补组“${group.name}”及其中 ${group.count} 个图标？`)) return;
        try { await exec("group_delete", group.id); await refreshGroups(); }
        catch (error) { notify(`删除修补组失败：${error.message}`); }
      };
      actions.append(rename, clone, remove);
      item.append(meta, actions);
      return item;
    }));
  }

  async function refreshGroups(preferredId = "") {
    groups = (await exec("group_list")).split(/\r?\n/).filter(Boolean).map((line) => {
      const [id, name64, count, mtime] = line.split("\t");
      return { id, name: decode(name64) || "未命名修补组", count: Number(count), mtime: Number(mtime) };
    });
    byId("groupSelect").replaceChildren(
      Object.assign(document.createElement("option"), { value: "", textContent: groups.length ? "请选择修补组" : "尚未创建修补组" }),
      ...groups.map((group) => Object.assign(document.createElement("option"), {
        value: group.id,
        textContent: `${group.name} · ${group.count} 个`
      }))
    );
    const candidate = preferredId || selectedId() || localStorage.getItem("hip-last-group") || groups[0]?.id || "";
    selectGroup(candidate);
  }

  function decodeBase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  async function readIcon(packageName, groupId) {
    const encoded = await exec("recipe_preview", groupId, packageName);
    if (!encoded) throw new Error("图标文件为空");
    return decodeBase64(encoded.replace(/\s/g, ""));
  }

  function resetPreviews() {
    previewObserver?.disconnect();
    previewObserver = undefined;
    objectUrls.forEach(URL.revokeObjectURL);
    objectUrls = [];
  }

  async function loadPreview(image, row, groupId) {
    if (selectedId() !== groupId) return;
    try {
      const bytes = await readIcon(row.packageName, groupId);
      if (selectedId() !== groupId || !image.isConnected) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      objectUrls.push(url);
      image.src = url;
      image.dataset.previewLoaded = "true";
    } catch {}
  }

  function startPreviewObserver(groupId) {
    previewObserver?.disconnect();
    previewObserver = undefined;
    if (!("IntersectionObserver" in window) || document.body.classList.contains("keyboard-open")) return false;
    // 键盘改变可视区域时暂停观察；关闭后仅恢复尚未读取的预览。
    previewObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        previewObserver?.unobserve(entry.target);
        const row = entry.target._hipRow;
        if (row) loadPreview(entry.target, row, groupId);
      }
    }, { root: byId("recipeManager"), rootMargin: "120px" });
    byId("recipeList").querySelectorAll("img:not([data-preview-loaded=true])")
      .forEach((image) => previewObserver.observe(image));
    return true;
  }

  function updateBatchBar(total) {
    byId("recipeBatchDelete").disabled = selectedPackages.size === 0;
    byId("recipeBatchDelete").textContent = selectedPackages.size ? `删除所选（${selectedPackages.size}）` : "删除所选";
    byId("recipeSelectAll").checked = total > 0 && selectedPackages.size === total;
    byId("recipeSelectAll").indeterminate = selectedPackages.size > 0 && selectedPackages.size < total;
  }

  async function removePackages(packages) {
    if (deleting) return;
    const group = selectedGroup();
    if (!group) throw new Error("请先选择修补组");
    if (!confirm(`从修补组“${group.name}”中删除 ${packages.length} 个图标？`)) return;
    deleting = true;
    byId("recipeBatchDelete").disabled = true;
    try {
      resetPreviews();
      await exec("recipe_delete_batch", group.id, packages.join(","));
      selectedPackages.clear();
      window.HIPToast?.(`已从“${group.name}”删除 ${packages.length} 个图标`);
      window.dispatchEvent(new Event("hip-patch-input-changed"));
      await refreshGroups(group.id);
    } finally {
      deleting = false;
      byId("recipeBatchDelete").disabled = selectedPackages.size === 0;
    }
  }

  async function refreshIcons() {
    const group = selectedGroup();
    resetPreviews();
    selectedPackages.clear();
    if (!group) {
      byId("recipeInfo").textContent = "创建或选择修补组";
      byId("recipeEmpty").hidden = false;
      byId("recipeList").replaceChildren();
      updateBatchBar(0);
      return;
    }
    const button = byId("recipeReload");
    button.disabled = true;
    try {
      const rows = (await exec("recipe_list_detail", group.id)).split(/\r?\n/).filter(Boolean).map((line) => {
        const [packageName, size, mtime] = line.split("\t");
        return { packageName, size: Number(size), mtime: Number(mtime) };
      });
      byId("recipeInfo").textContent = `${group.name} · ${rows.length} 个自定义图标`;
      byId("recipeEmpty").hidden = rows.length > 0;
      const nodes = [];
      for (const row of rows) {
        const item = document.createElement("div");
        item.className = "recipe-item";
        const head = document.createElement("div");
        head.className = "recipe-head";
        const checkbox = Object.assign(document.createElement("input"), { type: "checkbox" });
        checkbox.onchange = () => {
          checkbox.checked ? selectedPackages.add(row.packageName) : selectedPackages.delete(row.packageName);
          updateBatchBar(rows.length);
        };
        const image = document.createElement("img");
        image.src = `ksu://icon/${row.packageName}`;
        image._hipRow = row;
        const meta = document.createElement("div");
        meta.className = "recipe-meta";
        const name = document.createElement("strong");
        name.textContent = row.packageName;
        const detail = document.createElement("small");
        detail.textContent = `${Math.round(row.size / 1024)} KB · ${new Date(row.mtime * 1000).toLocaleString()}`;
        meta.append(name, detail);
        const remove = Object.assign(document.createElement("button"), { textContent: "删除", className: "danger compact-button" });
        remove.onclick = async () => {
          try { await removePackages([row.packageName]); }
          catch (error) { notify(`删除失败：${error.message}`); }
        };
        head.append(checkbox, image, meta, remove);
        item.append(head);
        nodes.push(item);
      }
      byId("recipeList").replaceChildren(...nodes);
      if (!startPreviewObserver(group.id) && !document.body.classList.contains("keyboard-open")) {
        byId("recipeList").querySelectorAll("img").forEach((image) => loadPreview(image, image._hipRow, group.id));
      }
      updateBatchBar(rows.length);
    } catch (error) { notify(`读取组内图标失败：${error.message}`); }
    finally { button.disabled = false; }
  }

  byId("groupSelect").onchange = () => selectGroup(byId("groupSelect").value);
  byId("groupCreate").onclick = async () => {
    try {
      const name = checkedGroupName(byId("newGroupName").value);
      const id = (await exec("group_create", name)).replace(/^OK:/, "");
      byId("newGroupName").value = "";
      await refreshGroups(id);
      window.HIPCloseSheet?.("groupCreator");
    } catch (error) { notify(`创建失败：${error.message}`); }
  };
  byId("newGroupName").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      byId("groupCreate").click();
    }
  });
  byId("recipeReload").onclick = refreshIcons;
  byId("recipeBatchDelete").onclick = async () => {
    try { await removePackages([...selectedPackages]); }
    catch (error) { notify(`批量删除失败：${error.message}`); }
  };
  byId("recipeSelectAll").onchange = () => {
    document.querySelectorAll("#recipeList input[type=checkbox]").forEach((checkbox) => {
      checkbox.checked = byId("recipeSelectAll").checked;
      checkbox.dispatchEvent(new Event("change"));
    });
  };
  window.addEventListener("hip-recipes-changed", async () => {
    await refreshGroups(selectedId());
  });
  window.addEventListener("hip-keyboard-changed", (event) => {
    if (event.detail?.open) {
      previewObserver?.disconnect();
      return;
    }
    const group = selectedGroup();
    if (group && byId("recipeManager").open) startPreviewObserver(group.id);
  });
  window.HIPGroups = {
    selectedId,
    selectedName: () => selectedGroup()?.name || "",
    selectedCount: () => selectedGroup()?.count || 0,
    refresh: refreshGroups
  };
  (async () => {
    try {
      const result = await exec("maintenance");
      const cleaned = result.match(/cleaned=(\d+)/)?.[1] || "0";
      const recovered = result.match(/recovered=(\d+)/)?.[1] || "0";
      const dataKb = Number(result.match(/data_kb=(\d+)/)?.[1] || 0);
      const log = byId("log");
      log.textContent = `[${new Date().toLocaleTimeString()}] 启动维护完成 · 清理 ${cleaned} 项 · 恢复 ${recovered} 项 · 数据占用 ${(dataKb / 1024).toFixed(1)}MB\n${log.textContent}`.slice(0, 6000);
      await refreshGroups();
    } catch (error) {
      notify(`模块数据维护失败：${error.message}`);
      await refreshGroups().catch(() => {});
    }
  })();
})();
