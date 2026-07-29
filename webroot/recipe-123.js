(() => {
  const byId = (id) => document.getElementById(id);
  const script = "/data/adb/modules/hyper_icon_patcher/scripts/backend.sh";
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  let callbackIndex = 0;
  let objectUrls = [];
  let selectedPackages = new Set();

  const identity = () => window.HIP?.themeIdentity?.() || "";
  const notify = (message) => window.HIPNotify ? window.HIPNotify(message, true) : window.alert(message);
  function exec(operation, ...args) {
    return new Promise((resolve, reject) => {
      const callback = `hip_recipe_${Date.now()}_${callbackIndex++}`;
      const timer = setTimeout(() => { delete window[callback]; reject(new Error("设备命令响应超时")); }, 60000);
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

  function decodeBase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  async function readIcon(packageName, themeIdentity) {
    const size = Number(await exec("prepare_recipe", packageName, themeIdentity));
    if (!Number.isFinite(size) || size <= 0) throw new Error("图标文件为空");
    const chunks = [];
    for (let offset = 0; offset < size; offset += 240000) {
      chunks.push(await exec("read_chunk", String(offset), String(Math.min(240000, size - offset))));
    }
    return decodeBase64(chunks.join("").replace(/\s/g, ""));
  }

  function updateBatchBar(total) {
    byId("recipeBatchDelete").disabled = selectedPackages.size === 0;
    byId("recipeBatchDelete").textContent = selectedPackages.size ? `删除所选（${selectedPackages.size}）` : "删除所选";
    byId("recipeSelectAll").checked = total > 0 && selectedPackages.size === total;
    byId("recipeSelectAll").indeterminate = selectedPackages.size > 0 && selectedPackages.size < total;
  }

  async function removePackages(packages) {
    const themeIdentity = identity();
    if (!themeIdentity) throw new Error("请先加载待修补主题");
    if (!confirm(`从当前主题的自定义图标中删除 ${packages.length} 项？\n已写入主题的内容不会立即改变。`)) return;
    for (const packageName of packages) await exec("recipe_delete", packageName, themeIdentity);
    selectedPackages.clear();
    await refresh();
  }

  async function refresh() {
    const themeIdentity = identity();
    objectUrls.forEach(URL.revokeObjectURL);
    objectUrls = [];
    selectedPackages.clear();
    if (!themeIdentity) {
      byId("recipeInfo").textContent = "请先加载待修补主题";
      byId("recipeEmpty").hidden = false;
      byId("recipeList").replaceChildren();
      updateBatchBar(0);
      return;
    }
    const button = byId("recipeReload");
    button.disabled = true;
    try {
      const rows = (await exec("recipe_list_detail", themeIdentity)).split(/\r?\n/).filter(Boolean).map((line) => {
        const [packageName, size, mtime] = line.split("\t");
        return { packageName, size: Number(size), mtime: Number(mtime) };
      });
      byId("recipeInfo").textContent = `当前主题 · ${rows.length} 个自定义图标`;
      byId("recipeEmpty").hidden = rows.length > 0;
      const nodes = await Promise.all(rows.map(async (row) => {
        const item = document.createElement("div");
        item.className = "recipe-item";
        const head = document.createElement("div");
        head.className = "recipe-head";
        const checkbox = Object.assign(document.createElement("input"), { type: "checkbox" });
        checkbox.addEventListener("change", () => {
          checkbox.checked ? selectedPackages.add(row.packageName) : selectedPackages.delete(row.packageName);
          updateBatchBar(rows.length);
        });
        const image = document.createElement("img");
        try {
          const bytes = await readIcon(row.packageName, themeIdentity);
          const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
          objectUrls.push(url);
          image.src = url;
        } catch { image.src = `ksu://icon/${row.packageName}`; }
        const meta = document.createElement("div");
        meta.className = "recipe-meta";
        const name = document.createElement("strong");
        name.textContent = row.packageName;
        const detail = document.createElement("small");
        detail.textContent = `${Math.round(row.size / 1024)} KB · ${new Date(row.mtime * 1000).toLocaleString()}`;
        meta.append(name, detail);
        const actions = document.createElement("div");
        actions.className = "recipe-actions";
        const remove = document.createElement("button");
        remove.className = "danger compact-button";
        remove.textContent = "删除";
        remove.onclick = async () => {
          try { await removePackages([row.packageName]); }
          catch (error) { notify(`删除失败：${error.message}`); }
        };
        actions.append(remove);
        head.append(checkbox, image, meta, actions);
        item.append(head);
        return item;
      }));
      byId("recipeList").replaceChildren(...nodes);
      updateBatchBar(rows.length);
    } catch (error) {
      notify(`读取自定义图标失败：${error.message}`);
    } finally { button.disabled = false; }
  }

  byId("recipeReload").addEventListener("click", refresh);
  byId("recipeBatchDelete").addEventListener("click", async () => {
    try { await removePackages([...selectedPackages]); }
    catch (error) { notify(`批量删除失败：${error.message}`); }
  });
  byId("recipeSelectAll").addEventListener("change", () => {
    document.querySelectorAll("#recipeList input[type=checkbox]").forEach((checkbox) => {
      checkbox.checked = byId("recipeSelectAll").checked;
      checkbox.dispatchEvent(new Event("change"));
    });
  });
  window.addEventListener("hip-recipes-changed", refresh);
  window.addEventListener("hip-theme-loaded", refresh);
})();
