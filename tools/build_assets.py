"""
Trazo · construye todas las bibliotecas de material real a partir de TEXTURES/.

  pin_<familia>.bin   pinceladas enderezadas (óleo, gouache, lápiz, cera, barra, manley, pastel, acuarela)
  manchas.bin         manchas con forma (sellos) con densidad y relieve
  tiles_acuarela.bin  texturas repetibles de aguada (gris)
  tiles_pintura.bin   texturas repetibles de pincelada (gris y color: cálidas / frías)
  ov_*.bin            texturas 9:16 no repetibles (impresión, madera, goteos, grafito)

Las de TEXTURES/REALISTAS tienen prioridad (peso q=3 al elegir).
uso: python3 tools/build_assets.py [--only pin|manchas|tiles|ov] [--fam barra,manley]
"""
import glob, hashlib, json, os, struct, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract_strokes as ES

Image.MAX_IMAGE_PIXELS = None
ROOT = ES.ROOT
T = os.path.join(ROOT, "TEXTURES")
OUT = os.path.join(ROOT, "plugin", "textures")
DBG = os.path.join(ROOT, "tools", "out")
os.makedirs(OUT, exist_ok=True); os.makedirs(DBG, exist_ok=True)

REAL = os.path.join(T, "REALISTAS")
RFORMA = os.path.join(REAL, "MANCHA CON  FORMA CONCRETA")
RGRAND = os.path.join(REAL, "MANCHAS GRANDES DE VARIOS TRAZOS_TEXTURA COMPLEJA")
RTILE = os.path.join(REAL, "TEXTURAS REALISTAS TILEABLES")
TR = os.path.join(T, "TRAZOS")
MAT = os.path.join(T, "MATERIALE_TILEABLES")
T916 = os.path.join(T, "TEXTURAS EN 9-16 NO TILEABLES")


def g(*pats):
    out = []
    for p in pats:
        out += sorted(f for f in glob.glob(p) if os.path.isfile(f) and not f.endswith(".md"))
    return out


FAMILIES = {
    "gouache": [(3, g(os.path.join(RFORMA, "Gemini*"), os.path.join(RFORMA, "Mancha vertical*"), os.path.join(RFORMA, "Pincelada*"),
                      os.path.join(RFORMA, "Trazo de gouache*"), *[os.path.join(RFORMA, f"{i:03d}.png") for i in (5, 6, 7, 14)])),
                (1, g(os.path.join(TR, "GUACHE", "*"), os.path.join(TR, "Muestras abstractas de pincel seco*")))],
    "oleo": [(2, g(os.path.join(TR, "Cuatro pinceladas rojas*"), os.path.join(TR, "Franjas de pintura roja*"),
                   os.path.join(TR, "Muestras de pinceladas azules*"), os.path.join(TR, "Ocho pinceladas azules*"),
                   os.path.join(TR, "Pinceladas azules sobre*"), os.path.join(TR, "Pinceladas rojas sobre*"),
                   os.path.join(TR, "Trazos azules sobre fondo blanco.png"))),
             (1, g(os.path.join(TR, "OLEO", "*")))],
    "lapiz": [(1, g(os.path.join(TR, "LAPIZ", "*"), os.path.join(TR, "Gemini_Generated_Image_uy13*"), os.path.join(TR, "Gemini_Generated_Image_2tepo*"),
                    os.path.join(TR, "Hoja de garabatos de grafito*"), os.path.join(TR, "Garabatos abstractos de grafito*"),
                    os.path.join(TR, "Doodles de grafito*")))],
    "cera": [(2, g(os.path.join(TR, "Cinco trazos azules sobre*"), os.path.join(TR, "Cinco trazos rojos*"), os.path.join(TR, "Cuatro trazos rojos texturizados*"),
                   os.path.join(TR, "Tres trazos azules texturizados*"), os.path.join(TR, "Gemini_Generated_Image_4k0x*"),
                   os.path.join(TR, "Garabato de carb*"), os.path.join(TR, "Trazo serpenteante*"))),
             (1, g(os.path.join(TR, "CERAS", "*")))],
    # ceras de colores: óleo en barra / pastel graso, cera escolar y pastel seco
    "barra": [(2, g(os.path.join(TR, "CERAS", "*")))],
    "manley": [(2, g(os.path.join(TR, "Cinco trazos rojos*"), os.path.join(TR, "Cuatro trazos rojos texturizados*"),
                     os.path.join(TR, "Cinco trazos azules sobre*"), os.path.join(TR, "Tres trazos azules texturizados*")))],
    "pastel": [(2, g(os.path.join(TR, "Gemini_Generated_Image_4k0x*"), os.path.join(TR, "Garabato de carb*"),
                     ))],
    "acuarela": [(1, g(os.path.join(TR, "AGUADAS", "*")))],
}
WIDTH = {"oleo": 112, "gouache": 96, "cera": 80, "lapiz": 56, "barra": 96, "manley": 72, "pastel": 96, "acuarela": 96}
HMAXF = {"oleo": 720, "gouache": 720, "cera": 640, "lapiz": 640, "barra": 720, "manley": 720, "pastel": 640, "acuarela": 640}
CAP = {"oleo": 30, "gouache": 30, "cera": 26, "lapiz": 30, "barra": 30, "manley": 30, "pastel": 30, "acuarela": 21}
OPAQUE = {"oleo", "gouache", "cera", "barra", "manley", "pastel"}


def md5(f):
    return hashlib.md5(open(f, "rb").read()).hexdigest()


def load_rgb(path, maxside=None):
    im = Image.open(path).convert("RGB")
    if maxside and max(im.size) > maxside:
        im.thumbnail((maxside, maxside), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def density(rgb):
    """Densidad de pigmento 0..1 sobre fondo blanco (vale para gris y para color)."""
    norm = []
    for c in range(3):
        bg = ES.fit_background(rgb[..., c])
        norm.append(np.clip(rgb[..., c] / bg, 0, 1.2))
    N = np.minimum(np.minimum(norm[0], norm[1]), norm[2])
    D = np.clip(1 - N, 0, 1)
    L = 0.299 * norm[0] + 0.587 * norm[1] + 0.114 * norm[2]
    return D.astype(np.float32), np.clip(L, 0, 1.2).astype(np.float32)


# ------------------------------------------------------------------ pinceladas
def components(D):
    h, w = D.shape
    Ds = ndi.gaussian_filter(D, 2.0)
    paper = Ds < np.percentile(Ds, 40)
    sig = float(np.std(D[paper])) if paper.any() else 0.01
    thr = max(0.05, 4 * sig)
    M = Ds > thr
    M = ndi.binary_opening(M, structure=np.ones((3, 3)))
    gap = max(4, int(min(h, w) * 0.006))
    G, n = ndi.label(ndi.binary_dilation(M, iterations=gap))
    t0 = max(0.03, 2.5 * sig)
    Dc = np.clip((D - t0) / (1 - t0), 0, 1)
    out = []
    for k, sl in enumerate(ndi.find_objects(G)):
        if sl is None:
            continue
        sub = (G[sl] == k + 1) & M[sl]
        area = sub.sum()
        if area < 0.0015 * h * w:
            continue
        out.append((sl, sub))
    return Dc, out


def frame_of(Dc, sl, sub):
    """Muestrea la componente en un marco recto (filas = a lo largo, empieza arriba)."""
    ys, xs = np.nonzero(sub)
    wts = Dc[sl][ys, xs] + 1e-3
    ys = ys + sl[0].start; xs = xs + sl[1].start
    cy, cx = np.average(ys, weights=wts), np.average(xs, weights=wts)
    C = np.cov(np.stack([xs - cx, ys - cy]), aweights=wts)
    ev, evec = np.linalg.eigh(C)
    vx, vy = evec[:, 1]
    if abs(vx) > abs(vy):
        if vx < 0: vx, vy = -vx, -vy
    elif vy < 0:
        vx, vy = -vx, -vy
    nx, ny = -vy, vx
    u = (xs - cx) * vx + (ys - cy) * vy
    wv = (xs - cx) * nx + (ys - cy) * ny
    length = u.max() - u.min()
    width = 2 * np.percentile(np.abs(wv), 92) + 2
    if length < 2.4 * width or length < 60:
        return None
    pad = max(8, int(width * 0.25))
    U = np.arange(u.min() - pad, u.max() + pad, 1.0)
    Wd = np.abs(wv).max() + pad
    Wx = np.arange(-Wd, Wd, 1.0)
    uu, ww = np.meshgrid(U, Wx, indexing="ij")
    mask = np.zeros_like(Dc)
    mask[sl] = ndi.binary_dilation(sub, iterations=3)
    src = Dc * mask
    F = ndi.map_coordinates(src, [cy + uu * vy + ww * ny, cx + uu * vx + ww * nx], order=1, cval=0.0).astype(np.float32)
    # rechazar espirales, cruces y bucles: varias "tiras" separadas en la misma fila
    Fs = ndi.gaussian_filter(F, max(1.0, width * 0.12)) > 0.08
    multi = 0
    rows = 0
    for r in range(0, Fs.shape[0], 2):
        row = Fs[r]
        if not row.any():
            continue
        rows += 1
        lab, nr = ndi.label(row)
        if nr > 1:
            sizes = ndi.sum(row, lab, range(1, nr + 1))
            if (sizes > max(3, width * 0.15)).sum() > 1:
                multi += 1
    if rows == 0 or multi / rows > 0.22:
        return None
    return F


def build_pinceladas():
    report = {}
    seen = set()
    fams = sys.argv[sys.argv.index("--fam") + 1].split(",") if "--fam" in sys.argv else None
    for fam, groups in FAMILIES.items():
        if fams and fam not in fams:
            continue
        ES.HMAX = HMAXF[fam]
        ES.WT[fam] = WIDTH[fam]
        ES.OPAQUE.clear(); ES.OPAQUE.update(OPAQUE)
        samples = []
        for q, files in groups:
            for f in files:
                h = md5(f)
                if (fam, h) in seen:
                    continue
                seen.add((fam, h))
                rgb = load_rgb(f, 2752)
                D, _ = density(rgb)
                Dc, comps = components(D)
                for sl, sub in comps:
                    F = frame_of(Dc, sl, sub)
                    if F is None:
                        continue
                    st = ES.extract_stroke(F, None, fam, 0)
                    if st is None or st["h"] < 40:
                        continue
                    st["q"] = q
                    st["file"] = os.path.basename(f)
                    samples.append(st)
        # quedarse con los mejores: prioridad, luego relleno medio (ni puntos ni manchas raras)
        rng = np.random.default_rng(5)
        samples.sort(key=lambda s: (-s["q"], abs(s["fill"] - 0.7) + rng.random() * 0.3))
        samples = samples[:CAP[fam]]
        ES.contact_sheet(samples, fam, os.path.join(DBG, f"pin_{fam}.jpg"))
        size = ES.write_library(fam, samples, os.path.join(OUT, f"pin_{fam}.bin"))
        report[fam] = (len(samples), size)
        print(f"pin_{fam}: {len(samples)} trazos, {size / 1024:.0f} KB")
    return report


# ------------------------------------------------------------------ contenedor genérico
def write_items(path, kind, items):
    """items: [{name, tags, meta..., planes:[np.uint8 2D]}]"""
    header = {"version": 2, "kind": kind, "items": []}
    blobs, off = [], 0
    for it in items:
        pl = []
        for arr in it["planes"]:
            a = np.ascontiguousarray(arr, dtype=np.uint8)
            pl.append({"w": int(a.shape[1]), "h": int(a.shape[0]), "offset": off})
            blobs.append(a.tobytes()); off += a.size
        meta = {k: v for k, v in it.items() if k != "planes"}
        meta["planes"] = pl
        header["items"].append(meta)
    hj = json.dumps(header, ensure_ascii=True, separators=(",", ":")).encode("ascii")
    pad = (4 - (8 + len(hj)) % 4) % 4
    with open(path, "wb") as fh:
        fh.write(b"TRZ1" + struct.pack("<I", len(hj) + pad) + hj + b" " * pad)
        for b in blobs:
            fh.write(b)
    return os.path.getsize(path)


def orient(A):
    """Ángulo dominante de las marcas (radianes, 0 = horizontal) y coherencia."""
    gx = ndi.sobel(A, 1); gy = ndi.sobel(A, 0)
    jxx, jyy, jxy = (gx * gx).sum(), (gy * gy).sum(), (gx * gy).sum()
    th = 0.5 * np.arctan2(2 * jxy, jxx - jyy) + np.pi / 2  # perpendicular al gradiente
    coh = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / (jxx + jyy + 1e-9)
    return float((th + np.pi / 2) % np.pi - np.pi / 2), float(coh)


# ------------------------------------------------------------------ manchas (sellos)
STAMP_TAGS = {1: "relleno", 2: "remolino", 3: "veta", 4: "remolino", 8: "remolino", 9: "puntos", 10: "puntos", 11: "puntos",
              12: "toques", 13: "toques", 15: "toques", 16: "relleno"}


def build_manchas():
    items = []
    files = [(os.path.join(RFORMA, f"{i:03d}.png"), STAMP_TAGS[i]) for i in STAMP_TAGS]
    for f in g(os.path.join(RGRAND, "*")):
        tag = "puntos_grande" if "11" in os.path.basename(f) else "parche"
        files.append((f, tag))
    for f, tag in files:
        rgb = load_rgb(f, 1500)
        D, L = density(rgb)
        M = ndi.gaussian_filter(D, 2) > 0.06
        ys, xs = np.nonzero(M)
        if len(ys) < 100:
            continue
        mgn = int(0.03 * max(D.shape))
        y0, y1 = max(0, ys.min() - mgn), min(D.shape[0], ys.max() + mgn)
        x0, x1 = max(0, xs.min() - mgn), min(D.shape[1], xs.max() + mgn)
        Dc = D[y0:y1, x0:x1]; Lc = L[y0:y1, x0:x1]
        side = 320 if tag != "parche" else 384
        f2 = side / max(Dc.shape)
        im = Image.fromarray(np.clip(Dc * 255, 0, 255).astype(np.uint8)).resize((max(8, int(Dc.shape[1] * f2)), max(8, int(Dc.shape[0] * f2))), Image.LANCZOS)
        Ds = np.asarray(im).astype(np.float32) / 255
        im2 = Image.fromarray(np.clip(Lc * 200, 0, 255).astype(np.uint8)).resize(im.size, Image.LANCZOS)
        Ls = np.asarray(im2).astype(np.float32) / 200
        d99 = np.percentile(Ds[Ds > 0.05], 98) if (Ds > 0.05).sum() > 50 else 1
        A = np.clip(Ds / max(d99, 0.05), 0, 1)
        # detalle (relieve y vetas) relativo al tono medio local de la pintura
        sg = max(2, side / 40)
        Lb = ndi.gaussian_filter(Ls * A, sg) / (ndi.gaussian_filter(A, sg) + 1e-4)
        S = np.where(A > 0.2, Ls - Lb, 0)
        sd = S[A > 0.5].std() if (A > 0.5).sum() > 50 else 0.05
        S = np.clip(S * (0.25 / max(sd, 0.01)), -1, 1) * np.clip((A - 0.2) / 0.5, 0, 1)
        ang, coh = orient(A)
        items.append({"name": os.path.basename(f), "tags": [tag], "ang": round(ang, 3), "coh": round(coh, 3),
                      "fill": round(float((A > 0.5).mean()), 3),
                      "planes": [np.clip(A * 255 + 0.5, 0, 255), np.clip(128 + S * 127, 0, 255)]})
    size = write_items(os.path.join(OUT, "manchas.bin"), "stamps", items)
    sheet([np.asarray(it["planes"][0]) for it in items], [it["tags"][0] for it in items], os.path.join(DBG, "manchas.jpg"), invert=True)
    print(f"manchas: {len(items)} sellos, {size / 1024:.0f} KB")


# ------------------------------------------------------------------ texturas repetibles
def tile_stats(L):
    hf = L - ndi.gaussian_filter(L, 2, mode="wrap")
    lf = ndi.gaussian_filter(L, 24, mode="wrap")
    ang, coh = orient(L)
    return {"mean": round(float(L.mean()), 4), "std": round(float(L.std()), 4),
            "empaste": round(float(hf.std() / (L.std() + 1e-4)), 4),
            "manchado": round(float(lf.std() / (L.std() + 1e-4)), 4),
            "blanco": round(float((L > 0.82).mean()), 4), "ang": round(ang, 3), "coh": round(coh, 3)}


def tile_planes(path, N, color):
    im = Image.open(path).convert("RGB")
    im = im.resize((N, N), Image.BOX)  # factor entero: sigue siendo repetible
    a = np.asarray(im).astype(np.float32) / 255
    L = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    st = tile_stats(L)
    planes = [np.clip(L * 255 + 0.5, 0, 255)]
    if color:
        n4 = N // 4
        sm = np.asarray(im.resize((n4, n4), Image.BOX)).astype(np.float32) / 255
        Ls = 0.299 * sm[..., 0] + 0.587 * sm[..., 1] + 0.114 * sm[..., 2]
        cr, cb = sm[..., 0] - Ls, sm[..., 2] - Ls
        st["cr"] = round(float(cr.mean()), 4); st["cb"] = round(float(cb.mean()), 4)
        st["rgb"] = [round(float(a[..., c].mean()), 4) for c in range(3)]
        planes.append(np.clip(128 + (cr - cr.mean()) * 400, 0, 255))
        planes.append(np.clip(128 + (cb - cb.mean()) * 400, 0, 255))
    return planes, st


def build_tiles():
    items = []
    for f in g(os.path.join(RTILE, "ACUARELAS_BASE*")):
        pl, st = tile_planes(f, 384, False); items.append(dict(name=os.path.basename(f), tags=["aguada", "real"], q=3, **st, planes=pl))
    for pat, tag, N, keep in (("Acuarela_Base_*", "aguada", 320, 5), ("Acuarela_Grano_*", "grano", 384, 6), ("Acuarela_manchas_*", "manchas", 320, 4)):
        for f in g(os.path.join(MAT, pat))[:keep]:
            pl, st = tile_planes(f, N, False); items.append(dict(name=os.path.basename(f), tags=[tag], q=1, **st, planes=pl))
    size = write_items(os.path.join(OUT, "tiles_acuarela.bin"), "tiles", items)
    print(f"tiles_acuarela: {len(items)} texturas, {size / 1024:.0f} KB")
    sheet([it["planes"][0] for it in items], [it["tags"][0] + f" e{it['empaste']:.2f}" for it in items], os.path.join(DBG, "tiles_acuarela.jpg"))

    items = []
    for f in g(os.path.join(RTILE, "Bruchazos_Guache*")):
        tag = "puntos" if "Puntos" in f else "brochazo"
        pl, st = tile_planes(f, 384, False); items.append(dict(name=os.path.basename(f), tags=[tag, "real", "gris"], q=3, **st, planes=pl))
    for pat, tag, keep in (("Guache_Pinceladas_Calidas_*", "calida", 8), ("Guache_Pinceladas_Frias_*", "fria", 8), ("Guache_Pinceladas_Grises_*", "gris", 4)):
        fs = g(os.path.join(MAT, pat))
        fs = [fs[int(i * len(fs) / keep)] for i in range(keep)]
        for f in fs:
            pl, st = tile_planes(f, 320, True); items.append(dict(name=os.path.basename(f), tags=["pincelada", tag], q=1, **st, planes=pl))
    size = write_items(os.path.join(OUT, "tiles_pintura.bin"), "tiles", items)
    print(f"tiles_pintura: {len(items)} texturas, {size / 1024:.0f} KB")
    sheet([it["planes"][0] for it in items], [it["tags"][-1] + f" e{it['empaste']:.2f}" for it in items], os.path.join(DBG, "tiles_pintura.jpg"))


# ------------------------------------------------------------------ texturas 9:16 (no repetibles)
OVERLAYS = {
    "impresion": ["1f8a", "flvu", "gjqu", "v3eb"],
    "madera": ["2a6p", "2uid", "xydf"],
    "goteos": ["2nzv", "bmol", "v9cx"],
    "grafito": ["614e", "h24g", "o4l9"],
    "carbon": ["e6zo", "uwxt"],
}


def build_overlays():
    files = g(os.path.join(T916, "*"))
    for kind, keys in OVERLAYS.items():
        items = []
        for key in keys:
            m = [f for f in files if key in os.path.basename(f) and "(1)" not in f]
            if not m:
                continue
            im = Image.open(m[0]).convert("L")
            w, h = im.size
            f2 = 288 / min(w, h)
            im = im.resize((int(w * f2), int(h * f2)), Image.LANCZOS)
            L = np.asarray(im).astype(np.float32) / 255
            # corregir la luz (sin viñeteo) y estirar a 0..1
            bg = ndi.gaussian_filter(L, 60)
            Ln = np.clip(L / np.maximum(bg, 0.05) * np.median(L), 0, 1)
            lo, hi = np.percentile(Ln, [1, 99.5])
            Ln = np.clip((Ln - lo) / max(hi - lo, 1e-3), 0, 1)
            ang, coh = orient(Ln)
            items.append({"name": os.path.basename(m[0]), "tags": [kind], "ang": round(ang, 3), "coh": round(coh, 3),
                          "mean": round(float(Ln.mean()), 4), "planes": [np.clip(Ln * 255 + 0.5, 0, 255)]})
        size = write_items(os.path.join(OUT, f"ov_{kind}.bin"), "overlays", items)
        print(f"ov_{kind}: {len(items)} texturas, {size / 1024:.0f} KB")


def sheet(planes, labels, path, invert=False):
    from PIL import ImageDraw
    cell = 180; cols = 8
    rows = (len(planes) + cols - 1) // cols
    W = Image.new("L", (cols * (cell + 4), rows * (cell + 18)), 60)
    d = ImageDraw.Draw(W)
    for k, p in enumerate(planes):
        a = np.asarray(p).astype(np.uint8)
        if invert: a = 255 - a
        im = Image.fromarray(a); im.thumbnail((cell, cell))
        W.paste(im, ((k % cols) * (cell + 4), (k // cols) * (cell + 18)))
        d.text(((k % cols) * (cell + 4) + 2, (k // cols) * (cell + 18) + cell + 2), f"{k} {labels[k]}"[:28], fill=230)
    W.save(path, quality=85)


if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    if only in (None, "pin"): build_pinceladas()
    if only in (None, "manchas"): build_manchas()
    if only in (None, "tiles"): build_tiles()
    if only in (None, "ov"): build_overlays()
