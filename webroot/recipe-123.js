(() => {
  const byId = (id) => document.getElementById(id);
  const script = "/data/adb/modules/hyper_icon_patcher/scripts/backend.sh";
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  let callbackIndex = 0;
  let objectUrls = [];

  function notify(message) {
    if (window.HIPNotify) window.HIPNotify(message);
    else window.alert(message);
  }

  function log(message) {
    const target = byId("log");
    target.textContent = `[${new Date().toLocaleTimeString()}] ${message}\n${target.textContent}`.slice(0, 6000);
  }

  function exec(operation, ...args) {
    return new Promise((resolve, reject) => {
      const callback = `hip_recipe_${Date.now()}_${callbackIndex++}`;
      const timer = setTimeout(() => {
        delete window[callback];
        reject(new Error("设备命令响应超时"));
      }, 60000);
      window[callback] = (errno, stdout, stderr) => {
        clearTimeout(timer);
        delete window[callback];
        const output = String(stdout || "").trim();
        if (errno !== 0 || output.startsWith("ERROR:")) reject(new Error(output.replace(/^ERROR:/, "") || stderr || `命令失败：${errno}`));
        else resolve(output);
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

  function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function readIcon(packageName) {
    const size = Number(await exec("prepare_recipe", packageName));
    if (!Number.isFinite(size) || size <= 0) throw new Error("图标文件为空");
    const chunks = [];
    const chunkSize = 240000;
    for (let offset = 0; offset < size; offset += chunkSize) {
      chunks.push(await exec("read_chunk", String(offset), String(Math.min(chunkSize, size - offset))));
    }
    return decodeBase64(chunks.join("").replace(/\s/g, ""));
  }

  function selectedComponent() {
    return byId("cacheSelect")?.value || "";
  }

  function drawablePrefix() {
    return window.HIP?.drawablePrefix?.() || "";
  }

  async function deleteOnly(packageName) {
    if (!confirm(`仅删除 ${packageName} 的自定义配置？\n当前主题文件不会立即改变。`)) return;
    await exec("recipe_delete", packageName);
    log(`已删除自定义配置：${packageName}（已移入回收站）`);
    await refresh();
  }

  async function deleteAndRestore(packageName) {
    const component = selectedComponent();
    const prefix = drawablePrefix();
    if (!component || !prefix) throw new Error("请先加载需要恢复的主题商店组件作为基础");
    if (!confirm(`删除 ${packageName} 的配置并恢复当前主题？\n已适配图标将恢复原图，未适配新增图标将被移除。`)) return;
    const result = await exec("recipe_delete_and_build", component, packageName, prefix);
    let patch;
    try {
      patch = await exec("patch_cache", component);
    } catch (error) {
      try {
        await exec("recipe_undo_delete", packageName);
      } catch (rollbackError) {
        throw new Error(`主题写入失败，且配置自动恢复失败：${rollbackError.message}`);
      }
      throw new Error(`主题写入失败，配置已自动恢复：${error.message}`);
    }
    log(`已删除并恢复 ${packageName}，剩余配置 ${result.split(":")[1] || 0} 个，备份：${patch.replace(/^OK:/, "")}`);
    await refresh();
    byId("cacheReload")?.click();
  }

  async function refresh() {
    const button = byId("recipeReload");
    button.disabled = true;
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
    try {
      const rows = (await exec("recipe_list_detail")).split(/\r?\n/).filter(Boolean).map((line) => {
        const [packageName, size, mtime] = line.split("\t");
        return { packageName, size: Number(size), mtime: Number(mtime) };
      });
      byId("recipeInfo").textContent = `已保存 ${rows.length} 个自定义图标`;
      byId("recipeEmpty").hidden = rows.length > 0;
      const nodes = await Promise.all(rows.map(async (row) => {
        const item = document.createElement("div");
        item.className = "recipe-item";
        const head = document.createElement("div");
        head.className = "recipe-head";
        const image = document.createElement("img");
        image.alt = "";
        try {
          const bytes = await readIcon(row.packageName);
          const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
          objectUrls.push(url);
          image.src = url;
        } catch {
          image.src = `ksu://icon/${row.packageName}`;
        }
        const meta = document.createElement("div");
        meta.className = "recipe-meta";
        const name = document.createElement("strong");
        name.textContent = row.packageName;
        const detail = document.createElement("small");
        const mode = window.HIP?.recipeMode?.(row.packageName);
        const modeText = mode === "replace" ? "替换主题原图" : mode === "add" ? "新增未适配图标" : "加载主题后识别类型";
        detail.textContent = `${modeText} · ${Math.round(row.size / 1024)} KB · ${new Date(row.mtime * 1000).toLocaleString()}`;
        meta.append(name, detail);
        head.append(image, meta);
        const actions = document.createElement("div");
        actions.className = "recipe-actions";
        const remove = document.createElement("button");
        remove.className = "danger";
        remove.textContent = "仅删除配置";
        remove.onclick = async () => {
          remove.disabled = true;
          try { await deleteOnly(row.packageName); } catch (error) { notify(`删除失败：${error.message}`); }
          finally { remove.disabled = false; }
        };
        const restore = document.createElement("button");
        restore.textContent = "删除并恢复主题";
        restore.onclick = async () => {
          restore.disabled = true;
          try { await deleteAndRestore(row.packageName); } catch (error) { notify(`恢复失败：${error.message}`); }
          finally { restore.disabled = false; }
        };
        actions.append(remove, restore);
        item.append(head, actions);
        return item;
      }));
      byId("recipeList").replaceChildren(...nodes);
    } catch (error) {
      byId("recipeInfo").textContent = "自定义图标读取失败";
      notify(`读取配置失败：${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

  byId("recipeReload").addEventListener("click", refresh);
  window.addEventListener("hip-recipes-changed", refresh);
  setTimeout(refresh, 1000);
})();
