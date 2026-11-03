// Empaqueta engine/*.js en un único archivo plugin/js/engine.js.
// El resultado define window.TrazoEngine (UXP / navegador) y module.exports (Node).
// uso: node tools/bundle.js
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "engine");
const outFile = path.join(root, "plugin", "js", "engine.js");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "plugin", "manifest.json"), "utf8"));

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".js")).sort();
let out = `/*! Trazo ${pkg.version} · motor de pintura (generado por tools/bundle.js, no editar) */\n`;
out += `(function (root) {\n"use strict";\nconst __defs = {}, __cache = {};\n`;
out += `function __req(name) {\n  const key = name.replace(/^\\.\\//, "");\n  if (__cache[key]) return __cache[key].exports;\n  const def = __defs[key];\n  if (!def) throw new Error("Módulo no encontrado: " + name);\n  const module = { exports: {} };\n  __cache[key] = module;\n  def(module, module.exports, __req);\n  return module.exports;\n}\n`;
for (const f of files) {
  const code = fs.readFileSync(path.join(srcDir, f), "utf8").replace(/^"use strict";\s*/, "");
  out += `__defs[${JSON.stringify(f)}] = function (module, exports, require) {\n${code}\n};\n`;
}
out += `const Engine = __req("index.js");\nif (typeof module !== "undefined" && module.exports) module.exports = Engine;\nroot.TrazoEngine = Engine;\n})(typeof window !== "undefined" ? window : globalThis);\n`;
fs.writeFileSync(outFile, out);
console.log(`engine.js: ${files.length} módulos, ${(out.length / 1024).toFixed(1)} KB`);
