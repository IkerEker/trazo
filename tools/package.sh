#!/usr/bin/env bash
# Empaqueta el plugin: regenera engine.js y crea dist/Trazo-<versión>.ccx y .zip
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/bundle.js
VERSION=$(node -e "console.log(require('./plugin/manifest.json').version)")
mkdir -p dist
OUT_CCX="dist/Trazo-${VERSION}.ccx"
OUT_ZIP="dist/Trazo-${VERSION}-carpeta.zip"
rm -f "$OUT_CCX" "$OUT_ZIP"
# .ccx = zip con manifest.json en la raíz
(cd plugin && zip -q -r -X "../$OUT_CCX" . -x ".*")
# zip con la carpeta, para cargarla con UXP Developer Tool
zip -q -r -X "$OUT_ZIP" plugin -x "plugin/.*"
echo "Listo:"
ls -la dist
