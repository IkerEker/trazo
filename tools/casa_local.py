"""
Trazo · comprobación de la «casa local» (ORDEN 2 de Iker: TEXTURAS/plugins/ORDEN_CARPETA_LOCAL.md).

Se ejecuta DENTRO de C:\\Users\\ikerg\\Biblioteca\\plugins\\trazo (lo lanza tools\\casa_local.bat):

  python tools/casa_local.py --biblioteca C:\\Users\\ikerg\\Biblioteca --bundle <ruta del .bundle>

Comprueba, sin borrar nada:
  1. ramas y etiquetas de GitHub = locales, mismo último commit y mismos archivos (árbol) en cada rama;
  2. el bundle de respaldo (git bundle verify);
  3. que la biblioteca tiene los 303 originales que usa Trazo, con su md5 (lectura por id);
  4. construcción desde la biblioteca en la rama sin-repetidos + prueba exacta (md5 de los .bin y
     node tools/bench.js --check);
  5. material repetido (md5 en el índice) en cada rama.
Escribe INFORME_CASA.txt y REPETIDOS_ENCONTRADOS.txt en la casa.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

AQUI = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
MAT_EXT = (".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".psd", ".mp4", ".mov", ".webm",
           ".wav", ".mp3", ".aif", ".aiff", ".ogg", ".exr")


def git(*a, check=True):
    r = subprocess.run(["git", "-C", AQUI, *a], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode:
        raise RuntimeError("git " + " ".join(a) + ": " + r.stderr.strip())
    return r.stdout


def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--biblioteca", required=True)
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--sin-construir", action="store_true", help="saltar la reconstrucción de texturas")
    a = ap.parse_args()
    B = os.path.abspath(a.biblioteca)
    inf = []
    ok_all = True

    def linea(txt, ok):
        nonlocal ok_all
        ok_all = ok_all and ok
        inf.append(f"- {txt}  {'VERIFICADO' if ok else 'FALTA / DISTINTO'}")
        print(inf[-1], flush=True)

    # ---------------------------------------------------------------- 1. ramas, etiquetas, commits, archivos
    git("fetch", "--all", "--tags", "--prune")
    # una rama local por cada rama de GitHub
    locales = set(git("branch", "--format=%(refname:short)").split())
    for l in git("branch", "-r", "--format=%(refname:short)").split():
        if l.startswith("origin/") and l != "origin/HEAD" and l[7:] and l[7:] not in locales and l != "origin":
            git("branch", "--track", l[7:], l)
    rem = {}
    for l in git("ls-remote", "--heads", "--tags", "origin").splitlines():
        sha, ref = l.split("\t")
        if ref.endswith("^{}"):
            continue
        rem[ref] = sha
    loc = {}
    for l in git("for-each-ref", "--format=%(objectname) %(refname)", "refs/heads", "refs/tags").splitlines():
        sha, ref = l.split(" ", 1)
        loc[ref] = sha
    faltan = sorted(set(rem) - set(loc))
    distintos = sorted(r for r in rem if r in loc and rem[r] != loc[r])
    nr = len([r for r in rem if r.startswith("refs/heads/")]); nt = len(rem) - nr
    linea(f"Ramas/etiquetas GitHub = local: {len(rem) - len(faltan)}/{len(rem)} ({nr} ramas, {nt} etiquetas)"
          + (f"; faltan {faltan}" if faltan else ""), not faltan)
    linea("Último commit de cada rama coincide" + (f"; distintos {distintos}" if distintos else ""), not distintos)
    arch_bad = []
    for ref in rem:
        if not ref.startswith("refs/heads/") or ref not in loc:
            continue
        br = ref[len("refs/heads/"):]
        t_rem = git("ls-tree", "-r", rem[ref])
        t_loc = git("ls-tree", "-r", br)
        if t_rem != t_loc:
            arch_bad.append(br)
    linea("Archivos de cada rama coinciden (git ls-tree -r)" + (f"; distintos {arch_bad}" if arch_bad else ""), not arch_bad)
    lfs = os.path.exists(os.path.join(AQUI, ".gitattributes")) and "lfs" in open(os.path.join(AQUI, ".gitattributes")).read()
    inf.append(f"- Git LFS: {'sí (revisar git lfs fetch --all)' if lfs else 'no se usa'}")

    # ---------------------------------------------------------------- 2. bundle
    r = subprocess.run(["git", "-C", AQUI, "bundle", "verify", a.bundle], capture_output=True, text=True)
    linea(f"Bundle creado y verificado: {a.bundle}", r.returncode == 0)

    # ---------------------------------------------------------------- 3. fuera de git
    inf.append("- Fuera de git: lo que solo vivía en la sesión en la nube está en la rama archivo-sesion "
               "(captura/, docs/, tools/img/). dist/*.zip y tools/out/ se regeneran. Los .ccx están en git (dist/).")

    # ---------------------------------------------------------------- 4. trabajar en sin-repetidos
    estado = git("status", "--porcelain")
    if estado.strip():
        print("AVISO: hay cambios sin guardar en la casa; no cambio de rama:\n" + estado)
    else:
        ramas = git("branch", "--format=%(refname:short)").split()
        if "sin-repetidos" not in ramas:
            git("branch", "sin-repetidos", "biblioteca")
        git("checkout", "-q", "sin-repetidos")
    cur = git("rev-parse", "--abbrev-ref", "HEAD").strip()
    inf.append(f"- Rama de trabajo: {cur} (= biblioteca: TEXTURES/ fuera, material por id)")

    # ---------------------------------------------------------------- 5. lectura por id
    os.environ["TEXTURAS_ROOT"] = B
    sys.path.insert(0, os.path.join(AQUI, "tools"))
    import biblioteca as BL
    tabla = BL.tabla()
    ids = sorted(set(tabla.values()))
    idx = BL._indice()
    malos = []
    for i in ids:
        f = os.path.join(B, idx[i]) if i in idx else None
        if not f or not os.path.isfile(f):
            malos.append((i, "no está"))
        elif md5(f) != i[3:]:
            malos.append((i, "md5 distinto"))
    linea(f"Material leído por id de la biblioteca: {len(ids) - len(malos)}/{len(ids)} ids"
          + (f"; problemas: {malos[:10]}" if malos else ""), not malos)

    # ---------------------------------------------------------------- 6. construir + prueba exacta
    ref = json.load(open(os.path.join(AQUI, "tools", "ref", "textures.md5.json")))
    tdir = os.path.join(AQUI, "plugin", "textures")
    antes = {f: md5(os.path.join(tdir, f)) for f in ref}
    linea("Texturas del repo = referencia (antes de construir)", antes == ref)
    if a.sin_construir or malos:
        inf.append("- Construcción desde la casa nueva: NO HECHA" + (" (faltan originales)" if malos else " (--sin-construir)"))
        ok_build = False
        ok_all = False
    else:
        t0 = time.time()
        for s in ("build_assets.py", "extract_papers.py"):
            r = subprocess.run([sys.executable, os.path.join(AQUI, "tools", s)], cwd=AQUI)
            if r.returncode:
                break
        despues = {f: md5(os.path.join(tdir, f)) for f in ref if os.path.isfile(os.path.join(tdir, f))}
        dif = sorted(f for f in ref if despues.get(f) != ref[f])
        ok_build = r.returncode == 0 and not dif
        linea(f"Construcción desde la casa nueva ({time.time() - t0:.0f} s): {len(ref) - len(dif)}/{len(ref)} .bin idénticos"
              + (f"; distintos {dif}" if dif else ""), ok_build)
        if dif:
            # se guardan aparte para enseñárselos a Iker y se deja el repo como estaba
            out = os.path.join(AQUI, "_construido_distinto")
            os.makedirs(out, exist_ok=True)
            for f in dif:
                if os.path.isfile(os.path.join(tdir, f)):
                    shutil.copy2(os.path.join(tdir, f), out)
            git("checkout", "--", "plugin/textures")
            inf.append(f"  (los .bin distintos están en {out}; plugin/textures vuelve a la versión de git)")
    node = shutil.which("node")
    if node:
        r = subprocess.run([node, os.path.join(AQUI, "tools", "bench.js"), "--check", "--rep", "1"], cwd=AQUI,
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        last = (r.stdout.strip().splitlines() or ["?"])[-1]
        linea(f"Prueba exacta del motor (node tools/bench.js --check): {last}", r.returncode == 0 and last.startswith("IDÉNTICO"))
        open(os.path.join(AQUI, "BENCH_CASA.txt"), "w", encoding="utf-8").write(r.stdout + r.stderr)
    else:
        linea("Prueba exacta del motor: falta Node.js (https://nodejs.org)", False)

    # ---------------------------------------------------------------- 7. repetidos en cada rama
    by = {x["md5"]: x["id"] for x in json.load(open(os.path.join(B, "TEXTURAS", "indice", "indice.json"), encoding="utf-8"))["assets"] if x.get("md5")}
    rep_lines, total_rep, total_mb, nuevos = [], 0, 0.0, []
    for br in sorted(git("branch", "--format=%(refname:short)").split()):
        n = mb = 0
        for l in git("ls-tree", "-r", "-l", br).splitlines():
            meta, path = l.split("\t", 1)
            _, typ, sha, size = meta.split()
            if typ != "blob" or not path.lower().endswith(MAT_EXT):
                continue
            data = subprocess.run(["git", "-C", AQUI, "cat-file", "blob", sha], capture_output=True).stdout
            m = hashlib.md5(data).hexdigest()
            if m in by:
                n += 1; mb += int(size) / 1e6
                rep_lines.append(f"{br}\t{path}\t{m}\t{by[m]}")
            elif br == cur and not path.startswith(("plugin/icons/", "captura/", "docs/", "tools/img/", "dist/", "tools/diagnostico_uxp/")):
                nuevos.append(path)
        inf.append(f"- Repetidos en la rama {br}: {n} ({mb:.0f} MB)")
        if br == cur:
            total_rep, total_mb = n, mb
    open(os.path.join(AQUI, "REPETIDOS_ENCONTRADOS.txt"), "w", encoding="utf-8").write(
        "rama\truta\tmd5\tid de la biblioteca\n" + "\n".join(rep_lines) + "\n")
    inf.append(f"- Repetidos en la rama de trabajo: {total_rep} ({total_mb:.0f} MB); los de main ya están quitados en "
               f"sin-repetidos (TEXTURES/). Lista completa: REPETIDOS_ENCONTRADOS.txt")
    inf.append(f"- Material que no está en la biblioteca (rama {cur}): {len(nuevos)} archivos "
               f"({', '.join(sorted(set(p.split('/')[0] for p in nuevos)))}) → ver PEDIDO en el informe de Claude")

    cab = f"PLUGIN: Trazo     CASA: {AQUI}"
    fin = "→ LISTO PARA BORRAR EL REPO DE GITHUB: " + ("SÍ" if ok_all else "NO (ver líneas sin VERIFICADO)")
    txt = "\n".join([cab] + inf + [fin]) + "\n"
    open(os.path.join(AQUI, "INFORME_CASA.txt"), "w", encoding="utf-8").write(txt)
    print("\n" + txt)


if __name__ == "__main__":
    main()
