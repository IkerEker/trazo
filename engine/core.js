"use strict";
/*
 * Trazo · núcleo numérico
 * Utilidades rápidas sobre Float32Array: aleatorio con semilla, ruido,
 * desenfoques O(n), remuestreo y muestreo bilineal.
 * Sin dependencias: funciona igual en UXP (Photoshop) y en Node.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/* ---------- desenfoque gaussiano aproximado (3 cajas) ---------- */
function boxesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

function boxBlurH(src, dst, w, h, r) {
  if (r <= 0) { dst.set(src); return; }
  const inv = 1 / (r + r + 1);
  const wm = w - 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + (k < 0 ? 0 : k > wm ? wm : k)];
    dst[row] = acc * inv;
    for (let x = 1; x < w; x++) {
      const add = x + r, sub = x - r - 1;
      acc += src[row + (add > wm ? wm : add)] - src[row + (sub < 0 ? 0 : sub)];
      dst[row + x] = acc * inv;
    }
  }
}

function boxBlurV(src, dst, w, h, r) {
  if (r <= 0) { dst.set(src); return; }
  const inv = 1 / (r + r + 1);
  const hm = h - 1;
  // procesa por filas completas para aprovechar la caché
  const acc = new Float32Array(w);
  for (let k = -r; k <= r; k++) {
    const yy = k < 0 ? 0 : k > hm ? hm : k;
    const o = yy * w;
    for (let x = 0; x < w; x++) acc[x] += src[o + x];
  }
  for (let x = 0; x < w; x++) dst[x] = acc[x] * inv;
  for (let y = 1; y < h; y++) {
    const add = y + r, sub = y - r - 1;
    const oa = (add > hm ? hm : add) * w;
    const os = (sub < 0 ? 0 : sub) * w;
    const od = y * w;
    for (let x = 0; x < w; x++) {
      acc[x] += src[oa + x] - src[os + x];
      dst[od + x] = acc[x] * inv;
    }
  }
}

/** Desenfoque gaussiano in-place (aprox. 3 cajas). tmp opcional. */
function gaussBlur(plane, w, h, sigma, tmp) {
  if (sigma < 0.3) return plane;
  const t = tmp && tmp.length >= plane.length ? tmp : new Float32Array(plane.length);
  const boxes = boxesForGauss(sigma, 3);
  for (let i = 0; i < 3; i++) {
    const r = (boxes[i] - 1) >> 1;
    boxBlurH(plane, t, w, h, r);
    boxBlurV(t, plane, w, h, r);
  }
  return plane;
}

/* ---------- muestreo ---------- */
function bilinear(p, w, h, x, y) {
  if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;
  const r0 = y0 * w, r1 = y1 * w;
  const a = p[r0 + x0] + (p[r0 + x1] - p[r0 + x0]) * fx;
  const b = p[r1 + x0] + (p[r1 + x1] - p[r1 + x0]) * fx;
  return a + (b - a) * fy;
}

/** Remuestreo separable con filtro triangular (antialias al reducir). */
function resample(src, sw, sh, dw, dh) {
  const tmp = resample1D(src, sw, sh, dw, true);
  return resample1D(tmp, dw, sh, dh, false);
}

function buildWeights(srcN, dstN) {
  const scale = srcN / dstN;
  const support = Math.max(1, scale);
  const idx = [], wts = [];
  for (let i = 0; i < dstN; i++) {
    const center = (i + 0.5) * scale - 0.5;
    const lo = Math.max(0, Math.floor(center - support));
    const hi = Math.min(srcN - 1, Math.ceil(center + support));
    const ii = [], ww = [];
    let sum = 0;
    for (let j = lo; j <= hi; j++) {
      const wgt = Math.max(0, 1 - Math.abs(j - center) / support);
      if (wgt > 0) { ii.push(j); ww.push(wgt); sum += wgt; }
    }
    if (sum === 0) { ii.push(clamp(Math.round(center), 0, srcN - 1)); ww.push(1); sum = 1; }
    for (let k = 0; k < ww.length; k++) ww[k] /= sum;
    idx.push(Int32Array.from(ii));
    wts.push(Float32Array.from(ww));
  }
  return { idx, wts };
}

function resample1D(src, w, h, n, horizontal) {
  if (horizontal) {
    if (n === w) return Float32Array.from(src);
    const out = new Float32Array(n * h);
    const { idx, wts } = buildWeights(w, n);
    for (let y = 0; y < h; y++) {
      const row = y * w, orow = y * n;
      for (let x = 0; x < n; x++) {
        const ii = idx[x], ww = wts[x];
        let s = 0;
        for (let k = 0; k < ii.length; k++) s += src[row + ii[k]] * ww[k];
        out[orow + x] = s;
      }
    }
    return out;
  }
  if (n === h) return Float32Array.from(src);
  const out = new Float32Array(w * n);
  const { idx, wts } = buildWeights(h, n);
  for (let y = 0; y < n; y++) {
    const ii = idx[y], ww = wts[y], orow = y * w;
    for (let k = 0; k < ii.length; k++) {
      const row = ii[k] * w, wk = ww[k];
      for (let x = 0; x < w; x++) out[orow + x] += src[row + x] * wk;
    }
  }
  return out;
}

/** Reduce a la mitad (promedio 2x2). */
function halve(src, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.min(h - 1, y * 2) * w, y1 = Math.min(h - 1, y * 2 + 1) * w;
    for (let x = 0; x < nw; x++) {
      const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1);
      out[y * nw + x] = (src[y0 + x0] + src[y0 + x1] + src[y1 + x0] + src[y1 + x1]) * 0.25;
    }
  }
  return { data: out, w: nw, h: nh };
}

/* ---------- ruido ---------- */
/** Ruido de valor fBm en una rejilla w×h (baja resolución). */
function fbmGrid(w, h, cell, octaves, seed, gain) {
  const out = new Float32Array(w * h);
  let amp = 1, total = 0, c = cell;
  gain = gain || 0.5;
  for (let o = 0; o < octaves; o++) {
    const sd = seed + o * 1013;
    for (let y = 0; y < h; y++) {
      const fy = y / c, iy = Math.floor(fy), ty = fy - iy;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = x / c, ix = Math.floor(fx), tx = fx - ix;
        const sx = tx * tx * (3 - 2 * tx);
        const a = hash2(ix, iy, sd), b = hash2(ix + 1, iy, sd);
        const cc = hash2(ix, iy + 1, sd), d = hash2(ix + 1, iy + 1, sd);
        const v = a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
        out[y * w + x] += v * amp;
      }
    }
    total += amp;
    amp *= gain;
    c = Math.max(1, c / 2);
  }
  const inv = 1 / total;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

/** Normaliza in-place a [0,1] usando percentiles aproximados. */
function normalizeRange(p, loPct, hiPct) {
  const n = p.length;
  const step = Math.max(1, Math.floor(n / 20000));
  const samp = [];
  for (let i = 0; i < n; i += step) samp.push(p[i]);
  samp.sort((a, b) => a - b);
  const lo = samp[Math.floor((samp.length - 1) * (loPct || 0))];
  const hi = samp[Math.floor((samp.length - 1) * (hiPct || 1))];
  const inv = hi > lo ? 1 / (hi - lo) : 1;
  for (let i = 0; i < n; i++) {
    const v = (p[i] - lo) * inv;
    p[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return p;
}

function percentile(p, pct) {
  const n = p.length;
  const step = Math.max(1, Math.floor(n / 20000));
  const samp = [];
  for (let i = 0; i < n; i += step) samp.push(p[i]);
  samp.sort((a, b) => a - b);
  return samp[Math.floor((samp.length - 1) * pct)];
}

/* ---------- textura en mosaico (grano de papel, lienzo) ---------- */
const TILE = 512;
const TILE_MASK = TILE - 1;

/** Grano de papel en mosaico 512×512 (valores 0..1, media ~0.5). */
const _tileCache = new Map();
function makeGrainTile(seed, kind) {
  const key = kind + ":" + seed;
  if (_tileCache.has(key)) return _tileCache.get(key);
  const t = _makeGrainTile(seed, kind);
  if (_tileCache.size > 12) _tileCache.clear();
  _tileCache.set(key, t);
  return t;
}

function _makeGrainTile(seed, kind) {
  const N = TILE;
  const out = new Float32Array(N * N);
  if (kind === "canvas") {
    // trama de lienzo: hilos horizontales y verticales con irregularidad
    const per = 4; // píxeles por hilo
    const jitter = fbmGrid(N, N, 32, 3, seed, 0.5);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const j = (jitter[i] - 0.5) * 1.2;
        const ax = Math.sin(((x + j) / per) * Math.PI);
        const ay = Math.sin(((y - j) / per) * Math.PI);
        const over = ((Math.floor(x / per) + Math.floor(y / per)) & 1) === 0;
        const warp = Math.abs(over ? ax : ay);
        const weft = Math.abs(over ? ay : ax);
        out[i] = 0.25 + 0.5 * (0.7 * warp + 0.3 * weft) + (hash2(x, y, seed) - 0.5) * 0.15;
      }
    }
  } else if (kind === "fine" || kind === "tooth") {
    // grano fino (lápiz) / diente de papel (ceras): ruido de píxel ligeramente
    // suavizado + algo de ondulación de baja frecuencia
    const px = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) px[i] = hash2(i % N, (i / N) | 0, seed + 41);
    const tmp = new Float32Array(N * N);
    const r = kind === "fine" ? 1 : 1;
    boxBlurH(px, tmp, N, N, r); boxBlurV(tmp, px, N, N, r);
    const mid = fbmGrid(N, N, kind === "fine" ? 4 : 3, 2, seed + 43, 0.5);
    const low = fbmGrid(N, N, 48, 2, seed + 47, 0.5);
    const wp = kind === "fine" ? 0.78 : 0.62, wm = kind === "fine" ? 0.12 : 0.2;
    for (let i = 0; i < N * N; i++) out[i] = px[i] * wp + mid[i] * wm + low[i] * (1 - wp - wm);
  } else {
    // papel: varias frecuencias de ruido + fibras alargadas
    const coarse = fbmGrid(N, N, 24, 3, seed + 7, 0.55);
    const fine = fbmGrid(N, N, 3, 2, seed + 13, 0.5);
    const fib = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) fib[i] = hash2(i % N, (i / N) | 0, seed + 29);
    // fibras: desenfoque direccional horizontal ligero
    const tmp = new Float32Array(N * N);
    boxBlurH(fib, tmp, N, N, 3);
    for (let i = 0; i < N * N; i++) {
      const wCoarse = kind === "rough" ? 0.45 : 0.3;
      out[i] = coarse[i] * wCoarse + fine[i] * (0.85 - wCoarse) + tmp[i] * 0.15;
    }
  }
  return normalizeRange(out, 0.01, 0.99);
}

function tileAt(tile, x, y) {
  return tile[((y | 0) & TILE_MASK) * TILE + ((x | 0) & TILE_MASK)];
}

/* ---------- color ---------- */
/** Variación de color de una pincelada: rotación de tono, saturación y luz. */
function varyColor(r, g, b, dh, ds, dl, out) {
  // rotación de tono alrededor del eje gris (espacio YIQ)
  if (dh !== 0) {
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const i = 0.596 * r - 0.274 * g - 0.322 * b;
    const q = 0.211 * r - 0.523 * g + 0.312 * b;
    const c = Math.cos(dh), s = Math.sin(dh);
    const i2 = i * c - q * s, q2 = i * s + q * c;
    r = y + 0.956 * i2 + 0.621 * q2;
    g = y - 0.272 * i2 - 0.647 * q2;
    b = y - 1.106 * i2 + 1.703 * q2;
  }
  if (ds !== 0) {
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const k = 1 + ds;
    r = y + (r - y) * k; g = y + (g - y) * k; b = y + (b - y) * k;
  }
  if (dl !== 0) {
    if (dl > 0) { r += (1 - r) * dl; g += (1 - g) * dl; b += (1 - b) * dl; }
    else { const k = 1 + dl; r *= k; g *= k; b *= k; }
  }
  out[0] = r < 0 ? 0 : r > 1 ? 1 : r;
  out[1] = g < 0 ? 0 : g > 1 ? 1 : g;
  out[2] = b < 0 ? 0 : b > 1 ? 1 : b;
  return out;
}

/* ---------- control de tiempo (ceder el hilo, progreso, cancelar) ---------- */
class CancelError extends Error {
  constructor() { super("Cancelado"); this.name = "CancelError"; this.cancelled = true; }
}

function makeClock(opts) {
  opts = opts || {};
  const sliceMs = opts.sliceMs || 40;
  const onProgress = opts.onProgress || null;
  const shouldCancel = opts.shouldCancel || null;
  const yieldFn = opts.yieldFn || (() => new Promise((r) => setTimeout(r, 0)));
  let last = Date.now();
  let stageLo = 0, stageHi = 1, label = "";
  return {
    stage(lo, hi, text) { stageLo = lo; stageHi = hi; if (text) label = text; this.report(0); },
    report(f) { if (onProgress) onProgress(stageLo + (stageHi - stageLo) * clamp(f, 0, 1), label); },
    due() { return Date.now() - last > sliceMs; },
    async tick(f) {
      if (Date.now() - last <= sliceMs) return;
      if (f !== undefined) this.report(f);
      await yieldFn();
      last = Date.now();
      if (shouldCancel && shouldCancel()) throw new CancelError();
    },
    async force(f) {
      if (f !== undefined) this.report(f);
      await yieldFn();
      last = Date.now();
      if (shouldCancel && shouldCancel()) throw new CancelError();
    },
  };
}

module.exports = {
  mulberry32, hash2, clamp, lerp, smoothstep,
  gaussBlur, boxBlurH, boxBlurV, bilinear, resample, halve,
  fbmGrid, normalizeRange, percentile, makeGrainTile, tileAt, TILE, TILE_MASK,
  varyColor, CancelError, makeClock,
};
