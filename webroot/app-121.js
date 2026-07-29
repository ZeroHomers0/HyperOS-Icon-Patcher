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
    var q = "/data/adb/modules/hyper_icon_patcher/scripts/backend.sh", c = (e) => document.getElementById(e), i = { apps: [], selected: /* @__PURE__ */ new Map(), iconsZip: null, sourceName: "", sourceLabel: "", builtIcons: null, builtOnDevice: false, builtSourceName: "", selectionVersion: 0, builtSelectionVersion: -1 }, K = (e) => `'${String(e).replaceAll("'", "'\\''")}'`;
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
    var U = new TextEncoder(), W = new TextDecoder(), m = (e, t) => e.getUint16(t, true), w = (e, t) => e.getUint32(t, true);
    function B(...e) {
      let t = new Uint8Array(e.reduce((n, r) => n + r.length, 0)), u = 0;
      for (let n of e) t.set(n, u), u += n.length;
      return t;
    }
    function Q(e) {
      for (let t = e.length - 22; t >= Math.max(0, e.length - 65557); t--) if (e[t] === 80 && e[t + 1] === 75 && e[t + 2] === 5 && e[t + 3] === 6) return t;
      throw new Error("\u4E0D\u662F\u53D7\u652F\u6301\u7684 ZIP/MTZ \u6587\u4EF6");
    }
    function E(e) {
      let t = new DataView(e.buffer, e.byteOffset, e.byteLength), u = Q(e), n = m(t, u + 10), r = w(t, u + 16);
      if (n === 65535 || r === 4294967295) throw new Error("\u6682\u4E0D\u652F\u6301 ZIP64 \u4E3B\u9898");
      let l = [], a = r;
      for (let o = 0; o < n; o++) {
        if (w(t, a) !== 33639248) throw new Error("ZIP \u4E2D\u592E\u76EE\u5F55\u635F\u574F");
        let s = m(t, a + 28), p = m(t, a + 30), F = m(t, a + 32), D = 46 + s + p + F;
        l.push({ name: W.decode(e.slice(a + 46, a + 46 + s)), method: m(t, a + 10), compressedSize: w(t, a + 20), size: w(t, a + 24), localOffset: w(t, a + 42), central: e.slice(a, a + D) }), a += D;
      }
      return { entries: l, centralOffset: r };
    }
    var C;
    function $(e) {
      if (!C) {
        C = new Uint32Array(256);
        for (let u = 0; u < 256; u++) {
          let n = u;
          for (let r = 0; r < 8; r++) n = n & 1 ? 3988292384 ^ n >>> 1 : n >>> 1;
          C[u] = n >>> 0;
        }
      }
      let t = 4294967295;
      for (let u of e) t = C[(t ^ u) & 255] ^ t >>> 8;
      return (t ^ 4294967295) >>> 0;
    }
    function N(e, t) {
      let u = new Uint8Array(30 + e.length + t.length), n = new DataView(u.buffer);
      return n.setUint32(0, 67324752, true), n.setUint16(4, 20, true), n.setUint16(6, 2048, true), n.setUint32(14, $(t), true), n.setUint32(18, t.length, true), n.setUint32(22, t.length, true), n.setUint16(26, e.length, true), u.set(e, 30), u.set(t, 30 + e.length), u;
    }
    function x(e, t, u) {
      let n = new Uint8Array(46 + e.length), r = new DataView(n.buffer);
      return r.setUint32(0, 33639248, true), r.setUint16(4, 20, true), r.setUint16(6, 20, true), r.setUint16(8, 2048, true), r.setUint32(16, $(t), true), r.setUint32(20, t.length, true), r.setUint32(24, t.length, true), r.setUint16(28, e.length, true), r.setUint32(42, u, true), n.set(e, 46), n;
    }
    function v(e, t, u) {
      let n = new Uint8Array(22), r = new DataView(n.buffer);
      return r.setUint32(0, 101010256, true), r.setUint16(8, e, true), r.setUint16(10, e, true), r.setUint32(12, t, true), r.setUint32(16, u, true), n;
    }
    function ie(e, t, u) {
      let n = E(e), r = e.slice(0, n.centralOffset), l = U.encode(t), a = N(l, u), o = n.entries.filter((p) => p.name !== t).map((p) => p.central);
      o.push(x(l, u, r.length));
      let s = B(...o);
      return B(r, a, s, v(o.length, s.length, r.length + a.length));
    }
    function k(e, t) {
      let u = E(e), n = e.slice(0, u.centralOffset), r = new Set(t.map((p) => p.name)), l = u.entries.filter((p) => !r.has(p.name)).map((p) => p.central), a = [], o = n.length;
      for (let p of t) {
        let F = U.encode(p.name), D = N(F, p.data);
        a.push(D), l.push(x(F, p.data, o)), o += D.length;
      }
      let s = B(...l);
      return B(n, ...a, s, v(l.length, s.length, o));
    }
    function L(e) {
      let t = E(e).entries.map((u) => u.name.match(/^(.*res\/drawable[^/]*\/)/)?.[1]).filter(Boolean);
      return t.find((u) => /drawable-nodpi-v4/.test(u)) || t.find((u) => /drawable-nodpi/.test(u)) || t.find((u) => /drawable-xxhdpi/.test(u)) || t.find((u) => /drawable-xhdpi/.test(u)) || t[0] || "res/drawable-nodpi-v4/";
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
    function I(e) {
      let t = atob(e), u = new Uint8Array(t.length);
      for (let n = 0; n < t.length; n++) u[n] = t.charCodeAt(n);
      return u;
    }
    function isArgumentLimitError(e) {
      return /argument list too long|参数列表过长/i.test(String(e?.message || e));
    }
    async function uploadInChunks(e, t, u, n, r) {
      let l = _(r), a = [96e3, 48e3, 24e3, 12e3], o;
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
    async function M(e, t) {
      await uploadInChunks("upload_begin", "upload_chunk", "upload_commit", e, t);
    }
    async function Y(e, t) {
      await uploadInChunks("recipe_upload_begin", "recipe_upload_chunk", "recipe_upload_commit", e, t);
    }
    async function ee(e) {
      let t = Number(await f("prepare_recipe", e));
      if (!Number.isFinite(t) || t <= 0) throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u5DF2\u4FDD\u5B58\u56FE\u6807\uFF1A${e}`);
      let u = 24e4, n = [];
      for (let r = 0; r < t; r += u) n.push(await f("read_chunk", String(r), String(Math.min(u, t - r))));
      return I(n.join("").replace(/\s/g, ""));
    }
    function y(e, t) {
      for (let u of t) {
        let n = e.match(new RegExp(`<${u}[^>]*>([\\s\\S]*?)<\\/${u}>`, "i"));
        if (n) return n[1].replace(/<!\\[CDATA\\[|\\]\\]>/g, "").trim();
      }
      return "";
    }
    function V(e, t, u, n = "", r = "icons") {
      let l = y(n, ["title", "name"]) || t || "\u5F53\u524D\u6D3B\u52A8\u4E3B\u9898", a = y(n, ["author", "designer"]), o = y(n, ["version"]), s = [`<strong>${g(l)}</strong>`, `\u6765\u6E90\uFF1A${g(e)}`, `\u56FE\u6807\u4E3B\u9898\uFF1A${g(r)} \xB7 ${(u / 1048576).toFixed(1)} MB`];
      a && s.push(`\u4F5C\u8005\uFF1A${g(a)}`), o && s.push(`\u7248\u672C\uFF1A${g(o)}`), c("selectedTheme").innerHTML = s.join("<br>");
    }
    function g(e) {
      let t = document.createElement("div");
      return t.textContent = e, t.innerHTML;
    }
    const APP_CACHE_KEY = "hip-user-apps-v2";
    const APP_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1e3;
    let appIconObserver;
    function readAppCache() {
      try {
        const value = JSON.parse(localStorage.getItem(APP_CACHE_KEY) || "null");
        if (!value || !Array.isArray(value.apps) || !Array.isArray(value.packages)) return null;
        if (value.apps.length > 5000 || value.packages.length > 5000) return null;
        if (!value.apps.every((app) => typeof app?.packageName === "string" && typeof app?.appLabel === "string")) return null;
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
        if ((!Array.isArray(e) || !e.length) && (e = (await f("list_apps")).split(/\r?\n/).filter(Boolean)), e = [...new Set(e.filter(Boolean))], !e.length) throw new Error("\u672A\u8BFB\u53D6\u5230\u7528\u6237\u5E94\u7528");
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
        const byPackage = new Map(details.filter((app) => app?.packageName).map((app) => [app.packageName, app]));
        let t = e.map((packageName) => byPackage.get(packageName) || ({ packageName, appLabel: packageName, isSystem: false }));
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
          URL.revokeObjectURL(t.url), i.selected.delete(e), i.selectionVersion++, Z();
        }, u;
      }));
    }
    async function ue() {
      if (!i.iconsZip) throw new Error("\u8BF7\u5148\u52A0\u8F7D\u4E00\u4E2A\u4E3B\u9898\u5546\u5E97\u56FE\u6807\u4E3B\u9898");
      if (!i.selected.size) throw new Error("\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u5E94\u7528\u56FE\u6807");
      let e = i.iconsZip, t = L(e), u = [], n = E(e).entries;
      await f("recipe_begin");
      for (let [r, l] of i.selected) {
        let a;
        try {
          a = await X(l.file);
        } catch (o) {
          throw new Error(`图标“${l.label}”（${r}，文件：${l.file.name || "未知"}）无法解码：${o.message}`);
        }
        let o = n.filter((s) => s.name.endsWith(`/${r}.png`) && /(^|\/)res\/drawable[^/]*\//.test(s.name)).map((s) => s.name);
        o.length || (o = [`${t}${r}.png`]);
        for (let s of o) u.push({ name: s, data: a });
        await Y(r, a), h(`已加入：${l.label} · ${Math.round(a.length / 1024)}KB · 写入 ${o.length} 个实际条目`);
      }
      await f("recipe_finish", i.sourceLabel || i.sourceName), window.dispatchEvent(new Event("hip-recipes-changed"));
      let r = await f("fast_build", i.sourceName, t);
      if (r.startsWith("OK")) {
        i.builtIcons = null, i.builtOnDevice = true, i.builtSourceName = i.sourceName, i.builtSelectionVersion = i.selectionVersion, h(`已添加为自定义图标：${i.selected.size} 个`);
        return;
      }
      h(`${r.replace(/^FALLBACK:/, "手机端快速生成不可用：")}，正在回退兼容写入链路`);
      e = k(e, u), E(e), i.builtIcons = e, i.builtOnDevice = false, i.builtSourceName = i.sourceName, i.builtSelectionVersion = i.selectionVersion, await M("active", e), h(`已添加为自定义图标：${i.selected.size} 个 · 已使用兼容处理链路`);
    }
    function R() {
      return new Promise((e, t) => {
        let u = indexedDB.open("hyper-icon-patcher", 1);
        u.onupgradeneeded = () => u.result.createObjectStore("state"), u.onsuccess = () => e(u.result), u.onerror = () => t(u.error);
      });
    }
    async function ne(e, t, u) {
      let n = await R();
      await new Promise((r, l) => {
        let a = n.transaction("state", "readwrite");
        a.objectStore("state").put({ bytes: e.slice().buffer, label: t, name: u, savedAt: Date.now() }, "lastSource"), a.oncomplete = r, a.onerror = () => l(a.error);
      }), n.close();
    }
    async function re() {
      try {
        let e = await R(), t = await new Promise((n, r) => {
          let l = e.transaction("state").objectStore("state").get("lastSource");
          l.onsuccess = () => n(l.result), l.onerror = () => r(l.error);
        });
        if (e.close(), !t?.bytes) return false;
        let u = new Uint8Array(t.bytes);
        return E(u), i.iconsZip = u, i.sourceName = t.name || "", i.sourceLabel = t.label || t.name || "", i.builtIcons = null, i.builtOnDevice = false, V("\u4E0A\u6B21\u52A0\u8F7D\u4E3B\u9898", t.label, u.length, "", t.label), h(`\u5DF2\u81EA\u52A8\u6062\u590D\u4E0A\u6B21\u4E3B\u9898\uFF1A${t.label}`), window.dispatchEvent(new CustomEvent("hip-theme-loaded", { detail: { name: i.sourceName, label: i.sourceLabel } })), true;
      } catch (e) {
        return h(`\u4E0A\u6B21\u4E3B\u9898\u6062\u590D\u5931\u8D25\uFF1A${e.message}`), false;
      }
    }
    window.HIP = { loadCacheSource(e, t, u = "") {
      let n = I(e);
      E(n), i.iconsZip = n, i.sourceName = u, i.sourceLabel = t || u, i.builtIcons = null, i.builtOnDevice = false, i.builtSourceName = "", i.builtSelectionVersion = -1, V("\u4E3B\u9898\u5546\u5E97\u4E3B\u9898", t, n.length, "", t), h(`\u5DF2\u52A0\u8F7D\u5546\u5E97\u4E3B\u9898\uFF1A${t}`), ne(n, t, u).catch((r) => h(`\u4E3B\u9898\u6301\u4E45\u5316\u5931\u8D25\uFF1A${r.message}`)), window.dispatchEvent(new CustomEvent("hip-theme-loaded", { detail: { name: u, label: i.sourceLabel } }));
    }, drawablePrefix() {
      return i.iconsZip ? L(i.iconsZip) : "";
    }, themeIdentity() {
      return i.sourceLabel || i.sourceName || "";
    }, recipeMode(e) {
      if (!i.iconsZip) return "unknown";
      return E(i.iconsZip).entries.some((t) => t.name.match(/\/res\/drawable[^/]*\/|^res\/drawable[^/]*\//) && t.name.endsWith(`/${e}.png`)) ? "replace" : "add";
    }, flowStatus() {
      let e = !!i.builtIcons || i.builtOnDevice;
      return { sourceLoaded: !!i.iconsZip, sourceName: i.sourceName, iconCount: i.selected.size, resultReady: e, resultCurrent: e && i.builtSelectionVersion === i.selectionVersion };
    }, validatePatch(e) {
      if (!i.iconsZip) return "\u8BF7\u5148\u52A0\u8F7D\u9009\u4E2D\u7684\u5546\u5E97\u56FE\u6807\u4E3B\u9898";
      if (!i.builtIcons && !i.builtOnDevice) return "\u8BF7\u5148\u6DFB\u52A0\u4E3A\u81EA\u5B9A\u4E49\u56FE\u6807";
      if (i.builtSelectionVersion !== i.selectionVersion) return "\u56FE\u6807\u9009\u62E9\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u91CD\u65B0\u6DFB\u52A0\u4E3A\u81EA\u5B9A\u4E49\u56FE\u6807";
      return !e || i.builtSourceName !== e ? "\u5F53\u524D\u9009\u4E2D\u4E3B\u9898\u4E0E\u5904\u7406\u7ED3\u679C\u4E0D\u5339\u914D\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D" : "";
    } }, c("iconInput").onchange = async (e) => {
      let t = e.target.files?.[0];
      if (!t || !b) return;
      let u = new Uint8Array(await t.slice(0, 8).arrayBuffer()), n = u.length === 8 && u[0] === 137 && u[1] === 80 && u[2] === 78 && u[3] === 71 && u[4] === 13 && u[5] === 10 && u[6] === 26 && u[7] === 10;
      if (t.type !== "image/png" || !/\.png$/i.test(t.name) || !n) {
        G("\u9009\u62E9\u5931\u8D25\uFF1A\u4EC5\u652F\u6301\u771F\u5B9E\u7684 PNG \u56FE\u7247"), e.target.value = "";
        return;
      }
      let r = i.selected.get(b.packageName);
      r && URL.revokeObjectURL(r.url), i.selected.set(b.packageName, { file: t, label: b.appLabel || "\u5E94\u7528", url: URL.createObjectURL(t) }), i.selectionVersion++, Z();
    }, (() => {
      let searchTimer;
      c("search").oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(O, 120);
      };
    })(), c("reloadApps").onclick = P, c("buildBtn").onclick = async () => {
      A(c("buildBtn"), true);
      try {
        await ue();
      } catch (e) {
        G(`\u6DFB\u52A0\u5931\u8D25\uFF1A${e.message}`);
      } finally {
        A(c("buildBtn"), false);
      }
    }, re(), setTimeout(P, 0);
  })();
})();
