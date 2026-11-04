#!/usr/bin/env bash
# Empaqueta el plugin (ver tools/package.py)
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/bundle.js
python3 tools/package.py
