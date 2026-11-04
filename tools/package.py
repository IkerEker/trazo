"""
Trazo · empaquetado del plugin.

Genera dist/Trazo-<versión>.ccx igual que lo espera Creative Cloud:
un zip con manifest.json en la raíz (primera entrada), sin entradas de
carpeta, sin archivos ocultos y con compresión deflate estándar.
También genera dist/Trazo-<versión>-carpeta.zip para UXP Developer Tool.

uso: python3 tools/package.py   (antes: node tools/bundle.js)
"""
import json, os, sys, zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PLUGIN = os.path.join(ROOT, "plugin")
DIST = os.path.join(ROOT, "dist")


def plugin_files():
    out = []
    for base, dirs, files in os.walk(PLUGIN):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for f in sorted(files):
            if f.startswith("."):
                continue
            full = os.path.join(base, f)
            rel = os.path.relpath(full, PLUGIN).replace(os.sep, "/")
            out.append((rel, full))
    out.sort(key=lambda t: (t[0] != "manifest.json", t[0]))
    return out


def check_manifest():
    m = json.load(open(os.path.join(PLUGIN, "manifest.json"), encoding="utf-8"))
    errs = []
    v = m.get("version", "")
    parts = v.split(".")
    if len(parts) != 3 or not all(p.isdigit() and 0 <= int(p) <= 99 for p in parts):
        errs.append("version debe ser x.y.z (0–99)")
    if not 3 <= len(m.get("name", "")) <= 45:
        errs.append("name debe tener 3–45 caracteres")
    if not isinstance(m.get("host"), dict):
        errs.append("host debe ser un objeto (no una lista) para distribuir")
    for ic in m.get("icons", []) + [i for e in m.get("entrypoints", []) for i in e.get("icons", [])]:
        for sc in ic.get("scale", [1]):
            p = ic["path"] if sc == 1 else ic["path"].replace(".png", f"@{sc}x.png")
            if not os.path.exists(os.path.join(PLUGIN, p)):
                errs.append(f"falta el icono {p}")
    if not os.path.exists(os.path.join(PLUGIN, m.get("main", "main.js"))):
        errs.append("falta el archivo main")
    if errs:
        sys.exit("manifest.json no válido:\n  " + "\n  ".join(errs))
    return m


def main():
    m = check_manifest()
    os.makedirs(DIST, exist_ok=True)
    ccx = os.path.join(DIST, f"Trazo-{m['version']}.ccx")
    folder_zip = os.path.join(DIST, f"Trazo-{m['version']}-carpeta.zip")
    files = plugin_files()
    for path, prefix in ((ccx, ""), (folder_zip, "Trazo/")):
        if os.path.exists(path):
            os.remove(path)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for rel, full in files:
                z.write(full, prefix + rel)
    with zipfile.ZipFile(ccx) as z:
        names = z.namelist()
        assert names[0] == "manifest.json" and not any(n.endswith("/") for n in names)
        assert z.testzip() is None
    print(f"{os.path.basename(ccx)}: {len(files)} archivos, {os.path.getsize(ccx) / 1e6:.1f} MB")
    print(f"{os.path.basename(folder_zip)}: carpeta para UXP Developer Tool")


if __name__ == "__main__":
    main()
