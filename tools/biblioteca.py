"""
Trazo · de dónde salen las fuentes de las texturas al CONSTRUIR (nunca en el plugin).

Las herramientas (build_assets.py, extract_papers.py) siguen escribiendo sus rutas de siempre
("TEXTURES/TRAZOS/LAPIZ/…"), pero cada una es solo un NOMBRE: el archivo real se lee por su id
de la biblioteca común de Iker (IkerEker/TEXTURAS, rama atlas):

  tools/fuentes_ids.json        nombre de siempre → id (or:<md5>), las 319 fuentes, en orden
  $TEXTURAS_ROOT/TEXTURAS/indice/indice.json   id → archivo (relativo a TEXTURAS_ROOT)

Así los globs dan exactamente los mismos archivos en el mismo orden y los .bin salen idénticos.
Cada archivo se comprueba con su md5 (el del id) antes de usarlo.

Modo:
  TEXTURAS_ROOT definido            → lee de la biblioteca (lo normal)
  sin TEXTURAS_ROOT y con TEXTURES/ → modo antiguo, avisa (solo hasta quitar TEXTURES/ del repo)
"""
import fnmatch
import hashlib
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(AQUI, ".."))
TABLA = os.path.join(AQUI, "fuentes_ids.json")

_ids = None
_archivo = None
_ok = {}


def _rel(p):
    return os.path.relpath(os.path.abspath(p), ROOT).replace(os.sep, "/")


def tabla():
    global _ids
    if _ids is None:
        _ids = json.load(open(TABLA, encoding="utf-8"))["fuentes"]
    return _ids


def raiz():
    r = os.environ.get("TEXTURAS_ROOT")
    return os.path.abspath(r) if r else None


def modo():
    if raiz():
        return "biblioteca"
    if os.path.isdir(os.path.join(ROOT, "TEXTURES")):
        return "antiguo"
    sys.exit("Falta TEXTURAS_ROOT (carpeta Biblioteca/ con TEXTURAS/ y originales/).")


def _indice():
    global _archivo
    if _archivo is None:
        R = raiz()
        for c in (os.path.join(R, "TEXTURAS", "indice", "indice.json"), os.path.join(R, "indice", "indice.json")):
            if os.path.isfile(c):
                idx = json.load(open(c, encoding="utf-8"))
                _archivo = {a["id"]: a["archivo"] for a in idx["assets"]}
                break
        else:
            sys.exit(f"No encuentro TEXTURAS/indice/indice.json en {R}")
    return _archivo


def aviso():
    m = modo()
    if m == "biblioteca":
        print(f"[fuentes] biblioteca común por id: TEXTURAS_ROOT={raiz()}")
    else:
        print("[fuentes] AVISO: modo antiguo, leyendo TEXTURES/ del repo (define TEXTURAS_ROOT)")


def glob(pat):
    """Como sorted(glob.glob(pat)) con archivos, pero sobre la tabla de ids. Comodines solo en el nombre."""
    if modo() == "antiguo":
        import glob as G
        return sorted(f for f in G.glob(pat) if os.path.isfile(f))
    rel = _rel(pat)
    d, name = rel.rsplit("/", 1)
    out = [k for k in tabla() if k.rsplit("/", 1)[0] == d and fnmatch.fnmatchcase(k.rsplit("/", 1)[1], name)
           and not k.rsplit("/", 1)[1].startswith(".")]
    return sorted(os.path.join(ROOT, k) for k in out)


def existe(p):
    return os.path.isfile(p) if modo() == "antiguo" else _rel(p) in tabla()


def real(p):
    """Ruta del archivo de verdad para un nombre de siempre (comprueba el md5 del id una vez)."""
    if modo() == "antiguo":
        return p
    k = _rel(p)
    if k in _ok:
        return _ok[k]
    i = tabla().get(k)
    if not i:
        sys.exit(f"{k}: no está en tools/fuentes_ids.json")
    a = _indice().get(i)
    if not a:
        sys.exit(f"{k}: el id {i} no está en el índice de la biblioteca")
    f = os.path.join(raiz(), a)
    if not os.path.isfile(f):
        sys.exit(f"{k}: falta {f} (id {i}); monta la biblioteca con montar_biblioteca.py")
    h = hashlib.md5(open(f, "rb").read()).hexdigest()
    if i.startswith("or:") and h != i[3:]:
        sys.exit(f"{k}: {f} no coincide con su id {i} (md5 {h})")
    _ok[k] = f
    return f
