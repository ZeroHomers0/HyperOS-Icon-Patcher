(() => {
  (() => {
    var m = 0;
    function D(u) {
      return `${u}_callback_${Date.now()}_${m++}`;
    }
    function f(u, e) {
      return typeof e > "u" && (e = {}), new Promise((a, n) => {
        let r = D("exec");
        let timeout = setTimeout(() => {
          s(r);
          n(new Error("设备命令响应超时，请稍后重试"));
        }, 6e4);
        window[r] = (c, F, $) => {
          clearTimeout(timeout), a({ errno: c, stdout: F, stderr: $ }), s(r);
        };
        function s(c) {
          clearTimeout(timeout);
          delete window[c];
        }
        try {
          ksu.exec(u, JSON.stringify(e), r);
        } catch (c) {
          n(c), s(r);
        }
      });
    }
    function d() {
      this.listeners = {};
    }
    d.prototype.on = function(u, e) {
      this.listeners[u] || (this.listeners[u] = []), this.listeners[u].push(e);
    }, d.prototype.emit = function(u, ...e) {
      this.listeners[u] && this.listeners[u].forEach((a) => a(...e));
    };
    function A() {
      this.listeners = {}, this.stdin = new d(), this.stdout = new d(), this.stderr = new d();
    }
    A.prototype.on = function(u, e) {
      this.listeners[u] || (this.listeners[u] = []), this.listeners[u].push(e);
    }, A.prototype.emit = function(u, ...e) {
      this.listeners[u] && this.listeners[u].forEach((a) => a(...e));
    };
    var w = "/data/adb/modules/hyper_icon_patcher/scripts/backend.sh", t = (u) => document.getElementById(u), i = [], p = (u) => `'${String(u).replaceAll("'", "'\\''")}'`;
    async function l(u, ...e) {
      let a = await f(["sh", w, u, ...e.map(p)].join(" ")), n = String(a.stdout || "").trim();
      if (a.errno !== 0 || n.startsWith("ERROR:")) throw new Error(n || a.stderr || `\u547D\u4EE4\u5931\u8D25\uFF1A${a.errno}`);
      return n;
    }
    function o(u) {
      let e = t("log");
      e.textContent = `[${(/* @__PURE__ */ new Date()).toLocaleTimeString()}] ${u}
${e.textContent}`.slice(0, 6e3);
    }
    function E(u) {
      o(u);
      if (window.HIPNotify) window.HIPNotify(u);
      else window.alert(u);
    }
    function B(u) {
      return u >= 1048576 ? `${(u / 1048576).toFixed(1)} MB` : `${Math.round(u / 1024)} KB`;
    }
    function g(u) {
      if (!u) return "";
      try {
        return new TextDecoder().decode(Uint8Array.from(atob(u), (e) => e.charCodeAt(0)));
      } catch {
        return "";
      }
    }
    function h() {
      let u = i.find((a) => a.name === t("cacheSelect").value), e = u?.status === "changed" ? "\u5DF2\u88AB\u5546\u5E97\u66F4\u65B0\u8986\u76D6" : u?.status === "patched" ? "\u81EA\u5B9A\u4E49\u7248\u672C\u5DF2\u5199\u5165" : "\u672A\u4FEE\u6539";
      t("cacheSelectedInfo").textContent = u ? `\u4E3B\u9898\uFF1A${u.label || "\u672A\u77E5\u4E3B\u9898"} \xB7 ${B(u.size)} \xB7 ${e} \xB7 ${new Date(u.mtime * 1e3).toLocaleString()}` : "\u8BF7\u9009\u62E9\u4E00\u4E2A\u4E3B\u9898\u5546\u5E97\u56FE\u6807\u7EC4\u4EF6";
    }
    async function C(notifyOnFailure = false) {
      const startedAt = Date.now();
      t("cacheReload").disabled = true;
      try {
        i = (await l("scan_cache")).split(/\r?\n/).filter(Boolean).map((e) => {
          let [a, n, r, s, c] = e.split("	");
          return { name: a, size: Number(n), mtime: Number(r), status: s || "new", label: g(c) };
        }), t("cacheSelect").replaceChildren(...i.map((e, a) => {
          let n = document.createElement("option"), r = e.status === "changed" ? "\u5DF2\u66F4\u65B0" : e.status === "patched" ? "\u5DF2\u81EA\u5B9A\u4E49" : "\u672A\u4FEE\u6539";
          return n.value = e.name, n.textContent = `${a === 0 ? "\u6700\u8FD1 \xB7 " : ""}${e.label || "\u672A\u77E5\u4E3B\u9898"} \xB7 ${r} \xB7 ${B(e.size)}`, n;
        }));
        let u = localStorage.getItem("hip-last-component");
        u && i.some((e) => e.name === u) && (t("cacheSelect").value = u), t("cacheInfo").textContent = i.length ? `\u53D1\u73B0 ${i.length} \u4E2A\u7EC4\u4EF6\uFF0C\u5DF2\u6309\u66F4\u65B0\u65F6\u95F4\u6392\u5E8F` : "\u6CA1\u6709\u53D1\u73B0\u7EC4\u4EF6\uFF0C\u8BF7\u5148\u4ECE\u4E3B\u9898\u5546\u5E97\u4E0B\u8F7D\u4E00\u4E2A\u56FE\u6807\u4E3B\u9898", h(), o(`组件扫描完成 · ${i.length} 个 · ${Date.now() - startedAt}ms`);
      } catch (u) {
        i = [], t("cacheInfo").textContent = u.message, o(`\u7F13\u5B58\u626B\u63CF\u5931\u8D25\uFF1A${u.message}`);
        if (notifyOnFailure) {
          if (window.HIPNotify) window.HIPNotify(`缓存扫描失败：${u.message}`);
          else window.alert(`缓存扫描失败：${u.message}`);
        }
      } finally {
        t("cacheReload").disabled = false;
      }
    }
    t("cacheSelect").addEventListener("change", h), t("cacheReload").addEventListener("click", () => C(true)), t("cacheLoad").addEventListener("click", async () => {
      let u = t("cacheSelect").value;
      if (!u) return E("\u8BF7\u5148\u9009\u62E9\u4E00\u4E2A\u5546\u5E97\u56FE\u6807\u7EC4\u4EF6");
      {
        t("cacheLoad").disabled = true, t("cacheLoad").textContent = "\u52A0\u8F7D\u4E2D\u2026";
        try {
          let e = Number(await l("prepare_cache", u));
          if (!Number.isFinite(e) || e <= 0) throw new Error("\u7EC4\u4EF6\u4E3A\u7A7A\u6216\u65E0\u6CD5\u8BFB\u53D6");
          if (e > 112e6) throw new Error("组件过大，超过 WebUI 安全读取限制");
          let a = 24e4, n = [];
          for (let F = 0; F < e; F += a) n.push(await l("read_chunk", String(F), String(Math.min(a, e - F)))), t("cacheLoad").textContent = `\u52A0\u8F7D ${Math.min(100, Math.round((F + a) / e * 100))}%`;
          if (!window.HIP?.loadCacheSource) throw new Error("\u4E3B\u9875\u7EC4\u4EF6\u5C1A\u672A\u5C31\u7EEA");
          let r = i.find((F) => F.name === u);
          window.HIP.loadCacheSource(n.join("").replace(/\s/g, ""), r?.label || "\u672A\u77E5\u4E3B\u9898", u), localStorage.setItem("hip-last-component", u), o("\u5546\u5E97\u7EC4\u4EF6\u5DF2\u4F5C\u4E3A\u56FE\u6807\u57FA\u7840\u52A0\u8F7D");
          let s = t("selectedTheme"), c = document.createElement("strong");
          c.textContent = r?.label || "\u672A\u77E5\u4E3B\u9898", s.replaceChildren(c, document.createElement("br"), "\u72B6\u6001\uFF1A\u5DF2\u52A0\u8F7D\u4E3A\u56FE\u6807\u57FA\u7840");
        } catch (e) {
          E(`\u52A0\u8F7D\u5546\u5E97\u7EC4\u4EF6\u5931\u8D25\uFF1A${e.message}`);
        } finally {
          t("cacheLoad").disabled = false, t("cacheLoad").textContent = "\u52A0\u8F7D\u9009\u4E2D\u7EC4\u4EF6\u4F5C\u4E3A\u57FA\u7840", h();
        }
      }
    }), t("cachePatch").addEventListener("click", async () => {
      let u = t("cacheSelect").value;
      if (!u) return E("\u8BF7\u5148\u9009\u62E9\u8981\u5199\u5165\u7684\u5546\u5E97\u56FE\u6807\u7EC4\u4EF6");
      if (!window.HIP?.validatePatch) return E("\u4E3B\u9875\u7EC4\u4EF6\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
      let e = window.HIP?.validatePatch?.(u);
      if (e) return E(e);
      {
        t("cachePatch").disabled = true;
        try {
          let a = await l("patch_cache", u);
          o(`\u5546\u5E97\u7EC4\u4EF6\u5199\u5165\u6210\u529F\uFF0C\u5907\u4EFD\uFF1A${a.replace(/^OK:/, "")}`), o("\u4E0B\u4E00\u6B65\uFF1A\u6253\u5F00\u4E3B\u9898\u5546\u5E97\uFF0C\u5728\u201C\u6211\u7684\uFF0F\u56FE\u6807\u201D\u4E2D\u5E94\u7528\u521A\u624D\u9009\u62E9\u7684\u5360\u4F4D\u4E3B\u9898"), await C();
        } catch (a) {
          E(`\u5546\u5E97\u7EC4\u4EF6\u5199\u5165\u5931\u8D25\uFF1A${a.message}`);
        } finally {
          t("cachePatch").disabled = false, h();
        }
      }
    }), t("cacheMerge").addEventListener("click", async () => {
      let u = t("cacheSelect").value;
      if (!u) return E("\u8BF7\u5148\u9009\u62E9\u4E00\u4E2A\u5DF2\u66F4\u65B0\u7684\u5546\u5E97\u56FE\u6807\u7EC4\u4EF6");
      if (i.find((e) => e.name === u)?.status !== "changed") return E("\u53EA\u6709\u68C0\u6D4B\u5230\u4E3B\u9898\u5546\u5E97\u66F4\u65B0\u540E\uFF0C\u624D\u9700\u8981\u6267\u884C\u66F4\u65B0\u5408\u5E76");
      {
        t("cacheMerge").disabled = true, t("cacheMerge").textContent = "\u6B63\u5728\u5408\u5E76\u2026";
        try {
          let e = (await l("fast_merge", u)).split(":"), a = Number(e[1] || 0), n = Number(e[2] || 0), r = await l("patch_cache", u);
          o(`更新合并已写入：主题新版优先，补回 ${n} 个，跳过冲突 ${Math.max(0, a - n)} 个，已使用手机端快速合并，备份：${r.replace(/^OK:/, "")}`), await C();
        } catch (e) {
          E(`\u66F4\u65B0\u5408\u5E76\u5931\u8D25\uFF1A${e.message}`);
        } finally {
          t("cacheMerge").disabled = false, t("cacheMerge").textContent = "\u5408\u5E76\u4E3B\u9898\u66F4\u65B0\u4E0E\u81EA\u5B9A\u4E49\u56FE\u6807", h();
        }
      }
    }), t("cacheRestore").addEventListener("click", async () => {
      let u = t("cacheSelect").value;
      if (!u) return E("\u8BF7\u5148\u9009\u62E9\u8981\u6062\u590D\u7684\u5546\u5E97\u56FE\u6807\u7EC4\u4EF6");
      {
        t("cacheRestore").disabled = true;
        try {
          let e = await l("restore_cache", u);
          o(`\u5DF2\u6062\u590D\u5546\u5E97\u7EC4\u4EF6\uFF1A${e.replace(/^OK:/, "")}`), await C();
        } catch (e) {
          E(`\u6062\u590D\u5931\u8D25\uFF1A${e.message}`);
        } finally {
          t("cacheRestore").disabled = false, h();
        }
      }
    }), t("cacheOpen").addEventListener("click", async () => {
      try {
        await l("open_theme_manager"), o("\u5DF2\u8BF7\u6C42\u6253\u5F00\u4E3B\u9898\u5546\u5E97");
      } catch (u) {
        E(`\u65E0\u6CD5\u6253\u5F00\u4E3B\u9898\u5546\u5E97\uFF1A${u.message}`);
      }
    }), setTimeout(C, 800);
  })();
})();
