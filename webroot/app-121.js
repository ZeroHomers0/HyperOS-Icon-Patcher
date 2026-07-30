(() => {
  (() => {
    var j = 0;
    function T(e) {
      return `${e}_callback_${Date.now()}_${j++}`;
    }
    function z(e, t) {
      return typeof t > "u" && (t = {}), new Promise((u, n) => {
        let r = T("exec");
        let timeout = setTimeout(() => {
          l(r);
          n(new Error("设备命令响应超时，请稍后重试"));
        }, 6e4);
        window[r] = (a, o, s) => {
          clearTimeout(timeout), u({ errno: a, stdout: o, stderr: s }), l(r);
        };
        function l(a) {
          clearTimeout(timeout);
          delete window[a];
        }
        try {
          ksu.exec(e, JSON.stringify(t), r);
        } catch (a) {
          n(a), l(r);
        }
      });
    }
    function d() {
      this.listeners = {};
    }
    d.prototype.on = function(e, t) {
      this.listeners[e] || (this.listeners[e] = []), this.listeners[e].push(t);
    }, d.prototype.emit = function(e, ...t) {
      this.listeners[e] && this.listeners[e].forEach((u) => u(...t));
    };
    function S() {
      this.listeners = {}, this.stdin = new d(), this.stdout = new d(), this.stderr = new d();
    }
    S.prototype.on = function(e, t) {
      this.listeners[e] || (this.listeners[e] = []), this.listeners[e].push(t);
    }, S.prototype.emit = function(e, ...t) {
      this.listeners[e] && this.listeners[e].forEach((u) => u(...t));
    };
    function H(e) {
      try {
        return typeof e != "string" && (e = JSON.stringify(e)), JSON.parse(ksu.getPackagesInfo(e));
      } catch {
        return [];
      }
    }
    function J(e) {
      try {
        return JSON.parse(ksu.listPackages(e));
      } catch {
        return [];
      }
    }
    var q = "/data/adb/modules/hyper_icon_patcher/scripts/backend.sh", c = (e) => document.getElementById(e), i = { apps: [], selected: /* @__PURE__ */ new Map(), sourcePrefix: "", sourceName: "" }, K = (e) => `'${String(e).replaceAll("'", "'\\''")}'`;
    async function f(e, ...t) {
      let u = await z(["sh", q, e, ...t.map(K)].join(" ")), n = String(u.stdout || "").trim();
      if (u.errno !== 0 || n.startsWith("ERROR:")) throw new Error(n || u.stderr || `\u547D\u4EE4\u5931\u8D25\uFF1A${u.errno}`);
      return n;
    }
    function h(e) {
      let t = c("log");
      t.textContent = `[${(/* @__PURE__ */ new Date()).toLocaleTimeString()}] ${e}
${t.textContent}`.slice(0, 6e3);
    }
    function G(e) {
      h(e);
      if (window.HIPNotify) window.HIPNotify(e);
      else window.alert(e);
    }
    function A(e, t, u = "\u5904\u7406\u4E2D\u2026") {
      t ? (e.dataset.label = e.textContent, e.textContent = u, e.disabled = true) : (e.textContent = e.dataset.label || e.textContent, e.disabled = false);
    }
    async function decodeImage(e) {
      let t;
      try {
        t = await createImageBitmap(e);
        if (t.width > 0 && t.height > 0) return t;
        t.close?.();
      } catch {
      }
      let u = URL.createObjectURL(e);
      try {
        let n = new Image();
        await new Promise((r, l) => {
          n.onload = r, n.onerror = () => l(new Error("浏览器无法解码该图片")), n.src = u;
        });
        if (!n.naturalWidth || !n.naturalHeight) throw new Error("图片尺寸无效");
        return n;
      } finally {
        URL.revokeObjectURL(u);
      }
    }
    async function X(e) {
      let t = await decodeImage(e), u = Math.max(t.width, t.height), n = Math.min(u, 512), r = document.createElement("canvas");
      for (; n >= 48; ) {
        r.width = r.height = n;
        let l = r.getContext("2d");
        l.clearRect(0, 0, n, n);
        let a = Math.min(n / t.width, n / t.height), o = Math.round(t.width * a), s = Math.round(t.height * a);
        l.drawImage(t, Math.round((n - o) / 2), Math.round((n - s) / 2), o, s);
        let p = await new Promise((F) => r.toBlob(F, "image/png"));
        if (p && p.size <= 50 * 1024) return t.close?.(), new Uint8Array(await p.arrayBuffer());
        n = Math.floor(n * 0.85);
      }
      throw t.close?.(), new Error("\u56FE\u6807\u65E0\u6CD5\u538B\u7F29\u5230 50KB \u4EE5\u5185");
    }
    function _(e) {
      let t = "";
      for (let u = 0; u < e.length; u += 32768) t += String.fromCharCode(...e.subarray(u, u + 32768));
      return btoa(t);
    }
    function isArgumentLimitError(e) {
      return /argument list too long|参数列表过长/i.test(String(e?.message || e));
    }
    async function uploadInChunks(e, t, u, n, r) {
      let l = _(r), a = [48e3, 24e3, 12e3], o;
      for (let s = 0; s < a.length; s++) {
        let p = a[s];
        try {
          await f(e, n);
          for (let F = 0; F < l.length; F += p) await f(t, n, l.slice(F, F + p));
          return await f(u, n);
        } catch (F) {
          if (o = F, !isArgumentLimitError(F) || s === a.length - 1) throw F;
          h(`设备命令参数受限，已将上传分块缩小到 ${Math.round(a[s + 1] / 1e3)}KB 并重新传输`);
        }
      }
      throw o;
    }
    async function Y(e, t) {
      await uploadInChunks("recipe_upload_begin", "recipe_upload_chunk", "recipe_upload_commit", e, t);
    }
    const APP_CACHE_KEY = "hip-user-apps-v2";
    const APP_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1e3;
    const APP_CACHE_MAX_ITEMS = 5000;
    let appIconObserver;
    function validPackageName(value) {
      return typeof value === "string" && value.length > 0 && value.length <= 255 && !/^[.-]/.test(value) && /^[A-Za-z0-9._-]+$/.test(value);
    }
    function normalizedApp(app, fallbackPackage = "") {
      const packageName = validPackageName(app?.packageName) ? app.packageName : fallbackPackage;
      if (!validPackageName(packageName)) return null;
      const rawLabel = typeof app?.appLabel === "string" ? app.appLabel.trim() : "";
      return {
        packageName,
        appLabel: (rawLabel || packageName).slice(0, 256),
        isSystem: Boolean(app?.isSystem)
      };
    }
    function readAppCache() {
      try {
        const value = JSON.parse(localStorage.getItem(APP_CACHE_KEY) || "null");
        if (!value || !Array.isArray(value.apps) || !Array.isArray(value.packages)) return null;
        if (value.apps.length > APP_CACHE_MAX_ITEMS || value.packages.length > APP_CACHE_MAX_ITEMS) return null;
        if (!value.packages.every(validPackageName)) return null;
        if (!value.apps.every((app) => validPackageName(app?.packageName) && typeof app?.appLabel === "string" && app.appLabel.length <= 256)) return null;
        if (Date.now() - Number(value.savedAt || 0) > APP_CACHE_MAX_AGE) return null;
        return value;
      } catch {
        return null;
      }
    }
    function writeAppCache(packages, apps) {
      try {
        localStorage.setItem(APP_CACHE_KEY, JSON.stringify({ packages, apps, savedAt: Date.now() }));
      } catch (error) {
        h(`应用缓存写入失败：${error.message}`);
      }
    }
    function samePackages(left, right) {
      if (left.length !== right.length) return false;
      const expected = new Set(left);
      return right.every((name) => expected.has(name));
    }
    function nextFrame() {
      return new Promise((resolve) => requestAnimationFrame(resolve));
    }
    async function P() {
      const startedAt = Date.now();
      A(c("reloadApps"), true);
      try {
        let e = await Promise.resolve(J("user"));
        if ((!Array.isArray(e) || !e.length) && (e = (await f("list_apps")).split(/\r?\n/).filter(Boolean)), e = [...new Set(e.filter(validPackageName))], !e.length) throw new Error("\u672A\u8BFB\u53D6\u5230\u7528\u6237\u5E94\u7528");
        if (e.length > APP_CACHE_MAX_ITEMS) {
          h(`应用数量 ${e.length} 超过安全上限，仅加载前 ${APP_CACHE_MAX_ITEMS} 个`);
          e = e.slice(0, APP_CACHE_MAX_ITEMS);
        }
        const cached = readAppCache();
        if (cached && samePackages(cached.packages, e)) {
          i.apps = cached.apps;
          O();
          h(`已从缓存加载 ${i.apps.length} 个应用 · ${Date.now() - startedAt}ms`);
          return;
        }
        if (cached?.apps?.length) {
          i.apps = cached.apps;
          O();
        }
        c("appCount").textContent = `\u6B63\u5728\u8BFB\u53D6 ${e.length} \u4E2A\u5E94\u7528\u4FE1\u606F`;
        const details = [];
        const batchSize = 40;
        for (let offset = 0; offset < e.length; offset += batchSize) {
          const packageBatch = e.slice(offset, offset + batchSize);
          const batch = await Promise.resolve(H(packageBatch));
          if (Array.isArray(batch)) details.push(...batch);
          c("appCount").textContent = `正在读取应用信息 ${Math.min(offset + batchSize, e.length)}/${e.length}`;
          await nextFrame();
        }
        const byPackage = new Map(details.map((app) => normalizedApp(app)).filter(Boolean).map((app) => [app.packageName, app]));
        let t = e.map((packageName) => normalizedApp(byPackage.get(packageName), packageName));
        i.apps = t.filter((u) => u?.packageName && !u.isSystem).sort((u, n) => (u.appLabel || "").localeCompare(n.appLabel || "", "zh-CN"));
        writeAppCache(e, i.apps);
        O();
        h(`应用列表加载完成 · ${i.apps.length} 个 · ${Date.now() - startedAt}ms`);
      } catch (e) {
        c("appCount").textContent = "\u5E94\u7528\u5217\u8868\u8BFB\u53D6\u5931\u8D25";
        G(`\u5E94\u7528\u5217\u8868\u8BFB\u53D6\u5931\u8D25\uFF1A${e.message}`);
      } finally {
        A(c("reloadApps"), false);
      }
    }
    function O() {
      let e = c("search").value.trim().toLowerCase(), t = i.apps.filter((u) => `${u.appLabel} ${u.packageName}`.toLowerCase().includes(e));
      appIconObserver?.disconnect();
      if ("IntersectionObserver" in window) {
        appIconObserver = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const image = entry.target;
            image.src = image.dataset.src;
            delete image.dataset.src;
            appIconObserver.unobserve(image);
          }
        }, { root: c("appList"), rootMargin: "120px" });
      }
      c("appCount").textContent = `\u7528\u6237\u5E94\u7528 ${i.apps.length} \u4E2A`, c("appList").replaceChildren(...t.map((u) => {
        let n = document.createElement("button");
        n.className = "app";
        let r = document.createElement("img");
        r.className = "app-icon";
        r.alt = "";
        if (appIconObserver) {
          r.dataset.src = `ksu://icon/${u.packageName}`;
          appIconObserver.observe(r);
        } else {
          r.loading = "lazy";
          r.src = `ksu://icon/${u.packageName}`;
        }
        let l = document.createElement("span");
        return l.className = "app-name", l.textContent = u.appLabel || "\u672A\u547D\u540D\u5E94\u7528", n.append(r, l), n.addEventListener("click", () => te(u)), n;
      }));
    }
    var b = null;
    function te(e) {
      b = e, c("iconInput").value = "", c("iconInput").click();
    }
    function Z() {
      c("selectionEmpty").hidden = i.selected.size > 0, c("selectionList").replaceChildren(...[...i.selected.entries()].map(([e, t]) => {
        let u = document.createElement("div");
        return u.className = "selection", u.innerHTML = '<img><div class="selection-meta"><strong></strong><small>\u5C06\u81EA\u52A8\u5339\u914D\u5E94\u7528</small></div><button class="remove">\u5220\u9664</button>', u.querySelector("img").src = t.url, u.querySelector("strong").textContent = t.label, u.querySelector("button").onclick = () => {
          URL.revokeObjectURL(t.url), i.selected.delete(e), Z();
        }, u;
      })), c("selectionCount").textContent = `\u5DF2\u9009\u62E9 ${i.selected.size} \u4E2A`, c("clearSelection").disabled = i.selected.size === 0, c("iconsStepState").textContent = `${i.selected.size} \u4E2A\u5F85\u6DFB\u52A0`, c("iconsStepState").className = `step-state${i.selected.size ? " is-ready" : ""}`;
    }
    function clearPendingIcons() {
      for (let e of i.selected.values()) URL.revokeObjectURL(e.url);
      i.selected.clear(), Z();
    }
    async function ue() {
      let groupId = window.HIPGroups?.selectedId?.();
      if (!groupId) throw new Error("\u8BF7\u5148\u521B\u5EFA\u5E76\u9009\u62E9\u4E00\u4E2A\u4FEE\u8865\u7EC4");
      if (!i.selected.size) throw new Error("\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u5E94\u7528\u56FE\u6807");
      let iconCount = i.selected.size, groupName = window.HIPGroups?.selectedName?.() || "\u5F53\u524D\u4FEE\u8865\u7EC4";
      await f("recipe_begin");
      for (let [r, l] of i.selected) {
        let a;
        try {
          a = await X(l.file);
        } catch (o) {
          throw new Error(`图标“${l.label}”（${r}，文件：${l.file.name || "未知"}）无法解码：${o.message}`);
        }
        await Y(r, a), h(`已加入修补组：${l.label} · ${Math.round(a.length / 1024)}KB`);
      }
      await f("recipe_finish", groupId), window.dispatchEvent(new Event("hip-recipes-changed")), window.dispatchEvent(new Event("hip-patch-input-changed"));
      await f("clear_recipe_stage").catch(() => {});
      h(`已添加到修补组“${groupName}”：${iconCount} 个图标`), window.HIPToast?.(`已添加 ${iconCount} 个图标到“${groupName}”`), clearPendingIcons();
    }
    window.HIP = { loadCacheIndex(e, t, u = "") {
      if (!e || typeof e.prefix !== "string") throw new Error("\u4E3B\u9898\u7D22\u5F15\u65E0\u6548");
      i.sourcePrefix = e.prefix, i.sourceName = u, h(`\u5DF2\u5728\u624B\u673A\u7AEF\u8BFB\u53D6\u4E3B\u9898\u7D22\u5F15\uFF1A${t}`), window.dispatchEvent(new CustomEvent("hip-theme-loaded", { detail: { name: u, label: t || u } }));
    }, drawablePrefix() {
      return i.sourcePrefix;
    }, flowStatus() {
      return { sourceLoaded: !!i.sourceName && !!i.sourcePrefix, sourceName: i.sourceName, iconCount: i.selected.size };
    } }, c("iconInput").onchange = async (e) => {
      let t = e.target.files?.[0];
      if (!t || !b) return;
      if (t.size <= 0 || t.size > 20 * 1024 * 1024) {
        G("\u9009\u62E9\u5931\u8D25\uFF1A\u6E90 PNG \u6587\u4EF6\u4E0D\u80FD\u8D85\u8FC7 20MB"), e.target.value = "";
        return;
      }
      let u = new Uint8Array(await t.slice(0, 24).arrayBuffer()), n = u.length >= 24 && u[0] === 137 && u[1] === 80 && u[2] === 78 && u[3] === 71 && u[4] === 13 && u[5] === 10 && u[6] === 26 && u[7] === 10 && u[8] === 0 && u[9] === 0 && u[10] === 0 && u[11] === 13 && u[12] === 73 && u[13] === 72 && u[14] === 68 && u[15] === 82;
      if (t.type !== "image/png" || !/\.png$/i.test(t.name) || !n) {
        G("\u9009\u62E9\u5931\u8D25\uFF1A\u4EC5\u652F\u6301\u771F\u5B9E\u7684 PNG \u56FE\u7247"), e.target.value = "";
        return;
      }
      let pngView = new DataView(u.buffer, u.byteOffset, u.byteLength), pngWidth = pngView.getUint32(16), pngHeight = pngView.getUint32(20);
      if (!pngWidth || !pngHeight || pngWidth > 8192 || pngHeight > 8192 || pngWidth * pngHeight > 16777216) {
        G("\u9009\u62E9\u5931\u8D25\uFF1APNG \u5C3A\u5BF8\u8FC7\u5927\u6216\u5F02\u5E38"), e.target.value = "";
        return;
      }
      if (!i.selected.has(b.packageName) && i.selected.size >= 500) {
        G("\u9009\u62E9\u5931\u8D25\uFF1A\u5355\u6B21\u6700\u591A\u6DFB\u52A0 500 \u4E2A\u56FE\u6807"), e.target.value = "";
        return;
      }
      let r = i.selected.get(b.packageName);
      r && URL.revokeObjectURL(r.url), i.selected.set(b.packageName, { file: t, label: b.appLabel || "\u5E94\u7528", url: URL.createObjectURL(t) }), Z();
    }, (() => {
      let searchTimer;
      c("search").oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(O, 120);
      };
    })(), c("reloadApps").onclick = P, c("clearSelection").onclick = clearPendingIcons, c("buildBtn").onclick = async () => {
      if (!window.HIPGroups?.selectedId?.()) {
        G("\u6DFB\u52A0\u5931\u8D25\uFF1A\u8BF7\u5148\u521B\u5EFA\u5E76\u9009\u62E9\u4FEE\u8865\u7EC4");
        return;
      }
      A(c("buildBtn"), true);
      try {
        await ue();
      } catch (e) {
        await f("clear_recipe_stage").catch(() => {});
        G(`\u6DFB\u52A0\u5931\u8D25\uFF1A${e.message}`);
      } finally {
        A(c("buildBtn"), false);
      }
    }, setTimeout(P, 0);
  })();
})();
