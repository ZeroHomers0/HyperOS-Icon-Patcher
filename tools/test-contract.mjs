import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const html = read("webroot/index.html");
const backend = read("scripts/backend.sh");
const files = {
  "webroot/ui-101.js": /byId\("([^"]+)"\)/g,
  "webroot/cache-101.js": /byId\("([^"]+)"\)/g,
  "webroot/recipe-123.js": /byId\("([^"]+)"\)/g,
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
if (!read("webroot/style-110.css").includes("--hip-visual-height")) {
  throw new Error("mobile visual viewport CSS contract is missing");
}

const cases = new Set([...backend.matchAll(/^  ([a-z_]+)\)/gm)].map((match) => match[1]));
const operations = new Set();
for (const file of ["webroot/cache-101.js", "webroot/recipe-123.js"]) {
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

for (const removed of ["fast_build", "prepare_cache", "stream_cache", "patch_cache)", "fast_merge)"]) {
  if (backend.includes(removed)) throw new Error(`obsolete public backend operation remains: ${removed}`);
}
if (!backend.includes("acquire_operation_lock") || !backend.includes("fast_patch)")) {
  throw new Error("atomic fast_patch contract is missing");
}

console.log(`Contract tests passed: ${ids.size} DOM ids, ${operations.size} backend operations`);
