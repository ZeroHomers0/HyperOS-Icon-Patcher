import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const html = read("webroot/index.html");
const backend = read("scripts/backend.sh");
const files = {
  "webroot/ui-101.js": /byId\("([^"]+)"\)/g,
  "webroot/cache-101.js": /byId\("([^"]+)"\)/g,
  "webroot/recipe-123.js": /byId\("([^"]+)"\)/g,
  "webroot/stitch-160.js": /byId\("([^"]+)"\)/g,
  "webroot/workspace-160.js": /byId\("([^"]+)"\)/g,
  "webroot/app-121.js": /\bc\("([^"]+)"\)/g
};

const idMatches = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const ids = new Set(idMatches);
if (ids.size !== idMatches.length) throw new Error("duplicate DOM id detected");

for (const [file, pattern] of Object.entries(files)) {
  const source = read(file);
  for (const match of source.matchAll(pattern)) {
    if (!ids.has(match[1])) throw new Error(`${file} references missing DOM id ${match[1]}`);
  }
}

for (const match of html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))(?:\?v=(\d+))?/g)) {
  if (!fs.existsSync(`webroot/${match[1]}`)) throw new Error(`missing WebUI asset ${match[1]}`);
}
if (!html.includes('id="groupCreator"') || !html.includes('class="sheet-scroll"')) {
  throw new Error("mobile sheet structure is incomplete");
}
const ui = read("webroot/ui-101.js");
if (!ui.includes("visualViewport") || !ui.includes("hip-keyboard-changed")) {
  throw new Error("keyboard viewport contract is missing");
}
if (!ui.includes("history.pushState") || !ui.includes('addEventListener("popstate"')) {
  throw new Error("secondary-page back-navigation contract is missing");
}
const styles = read("webroot/style-110.css");
if (!styles.includes("height: 100%;")) {
  throw new Error("stable mobile sheet geometry contract is missing");
}
if (!styles.includes("body.sheet-open::before")) {
  throw new Error("mobile sheet background mask contract is missing");
}
if (!styles.includes("@media screen") || !styles.includes("(pointer: fine)")) {
  throw new Error("phone-first sheet media contract is missing");
}
const appSource = read("webroot/app-121.js");
if (!appSource.includes("const searching = e.length > 0") || !appSource.includes("&& !searching")) {
  throw new Error("search-result icon loading contract is missing");
}
if (!["已添加", "本次已选择", "将替换"].every((label) => appSource.includes(label)) || !appSource.includes('f("recipe_list"')) {
  throw new Error("existing group-icon marker contract is missing");
}
const groupSource = read("webroot/recipe-123.js");
if (!groupSource.includes('exec("group_initialize"') || !backend.includes('group_create "默认修补组"')) {
  throw new Error("default patch-group contract is missing");
}
const cacheSource = read("webroot/cache-101.js");
for (const label of ["请选择待修补主题", "请选择修补组", "请先添加图标"]) {
  if (!cacheSource.includes(label)) throw new Error(`primary-action state is missing: ${label}`);
}
if (cacheSource.includes('button.textContent = "打开主题商店"')) {
  throw new Error("patch button must not duplicate the theme-store action");
}
for (const sharedModule of ["webroot/backend-client.js", "webroot/flow-state.js"]) {
  if (!fs.existsSync(sharedModule)) throw new Error(`missing shared WebUI module ${sharedModule}`);
}
if (!read("webroot/backend-client.js").includes("export function execBackend")) {
  throw new Error("shared backend client contract is missing");
}

const cases = new Set([...backend.matchAll(/^  ([a-z_]+)\)/gm)].map((match) => match[1]));
const operations = new Set();
for (const file of ["webroot/cache-101.js", "webroot/recipe-123.js", "webroot/stitch-160.js"]) {
  for (const match of read(file).matchAll(/exec\("([a-z_]+)"/g)) operations.add(match[1]);
}
for (const operation of [
  "list_apps",
  "recipe_begin",
  "recipe_upload_begin",
  "recipe_upload_chunk",
  "recipe_upload_commit",
  "recipe_finish",
  "clear_recipe_stage"
]) operations.add(operation);
for (const operation of operations) {
  if (!cases.has(operation)) throw new Error(`backend does not dispatch ${operation}`);
}

for (const removed of ["fast_build", "prepare_cache", "stream_cache", "patch_cache)", "fast_merge)", "refresh)"]) {
  if (backend.includes(removed)) throw new Error(`obsolete public backend operation remains: ${removed}`);
}
if (!backend.includes("acquire_operation_lock") || !backend.includes("fast_patch)")) {
  throw new Error("atomic fast_patch contract is missing");
}
const stitchSource = read("webroot/stitch-160.js");
for (const contract of [
  'row.kind === "add"',
  'selectedPackages.add(row.packageName)',
  'previewActive < 4',
  'exec("stitch_begin"',
  'exec("stitch_upload_chunk"',
  'exec("stitch_apply"'
]) {
  if (!stitchSource.includes(contract)) throw new Error(`stitch WebUI contract is missing: ${contract}`);
}
for (const id of ["modePatch", "modeStitch", "stitchTarget", "stitchSource", "stitchList", "stitchApply"]) {
  if (!ids.has(id)) throw new Error(`stitch DOM contract is missing: ${id}`);
}
if (!backend.includes("theme_fingerprint") || !backend.includes("stitch_apply) stitch_apply")) {
  throw new Error("atomic stitch backend contract is missing");
}
if (!html.includes('workspace-160.js?v=160') || !html.includes('stitch-160.js?v=160') || !html.includes('style-110.css?v=161')) {
  throw new Error("stitch WebUI cache-busting contract is missing");
}
const workspaceSource = read("webroot/workspace-160.js");
if (!workspaceSource.includes('typeof ksu !== "undefined"') || !workspaceSource.includes("电脑端仅用于预览界面")) {
  throw new Error("local-file workspace preview contract is missing");
}

console.log(`Contract tests passed: ${ids.size} DOM ids, ${operations.size} backend operations`);
