const BACKEND_SCRIPT = "/data/adb/modules/hyper_icon_patcher/scripts/backend.sh";
let callbackSequence = 0;

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

function timeoutFor(operation) {
  if (operation === "fast_patch") return 240000;
  if (["group_clone", "recipe_delete_batch", "maintenance"].includes(operation)) return 180000;
  if (operation === "scan_cache") return 90000;
  return 60000;
}

// All WebUI modules use one callback/error contract so timeout and shell errors stay consistent.
export function execBackend(operation, ...args) {
  return new Promise((resolve, reject) => {
    const callback = `hip_backend_${Date.now()}_${callbackSequence++}`;
    const timer = setTimeout(() => {
      delete window[callback];
      reject(new Error("设备命令响应超时，请稍后重试"));
    }, timeoutFor(operation));
    window[callback] = (errno, stdout, stderr) => {
      clearTimeout(timer);
      delete window[callback];
      const output = String(stdout || "").trim();
      const errorLine = output.split(/\r?\n/).find((line) => line.startsWith("ERROR:"));
      if (errno !== 0 || errorLine) {
        reject(new Error((errorLine || output).replace(/^ERROR:/, "") || stderr || `命令失败：${errno}`));
      } else {
        resolve(output);
      }
    };
    try {
      ksu.exec(["sh", BACKEND_SCRIPT, operation, ...args.map(quote)].join(" "), "{}", callback);
    } catch (error) {
      clearTimeout(timer);
      delete window[callback];
      reject(error);
    }
  });
}
