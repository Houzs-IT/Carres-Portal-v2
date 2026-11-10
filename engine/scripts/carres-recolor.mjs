// Carres only (not part of Houzs's code). The Carres engine theme: the Houzs palette mapped to the Carres one
// (the mapping d7fa026e1 applied by hand). Run after every resync from Houzs, from the repo root:
//   node engine/scripts/carres-recolor.mjs engine/frontend/src engine/frontend/index.html engine/frontend/tailwind.config.js
// Test files are left alone, as d7fa026e1 left them. Safe to repeat: already-mapped values do not match again.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
const MAP = { "16695f":"1b1b39","a16a2e":"d64f20","e1efed":"dce6fd","11140f":"111827","414539":"4b5563","767b6e":"6b7280",
  "d6d9d2":"e5e7eb","eef0ec":"f6f7f9","0c3f39":"2f55e0","f4f6f3":"f8f9fa","e3e6e0":"eef0f3","d8a85a":"d64f20","13201c":"1b1b39" };
const hexRe = new RegExp(`#(${Object.keys(MAP).join("|")})(?![0-9a-fA-F])`, "gi");
const rgbaRe = /rgba\(\s*22\s*,\s*105\s*,\s*95\s*,/g;
const EXT = new Set([".css", ".tsx", ".ts", ".html", ".js"]);
let files = 0, hits = 0;
function recolor(f) {
  if (!EXT.has(extname(f)) || /\.test\./.test(basename(f))) return;
  const t = readFileSync(f, "utf8");
  let c = 0;
  const o = t.replace(hexRe, (_m, h) => { c++; return "#" + MAP[h.toLowerCase()].toUpperCase(); })
             .replace(rgbaRe, () => { c++; return "rgba(27, 27, 57,"; });
  if (c) { writeFileSync(f, o); files++; hits += c; }
}
function walk(p) {
  for (const n of readdirSync(p)) {
    if (n === "node_modules" || n === "dist") continue;
    const f = join(p, n);
    if (statSync(f).isDirectory()) walk(f); else recolor(f);
  }
}
for (const r of process.argv.slice(2)) statSync(r).isDirectory() ? walk(r) : recolor(r);
console.log(`recoloured ${hits} values in ${files} files`);
