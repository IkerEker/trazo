"""
Trazo · texturas de soporte reales (lienzo, papel de acuarela, papel de dibujo).

Toma el fondo de las imágenes de TEXTURES (zonas sin trazos), corrige la luz y
sintetiza una textura de 512×512 que se repite sin costuras, con el mismo
espectro que el papel real (síntesis de fase aleatoria). Para el lienzo, que
es periódico, usa además un recorte real hecho repetible por desplazamiento
y fundido que conserva la trama.

Salida: plugin/textures/soporte-<tipo>.bin (contenedor TRZ1, 1 canal 8 bits)
uso: python3 tools/extract_papers.py
"""
import glob
import hashlib
import json
import os
import struct

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

import extract_strokes as ES

N = 512
KINDS = {
    "lienzo": ["OLEO"],
    "acuarela": ["AGUADAS", "GUACHE"],
    "dibujo": ["LAPIZ", "CERAS"],
}


def background_blocks(path, tech, block=256):
    L = ES.load_lum(path)
    bg = ES.fit_background(L)
    Nn = L / bg
    D = np.clip(1 - Nn, 0, 1)
    Ds = ndi.gaussian_filter(D, 2.0)
    paper = Ds < np.percentile(Ds, 40)
    sig = float(np.std(D[paper]))
    mask = Ds > max(0.05, 4 * sig)
    mask = ndi.binary_dilation(mask, iterations=45)  # lejos de los trazos y migas
    h, w = Nn.shape
    T = Nn - ndi.gaussian_filter(Nn, 24)  # solo la textura fina
    out = []
    step = block // 2
    for y in range(16, h - block - 16, step):
        for x in range(16, w - block - 16, step):
            if not mask[y:y + block, x:x + block].any():
                out.append(T[y:y + block, x:x + block].astype(np.float64))
    return out


def random_phase(blocks, n, seed):
    b = blocks[0].shape[0]
    win = np.outer(np.hanning(b), np.hanning(b))
    P = np.zeros((b, b))
    for blk in blocks:
        P += np.abs(np.fft.fft2((blk - blk.mean()) * win)) ** 2
    P /= len(blocks)
    amp = np.sqrt(P)
    # remuestrear el espectro a n×n (misma frecuencia en ciclos/píxel)
    amp_s = np.fft.fftshift(amp)
    zoom = n / b
    amp_n = ndi.zoom(amp_s, zoom, order=1)
    amp_n = np.fft.ifftshift(amp_n)
    rng = np.random.default_rng(seed)
    phase = np.exp(2j * np.pi * rng.random((n, n)))
    F = amp_n * phase
    F[0, 0] = 0
    t = np.real(np.fft.ifft2(F))
    target_sd = np.mean([blk.std() for blk in blocks])
    t = t / (t.std() + 1e-9) * target_sd
    return t, target_sd


def periodic_from_block(blocks, n, target_sd):
    """Lienzo: recorte real ampliado a n, hecho repetible con fundido que mantiene la varianza."""
    # el bloque con menos variación de baja frecuencia (más uniforme)
    best = min(blocks, key=lambda b: ndi.gaussian_filter(b, 8).std())
    b = best.shape[0]
    reps = int(np.ceil(n / b)) + 1
    big = np.tile(best, (reps, reps))[:n, :n]
    # rejilla de bloques distintos para no repetir el mismo recorte
    rng = np.random.default_rng(3)
    for by in range(0, n, b):
        for bx in range(0, n, b):
            blk = blocks[rng.integers(len(blocks))]
            big[by:by + b, bx:bx + b] = blk[: min(b, n - by), : min(b, n - bx)]
    # costuras: fundido con ventana de 32 px conservando la varianza
    return make_tileable(big, target_sd)


def make_tileable(t, target_sd):
    n = t.shape[0]
    shifted = np.roll(np.roll(t, n // 2, 0), n // 2, 1)
    x = np.abs(np.arange(n) - (n - 1) / 2) / ((n - 1) / 2)  # 0 centro, 1 borde
    wx = np.clip((1 - x) / 0.25, 0, 1)
    w2 = np.outer(wx, wx)
    mix = (w2 * t + (1 - w2) * shifted) / np.sqrt(w2 ** 2 + (1 - w2) ** 2)
    return mix / (mix.std() + 1e-9) * target_sd


def main():
    out_dir = os.path.join(ES.ROOT, "plugin", "textures")
    dbg = os.path.join(ES.ROOT, "tools", "out")
    os.makedirs(out_dir, exist_ok=True)
    previews = []
    for kind, folders in KINDS.items():
        blocks = []
        seen = set()
        for folder in folders:
            for f in sorted(glob.glob(os.path.join(ES.SRC, folder, "*.jp*g"))):
                hsh = hashlib.md5(open(f, "rb").read()).hexdigest()
                if hsh in seen:
                    continue
                seen.add(hsh)
                blocks += background_blocks(f, ES.FOLDERS[folder])
        print(f"{kind}: {len(blocks)} bloques de fondo")
        t, sd = random_phase(blocks, N, seed=11)
        if kind == "lienzo":
            t = periodic_from_block(blocks, N, sd)
        # a 0..255 con 128 = papel medio (±4σ)
        u8 = np.clip(128 + t / (4 * sd) * 127, 0, 255).astype(np.uint8)
        header = {"version": 1, "kind": kind, "w": N, "h": N, "sd": round(float(sd), 5), "offset": 0}
        hj = json.dumps(header, ensure_ascii=True, separators=(",", ":")).encode("ascii")
        pad = (4 - (8 + len(hj)) % 4) % 4
        path = os.path.join(out_dir, f"soporte-{kind}.bin")
        with open(path, "wb") as fh:
            fh.write(b"TRZ1" + struct.pack("<I", len(hj) + pad) + hj + b" " * pad + u8.tobytes())
        print(f"  → {os.path.basename(path)} σ={sd:.4f}")
        # vista previa: 2×2 repeticiones (para ver costuras) + bloque real
        rep = np.tile(u8, (2, 2))
        real = np.clip(128 + blocks[len(blocks) // 2] / (4 * sd) * 127, 0, 255).astype(np.uint8)
        real = np.kron(real, np.ones((2, 2), dtype=np.uint8))
        canvas = np.full((1024, 1024 + 16 + 512), 255, np.uint8)
        canvas[:, :1024] = rep
        canvas[:512, 1040:1552] = real
        previews.append((kind, canvas))
    for kind, c in previews:
        Image.fromarray(c).save(os.path.join(dbg, f"soporte_{kind}.png"))


if __name__ == "__main__":
    main()
