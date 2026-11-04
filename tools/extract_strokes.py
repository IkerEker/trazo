"""
Trazo · extractor de trazos reales.

Lee TEXTURES/PINCELADAS/<CARPETA>/*.jpg (9:16, fondo blanco, 3 trazos verticales que empiezan
arriba) y genera, por técnica, una biblioteca binaria plugin/textures/<tecnica>.bin
con cada trazo enderezado y normalizado:

  canal A  cobertura / densidad de pigmento (0..255)
  canal S  relieve y brillo relativos al color medio de la pintura (128 = neutro)
           (solo en técnicas opacas: óleo, gouache, ceras)

Además guarda hojas de contacto en tools/out/ para revisar el resultado.

uso: python3 tools/extract_strokes.py [--only OLEO] [--no-write]
"""
import glob
import hashlib
import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "TEXTURES", "TRAZOS")
OUT_LIB = os.path.join(ROOT, "plugin", "textures")
OUT_DBG = os.path.join(ROOT, "tools", "out")

FOLDERS = {"OLEO": "oleo", "GUACHE": "gouache", "CERAS": "ceras", "LAPIZ": "lapiz", "AGUADAS": "acuarela"}
WT = {"oleo": 128, "gouache": 96, "ceras": 96, "acuarela": 96, "lapiz": 80}  # ancho de la textura
OPAQUE = {"oleo", "gouache", "ceras"}
BODY_FRAC = 0.70  # fracción del ancho de textura que ocupa el cuerpo del trazo
HMAX = None       # alto máximo de la textura (si se supera, se estrecha)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


def load_lum(path):
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32) / 255.0
    return 0.299 * im[..., 0] + 0.587 * im[..., 1] + 0.114 * im[..., 2]


def fit_background(L):
    """Superficie polinómica (grado 3) ajustada al papel: corrige viñeteo y degradados."""
    f = 8
    h, w = L.shape
    small = L[: h // f * f, : w // f * f].reshape(h // f, f, w // f, f).mean(axis=(1, 3))
    sh, sw = small.shape
    yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float64)
    xn, yn = xx / sw * 2 - 1, yy / sh * 2 - 1
    terms = [np.ones_like(xn), xn, yn, xn * xn, xn * yn, yn * yn, xn ** 3, xn * xn * yn, xn * yn * yn, yn ** 3]
    Amat = np.stack([t.ravel() for t in terms], 1)
    z = small.ravel().astype(np.float64)
    mask = z >= np.percentile(z, 50)
    if mask.sum() < 10:
        return np.full(L.shape, max(0.3, float(np.median(L))), np.float32)
    for _ in range(5):
        if mask.sum() < 10:
            break
        coef, *_ = np.linalg.lstsq(Amat[mask], z[mask], rcond=None)
        fit = Amat @ coef
        r = z - fit
        mad = np.median(np.abs(r[mask])) + 1e-4
        mask = (r > -3 * mad) & (r < 4 * mad)
    # evaluar a resolución completa
    Y, X = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = X / w * 2 - 1, Y / h * 2 - 1
    terms = [np.ones_like(xn), xn, yn, xn * xn, xn * yn, yn * yn, xn ** 3, xn * xn * yn, xn * yn * yn, yn ** 3]
    bg = sum(c * t for c, t in zip(coef.astype(np.float32), terms))
    return np.maximum(bg, 0.3)


def split_columns(mask, n=3):
    """Divide la imagen en n franjas verticales, una por trazo."""
    prof = ndi.gaussian_filter1d(mask.sum(0).astype(np.float32), 12)
    w = len(prof)
    on = prof > 0.12 * prof.max()
    runs, x = [], 0
    while x < w:
        if on[x]:
            s = x
            while x < w and on[x]:
                x += 1
            runs.append([s, x - 1])
        x += 1
    # unir huecos muy pequeños
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < 25:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    runs = merged
    while len(runs) > n:  # unir los dos más cercanos
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
        i = int(np.argmin(gaps))
        runs[i] = [runs[i][0], runs[i + 1][1]]
        del runs[i + 1]
    while len(runs) < n:  # partir el más ancho por su mínimo
        widths = [r[1] - r[0] for r in runs]
        i = int(np.argmax(widths))
        a, b = runs[i]
        mid = a + (b - a) // 4 + int(np.argmin(prof[a + (b - a) // 4: b - (b - a) // 4]))
        runs[i] = [a, mid - 1]
        runs.insert(i + 1, [mid + 1, b])
    bounds = []
    for i, r in enumerate(runs):
        lo = 0 if i == 0 else (runs[i - 1][1] + r[0]) // 2
        hi = w if i == len(runs) - 1 else (r[1] + runs[i + 1][0]) // 2
        bounds.append((lo, hi))
    return bounds


def extract_image(path, tech):
    L = load_lum(path)
    bg = fit_background(L)
    N = np.clip(L / bg, 0, 1.2)
    D = np.clip(1 - N, 0, 1)
    h, w = D.shape
    # ruido del papel (grano) medido en zonas claras
    Ds = ndi.gaussian_filter(D, 2.0)
    paper = Ds < np.percentile(Ds, 40)
    sig = float(np.std(D[paper]))
    t0 = max(0.035, 2.5 * sig)
    thr = max(0.06 if tech != "lapiz" else 0.045, 4 * sig)
    mask = Ds > thr
    mask = ndi.binary_closing(mask, structure=np.ones((15, 15)), iterations=1)
    mask = ndi.binary_opening(mask, structure=np.ones((3, 3)))
    bounds = split_columns(mask)
    Dc = np.clip((D - t0) / (1 - t0), 0, 1)  # quita el suelo de grano del papel
    strokes = []
    for (x0, x1) in bounds:
        sub = mask[:, x0:x1]
        lab, nl = ndi.label(sub)
        if nl == 0:
            continue
        sizes = ndi.sum(sub, lab, range(1, nl + 1))
        main = int(np.argmax(sizes)) + 1
        objs = ndi.find_objects(lab)
        ms = objs[main - 1]
        my0, my1, mx0, mx1 = ms[0].start, ms[0].stop, ms[1].start, ms[1].stop
        mw = mx1 - mx0
        keep = np.zeros_like(sub)
        for k in range(1, nl + 1):
            sl = objs[k - 1]
            cy0, cy1, cx0, cx1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
            dx = max(0, mx0 - cx1, cx0 - mx1)
            dy = max(0, my0 - cy1, cy0 - my1)
            if k == main or (dx < 0.5 * mw and dy < 0.6 * mw and sizes[k - 1] > 12):
                keep |= lab == k
        M = ndi.binary_dilation(keep, iterations=6)
        Msoft = ndi.gaussian_filter(M.astype(np.float32), 3)
        strokes.append(extract_stroke(Dc[:, x0:x1] * Msoft, Msoft, tech, x0))
    return [s for s in strokes if s is not None], {"sig": sig, "bounds": bounds}


def extract_stroke(Dm, Msoft, tech, xoff):
    h, w = Dm.shape
    xs = np.arange(w, dtype=np.float64)
    mass = Dm.sum(1)
    if mass.max() <= 0:
        return None
    core = mass > 0.25 * np.median(mass[mass > mass.max() * 0.1])
    ys = np.where(mass > 0.02 * mass.max())[0]
    if len(ys) < 50:
        return None
    y0, y1 = ys[0], ys[-1]
    # centro y anchura por fila
    cen = np.zeros(h)
    wid = np.zeros(h)
    for y in range(y0, y1 + 1):
        row = Dm[y]
        m = row.sum()
        if m <= 1e-6:
            cen[y], wid[y] = np.nan, np.nan
            continue
        c = np.cumsum(row) / m
        cen[y] = (row * xs).sum() / m
        wid[y] = np.interp(0.95, c, xs) - np.interp(0.05, c, xs)
    rows = np.arange(y0, y1 + 1)
    good = ~np.isnan(cen[rows]) & core[rows]
    cen_s = np.interp(np.arange(h), rows[good], cen[rows][good])
    cen_s = ndi.gaussian_filter1d(cen_s, 40)
    wid_core = wid[rows][good]
    L = y1 - y0
    mid = wid_core[int(len(wid_core) * 0.2): int(len(wid_core) * 0.8)]
    wb = float(np.median(mid)) / 0.9  # 5–95 % → anchura aproximada del cuerpo
    Wt = WT[tech]
    s = BODY_FRAC * Wt / wb
    pad = int(0.15 * wb)
    ya, yb = max(0, y0 - pad), min(h - 1, y1 + pad)
    Lt = int(round((yb - ya) * s))
    if HMAX and Lt > HMAX:
        Wt = max(12, int(Wt * HMAX / Lt))
        s = BODY_FRAC * Wt / wb
        Lt = int(round((yb - ya) * s))
    # enderezar siguiendo la línea central (con antialias)
    Dpre = ndi.gaussian_filter(Dm, 0.45 / s)
    jj, ii = np.mgrid[0:Lt, 0:Wt].astype(np.float64)
    yy = ya + jj / s
    xx = np.interp(yy, np.arange(h), cen_s) + (ii - (Wt - 1) / 2) / s
    R = ndi.map_coordinates(Dpre, [yy, xx], order=1, mode="constant", cval=0.0).astype(np.float32)
    rows_mass = R.sum(1)
    # cabeza (inicio) y cola (final seco)
    med = np.median(rows_mass[int(Lt * 0.25): int(Lt * 0.75)])
    top = int(np.argmax(rows_mass > 0.6 * med))
    head = int(np.clip(top + 0.5 * Wt, 0.3 * Wt, 0.25 * Lt))
    above = np.where(rows_mass[int(Lt * 0.4):] > 0.7 * med)[0]
    tail = int(Lt * 0.4) + (int(above[-1]) if len(above) else int(Lt * 0.5))
    tail = int(np.clip(tail, head + Wt, Lt - 0.3 * Wt))

    core_vals = R[int(Lt * 0.2): int(Lt * 0.7), int(Wt * 0.3): int(Wt * 0.7)]
    if tech in OPAQUE:
        Db = float(np.percentile(core_vals, 60))
        Rs = ndi.gaussian_filter(R, 0.7)
        A = smoothstep(0.1 * Db, 0.62 * Db, Rs)
        Nn = 1 - R
        sg = Wt / 14
        Nb = ndi.gaussian_filter(Nn * A, sg) / (ndi.gaussian_filter(A, sg) + 1e-4)
        S = np.where(A > 0.25, Nn / np.maximum(Nb, 0.03), 1.0) - 1.0
        cs = S[A > 0.6]
        sd = float(np.std(cs)) if cs.size > 50 else 0.1
        S = np.clip(S * (0.11 / max(sd, 0.02)), -0.75, 0.75)
        S = S * smoothstep(0.15, 0.6, A)  # sin detalle en los bordes casi vacíos
        Su8 = np.clip(S * 127.5 + 128, 0, 255).astype(np.uint8)
        paint = 1 - Db
    else:
        D99 = float(np.percentile(R[R > 0.02], 99.3)) if (R > 0.02).sum() > 100 else 1.0
        A = np.clip(R / max(D99, 0.05), 0, 1)
        Su8 = None
        paint = 1 - D99
    Au8 = np.clip(A * 255 + 0.5, 0, 255).astype(np.uint8)
    fill = float((A[head:tail] > 0.5).mean()) if tail > head else 0.0
    rm = (A > 0.3).sum(1)
    rows_on = np.where(rm > 0.25 * np.median(rm[rm > 0]))[0] if (rm > 0).any() else np.array([0, Lt - 1])
    topr, botr = int(rows_on[0]), int(rows_on[-1])
    head = int(max(head, topr + 2))
    tail = int(np.clip(tail, head + 2, max(head + 2, botr - 2)))
    return {
        "A": Au8, "S": Su8, "w": Wt, "h": Lt, "head": head, "tail": tail, "top": topr, "bottom": botr,
        "fill": round(fill, 3), "paint": round(paint, 3), "aspect": round(Lt / Wt, 2),
        "srcWidth": round(wb, 1), "x": xoff,
    }


def contact_sheet(samples, tech, path):
    if not samples:
        return
    scale = 0.6
    cols = len(samples)
    hs = [int(s["h"] * scale) for s in samples]
    ws = [int(s["w"] * scale) for s in samples]
    H = max(hs) + 40
    W = sum(ws) + 14 * cols + 14
    im = Image.new("RGB", (W, H), (236, 233, 226))
    d = ImageDraw.Draw(im)
    x = 14
    for k, s in enumerate(samples):
        A = s["A"].astype(np.float32) / 255
        if s["S"] is not None:
            S = (s["S"].astype(np.float32) - 128) / 127.5
            base = 0.32 * (1 + 1.2 * S)
            val = (1 - A) * 0.95 + A * np.clip(base, 0, 1)
        else:
            val = 0.95 - A * 0.85
        g = Image.fromarray(np.clip(val * 255, 0, 255).astype(np.uint8)).resize((ws[k], hs[k]), Image.LANCZOS)
        im.paste(g.convert("RGB"), (x, 30))
        d.line([(x, 30 + int(s["head"] * scale)), (x + 6, 30 + int(s["head"] * scale))], fill=(40, 200, 120), width=2)
        d.line([(x, 30 + int(s["tail"] * scale)), (x + 6, 30 + int(s["tail"] * scale))], fill=(220, 60, 60), width=2)
        d.text((x, 8), str(k + 1), fill=(20, 20, 20))
        x += ws[k] + 14
    im.save(path, quality=88)


def write_library(tech, samples, path):
    header = {"version": 1, "technique": tech, "samples": []}
    blobs = []
    off = 0
    for s in samples:
        ch = 2 if s["S"] is not None else 1
        meta = {k: s[k] for k in ("w", "h", "head", "tail", "top", "bottom", "fill", "paint", "aspect")}
        meta["q"] = s.get("q", 1)
        meta.update({"offset": off, "channels": ch})
        header["samples"].append(meta)
        blobs.append(s["A"].tobytes())
        off += s["w"] * s["h"]
        if ch == 2:
            blobs.append(s["S"].tobytes())
            off += s["w"] * s["h"]
    hj = json.dumps(header, ensure_ascii=True, separators=(",", ":")).encode("ascii")
    pad = (4 - (8 + len(hj)) % 4) % 4
    with open(path, "wb") as f:
        f.write(b"TRZ1")
        f.write(struct.pack("<I", len(hj) + pad))
        f.write(hj + b" " * pad)
        for b in blobs:
            f.write(b)
    return os.path.getsize(path)


def main():
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]
    write = "--no-write" not in sys.argv
    os.makedirs(OUT_LIB, exist_ok=True)
    os.makedirs(OUT_DBG, exist_ok=True)
    total = 0
    for folder, tech in FOLDERS.items():
        if only and folder != only:
            continue
        files = sorted(glob.glob(os.path.join(SRC, folder, "*.jp*g")) + glob.glob(os.path.join(SRC, folder, "*.png")))
        # descartar copias exactas (p. ej. «imagen (1).jpg»)
        seen, uniq = set(), []
        for f in files:
            hsh = hashlib.md5(open(f, "rb").read()).hexdigest()
            if hsh not in seen:
                seen.add(hsh)
                uniq.append(f)
        files = uniq
        samples = []
        for f in files:
            st, info = extract_image(f, tech)
            for s in st:
                s["file"] = os.path.basename(f)
            samples.extend(st)
            print(f"  {folder}/{os.path.basename(f)[:30]}: {len(st)} trazos · grano {info['sig']:.3f} · franjas {info['bounds']}")
        contact_sheet(samples, tech, os.path.join(OUT_DBG, f"contacto_{tech}.jpg"))
        if write:
            size = write_library(tech, samples, os.path.join(OUT_LIB, f"{tech}.bin"))
            total += size
            print(f"{folder} → {tech}.bin: {len(samples)} trazos, {size / 1024:.0f} KB")
    if write:
        print(f"total bibliotecas: {total / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
