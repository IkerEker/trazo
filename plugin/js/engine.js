/*! Trazo 1.3.1 · motor de pintura (generado por tools/bundle.js, no editar) */
(function (root) {
"use strict";
const __defs = {}, __cache = {};
function __req(name) {
  const key = name.replace(/^\.\//, "");
  if (__cache[key]) return __cache[key].exports;
  const def = __defs[key];
  if (!def) throw new Error("Módulo no encontrado: " + name);
  const module = { exports: {} };
  __cache[key] = module;
  def(module, module.exports, __req);
  return module.exports;
}
__defs["analysis.js"] = function (module, exports, require) {
/*
 * Trazo · análisis de la imagen
 * - Campo de direcciones de trazo (tensor de estructura suavizado): las
 *   pinceladas siguen los bordes y las formas reales de la foto.
 * - Mapa de bordes / detalle, máscara de cobertura y pirámide de color.
 * Todo lo pesado se calcula a "resolución de análisis" (≤1024 px) y se
 * muestrea con interpolación bilineal a resolución completa.
 */
const C = require("./core.js");

const ANALYSIS_MAX = 1024;

class Context {
  /**
   * @param {object} input {width,height,data(Uint8Array),components}
   * @param {object} opts  {seed, baseAngle(rad), flowSigma(px@1000), bias}
   */
  constructor(input, opts) {
    const W = input.width, H = input.height;
    this.W = W; this.H = H;
    this.N = W * H;
    this.data = input.data;
    this.comp = input.components || 4;
    this.s = Math.max(W, H) / 1000; // escala relativa: mismo aspecto en preview y final
    this.seed = opts.seed | 0;
    this.rand = C.mulberry32(this.seed * 7919 + 17);

    const long = Math.max(W, H);
    const fa = long > ANALYSIS_MAX ? long / ANALYSIS_MAX : 1;
    this.fa = fa;
    this.aw = Math.max(8, Math.round(W / fa));
    this.ah = Math.max(8, Math.round(H / fa));
    this.ax = this.aw / W; // factor a coordenadas de análisis
    this.ay = this.ah / H;
    this.srcAlpha = null;
  }

  /* -------- planos a resolución de análisis y pirámide -------- */
  async buildBase(clock) {
    const { W, H, N, data, comp } = this;
    // nivel 1 de la pirámide (mitad) directamente desde los bytes
    const w1 = Math.max(1, W >> 1), h1 = Math.max(1, H >> 1);
    const r1 = new Float32Array(w1 * h1), g1 = new Float32Array(w1 * h1), b1 = new Float32Array(w1 * h1);
    const k = 1 / (255 * 4);
    for (let y = 0; y < h1; y++) {
      const ya = Math.min(H - 1, y * 2) * W, yb = Math.min(H - 1, y * 2 + 1) * W;
      for (let x = 0; x < w1; x++) {
        const xa = Math.min(W - 1, x * 2), xb = Math.min(W - 1, x * 2 + 1);
        const i0 = (ya + xa) * comp, i1 = (ya + xb) * comp, i2 = (yb + xa) * comp, i3 = (yb + xb) * comp;
        const o = y * w1 + x;
        r1[o] = (data[i0] + data[i1] + data[i2] + data[i3]) * k;
        g1[o] = (data[i0 + 1] + data[i1 + 1] + data[i2 + 1] + data[i3 + 1]) * k;
        b1[o] = (data[i0 + 2] + data[i1 + 2] + data[i2 + 2] + data[i3 + 2]) * k;
      }
      if ((y & 63) === 0) await clock.tick(y / h1 * 0.5);
    }
    if (comp === 4) {
      let anyAlpha = false;
      for (let i = 3; i < N * 4; i += 4) if (data[i] < 255) { anyAlpha = true; break; }
      if (anyAlpha) this.srcAlpha = true;
    }
    // pirámide
    const levels = [null, { r: r1, g: g1, b: b1, w: w1, h: h1 }];
    let cur = levels[1];
    while (cur.w > 8 && cur.h > 8 && levels.length < 12) {
      const hr = C.halve(cur.r, cur.w, cur.h), hg = C.halve(cur.g, cur.w, cur.h), hb = C.halve(cur.b, cur.w, cur.h);
      cur = { r: hr.data, g: hg.data, b: hb.data, w: hr.w, h: hr.h };
      levels.push(cur);
    }
    this.pyr = levels;

    // planos de análisis (remuestreo desde el nivel de pirámide más cercano por encima)
    const { aw, ah } = this;
    let src = levels[1];
    for (let l = 1; l < levels.length; l++) if (levels[l].w >= aw && levels[l].h >= ah) src = levels[l];
    if (W <= aw) {
      // imagen pequeña: análisis a resolución completa
      const r = new Float32Array(N), g = new Float32Array(N), b = new Float32Array(N);
      const inv = 1 / 255;
      for (let i = 0; i < N; i++) { r[i] = data[i * comp] * inv; g[i] = data[i * comp + 1] * inv; b[i] = data[i * comp + 2] * inv; }
      this.ar = r; this.ag = g; this.ab = b;
    } else {
      this.ar = C.resample(src.r, src.w, src.h, aw, ah);
      this.ag = C.resample(src.g, src.w, src.h, aw, ah);
      this.ab = C.resample(src.b, src.w, src.h, aw, ah);
    }
    const n = aw * ah;
    const lum = new Float32Array(n);
    for (let i = 0; i < n; i++) lum[i] = 0.299 * this.ar[i] + 0.587 * this.ag[i] + 0.114 * this.ab[i];
    this.lum = lum;
    await clock.tick(1);
  }

  /* -------- campo de direcciones -------- */
  async buildFlow(opts, clock) {
    const { aw, ah } = this;
    const n = aw * ah;
    const L = Float32Array.from(this.lum);
    const tmp = new Float32Array(n);
    C.gaussBlur(L, aw, ah, Math.max(0.8, 1.0 / Math.sqrt(this.fa)), tmp);
    const gx = new Float32Array(n), gy = new Float32Array(n);
    for (let y = 0; y < ah; y++) {
      const ym = (y > 0 ? y - 1 : 0) * aw, y0 = y * aw, yp = (y < ah - 1 ? y + 1 : y) * aw;
      for (let x = 0; x < aw; x++) {
        const xm = x > 0 ? x - 1 : 0, xp = x < aw - 1 ? x + 1 : x;
        gx[y0 + x] = (L[ym + xp] + 2 * L[y0 + xp] + L[yp + xp] - L[ym + xm] - 2 * L[y0 + xm] - L[yp + xm]) * 0.125;
        gy[y0 + x] = (L[yp + xm] + 2 * L[yp + x] + L[yp + xp] - L[ym + xm] - 2 * L[ym + x] - L[ym + xp]) * 0.125;
      }
    }
    // magnitud de borde
    const edge = new Float32Array(n);
    for (let i = 0; i < n; i++) edge[i] = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
    const e98 = C.percentile(edge, 0.985) || 1e-3;
    for (let i = 0; i < n; i++) { const v = edge[i] / e98; edge[i] = v > 1 ? 1 : v; }
    this.edgeRaw = Float32Array.from(edge);
    C.gaussBlur(edge, aw, ah, 1.0, tmp);
    this.edge = edge;
    await clock.tick(0.3);

    // tensor de estructura
    const jxx = new Float32Array(n), jxy = new Float32Array(n), jyy = new Float32Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) {
      jxx[i] = gx[i] * gx[i]; jxy[i] = gx[i] * gy[i]; jyy[i] = gy[i] * gy[i];
      mean += jxx[i] + jyy[i];
    }
    mean /= n;
    // campo fino (contornos y detalle): poco suavizado, sin sesgo
    {
      const fxx = Float32Array.from(jxx), fxy = Float32Array.from(jxy), fyy = Float32Array.from(jyy);
      const sf = Math.max(1.0, 1.6 * this.s / this.fa);
      C.gaussBlur(fxx, aw, ah, sf, tmp); C.gaussBlur(fxy, aw, ah, sf, tmp); C.gaussBlur(fyy, aw, ah, sf, tmp);
      const e0 = mean * 0.02 + 1e-12;
      const c2f = new Float32Array(n), s2f = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const cc = fxx[i] - fyy[i] + e0, ss = 2 * fxy[i];
        const mag = Math.sqrt(cc * cc + ss * ss) + 1e-12;
        c2f[i] = -cc / mag; s2f[i] = -ss / mag;
      }
      this.c2f = c2f; this.s2f = s2f;
    }
    const sig = Math.max(1.5, (opts.flowSigma || 6) * this.s / this.fa);
    C.gaussBlur(jxx, aw, ah, sig, tmp);
    C.gaussBlur(jxy, aw, ah, sig, tmp);
    C.gaussBlur(jyy, aw, ah, sig, tmp);
    await clock.tick(0.6);

    // sesgo hacia una dirección por defecto (zonas planas: cielo, agua…)
    const base = opts.baseAngle || 0;
    const wander = opts.wander === undefined ? 0.45 : opts.wander;
    const nW = Math.max(4, Math.ceil(aw / 8)), nH = Math.max(4, Math.ceil(ah / 8));
    const noise = C.fbmGrid(nW, nH, Math.max(3, nW / 3), 2, this.seed + 101, 0.5);
    const eps = (opts.bias === undefined ? 0.08 : opts.bias) * mean + 1e-9;
    const localK = opts.localBias || 0;
    const c2 = new Float32Array(n), s2 = new Float32Array(n), coh = new Float32Array(n);
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) {
        const i = y * aw + x;
        const nv = C.bilinear(noise, nW, nH, x / 8, y / 8) - 0.5;
        const a = base + nv * wander * 2;
        // vector gradiente del sesgo = perpendicular a la tangente deseada
        const gxx = -Math.sin(a), gyy = Math.cos(a);
        // sesgo global (zonas planas) + local (zonas con textura sin dirección clara)
        const tr = jxx[i] + jyy[i];
        let co = 0;
        if (localK > 0 && tr > 1e-12) {
          const dd = jxx[i] - jyy[i];
          co = Math.sqrt(dd * dd + 4 * jxy[i] * jxy[i]) / tr; // coherencia 0..1
        }
        const e = eps + localK * tr * (1 - co) * (1 - co);
        const Jxx = jxx[i] + e * gxx * gxx, Jxy = jxy[i] + e * gxx * gyy, Jyy = jyy[i] + e * gyy * gyy;
        // ángulo doble del gradiente dominante; la tangente es perpendicular → signo invertido
        const cc = Jxx - Jyy, ss = 2 * Jxy;
        const mag = Math.sqrt(cc * cc + ss * ss) + 1e-12;
        c2[i] = -cc / mag;
        s2[i] = -ss / mag;
        coh[i] = mag / (Jxx + Jyy + 1e-12);
      }
    }
    this.c2 = c2; this.s2 = s2; this.coh = coh;
    await clock.tick(1);
  }

  /** Dirección tangente unitaria en coordenadas de imagen completa. */
  flowAt(x, y, out, fine) {
    const ax = (x + 0.5) * this.ax - 0.5, ay = (y + 0.5) * this.ay - 0.5;
    const c = C.bilinear(fine ? this.c2f : this.c2, this.aw, this.ah, ax, ay);
    const s = C.bilinear(fine ? this.s2f : this.s2, this.aw, this.ah, ax, ay);
    const r = Math.sqrt(c * c + s * s);
    if (r < 1e-6) { out[0] = 1; out[1] = 0; return out; }
    const cn = c / r;
    const cx = Math.sqrt(Math.max(0, (1 + cn) * 0.5));
    let sy = Math.sqrt(Math.max(0, (1 - cn) * 0.5));
    if (s < 0) sy = -sy;
    out[0] = cx; out[1] = sy;
    return out;
  }

  /** Muestra un plano de análisis en coordenadas de imagen completa. */
  at(plane, x, y) {
    return C.bilinear(plane, this.aw, this.ah, (x + 0.5) * this.ax - 0.5, (y + 0.5) * this.ay - 0.5);
  }

  /** Color de referencia (desenfocado según el nivel de pirámide). */
  colorAt(level, x, y, out) {
    if (level <= 0) {
      const { W, H, data, comp } = this;
      let xx = x < 0 ? 0 : x > W - 1 ? W - 1 : x;
      let yy = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
      const x0 = xx | 0, y0 = yy | 0;
      const x1 = x0 < W - 1 ? x0 + 1 : x0, y1 = y0 < H - 1 ? y0 + 1 : y0;
      const fx = xx - x0, fy = yy - y0;
      const i00 = (y0 * W + x0) * comp, i10 = (y0 * W + x1) * comp, i01 = (y1 * W + x0) * comp, i11 = (y1 * W + x1) * comp;
      for (let c = 0; c < 3; c++) {
        const a = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * fx;
        const b = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * fx;
        out[c] = (a + (b - a) * fy) / 255;
      }
      return out;
    }
    const lv = this.pyr[Math.min(level, this.pyr.length - 1)];
    const f = this.W / lv.w;
    const lx = (x + 0.5) / f - 0.5, ly = (y + 0.5) / f - 0.5;
    out[0] = C.bilinear(lv.r, lv.w, lv.h, lx, ly);
    out[1] = C.bilinear(lv.g, lv.w, lv.h, lx, ly);
    out[2] = C.bilinear(lv.b, lv.w, lv.h, lx, ly);
    return out;
  }

  levelFor(radius) {
    const l = Math.floor(Math.log2(Math.max(1, radius)));
    return Math.max(0, Math.min(this.pyr.length - 1, l));
  }

  /* -------- máscara de cobertura (zonas sin pintar = transparentes) -------- */
  buildCoverage(cov, opts) {
    opts = opts || {};
    const { aw, ah } = this;
    const n = aw * ah;
    const M = new Float32Array(n);
    if (cov >= 0.995) { M.fill(1); this.cover = M; return M; }
    const nW = Math.max(4, Math.ceil(aw / 4)), nH = Math.max(4, Math.ceil(ah / 4));
    const noise = C.fbmGrid(nW, nH, Math.max(4, nW / 5), 4, this.seed + 333, 0.55);
    const lumW = opts.lumWeight === undefined ? 0.55 : opts.lumWeight;
    const thr = 0.12 + Math.pow(cov, 1.3) * 1.25;
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) {
        const i = y * aw + x;
        const dx = (x / (aw - 1)) * 2 - 1, dy = (y / (ah - 1)) * 2 - 1;
        const rad = Math.pow(Math.pow(Math.abs(dx), 3) + Math.pow(Math.abs(dy), 3), 1 / 3); // forma "superelipse"
        const nv = C.bilinear(noise, nW, nH, x / 4, y / 4) - 0.5;
        const light = Math.max(0, this.lum[i] - 0.55) / 0.45; // las luces se quedan en papel antes
        const score = rad * 0.75 + nv * 0.9 + light * lumW - this.edge[i] * 0.25;
        M[i] = C.smoothstep(thr + 0.07, thr - 0.07, score);
      }
    }
    this.cover = M;
    return M;
  }

  /* -------- selección (opcional) -------- */
  setSelection(sel) {
    // sel: {mask: Uint8Array W*H (0..255), mode: "solo"|"detalle"}
    if (!sel || !sel.mask) { this.sel = null; this.selMode = null; return; }
    const { W, H, aw, ah } = this;
    const f = new Float32Array(W * H);
    for (let i = 0; i < f.length; i++) f[i] = sel.mask[i] / 255;
    this.selFull = sel.mode === "solo" ? sel.mask : null;
    this.sel = W === aw && H === ah ? f : C.resample(f, W, H, aw, ah);
    this.selMode = sel.mode;
  }
}

module.exports = { Context, ANALYSIS_MAX };

};
__defs["core.js"] = function (module, exports, require) {
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

};
__defs["index.js"] = function (module, exports, require) {
/*
 * Trazo · punto de entrada del motor.
 *
 *   const res = await Engine.render(
 *     { width, height, data: Uint8Array, components: 3|4 },
 *     { technique: "oleo", params: {...0..100, modo}, seed: 1,
 *       selection: { mask, mode: "solo"|"detalle" } | null,
 *       paper: true,                         // capa de papel visible
 *       assets: { pin_oleo: <parseTexture>, tiles_pintura: ..., ... },
 *       support: <parseTexture soporte-*> },
 *     { onProgress(f, texto), shouldCancel(), sliceMs }
 *   );
 *   // res = { paint: RGBA, paper: RGBA | null, width, height }
 *
 * Qué material usa cada técnica: ASSETS_FOR. Sin material, cada técnica
 * sigue funcionando con su modelo procedural.
 */
const C = require("./core.js");
const { Context } = require("./analysis.js");
const T = require("./techniques.js");
const Painter = require("./painter.js");
const Pencil = require("./pencil.js");
const Paper = require("./paper.js");
const Lib = require("./library.js");
const Seg = require("./segment.js");
const Painter2 = require("./painter2.js");
const Water2 = require("./watercolor2.js");
const Xilo = require("./xilografia.js");
const Markers = require("./rotuladores.js");
const Mixta = require("./mixta.js");
const K = require("./kit.js");

const SUPPORT_FOR = {
  oleo: "lienzo", gouache: "acuarela", acuarela: "acuarela", lapiz: "dibujo", rotulador: "dibujo",
  mixtalg: "dibujo", mixta: "dibujo", xilografia: "dibujo",
};
const ASSETS_FOR = {
  oleo: ["pin_oleo", "pin_gouache", "tiles_pintura", "manchas"],
  gouache: ["pin_gouache", "tiles_pintura", "manchas"],
  acuarela: ["pin_acuarela", "tiles_acuarela", "pin_lapiz", "ov_goteos"],
  lapiz: ["pin_lapiz", "pin_cera", "ov_grafito", "ov_carbon"],
  rotulador: ["pin_rotulador", "pin_linea", "pin_lapiz"],
  mixtalg: ["pin_lapiz", "pin_gouache", "tiles_pintura", "manchas"],
  mixta: ["pin_linea", "pin_cera", "pin_gouache", "tiles_pintura", "manchas", "ov_impresion", "pin_lapiz"],
  xilografia: ["ov_madera", "ov_impresion"],
};
// cómo se marca el papel en lo velado
const TOOTH = {
  oleo: ["lienzo", 0.55], gouache: ["lienzo", 0.4], acuarela: ["valles", 0.55], lapiz: ["picos", 0.8],
  rotulador: ["picos", 0.25], mixtalg: ["picos", 0.5], mixta: ["picos", 0.35], xilografia: ["picos", 0.55],
};
const DETAIL = { oleo: [0.25, 0.7], gouache: [0.25, 0.7], acuarela: [0.3, 0.6], lapiz: [0.3, 0.6], rotulador: [0.06, 0.34], mixtalg: [0.2, 0.55], mixta: [0.08, 0.4], xilografia: [0.3, 0.6] };

function flowOptions(tech, p) {
  switch (tech) {
    case "lapiz": case "mixtalg": return { flowSigma: 8 + p.grosor * 8, baseAngle: -Math.PI / 4, wander: 0.2, bias: 0.15, localBias: 0.35 };
    case "acuarela": return { flowSigma: 6 + p.grosor * 14, baseAngle: 0, wander: 0.6, bias: 0.1, localBias: 0.1 };
    case "rotulador": case "mixta": return { flowSigma: 10 + p.grosor * 12, baseAngle: -Math.PI / 3, wander: 0.3, bias: 0.12, localBias: 0.2 };
    case "xilografia": return { flowSigma: 6 + p.grosor * 10, baseAngle: 0, wander: 0.3, bias: 0.1, localBias: 0.15 };
    case "gouache": return { flowSigma: 4 + p.grosor * 16, baseAngle: 0, wander: 0.55, bias: 0.08, localBias: 0.08 };
    default: return { flowSigma: 3 + p.grosor * 15, baseAngle: 0, wander: 0.5, bias: 0.08, localBias: 0.06 };
  }
}

function strokesOf(assets, names) {
  const samples = [];
  for (const nm of names) { const a = assets[nm]; if (a && a.kind === "strokes") samples.push(...a.samples); }
  return samples.length ? { kind: "strokes", samples } : null;
}

async function render(input, opts, hooks) {
  const tech = T.BY_ID[opts.technique] ? opts.technique : "oleo";
  const p = T.normalized(tech, opts.params);
  const clock = C.makeClock(hooks);
  const seed = (opts.seed | 0) || 1;
  const ctx = new Context(input, { seed });
  const assets = Object.assign({}, opts.assets || {});
  ctx.assets = assets;
  ctx.strokesOf = (names) => strokesOf(assets, names);
  ctx.paperPrep = opts.support ? Lib.preparePaper(opts.support) : null;
  // biblioteca de pinceladas principal de la técnica
  const mainLib = { oleo: ["pin_gouache", "pin_oleo"], gouache: ["pin_gouache"], acuarela: ["pin_acuarela"], lapiz: ["pin_lapiz"], rotulador: ["pin_rotulador"], mixtalg: ["pin_gouache"], mixta: ["pin_gouache"], xilografia: [] }[tech];
  ctx.lib = strokesOf(assets, mainLib) || (opts.library && opts.library.kind === "strokes" ? opts.library : null);

  clock.stage(0, 0.05, "Analizando la imagen");
  await ctx.buildBase(clock);
  clock.stage(0.05, 0.11, "Calculando la dirección de los trazos");
  await ctx.buildFlow(flowOptions(tech, p), clock);
  ctx.setSelection(opts.selection);
  ctx.buildCoverage(p.cobertura, { lumWeight: tech === "acuarela" ? 0.7 : tech === "lapiz" || tech === "rotulador" ? 0.45 : 0.55 });

  const [d0, d1] = DETAIL[tech];
  const detail = tech === "xilografia" && p.modo === "expresiva" ? 0.12 + 0.3 * p.detalle : d0 + d1 * p.detalle;
  clock.stage(0.11, 0.2, "Viendo la imagen en manchas");
  const seg = await Seg.segment(ctx, { detail }, clock);
  clock.stage(0.2, 0.25, "Ajustando los bordes");
  const Lfull = await Seg.fullLabels(ctx, seg, clock);
  const end = opts.paper ? 0.88 : 0.95;

  let paint;
  if (tech === "lapiz") {
    clock.stage(0.25, end, "Dibujando");
    paint = await Pencil.paint(ctx, p, clock, seg, Lfull);
  } else if (tech === "acuarela") {
    if (p.modo === "dibujo") {
      clock.stage(0.25, 0.45, "Dibujo a lápiz");
      const lines = await Pencil.paint(ctx, Object.assign({}, p, { modo: "boceto", intensidad: 0.45 + 0.3 * p.intensidad }), clock, seg, Lfull, { lib: strokesOf(assets, ["pin_lapiz"]) });
      clock.stage(0.45, end, "Pintando aguadas");
      const wc = await Water2.paint(ctx, p, seg, Lfull, clock);
      paint = K.multU8(lines, wc);
    } else {
      clock.stage(0.25, end, "Pintando aguadas");
      paint = await Water2.paint(ctx, p, seg, Lfull, clock);
    }
  } else if (tech === "xilografia") {
    clock.stage(0.25, end, "Tallando y estampando");
    paint = await Xilo.paint(ctx, p, seg, Lfull, clock);
  } else if (tech === "rotulador") {
    clock.stage(0.25, end, "Pintando con rotulador");
    paint = await Markers.paint(ctx, p, seg, Lfull, clock);
  } else if (tech === "mixtalg") {
    clock.stage(0.25, end, "Lápiz y gouache");
    paint = await Mixta.paintLG(ctx, p, seg, Lfull, clock);
  } else if (tech === "mixta") {
    clock.stage(0.25, end, "Collage y técnica mixta");
    paint = await Mixta.paintCollage(ctx, p, seg, Lfull, clock);
  } else {
    clock.stage(0.25, 0.82, "Pintando");
    const planes = await Painter2.paint(ctx, tech, p, seg, Lfull, clock);
    clock.stage(0.82, end, "Acabado");
    paint = await Painter.finish(ctx, tech, p, planes, clock);
  }

  // el papel se marca siempre en lo velado (esté o no visible)
  const [tm, ta] = TOOTH[tech];
  clock.stage(end, end + 0.03, "Grano del papel");
  await K.paperTooth(paint, ctx, tm, ta, clock);

  let paper = null;
  if (opts.paper) {
    clock.stage(end + 0.03, 0.98, "Preparando el papel");
    paper = await Paper.makePaper(tech, ctx.W, ctx.H, seed, clock, ctx.paperPrep);
  }
  clock.stage(1, 1, "Listo");
  return { paint, paper, width: ctx.W, height: ctx.H };
}

/** Compone la pintura sobre el papel (o blanco) → RGB para la vista previa. */
function flatten(paint, paper, W, H, out) {
  const n = W * H;
  out = out || new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = paint[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const bgc = paper ? paper[i * 4 + c] : 255;
      out[i * 3 + c] = (paint[i * 4 + c] * a + bgc * (1 - a) + 0.5) | 0;
    }
  }
  return out;
}

module.exports = {
  render, flatten, Techniques: T, CancelError: C.CancelError,
  parseTexture: Lib.parse, SUPPORT_FOR, ASSETS_FOR,
};

};
__defs["kit.js"] = function (module, exports, require) {
/*
 * Trazo · utilidades compartidas por las técnicas
 *  - texturas repetibles (gris o color) con giro, escala física y desplazamiento
 *  - texturas 9:16 no repetibles (se estiran para cubrir el lienzo)
 *  - manchas reales como sellos (densidad + relieve), giradas y escaladas
 *  - composición de capas: normal (opaco) y multiplicar (medios transparentes)
 *  - grano del papel en las zonas veladas (con o sin papel visible)
 */
const C = require("./core.js");
const Lib = require("./library.js");

/* ---------------- texturas repetibles ---------------- */
function tilePrep(item) {
  if (item._prep) return item._prep;
  const P = item.planes[0], n = P.w * P.h;
  let m = 0, m2 = 0;
  for (let i = 0; i < n; i++) { const v = P.data[i] / 255; m += v; m2 += v * v; }
  m /= n; const sd = Math.sqrt(Math.max(1e-6, m2 / n - m * m));
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = (P.data[i] / 255 - m) / sd; L[i] = v < -3 ? -3 : v > 3 ? 3 : v; }
  const prep = { w: P.w, h: P.h, L, mean: m, sd, cr: null, cb: null, cw: 0, ch: 0 };
  if (item.planes.length >= 3) {
    const a = item.planes[1], b = item.planes[2];
    prep.cw = a.w; prep.ch = a.h;
    prep.cr = new Float32Array(a.w * a.h); prep.cb = new Float32Array(a.w * a.h);
    for (let i = 0; i < a.w * a.h; i++) { prep.cr[i] = (a.data[i] - 128) / 400; prep.cb[i] = (b.data[i] - 128) / 400; }
  }
  item._prep = prep;
  return prep;
}

function bilWrap(arr, w, h, u, v) {
  u %= w; if (u < 0) u += w;
  v %= h; if (v < 0) v += h;
  const x0 = u | 0, y0 = v | 0;
  const x1 = x0 + 1 >= w ? 0 : x0 + 1, y1 = y0 + 1 >= h ? 0 : y0 + 1;
  const fx = u - x0, fy = v - y0;
  const a = arr[y0 * w + x0] + (arr[y0 * w + x1] - arr[y0 * w + x0]) * fx;
  const b = arr[y1 * w + x0] + (arr[y1 * w + x1] - arr[y1 * w + x0]) * fx;
  return a + (b - a) * fy;
}

/** Píxeles de textura por píxel de salida (la textura original de 2048 px ≈ 20 cm; cuadro ≈ 30 cm). */
function tileScale(item, longSide, mul) {
  const N = item.planes[0].w;
  return (1.5 * N / Math.max(64, longSide)) * (mul || 1);
}

/**
 * Muestreador de una textura repetible. l(x,y) = luminancia normalizada (media 0, desv. 1);
 * c(x,y,out) = desviación de color [cr, cb] (solo texturas en color).
 */
function tileSampler(item, k, angle, ox, oy) {
  const P = tilePrep(item);
  const ca = Math.cos(angle || 0) * k, sa = Math.sin(angle || 0) * k;
  ox = ox || 0; oy = oy || 0;
  const cf = P.cw / P.w;
  return {
    item, prep: P,
    l(x, y) { return bilWrap(P.L, P.w, P.h, x * ca + y * sa + ox, -x * sa + y * ca + oy); },
    c(x, y, out) {
      if (!P.cr) { out[0] = 0; out[1] = 0; return out; }
      const u = (x * ca + y * sa + ox) * cf, v = (-x * sa + y * ca + oy) * cf;
      out[0] = bilWrap(P.cr, P.cw, P.ch, u, v); out[1] = bilWrap(P.cb, P.cw, P.ch, u, v);
      return out;
    },
  };
}

/** Elige textura por etiquetas y temperatura (cálida/fría) con la calidad como peso. */
function pickTile(lib, rand, tags, warmth) {
  if (!lib || !lib.items) return null;
  let cands = lib.items.filter((it) => !tags || tags.some((t) => it.tags.indexOf(t) >= 0));
  if (!cands.length) cands = lib.items;
  return Lib.pick(cands, rand, (it) => {
    let w = it.q || 1;
    if (warmth !== undefined && it.tags) {
      if (it.tags.indexOf("calida") >= 0) w *= warmth > 0.02 ? 3 : 0.4;
      if (it.tags.indexOf("fria") >= 0) w *= warmth < -0.02 ? 3 : 0.4;
    }
    return w;
  });
}

/* ---------------- texturas 9:16 (no repetibles) ---------------- */
function overlaySampler(item, W, H, opts) {
  opts = opts || {};
  const P = item.planes[0];
  const rot = (W > H) !== (P.w > P.h);
  const ow = rot ? P.h : P.w, oh = rot ? P.w : P.h;
  const s = Math.max(W / ow, H / oh) * (opts.zoom || 1);
  const ox = opts.ox || 0, oy = opts.oy || 0;
  const d = P.data, w = P.w, h = P.h;
  return function (x, y) {
    let u = x / s + ox, v = y / s + oy;
    if (rot) { const t = u; u = v; v = ow - 1 - t; }
    // espejo en los bordes (no repetible: nunca se ve una costura recta)
    u = Math.abs(u) % (2 * w); if (u >= w) u = 2 * w - 1 - u;
    v = Math.abs(v) % (2 * h); if (v >= h) v = 2 * h - 1 - v;
    const x0 = u | 0, y0 = v | 0, x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
    const fx = u - x0, fy = v - y0;
    const a = d[y0 * w + x0] + (d[y0 * w + x1] - d[y0 * w + x0]) * fx;
    const b = d[y1 * w + x0] + (d[y1 * w + x1] - d[y1 * w + x0]) * fx;
    return (a + (b - a) * fy) / 255;
  };
}

/* ---------------- manchas (sellos) ---------------- */
/**
 * Estampa una mancha real centrada en (cx,cy): size = lado largo en px, angle = giro.
 * cb(i, a, s) recibe índice de píxel, densidad 0..1 y relieve −1..1.
 */
function drawStamp(item, cx, cy, size, angle, W, H, cb) {
  const A = item.planes[0], S = item.planes[1] || null;
  const w = A.w, h = A.h;
  const k = Math.max(w, h) / Math.max(1, size); // px de sello por px de salida
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const hw = w / k / 2, hh = h / k / 2;
  const ext = Math.abs(hw * ca) + Math.abs(hh * sa), eyt = Math.abs(hw * sa) + Math.abs(hh * ca);
  const x0 = Math.max(0, Math.floor(cx - ext)), x1 = Math.min(W - 1, Math.ceil(cx + ext));
  const y0 = Math.max(0, Math.floor(cy - eyt)), y1 = Math.min(H - 1, Math.ceil(cy + eyt));
  const ad = A.data, sd = S ? S.data : null;
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const u = (dx * ca + dy * sa) * k + w / 2, v = (-dx * sa + dy * ca) * k + h / 2;
      if (u < 0 || v < 0 || u > w - 1.001 || v > h - 1.001) continue;
      const ux = u | 0, vy = v | 0, fx = u - ux, fy = v - vy, o = vy * w + ux;
      const a0 = ad[o] + (ad[o + 1] - ad[o]) * fx, a1 = ad[o + w] + (ad[o + w + 1] - ad[o + w]) * fx;
      const a = (a0 + (a1 - a0) * fy) / 255;
      if (a < 0.01) continue;
      let sv = 0;
      if (sd) {
        const s0 = sd[o] + (sd[o + 1] - sd[o]) * fx, s1 = sd[o + w] + (sd[o + w + 1] - sd[o + w]) * fx;
        sv = (s0 + (s1 - s0) * fy - 128) / 127;
      }
      cb(y * W + x, a, sv);
    }
  }
}

/* ---------------- composición ---------------- */
/** dst := src sobre dst (alfa normal). Ambos RGBA uint8. */
function overU8(dst, src, alphaMul) {
  const m = alphaMul === undefined ? 1 : alphaMul;
  for (let i = 0; i < dst.length; i += 4) {
    const sa = src[i + 3] / 255 * m;
    if (sa <= 0) continue;
    const da = dst[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let c = 0; c < 3; c++) dst[i + c] = (src[i + c] * sa + dst[i + c] * da * (1 - sa)) / oa + 0.5;
    dst[i + 3] = oa * 255 + 0.5;
  }
  return dst;
}

/** Medios transparentes (acuarela, rotulador, grafito): se multiplican como sobre papel blanco. */
function multU8(dst, src, alphaMul) {
  const m = alphaMul === undefined ? 1 : alphaMul;
  for (let i = 0; i < dst.length; i += 4) {
    const sa = src[i + 3] / 255 * m;
    if (sa <= 0) continue;
    const da = dst[i + 3] / 255;
    let r = (1 - da * (1 - dst[i] / 255)) * (1 - sa * (1 - src[i] / 255));
    let g = (1 - da * (1 - dst[i + 1] / 255)) * (1 - sa * (1 - src[i + 1] / 255));
    let b = (1 - da * (1 - dst[i + 2] / 255)) * (1 - sa * (1 - src[i + 2] / 255));
    const a = Math.max(1 - r, 1 - g, 1 - b);
    if (a < 0.003) { dst[i + 3] = 0; continue; }
    dst[i] = (1 - (1 - r) / a) * 255 + 0.5; dst[i + 1] = (1 - (1 - g) / a) * 255 + 0.5; dst[i + 2] = (1 - (1 - b) / a) * 255 + 0.5;
    dst[i + 3] = a * 255 + 0.5;
  }
  return dst;
}

/** Planos de transmitancia (multiplicativos sobre blanco) → RGBA con el blanco transparente. */
function transToRGBA(Tr, Tg, Tb, out, mask) {
  const n = Tr.length;
  out = out || new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let a = Math.max(1 - Tr[i], 1 - Tg[i], 1 - Tb[i]);
    if (mask) a *= mask[i];
    if (a < 0.003) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 0; continue; }
    const ia = 1 / Math.max(a, 1 - Math.min(Tr[i], Tg[i], Tb[i]));
    out[o] = C.clamp(1 - (1 - Tr[i]) * ia, 0, 1) * 255 + 0.5;
    out[o + 1] = C.clamp(1 - (1 - Tg[i]) * ia, 0, 1) * 255 + 0.5;
    out[o + 2] = C.clamp(1 - (1 - Tb[i]) * ia, 0, 1) * 255 + 0.5;
    out[o + 3] = C.clamp(a, 0, 1) * 255 + 0.5;
  }
  return out;
}

/* ---------------- grano del papel en lo velado ---------------- */
/**
 * La textura del papel se marca siempre en las zonas poco cubiertas:
 *  mode "picos"  → medios secos (grafito, cera, rotulador seco, tinta de grabado): se quedan en los picos
 *  mode "valles" → medios húmedos (acuarela): el pigmento se asienta en los valles
 *  mode "lienzo" → pintura fina sobre tela/papel: la trama asoma y matiza el color
 */
async function paperTooth(out, ctx, mode, amount, clock) {
  if (!ctx.paperPrep || amount <= 0) return out;
  const { W, H } = ctx;
  const pap = Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H)));
  const sign = mode === "valles" ? -1 : 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const a = out[o + 3] / 255;
      if (a <= 0.004 || a >= 0.997) continue;
      const r = pap.raw(x, y);
      const thin = 1 - a;
      let na = a * (1 + amount * sign * thin * r * 1.6);
      na = na < 0 ? 0 : na > 1 ? 1 : na;
      out[o + 3] = na * 255 + 0.5;
      if (mode === "lienzo") {
        const k = 1 + 0.12 * amount * r * thin;
        out[o] = C.clamp(out[o] * k, 0, 255); out[o + 1] = C.clamp(out[o + 1] * k, 0, 255); out[o + 2] = C.clamp(out[o + 2] * k, 0, 255);
      }
    }
    if (clock && (y & 63) === 0) await clock.tick(y / H);
  }
  return out;
}

/* ---------------- paleta (k-medias sobre la imagen de análisis) ---------------- */
function palette(ctx, K, seed, opts) {
  opts = opts || {};
  const { ar, ag, ab } = ctx;
  const n = ar.length;
  const rand = C.mulberry32(seed + 55);
  const S = Math.min(n, 8000);
  const sr = [], sg = [], sb = [];
  for (let i = 0; i < S; i++) {
    const j = Math.floor(rand() * n);
    const r = ar[j], g = ag[j], b = ab[j];
    if (opts.skip && opts.skip(r, g, b)) continue;
    sr.push(r); sg.push(g); sb.push(b);
  }
  const m = sr.length || 1;
  const cr = new Float32Array(K), cg = new Float32Array(K), cb = new Float32Array(K);
  for (let k = 0; k < K; k++) { const j = Math.floor(((k + 0.5) / K) * m) % m; cr[k] = sr[j] || 0.5; cg[k] = sg[j] || 0.5; cb[k] = sb[j] || 0.5; }
  // inicialización por luminancia ordenada (estable entre ejecuciones)
  const idx = Array.from({ length: m }, (_, i) => i).sort((a, b) => (sr[a] * 0.3 + sg[a] * 0.59 + sb[a] * 0.11) - (sr[b] * 0.3 + sg[b] * 0.59 + sb[b] * 0.11));
  for (let k = 0; k < K; k++) { const j = idx[Math.floor(((k + 0.5) / K) * m)]; cr[k] = sr[j]; cg[k] = sg[j]; cb[k] = sb[j]; }
  for (let it = 0; it < 10; it++) {
    const nr = new Float32Array(K), ng = new Float32Array(K), nb = new Float32Array(K), c = new Float32Array(K);
    for (let i = 0; i < m; i++) {
      let best = 0, bd = 1e9;
      for (let k = 0; k < K; k++) { const d0 = sr[i] - cr[k], d1 = sg[i] - cg[k], d2 = sb[i] - cb[k]; const d = d0 * d0 * 0.9 + d1 * d1 * 1.2 + d2 * d2 * 0.7; if (d < bd) { bd = d; best = k; } }
      nr[best] += sr[i]; ng[best] += sg[i]; nb[best] += sb[i]; c[best]++;
    }
    for (let k = 0; k < K; k++) if (c[k]) { cr[k] = nr[k] / c[k]; cg[k] = ng[k] / c[k]; cb[k] = nb[k] / c[k]; }
  }
  return { r: cr, g: cg, b: cb, K };
}

function nearest(pal, r, g, b) {
  let best = 0, bd = 1e9;
  for (let k = 0; k < pal.K; k++) { const d0 = r - pal.r[k], d1 = g - pal.g[k], d2 = b - pal.b[k]; const d = d0 * d0 * 0.9 + d1 * d1 * 1.2 + d2 * d2 * 0.7; if (d < bd) { bd = d; best = k; } }
  return best;
}

/** Calidez de un color: >0 cálido (rojo/naranja), <0 frío (azul/verde). */
function warmth(r, g, b) { return (r - b) * 0.8 + (g - b) * 0.2 - 0.05; }

module.exports = { tilePrep, tileScale, tileSampler, pickTile, overlaySampler, drawStamp, overU8, multU8, transToRGBA, paperTooth, palette, nearest, warmth };

};
__defs["library.js"] = function (module, exports, require) {
/*
 * Trazo · biblioteca de trazos y soportes reales.
 *
 * Contenedor TRZ1 (generado por tools/extract_strokes.py y extract_papers.py):
 *   "TRZ1" · uint32 LE longitud de cabecera · cabecera JSON ASCII · datos uint8
 *
 * Trazos: cada muestra está enderezada en vertical (empieza arriba). Canales:
 *   A = cobertura o densidad de pigmento, S = relieve/brillo relativo (128 neutro).
 * Marcas por fila: top (empieza la pintura), head (fin de la carga inicial),
 * tail (empieza el final seco), bottom (acaba la pintura).
 */

function readU32(u8, o) {
  return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
}

function parse(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (u8.length < 8 || u8[0] !== 84 || u8[1] !== 82 || u8[2] !== 90 || u8[3] !== 49) throw new Error("Formato de textura no válido");
  const hl = readU32(u8, 4);
  let json = "";
  for (let i = 0; i < hl; i++) json += String.fromCharCode(u8[8 + i]);
  const header = JSON.parse(json);
  const base = 8 + hl;
  if (header.samples) {
    const samples = header.samples.map((m) => {
      const size = m.w * m.h;
      const A = u8.subarray(base + m.offset, base + m.offset + size);
      const S = m.channels === 2 ? u8.subarray(base + m.offset + size, base + m.offset + 2 * size) : null;
      return {
        w: m.w, h: m.h, top: m.top, head: m.head, tail: m.tail, bottom: m.bottom,
        fill: m.fill, aspect: m.aspect, q: m.q || 1, A, S, mips: null,
      };
    });
    return { kind: "strokes", technique: header.technique, samples };
  }
  if (header.items) {
    // texturas repetibles, sellos (manchas) y texturas 9:16: varios planos uint8 por elemento
    const items = header.items.map((m) => {
      const it = Object.assign({}, m);
      it.planes = m.planes.map((pl) => ({ w: pl.w, h: pl.h, data: u8.subarray(base + pl.offset, base + pl.offset + pl.w * pl.h) }));
      return it;
    });
    return { kind: header.kind, items };
  }
  return { kind: "paper", paperKind: header.kind, w: header.w, h: header.h, data: u8.subarray(base, base + header.w * header.h) };
}

/* ---------- mipmaps de una muestra (reducción 2×2) ---------- */
function halveU8(src, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const r0 = Math.min(h - 1, y * 2) * w, r1 = Math.min(h - 1, y * 2 + 1) * w;
    for (let x = 0; x < nw; x++) {
      const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1);
      out[y * nw + x] = (src[r0 + x0] + src[r0 + x1] + src[r1 + x0] + src[r1 + x1] + 2) >> 2;
    }
  }
  return out;
}

function mip(sample, level) {
  if (!sample.mips) {
    sample.mips = [{ w: sample.w, h: sample.h, A: sample.A, S: sample.S, top: sample.top, head: sample.head, tail: sample.tail, bottom: sample.bottom }];
  }
  while (sample.mips.length <= level) {
    const p = sample.mips[sample.mips.length - 1];
    if (p.w <= 4 || p.h <= 8) { break; }
    sample.mips.push({
      w: Math.max(1, p.w >> 1), h: Math.max(1, p.h >> 1),
      A: halveU8(p.A, p.w, p.h), S: p.S ? halveU8(p.S, p.w, p.h) : null,
      top: p.top / 2, head: p.head / 2, tail: p.tail / 2, bottom: p.bottom / 2,
    });
  }
  return sample.mips[Math.min(level, sample.mips.length - 1)];
}

/**
 * Prepara el mapeo de una muestra sobre una trayectoria.
 * pathLen: longitud del recorrido (px de salida). Rr: radio del área rasterizada,
 * que corresponde al ancho completo de la textura (v = ±1).
 */
function prepare(sample, pathLen, Rr, rand, vk) {
  const k0 = sample.w / (2 * Rr); // px de textura por px de salida
  let level = 0;
  while (k0 / (1 << level) > 2.2 && level < 6) level++;
  const m = mip(sample, level);
  const kk = m.w / (2 * Rr); // px de textura (del nivel elegido) por px de salida
  const Ltex = Math.max(1, pathLen * kk);
  const H = Math.max(1, m.head - m.top), T = Math.max(1, m.bottom - m.tail), B = Math.max(1, m.tail - m.head);
  const Lb = Ltex - H - T;
  const off = Lb >= 0 && Lb <= B ? rand() * (B - Lb) : 0;
  return { m, kk, Ltex, H, T, B, Lb, off, flip: rand() < 0.5, pathLen, vk: vk || 1 };
}

/** Fila de textura para una distancia d (px de salida) a lo largo del trazo. */
function rowAt(st, d) {
  const dt = d * st.kk;
  const m = st.m;
  if (dt < 0) return m.top + dt;
  if (st.Lb >= 0) {
    if (dt < st.H) return m.top + dt;
    const x = dt - st.H;
    if (x < st.Lb) {
      if (st.Lb <= st.B) return m.head + st.off + x;
      const period = 2 * st.B;
      const q = x % period;
      return m.head + (q < st.B ? q : period - q);
    }
    if (dt <= st.Ltex) return m.tail + (x - st.Lb);
    return m.bottom + (dt - st.Ltex);
  }
  if (dt > st.Ltex) return m.bottom + (dt - st.Ltex);
  const x = dt * (st.H + st.T) / st.Ltex;
  return x < st.H ? m.top + x : m.tail + (x - st.H);
}

/** Muestreo bilineal de un canal uint8 (0..255) → 0..1 */
function bilinearU8(arr, w, h, x, y) { // (se conserva para usos puntuales)
  if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
  if (y < 0) return 0; else if (y > h - 1) return 0;
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;
  const a = arr[y0 * w + x0] + (arr[y0 * w + x1] - arr[y0 * w + x0]) * fx;
  const b = arr[y1 * w + x0] + (arr[y1 * w + x1] - arr[y1 * w + x0]) * fx;
  return (a + (b - a) * fy) * (1 / 255);
}

/**
 * Muestra el trazo en (u normalizado a lo largo, v en -1..1 a lo ancho).
 * out[0] = cobertura 0..1, out[1] = relieve/brillo −1..1 (0 si no hay canal S).
 * Bilineal compartido para ambos canales (es el bucle más caliente del motor).
 */
function sampleAt(st, u, v, out) {
  const m = st.m;
  const w = m.w, h = m.h;
  const row = rowAt(st, u * st.pathLen);
  if (!(row >= 0 && row <= h - 1)) { out[0] = 0; out[1] = 0; return out; }
  let col = ((st.flip ? -v : v) * st.vk * 0.5 + 0.5) * (w - 1);
  if (col < 0) col = 0; else if (col > w - 1) col = w - 1;
  const x0 = col | 0, y0 = row | 0;
  const x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
  const fx = col - x0, fy = row - y0;
  const r0 = y0 * w, r1 = y1 * w;
  const A = m.A;
  const a0 = A[r0 + x0] + (A[r0 + x1] - A[r0 + x0]) * fx;
  const a1 = A[r1 + x0] + (A[r1 + x1] - A[r1 + x0]) * fx;
  const a = (a0 + (a1 - a0) * fy) * (1 / 255);
  out[0] = a;
  const S = m.S;
  if (S !== null && a > 0.004) {
    const s0 = S[r0 + x0] + (S[r0 + x1] - S[r0 + x0]) * fx;
    const s1 = S[r1 + x0] + (S[r1 + x1] - S[r1 + x0]) * fx;
    out[1] = (s0 + (s1 - s0) * fy - 128) * (1 / 127.5);
  } else out[1] = 0;
  return out;
}

/* ---------- soporte real (papel / lienzo) ---------- */
/**
 * Ecualiza la textura (distribución uniforme 0..1, como el grano procedural) y
 * crea mipmaps. scale = px de textura por px de salida (escala física).
 */
function preparePaper(paper) {
  if (!paper || paper.kind !== "paper") return null;
  if (paper._prepared) return paper._prepared;
  const n = paper.w * paper.h;
  const hist = new Float64Array(256);
  for (let i = 0; i < n; i++) hist[paper.data[i]]++;
  const cdf = new Float32Array(256);
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; cdf[v] = (acc - hist[v] * 0.5) / n; }
  const raw = new Float32Array(n), eq = new Float32Array(n);
  for (let i = 0; i < n; i++) { raw[i] = (paper.data[i] - 128) / 127; eq[i] = cdf[paper.data[i]]; }
  const levels = [{ size: paper.w, eq, raw }];
  let cur = levels[0];
  while (cur.size > 8) {
    const s = cur.size, ns = s >> 1;
    const e2 = new Float32Array(ns * ns), r2 = new Float32Array(ns * ns);
    for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) {
      const i0 = (2 * y) * s + 2 * x, i1 = i0 + 1, i2 = i0 + s, i3 = i2 + 1;
      e2[y * ns + x] = (cur.eq[i0] + cur.eq[i1] + cur.eq[i2] + cur.eq[i3]) * 0.25;
      r2[y * ns + x] = (cur.raw[i0] + cur.raw[i1] + cur.raw[i2] + cur.raw[i3]) * 0.25;
    }
    cur = { size: ns, eq: e2, raw: r2 };
    levels.push(cur);
  }
  paper._prepared = { levels, kind: paper.paperKind };
  return paper._prepared;
}

/**
 * Muestreador de soporte a una escala dada. Devuelve {eq(x,y), raw(x,y)}:
 * eq = grano ecualizado 0..1 (al reducir, tiende a 0.5); raw = relieve −1..1 aprox.
 */
function paperSampler(prep, texPerPx) {
  let level = 0, k = texPerPx;
  while (k > 1.5 && level < prep.levels.length - 1) { k /= 2; level++; }
  const L = prep.levels[level];
  const size = L.size, mask = size - 1;
  function bil(arr, x, y) {
    x *= k; y *= k;
    const xf = Math.floor(x), yf = Math.floor(y);
    const fx = x - xf, fy = y - yf;
    const x0 = xf & mask, y0 = yf & mask, x1 = (xf + 1) & mask, y1 = (yf + 1) & mask;
    const a = arr[y0 * size + x0] + (arr[y0 * size + x1] - arr[y0 * size + x0]) * fx;
    const b = arr[y1 * size + x0] + (arr[y1 * size + x1] - arr[y1 * size + x0]) * fx;
    return a + (b - a) * fy;
  }
  const eqArr = L.eq;
  return {
    k, level,
    eqN: (x, y) => eqArr[(((y * k) | 0) & mask) * size + (((x * k) | 0) & mask)],
    eq: (x, y) => bil(L.eq, x, y),
    raw: (x, y) => bil(L.raw, x, y),
  };
}

/** px de textura por px de salida, suponiendo un cuadro de ~30 cm y escaneos a ~10 px/mm. */
function paperScale(longSide) {
  const pxPerMm = longSide / 300;
  return 10 / Math.max(0.05, pxPerMm);
}

/** Pinceladas sintéticas (respaldo si faltan las texturas reales). */
const _synth = {};
function synthetic(kind) {
  if (_synth[kind]) return _synth[kind];
  const out = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let k = 0; k < 6; k++) {
    const w = 64, h = 384, A = new Uint8Array(w * h), Sx = new Uint8Array(w * h);
    const br = new Float32Array(w);
    let prev = rnd();
    for (let x = 0; x < w; x++) { prev = prev * 0.5 + rnd() * 0.5; br[x] = prev; }
    const top = 18, bottom = h - 20, tail = Math.round(h * (0.6 + 0.2 * rnd()));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = (x - (w - 1) / 2) / ((w - 1) / 2);
      const edge = 0.7 + 0.06 * Math.sin(y * 0.11 + k) + 0.04 * (rnd() - 0.5);
      let a = Math.abs(v) < edge ? 1 : Math.max(0, 1 - (Math.abs(v) - edge) * 12);
      if (y < top) a *= Math.max(0, 1 - (top - y) / 8);
      if (y > tail) { const t = (y - tail) / Math.max(1, bottom - tail); a *= br[x] > t ? 1 : Math.max(0, 1 - (t - br[x]) * 6); }
      if (y > bottom) a = 0;
      A[y * w + x] = Math.round(a * 255);
      Sx[y * w + x] = Math.round(128 + (br[x] - 0.5) * 40 * a);
    }
    out.push({ w, h, top, head: top + 24, tail, bottom, fill: 0.8, aspect: h / w, A, S: kind === "lapiz" || kind === "acuarela" ? null : Sx, mips: null });
  }
  _synth[kind] = out;
  return out;
}

/** Elige un elemento al azar con peso (por defecto, la calidad q). */
function pick(arr, rand, wfn) {
  if (!arr || !arr.length) return null;
  let tot = 0;
  for (let i = 0; i < arr.length; i++) tot += wfn ? wfn(arr[i]) : (arr[i].q || 1);
  let t = rand() * tot;
  for (let i = 0; i < arr.length; i++) { t -= wfn ? wfn(arr[i]) : (arr[i].q || 1); if (t <= 0) return arr[i]; }
  return arr[arr.length - 1];
}

module.exports = { pick, synthetic, parse, prepare, sampleAt, rowAt, mip, preparePaper, paperSampler, paperScale };

};
__defs["mixta.js"] = function (module, exports, require) {
/*
 * Trazo · Técnicas mixtas
 *
 * paintLG — Lápiz + gouache: dibujo a lápiz completo; gouache opaco en una parte
 *   de las zonas, desalineado de la línea y con borde irregular (o con manchas
 *   reales sueltas); y la línea de lápiz otra vez por encima, muy presente.
 *
 * paintCollage — Mixta completa: cada zona con un material distinto que no se
 *   integra con el resto: recortes de la propia foto pasados por filtros de
 *   impresión (fotocopia, trama de puntos, risografía), planos de gouache,
 *   ceras y línea de tinta. Variantes: cuaderno, collage, cartel, impresión.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");
const Painter = require("./painter.js");
const Painter2 = require("./painter2.js");
const Pencil = require("./pencil.js");
const K = require("./kit.js");
const M = require("./rotuladores.js");

/* ---------- gouache completo (RGBA) ---------- */
async function gouacheLayer(ctx, p, seg, Lfull, clock, modo) {
  const gp = Object.assign({}, p, { modo: modo || "pleinair", cobertura: 1 });
  const planes = await Painter2.paint(ctx, "gouache", gp, seg, Lfull, clock);
  return Painter.finish(ctx, "gouache", gp, planes, clock);
}

/** Máscara por zonas con borde orgánico y desplazada (desregistro respecto a la línea). */
function regionMask(ctx, seg, Lfull, chosen, shiftX, shiftY, wob, seed) {
  const { W, H, N } = ctx;
  const gw = Math.max(4, Math.ceil(W / 40)), gh = Math.max(4, Math.ceil(H / 40));
  const nx = C.fbmGrid(gw, gh, Math.max(2, gw / 8), 3, seed + 1, 0.5), ny = C.fbmGrid(gw, gh, Math.max(2, gw / 8), 3, seed + 2, 0.5);
  const m = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ox = (C.bilinear(nx, gw, gh, x / 40, y / 40) - 0.5) * 2 * wob, oy = (C.bilinear(ny, gw, gh, x / 40, y / 40) - 0.5) * 2 * wob;
    const sx = C.clamp((x - shiftX + ox) | 0, 0, W - 1), sy = C.clamp((y - shiftY + oy) | 0, 0, H - 1);
    m[y * W + x] = chosen[Lfull[sy * W + sx]];
  }
  return m;
}

async function paintLG(ctx, p, seg, Lfull, clock) {
  const { W, H, N, s } = ctx;
  const reg = seg.reg;
  const mode = p.modo;
  const rand = C.mulberry32(ctx.seed * 37 + 1);
  const tick = (a, b) => ({ tick: async (f) => clock.tick(a + (b - a) * f), stage() {}, report() {}, force: async () => {} });
  const pencilLib = ctx.strokesOf(["pin_lapiz"]);

  // 1) lápiz: rayado ligero y contornos
  const base = await Pencil.paint(ctx, Object.assign({}, p, { modo: "mixta", cobertura: 0.55 + 0.3 * (1 - p.cobertura) }), tick(0, 0.3), seg, Lfull, { lib: pencilLib, only: "tono" });
  // 2) gouache
  const gou = await gouacheLayer(ctx, Object.assign({}, p, { grosor: p.grosor * 0.9 }), seg, Lfull, tick(0.3, 0.7), "pleinair");
  // qué zonas llevan gouache: las importantes y las de color; "más lápiz" deja muchas solo a lápiz
  const cover = { maslapiz: 0.28, equilibrada: 0.55, masgouache: 0.82, manchas: 0.6 }[mode] * (0.6 + 0.6 * p.cobertura);
  // se eligen por importancia y color hasta cubrir la proporción de la variante
  const chosen = new Float32Array(reg.n);
  {
    const score = [];
    let total = 0;
    for (let r = 0; r < reg.n; r++) {
      const sat = Math.max(reg.mean[r * 3], reg.mean[r * 3 + 1], reg.mean[r * 3 + 2]) - Math.min(reg.mean[r * 3], reg.mean[r * 3 + 1], reg.mean[r * 3 + 2]);
      score.push([reg.imp[r] * 0.9 + sat * 0.8 + rand() * 0.35 - (reg.lum[r] > 0.88 ? 0.6 : 0), r]);
      total += reg.cnt[r];
    }
    score.sort((a, b) => b[0] - a[0]);
    let acc = 0;
    for (const [, r] of score) {
      if (acc / total >= cover) break;
      chosen[r] = 0.82 + 0.18 * rand();          // algunas zonas diluidas: se ve el lápiz debajo
      acc += reg.cnt[r];
    }
  }
  let mask;
  const Rb = (2.6 + p.grosor * 22) * s;
  if (mode === "manchas") {
    // manchas reales sueltas: no siguen el contorno de la forma
    mask = new Float32Array(N);
    const st = ctx.assets.manchas && ctx.assets.manchas.items ? ctx.assets.manchas.items.filter((it) => /relleno|remolino|parche|toques/.test(it.tags[0])) : [];
    const fa = 1 / ctx.ax;
    for (let r = 0; r < reg.n; r++) {
      if (!chosen[r]) continue;
      const area = reg.cnt[r] * fa * fa;
      const nS = Math.min(4, Math.max(1, Math.round(area / (Rb * Rb * 60))));
      for (let k = 0; k < nS; k++) {
        const a = seg.pixOff[r], b = seg.pixOff[r + 1];
        const pi = seg.pix[a + ((rand() * (b - a)) | 0)];
        const cx = (pi % seg.aw + 0.5) * fa, cy = (((pi / seg.aw) | 0) + 0.5) * fa;
        const size = Math.min(Math.sqrt(area) * (1.0 + 0.6 * rand()), Math.max(W, H) * 0.5);
        if (st.length) {
          const it = st[(rand() * st.length) | 0];
          K.drawStamp(it, cx + (rand() - 0.5) * Rb, cy + (rand() - 0.5) * Rb, size, (rand() - 0.5) * 1.2, W, H, (i, av) => { mask[i] = Math.max(mask[i], C.smoothstep(0.15, 0.6, av) * chosen[r]); });
        }
      }
    }
  } else {
    mask = regionMask(ctx, seg, Lfull, chosen, Math.round(Rb * 0.35 * (rand() - 0.3)), Math.round(Rb * 0.3 * (rand() - 0.3)), Rb * 0.45, ctx.seed + 77);
  }
  for (let i = 0; i < N; i++) gou[i * 4 + 3] = gou[i * 4 + 3] * mask[i];
  await clock.tick(0.75);
  // 3) composición: lápiz → gouache → líneas de lápiz encima (muy presentes)
  const out = base;
  K.overU8(out, gou);
  const lines = await Pencil.paint(ctx, Object.assign({}, p, { modo: "mixta" }), tick(0.75, 0.98), seg, Lfull, { lib: pencilLib, only: "contornos", contourMul: 1.25 + 0.4 * p.intensidad });
  K.multU8(out, lines);
  return out;
}

/* ---------- filtros de impresión sobre un recorte de la foto ---------- */
const RISO = [[1.0, 0.28, 0.69], [0.0, 0.47, 0.75], [1.0, 0.91, 0.0], [0.0, 0.66, 0.36], [1.0, 0.42, 0.18], [0.38, 0.33, 0.66]];

function luminanceAt(ctx, x, y) {
  const i = ((y | 0) * ctx.W + (x | 0)) * ctx.comp, d = ctx.data;
  return (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
}

async function paintCollage(ctx, p, seg, Lfull, clock) {
  const { W, H, N, s } = ctx;
  const reg = seg.reg;
  const mode = p.modo;
  const rand = C.mulberry32(ctx.seed * 41 + 9);
  const tick = (a, b) => ({ tick: async (f) => clock.tick(a + (b - a) * f), stage() {}, report() {}, force: async () => {} });
  const A = ctx.assets || {};
  const imp = A.ov_impresion && A.ov_impresion.items.length ? K.overlaySampler(A.ov_impresion.items[(rand() * A.ov_impresion.items.length) | 0], W, H) : null;
  const gran = 0.3 + 0.9 * p.granulado;

  // material de cada zona
  const W8 = { cuaderno: [0.12, 0.38, 0.15, 0.35], collage: [0.45, 0.3, 0.1, 0.15], cartel: [0.15, 0.7, 0.1, 0.05], impresion: [0.6, 0.12, 0.2, 0.08] }[mode];
  // [impreso, gouache, cera, solo línea/papel]
  const mat = new Int8Array(reg.n), filt = new Int8Array(reg.n), riso = new Int8Array(reg.n);
  for (let r = 0; r < reg.n; r++) {
    let t = rand() * (W8[0] + W8[1] + W8[2] + W8[3] * (1.4 - p.cobertura));
    let m = 0;
    while (m < 3 && t > W8[m]) { t -= W8[m]; m++; }
    if (reg.lum[r] > 0.9 && m === 1) m = 3;
    if (m === 2 && reg.cnt[r] > 0.04 * seg.aw * seg.ah) m = 1;   // las ceras, solo en zonas pequeñas y medianas
    mat[r] = m;
    filt[r] = mode === "cartel" ? 2 : mode === "impresion" ? (rand() < 0.5 ? 2 : (rand() < 0.5 ? 1 : 0)) : (rand() < 0.55 ? 0 : 1); // 0 fotocopia · 1 trama · 2 riso
    riso[r] = (rand() * RISO.length) | 0;
  }
  // 1) gouache (planos) para las zonas de pintura
  const gp = Object.assign({}, p, { empaste: 0.1, varSat: mode === "cartel" ? 0.6 : p.varSat, curvatura: 0.5, humedad: 0.3, cruzado: 0.3, varLuz: 0.15 });
  const gou = await gouacheLayer(ctx, gp, seg, Lfull, tick(0, 0.4), mode === "cartel" ? "lineaplano" : "pleinair");
  await clock.tick(0.4);

  const out = new Uint8Array(N * 4);
  // 2) recortes impresos: papel del recorte (filo blanco) + imagen filtrada
  const cell = Math.max(3, (3 + 6 * p.grosor) * s);
  const ca = Math.cos(Math.PI / 4), sa = Math.sin(Math.PI / 4);
  const edgeW = Math.max(1, Math.round(1.5 * s));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, o = i * 4;
      const r = Lfull[i];
      const m = mat[r];
      if (m === 1) { // gouache
        out[o] = gou[o]; out[o + 1] = gou[o + 1]; out[o + 2] = gou[o + 2]; out[o + 3] = gou[o + 3];
        continue;
      }
      if (m !== 0) continue;
      // filo del recorte: el papel asoma en el borde de la pieza
      let edge = false;
      for (let k = 1; k <= edgeW && !edge; k++) {
        if ((x >= k && Lfull[i - k] !== r && mat[Lfull[i - k]] !== 0) || (x < W - k && Lfull[i + k] !== r && mat[Lfull[i + k]] !== 0) ||
            (y >= k && Lfull[i - k * W] !== r && mat[Lfull[i - k * W]] !== 0) || (y < H - k && Lfull[i + k * W] !== r && mat[Lfull[i + k * W]] !== 0)) edge = true;
      }
      const paperC = filt[r] === 0 ? 0.95 : 0.93;
      let rr = paperC, gg = paperC * 0.99, bb = paperC * 0.96, ink = 0, ir = 0.08, ig = 0.08, ib = 0.08;
      if (!edge) {
        const l = luminanceAt(ctx, x, y);
        if (filt[r] === 0) {          // fotocopia: alto contraste y tóner
          let v = C.smoothstep(0.62, 0.3, l + (C.hash2(x >> 1, y >> 1, 3) - 0.5) * 0.12 * gran);
          if (imp) v = Math.max(v * (0.85 + 0.15 * imp(x, y)), C.smoothstep(0.35, 0.1, imp(x, y)) * 0.8 * gran);
          ink = v;
        } else if (filt[r] === 1) {   // trama de puntos a 45°
          const u = (x * ca + y * sa) / cell, v2 = (-x * sa + y * ca) / cell;
          const fu = u - Math.floor(u) - 0.5, fv = v2 - Math.floor(v2) - 0.5;
          const d = Math.sqrt(fu * fu + fv * fv);
          const rad = Math.sqrt(C.clamp(1 - l, 0, 1)) * 0.62;
          ink = C.clamp((rad - d) * cell * 0.9 + 0.5, 0, 1);
        } else {                      // risografía: una tinta, 3 tonos, grano y desregistro
          const c = RISO[riso[r]];
          ir = c[0]; ig = c[1]; ib = c[2];
          const l2 = luminanceAt(ctx, C.clamp(x - 2 * s, 0, W - 1), C.clamp(y - 1 * s, 0, H - 1));
          const lev = l2 < 0.33 ? 1 : l2 < 0.6 ? 0.62 : l2 < 0.82 ? 0.3 : 0;
          ink = lev * (1 - gran * 0.45 * C.smoothstep(0.6, 1, C.hash2(x, y, 9)));
          if (imp) ink *= 0.8 + 0.2 * imp(x, y);
        }
      }
      rr = rr * (1 - ink) + ir * ink; gg = gg * (1 - ink) + ig * ink; bb = bb * (1 - ink) + ib * ink;
      out[o] = rr * 255 + 0.5; out[o + 1] = gg * 255 + 0.5; out[o + 2] = bb * 255 + 0.5; out[o + 3] = 255;
    }
    if ((y & 31) === 0) await clock.tick(0.4 + 0.25 * y / H);
  }
  // sombra mínima bajo los recortes (relieve del papel pegado)
  {
    const sh = new Float32Array(N), tmp = new Float32Array(N);
    const d = Math.max(1, Math.round(1.6 * s));
    for (let y = d; y < H; y++) for (let x = d; x < W; x++) if (mat[Lfull[(y - d) * W + x - d]] === 0) sh[y * W + x] = 1;
    C.boxBlurH(sh, tmp, W, H, d); C.boxBlurV(tmp, sh, W, H, d);
    for (let i = 0; i < N; i++) {
      if (mat[Lfull[i]] === 0 || sh[i] < 0.02) continue;
      const o = i * 4, a = sh[i] * 0.25;
      const da = out[o + 3] / 255, oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++) out[o + c] = (20 * a + out[o + c] * da * (1 - a)) / oa;
      out[o + 3] = oa * 255;
    }
  }
  await clock.tick(0.68);

  // 3) ceras: bandas de cera de color, sueltas
  const cera = (ctx.strokesOf(["pin_cera"]) || { samples: Lib.synthetic("cera") }).samples;
  const Tr = new Float32Array(N).fill(1), Tg = new Float32Array(N).fill(1), Tb = new Float32Array(N).fill(1);
  const raster = new S.StrokeRaster(W, H), path = new S.StrokePath();
  const col = new Float32Array(3);
  const Wc = Math.max(2, (4 + 10 * p.grosor) * s);
  for (let r = 0; r < reg.n; r++) {
    if (mat[r] !== 2) continue;
    M.markerColor(reg.mean[r * 3], reg.mean[r * 3 + 1], reg.mean[r * 3 + 2], 1.6, col);
    const bands = M.scanBands(ctx, seg, r, -Math.PI / 4 + (rand() - 0.5) * 1.0, Wc * 1.5, Wc * 1.5, null, rand);
    for (const bd of bands) {
      if (rand() < 0.35) continue;
      M.drawBand(ctx, raster, path, cera, rand, bd[0], bd[1], bd[2], bd[3], Wc * (0.7 + 0.5 * rand()), Wc * 0.5, (g, a) => {
        const aa = a * (0.4 + 0.3 * p.intensidad);
        Tr[g] *= 1 - aa * (1 - col[0]); Tg[g] *= 1 - aa * (1 - col[1]); Tb[g] *= 1 - aa * (1 - col[2]);
      });
    }
  }
  // 4) línea de tinta (y lápiz en cuaderno) por encima
  const ink = (ctx.strokesOf(["pin_linea"]) || { samples: Lib.synthetic("lapiz") }).samples;
  await M.drawContours(ctx, seg, Lfull, {
    lib: ink, width: Math.max(0.9, (0.8 + 2.4 * p.grosor) * s * (mode === "cartel" ? 1.4 : 1)), opacity: 0.92,
    thr: { cuaderno: 0.12, collage: 0.35, cartel: 0.25, impresion: 0.45 }[mode] - 0.12 * p.detalle, impK: 0.9,
    segLen: (50 + 160 * p.longitud) * s, gap: 3, overshoot: 0.18,
    apply: (g, a) => { Tr[g] *= 1 - a * 0.94; Tg[g] *= 1 - a * 0.94; Tb[g] *= 1 - a * 0.93; },
  }, tick(0.72, 0.95));
  K.multU8(out, K.transToRGBA(Tr, Tg, Tb));
  if (mode === "cuaderno") {
    const lines = await Pencil.paint(ctx, Object.assign({}, p, { modo: "linea", curvatura: 0.6, cruzado: 0.3 }), tick(0.95, 0.99), seg, Lfull, { lib: ctx.strokesOf(["pin_lapiz"]), only: "contornos", contourMul: 0.8 });
    K.multU8(out, lines);
  }
  if (ctx.selFull) for (let i = 0; i < N; i++) out[i * 4 + 3] = out[i * 4 + 3] * ctx.selFull[i] / 255;
  return out;
}

module.exports = { paintLG, paintCollage };

};
__defs["painter.js"] = function (module, exports, require) {
/*
 * Trazo · pintor de pinceladas (Óleo, Gouache, Ceras)
 *
 * Método: capas de pincel de grueso a fino. En cada capa se proponen puntos
 * en una rejilla; un trazo solo se pinta si en ese punto falta pintura o el
 * color del lienzo difiere de la referencia (Hertzmann). Cada trazo sigue el
 * campo de direcciones de la imagen y se detiene en los cambios de color.
 * El lienzo es premultiplicado: lo no pintado queda transparente.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");

const BODY = 0.7; // fracción del ancho de la textura que ocupa el cuerpo del trazo
const VK = 0.9;   // se rasteriza el 90 % central del ancho (el borde exterior está vacío)

const NB = 32; // cerdas por pincel

function kindConfig(kind, p, s) {
  // radios y longitudes en px a resolución de trabajo (s = lado largo / 1000)
  if (kind === "oleo") {
    const R0 = (1.8 + p.grosor * 20) * s;
    return {
      R0, layers: 1 + Math.round(p.detalle * 3), ratio: 0.5, minR: 0.8,
      Lk: 2 * (0.7 + p.longitud * 6.5), spacing: 1.05, soft: 0.22,
      opacity: 0.55 + 0.45 * p.intensidad, streak: 0.2, wet: 0.22,
      dry: 0.55 + 0.4 * p.intensidad, thick: p.empaste, sat: 1.1,
      tol: 0.42 - 0.22 * p.detalle, refineT: 0.14 - 0.09 * p.detalle,
      needCov: 0.7, gloss: 0.3, shade: 1.0, canvasTex: 0.5, under: 0.9,
      sK: 0.75 + 0.9 * p.empaste, paperDep: 0, dual: 0.6,
    };
  }
  if (kind === "gouache") {
    const R0 = (1.8 + p.grosor * 17) * s;
    return {
      R0, layers: 1 + Math.round(p.detalle * 3), ratio: 0.5, minR: 0.8,
      Lk: 2 * (1.6 + p.longitud * 6.5), spacing: 1.0, soft: 0.1,
      opacity: 0.8 + 0.2 * p.intensidad, streak: 0.12, wet: 0.06,
      dry: 0.6 + 0.3 * p.intensidad, thick: p.empaste * 0.45, sat: 1.04,
      tol: 0.36 - 0.2 * p.detalle, refineT: 0.12 - 0.08 * p.detalle,
      needCov: 0.85, gloss: 0.0, shade: 0.7, palette: 0.5, canvasTex: 0.35, under: 1.0,
      sK: 0.7 + 0.6 * p.empaste, paperDep: 0, dual: 0.45,
    };
  }
  // ceras
  const R0 = (2.4 + p.grosor * 12) * s;
  return {
    R0, layers: 2 + Math.round(p.detalle * 1.4), ratio: 0.72, minR: 0.6,
    Lk: 2 * (2.5 + p.longitud * 12), spacing: 1.9, soft: 0.35,
    opacity: 0.92, pressure: 0.3 + 0.62 * p.intensidad, streak: 0.12, wet: 0.0,
    dry: 0.7, thick: p.empaste * 0.6, sat: 1.22,
    tol: 0.5 - 0.22 * p.detalle, refineT: 0.18 - 0.1 * p.detalle,
    needCov: 0.8, gloss: 0.12, shade: 0.6, canvasTex: 0.0, under: 0,
    sK: 0.85 + 0.6 * p.empaste, paperDep: 0.5, dual: 0.5,
  };
}

/* ---------- paleta para gouache (k-means simple) ---------- */
function buildPalette(ctx, K, seed) {
  const { ar, ag, ab } = ctx;
  const n = ar.length;
  const rand = C.mulberry32(seed + 55);
  const samples = Math.min(n, 6000);
  const sr = new Float32Array(samples), sg = new Float32Array(samples), sb = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const j = Math.floor(rand() * n);
    sr[i] = ar[j]; sg[i] = ag[j]; sb[i] = ab[j];
  }
  const cr = new Float32Array(K), cg = new Float32Array(K), cb = new Float32Array(K);
  // inicialización k-means++ simplificada
  let j0 = Math.floor(rand() * samples);
  cr[0] = sr[j0]; cg[0] = sg[j0]; cb[0] = sb[j0];
  const dist = new Float32Array(samples).fill(1e9);
  for (let k = 1; k < K; k++) {
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      const dr = sr[i] - cr[k - 1], dg = sg[i] - cg[k - 1], db = sb[i] - cb[k - 1];
      const d = dr * dr + dg * dg + db * db;
      if (d < dist[i]) dist[i] = d;
      sum += dist[i];
    }
    let t = rand() * sum, pick = 0;
    for (let i = 0; i < samples; i++) { t -= dist[i]; if (t <= 0) { pick = i; break; } }
    cr[k] = sr[pick]; cg[k] = sg[pick]; cb[k] = sb[pick];
  }
  const asg = new Int32Array(samples);
  for (let it = 0; it < 8; it++) {
    for (let i = 0; i < samples; i++) {
      let best = 0, bd = 1e9;
      for (let k = 0; k < K; k++) {
        const dr = sr[i] - cr[k], dg = sg[i] - cg[k], db = sb[i] - cb[k];
        const d = dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.7;
        if (d < bd) { bd = d; best = k; }
      }
      asg[i] = best;
    }
    const nr = new Float32Array(K), ng = new Float32Array(K), nb = new Float32Array(K), cnt = new Float32Array(K);
    for (let i = 0; i < samples; i++) { const k = asg[i]; nr[k] += sr[i]; ng[k] += sg[i]; nb[k] += sb[i]; cnt[k]++; }
    for (let k = 0; k < K; k++) if (cnt[k] > 0) { cr[k] = nr[k] / cnt[k]; cg[k] = ng[k] / cnt[k]; cb[k] = nb[k] / cnt[k]; }
  }
  return { r: cr, g: cg, b: cb, K };
}

function snapPalette(pal, c, amt) {
  let best = 0, bd = 1e9;
  for (let k = 0; k < pal.K; k++) {
    const dr = c[0] - pal.r[k], dg = c[1] - pal.g[k], db = c[2] - pal.b[k];
    const d = dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.7;
    if (d < bd) { bd = d; best = k; }
  }
  c[0] += (pal.r[best] - c[0]) * amt;
  c[1] += (pal.g[best] - c[1]) * amt;
  c[2] += (pal.b[best] - c[2]) * amt;
}

function saturate(c, k) {
  const y = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  for (let i = 0; i < 3; i++) { const v = y + (c[i] - y) * k; c[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
}

/**
 * Pinta con pinceladas. Devuelve {Pr,Pg,Pb,Cv,Hh} (planos premultiplicados).
 */
async function paint(ctx, kind, p, clock) {
  const { W, H, N, s } = ctx;
  const cfg = kindConfig(kind, p, s);
  const rand = C.mulberry32(ctx.seed * 31 + 7);
  const Pr = new Float32Array(N), Pg = new Float32Array(N), Pb = new Float32Array(N);
  const Cv = new Float32Array(N);
  const Hh = cfg.thick > 0.001 || cfg.canvasTex > 0 ? new Float32Array(N) : null;
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const grain = C.makeGrainTile(ctx.seed + 5, kind === "ceras" ? "tooth" : "paper");
  const gsInv = 1 / Math.max(1, Math.sqrt(s) * (kind === "ceras" ? 0.9 : 1.6));
  const pal = cfg.palette ? buildPalette(ctx, 10 + Math.round(p.detalle * 14), ctx.seed) : null;
  const cover = ctx.cover;
  const sel = ctx.sel, selDetail = ctx.selMode === "detalle";
  const col = new Float32Array(3);
  const tmpc = new Float32Array(3);
  const bris = new Float32Array(NB);
  // trazos reales (si hay biblioteca) y soporte real a escala física
  const lib = ctx.lib && ctx.lib.samples && ctx.lib.samples.length ? ctx.lib.samples : null;
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H))) : null;
  const ts = new Float32Array(2);
  const col2 = new Float32Array(3);
  const stripes = new Float32Array(64);

  const varH = p.varTono * 0.42, varS = p.varSat * 0.55, varL = p.varLuz * 0.26;

  // radios de cada capa
  const radii = [];
  let R = cfg.R0;
  for (let k = 0; k < cfg.layers; k++) {
    radii.push(Math.max(cfg.minR, R));
    R *= cfg.ratio;
    if (R < cfg.minR * 0.9 && k >= 1) break;
  }
  const nL = radii.length;

  for (let k = 0; k < nL; k++) {
    const Rk = radii[k];
    const level = ctx.levelFor(Rk * (kind === "ceras" ? 1.6 : 1.0));
    const sp = Math.max(0.8, Rk * cfg.spacing * (kind === "ceras" ? 1 : 1));
    const cols = Math.ceil(W / sp), rows = Math.ceil(H / sp);
    const base = k === 0;
    // umbral estático de detalle para capas finas (evita millones de candidatos)
    const edgeGate = base ? -1 : (kind === "ceras" ? 0.02 : 0.04) + 0.1 * (k - 1);
    const angle = kind === "ceras" ? (k % 2 === 0 ? 0 : (k % 4 === 1 ? 0.42 : -0.42)) : 0;

    // candidatos
    let cnt = 0;
    let cap = 1 << 16;
    let cx = new Float32Array(cap), cy = new Float32Array(cap);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const x = (gx + rand()) * sp, y = (gy + rand()) * sp;
        if (x >= W || y >= H) continue;
        const m = ctx.at(cover, x, y);
        if (m < 0.999 && rand() > m) continue;
        if (!base) {
          let e = ctx.at(ctx.edge, x, y);
          if (selDetail && sel) e += ctx.at(sel, x, y) * 0.5;
          if (e < edgeGate) continue;
        }
        if (cnt >= cap) {
          cap *= 2;
          const nx = new Float32Array(cap); nx.set(cx); cx = nx;
          const ny = new Float32Array(cap); ny.set(cy); cy = ny;
        }
        cx[cnt] = x; cy[cnt] = y; cnt++;
      }
      if ((gy & 31) === 0) await clock.tick((k + gy / rows * 0.1) / nL);
    }
    const order = new Int32Array(cnt);
    for (let i = 0; i < cnt; i++) order[i] = i;
    S.shuffle(order, cnt, rand);

    const tolK = cfg.tol * (1 + 0.35 * (nL - 1 - k));
    const L = Rk * cfg.Lk * (base ? 1 : 0.8);
    const step = Math.max(0.8, kind === "ceras" ? Rk * 1.2 + 0.5 * s : Rk * 0.9);

    for (let oi = 0; oi < cnt; oi++) {
      const ci = order[oi];
      const x = cx[ci], y = cy[ci];
      const xi = x | 0, yi = y | 0;
      const g0 = yi * W + xi;
      const cov0 = Cv[g0];

      ctx.colorAt(level, x, y, col);
      // ¿hace falta pintar aquí?
      let need = cov0 < cfg.needCov;
      if (!need && !base) {
        const inv = 1 / cov0;
        const err = Math.abs(Pr[g0] * inv - col[0]) + Math.abs(Pg[g0] * inv - col[1]) + Math.abs(Pb[g0] * inv - col[2]);
        let T = cfg.refineT * 3 * (1.25 - ctx.at(ctx.edge, x, y) * 0.9);
        if (selDetail && sel) T *= 1 - 0.6 * ctx.at(sel, x, y);
        need = err > T;
      } else if (!need && base && kind === "ceras") {
        need = rand() < 0.18; // las ceras se superponen un poco más
      }
      if (!need) continue;

      // color del trazo
      if (pal) snapPalette(pal, col, cfg.palette);
      if (cfg.sat !== 1) saturate(col, cfg.sat);
      tmpc[0] = col[0]; tmpc[1] = col[1]; tmpc[2] = col[2];
      C.varyColor(tmpc[0], tmpc[1], tmpc[2],
        (rand() - 0.5) * 2 * varH, (rand() - 0.5) * 2 * varS, (rand() - 0.5) * 2 * varL, col);

      // trayectoria
      S.traceStroke(ctx, path, x, y, {
        R: Rk, Lmax: L * (0.6 + rand() * 0.8), step, curv: 0.08 + 0.9 * p.curvatura,
        colorTol: tolK, color: tmpc, level, angle: angle + (rand() - 0.5) * (kind === "ceras" ? 0.25 : lib ? 0.3 : 0),
        minLen: Rk * (kind === "ceras" ? 3 : 1.2), fine: k >= 2 && Rk < 6 * s,
      });
      if (kind === "ceras") S.wobblePath(path, Rk * (0.3 + 0.9 * p.curvatura), Rk * (10 + rand() * 12), rand() * 6.28);

      // perfil de anchura
      const n = path.n, len = path.len || 1;
      const rs = path.rs;
      if (lib) {
        // con trazos reales la forma la da la muestra: área rasterizada constante
        const Rr = Rk / BODY, Rq = Rr * VK;
        for (let i = 0; i < n; i++) rs[i] = Rq;
        const ntl = raster.rasterize(path, 0.04);
        if (ntl === 0) continue;
        const smp = lib[(rand() * lib.length) | 0];
        const st = Lib.prepare(smp, len, Rr, rand, VK);
        const op = cfg.opacity * (kind === "ceras" ? 1 : (0.88 + rand() * 0.12));
        const thick = cfg.thick * (0.7 + rand() * 0.6);
        const cr = col[0], cg = col[1], cb = col[2];
        const sK = cfg.sK, wet = cfg.wet, pdep = cfg.paperDep;
        // pincel cargado con dos tonos: vetas finas a lo largo de las cerdas
        const vlum = 0.4 + p.varLuz + p.varTono * 0.6;
        const mixAmt = Math.min(0.9, cfg.dual * vlum * (0.4 + 0.6 * rand()));
        C.varyColor(cr, cg, cb, (rand() - 0.5) * 0.5 * (0.3 + p.varTono), (rand() - 0.5) * 0.5,
          (rand() < 0.5 ? -1 : 1) * (0.07 + 0.12 * rand()), col2);
        const c2r = col2[0], c2g = col2[1], c2b = col2[2];
        let ph = rand() * 6.28, fr1 = 5 + rand() * 9, fr2 = 13 + rand() * 17;
        for (let q = 0; q < 64; q++) {
          const z = q / 63;
          const w = 0.55 * Math.sin(z * fr1 + ph) + 0.45 * Math.sin(z * fr2 + ph * 1.7) + (rand() - 0.5) * 0.5;
          stripes[q] = C.smoothstep(0.05, 0.7, w);
        }
        const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
        for (let t = 0; t < ntl; t++) {
          const li = tl[t], g = tg[t];
          const u = U[li];
          Lib.sampleAt(st, u, V[li], ts);
          let a = ts[0] * op * A[li];
          if (pdep > 0 && pap && a > 0.004) {
            // las ceras se quedan en los picos del papel (siempre el mismo grano)
            const x = g % W, y = (g / W) | 0;
            a *= 1 - pdep + pdep * C.smoothstep(0.2, 0.7, pap.eqN(x, y));
          }
          if (a < 0.004) continue;
          // detalle de la muestra: menos en los bordes (cobertura parcial) y sombras suaves
          let sv = ts[1] * sK * C.smoothstep(0.3, 0.9, ts[0]);
          if (sv < 0) sv *= 0.7;
          const vv = V[li];
          const mz = stripes[((vv + 1) * 31.5) | 0] * mixAmt;
          const br = cr + (c2r - cr) * mz, bgc = cg + (c2g - cg) * mz, bbc = cb + (c2b - cb) * mz;
          let r, gg, bb;
          if (sv < 0) { const f = 1 + (sv < -0.9 ? -0.9 : sv); r = br * f; gg = bgc * f; bb = bbc * f; }
          else { const f = sv > 1 ? 0.85 : sv * 0.85; r = br + (1 - br) * f; gg = bgc + (1 - bgc) * f; bb = bbc + (1 - bbc) * f; }
          const cv = Cv[g];
          if (wet > 0 && cv > 0.05) {
            const m = wet * (0.2 + 0.8 * (u < 0 ? 0 : u > 1 ? 1 : u)) * cv, inv = 1 / cv;
            r += (Pr[g] * inv - r) * m; gg += (Pg[g] * inv - gg) * m; bb += (Pb[g] * inv - bb) * m;
          }
          const ia = 1 - a;
          Pr[g] = Pr[g] * ia + r * a; Pg[g] = Pg[g] * ia + gg * a; Pb[g] = Pb[g] * ia + bb * a;
          Cv[g] = cv * ia + a;
          if (Hh) Hh[g] = Hh[g] * (1 - a * 0.85) + a * thick * (0.45 + 0.55 * ts[0] + 0.5 * ts[1]);
        }
        raster.clear();
        if ((oi & 15) === 0) await clock.tick((k + 0.1 + 0.9 * oi / cnt) / nL);
        continue;
      }
      for (let i = 0; i < n; i++) {
        const u = path.ss[i] / len;
        let prof;
        if (kind === "oleo") prof = 0.82 + 0.18 * Math.sin(Math.min(1, u * 1.15) * Math.PI) - 0.1 * C.smoothstep(0.75, 1, u);
        else if (kind === "gouache") prof = 0.9 + 0.1 * Math.sin(u * Math.PI);
        else prof = 0.55 + 0.45 * Math.sin(u * Math.PI);
        rs[i] = Rk * prof;
      }
      const nt = raster.rasterize(path, cfg.soft);
      if (nt === 0) continue;

      // cerdas de este pincel
      let prev = rand();
      for (let b = 0; b < NB; b++) { const v = rand(); prev = prev * 0.45 + v * 0.55; bris[b] = prev; }
      const nbm = Math.max(3, Math.min(NB, Math.round(Rk * 1.3))) - 1; // cerdas visibles según el tamaño
      const dryStart = cfg.dry * (0.75 + rand() * 0.25);
      const op = cfg.opacity * (kind === "ceras" ? 1 : (0.85 + rand() * 0.15));
      const thick = cfg.thick * (0.7 + rand() * 0.6);
      const cr = col[0], cg = col[1], cb = col[2];
      const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;

      if (kind === "oleo") {
        const streak = cfg.streak, wet = cfg.wet;
        const capK = 1.6 * (path.len || 1) / Math.max(1, Rk);
        for (let t = 0; t < nt; t++) {
          const li = tl[t], g = tg[t];
          const u = U[li], v = V[li];
          const b = bris[((v + 1) * 0.5 * nbm + 0.5) | 0];
          let a = A[li] * op;
          if (u > dryStart) {
            const nd = u > 1 ? 1 : (u - dryStart) / (1 - dryStart);
            a *= C.smoothstep(nd - 0.3, nd + 0.02, b);
          }
          if (u < 0) a *= C.smoothstep(-u * capK - 0.2, -u * capK + 0.05, b);
          if (a < 0.004) continue;
          const sk = 1 + (b - 0.5) * streak;
          let r = cr * sk, gg = cg * sk, bb = cb * sk;
          const cv = Cv[g];
          if (cv > 0.05) {
            const m = wet * (0.25 + 0.75 * u) * cv;
            const inv = 1 / cv;
            r += (Pr[g] * inv - r) * m; gg += (Pg[g] * inv - gg) * m; bb += (Pb[g] * inv - bb) * m;
          }
          const ia = 1 - a;
          Pr[g] = Pr[g] * ia + r * a; Pg[g] = Pg[g] * ia + gg * a; Pb[g] = Pb[g] * ia + bb * a;
          Cv[g] = cv * ia + a;
          if (Hh) {
            const av = v < 0 ? -v : v;
            const hs = thick * (0.45 + 0.55 * b + 0.22 * C.smoothstep(0.4, 1, av)) * (1 + 0.7 * (1 - u) * (1 - u) * (1 - u));
            Hh[g] = Hh[g] * (1 - a * 0.85) + hs * a;
          }
        }
      } else if (kind === "gouache") {
        const streak = cfg.streak, wet = cfg.wet;
        const capK = 2.5 * (path.len || 1) / Math.max(1, Rk); // remate seco en ~0.4 radios
        for (let t = 0; t < nt; t++) {
          const li = tl[t], g = tg[t];
          const u = U[li], v = V[li];
          const av = v < 0 ? -v : v;
          let a = A[li] * op;
          let ez = C.smoothstep(0.45, 1, av) * 0.6 + (u > dryStart ? (u - dryStart) / (1 - dryStart) * 0.85 : 0);
          if (u < 0) ez += -u * capK; else if (u > 1) ez += (u - 1) * capK;
          if (ez > 0.02) {
            const x = g % W, y = (g / W) | 0;
            const gr = C.tileAt(grain, x * gsInv, y * gsInv);
            a *= C.smoothstep(ez - 0.18, ez + 0.08, gr);
          }
          if (a < 0.004) continue;
          const b = bris[((v + 1) * 0.5 * nbm + 0.5) | 0];
          const sk = 1 + (b - 0.5) * streak;
          let r = cr * sk, gg = cg * sk, bb = cb * sk;
          const cv = Cv[g];
          if (cv > 0.05 && wet > 0) {
            const m = wet * u * cv, inv = 1 / cv;
            r += (Pr[g] * inv - r) * m; gg += (Pg[g] * inv - gg) * m; bb += (Pb[g] * inv - bb) * m;
          }
          const ia = 1 - a;
          Pr[g] = Pr[g] * ia + r * a; Pg[g] = Pg[g] * ia + gg * a; Pb[g] = Pb[g] * ia + bb * a;
          Cv[g] = cv * ia + a;
          if (Hh) Hh[g] = Hh[g] * (1 - a * 0.9) + thick * (0.6 + 0.4 * b) * a;
        }
      } else {
        // ceras: el pigmento se queda en los picos del grano del papel
        const pressure = cfg.pressure;
        const lumc = 0.299 * cr + 0.587 * cg + 0.114 * cb;
        const spr = (0.8 + rand() * 0.4) * (1 + 0.45 * (1 - lumc)); // presión: más en colores oscuros
        const floor = 0.25 + 0.45 * (1 - lumc);
        for (let t = 0; t < nt; t++) {
          const li = tl[t], g = tg[t];
          const v = V[li], u = U[li];
          const b = bris[((v + 1) * 0.5 * nbm + 0.5) | 0];
          const x = g % W, y = (g / W) | 0;
          const gr = C.tileAt(grain, x * gsInv, y * gsInv);
          const pr = pressure * spr * (0.72 + 0.28 * b) * (0.8 + 0.2 * Math.sin(u * Math.PI));
          const dep = floor + (1 - floor) * C.smoothstep(1 - pr - 0.2, 1 - pr + 0.1, gr);
          let a = A[li] * dep * op;
          if (a < 0.004) continue;
          const sk = 1 + (b - 0.5) * cfg.streak;
          const ia = 1 - a;
          Pr[g] = Pr[g] * ia + cr * sk * a; Pg[g] = Pg[g] * ia + cg * sk * a; Pb[g] = Pb[g] * ia + cb * sk * a;
          Cv[g] = Cv[g] * ia + a;
          if (Hh) Hh[g] += a * thick * 0.35 * (1 - Hh[g] * 0.5);
        }
      }
      raster.clear();
      if ((oi & 15) === 0) await clock.tick((k + 0.1 + 0.9 * oi / cnt) / nL);
    }
  }
  return { Pr, Pg, Pb, Cv, Hh, cfg, grain, gsInv, real: !!lib, pap };
}

/**
 * Sombreado final (relieve del empaste, brillo, textura de soporte) y salida RGBA.
 */
async function finish(ctx, kind, p, planes, clock) {
  const { W, H, N, s } = ctx;
  const { Pr, Pg, Pb, Cv, Hh, cfg, grain, pap } = planes;
  const out = new Uint8Array(N * 4);
  let weave = null, wInv = 1;
  if (Hh && cfg.canvasTex > 0 && pap) {
    // lienzo / papel real: la trama asoma donde la pintura es fina
    const tmp0 = new Float32Array(N);
    const rb0 = Math.max(1, Math.round(0.9 * Math.sqrt(s)));
    C.boxBlurH(Hh, tmp0, W, H, rb0); C.boxBlurV(tmp0, Hh, W, H, rb0);
    C.boxBlurH(Hh, tmp0, W, H, 1); C.boxBlurV(tmp0, Hh, W, H, 1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const thin = 1 - Math.min(1, Hh[i] * 1.2);
        Hh[i] += (0.5 + pap.raw(x, y) * 1.6) * cfg.canvasTex * (0.12 + 0.4 * thin);
      }
      if ((y & 63) === 0) await clock.tick(y / H * 0.3);
    }
  } else if (Hh && cfg.canvasTex > 0) {
    weave = C.makeGrainTile(ctx.seed + 9, kind === "oleo" ? "canvas" : "paper");
    wInv = 1 / Math.max(1, Math.sqrt(s) * (kind === "oleo" ? 1.0 : 1.6));
  }
  if (Hh && !(cfg.canvasTex > 0 && pap)) {
    // suavizado ligero del relieve
    const tmp = new Float32Array(N);
    const rb = Math.max(1, Math.round(0.6 * Math.sqrt(s)));
    C.boxBlurH(Hh, tmp, W, H, rb); C.boxBlurV(tmp, Hh, W, H, rb);
    C.boxBlurH(Hh, tmp, W, H, 1); C.boxBlurV(tmp, Hh, W, H, 1);
    if (weave) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const thin = 1 - Math.min(1, Hh[i] * 1.2);
          Hh[i] += C.tileAt(weave, x * wInv, y * wInv) * cfg.canvasTex * (0.15 + 0.35 * thin);
        }
        if ((y & 63) === 0) await clock.tick(y / H * 0.3);
      }
    }
  }
  // dirección de la luz (arriba-izquierda)
  let lx = -0.55, ly = -0.65, lz = 0.52;
  const lm = Math.sqrt(lx * lx + ly * ly + lz * lz);
  lx /= lm; ly /= lm; lz /= lm;
  const relief = (0.12 + 0.95 * p.empaste) * cfg.shade * Math.max(0.6, Math.sqrt(s)) * (planes.real ? 0.55 : 1);
  const gloss = cfg.gloss * (0.3 + p.empaste);
  const selFull = ctx.selFull;
  const data = ctx.data, comp = ctx.comp, srcA = ctx.srcAlpha;
  const chalk = kind === "gouache";
  const under = cfg.under || 0;
  const uLevel = ctx.levelFor(cfg.R0 * 1.5);
  const ucol = new Float32Array(3);
  const fullCover = p.cobertura >= 0.995;

  for (let y = 0; y < H; y++) {
    const row = y * W;
    const ym = y > 0 ? -W : 0, yp = y < H - 1 ? W : 0;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      let cv = Cv[i];
      const o = i * 4;
      let pr = Pr[i], pg = Pg[i], pb = Pb[i];
      if (under > 0 && cv < 0.999) {
        // imprimación: capa fina de color base bajo los huecos entre pinceladas
        let m = fullCover ? 1 : ctx.at(ctx.cover, x, y);
        m = m * m * under;
        if (m > 0.002) {
          ctx.colorAt(uLevel, x, y, ucol);
          const k = m * (1 - cv);
          pr += (ucol[0] * 0.9 + 0.08) * k; pg += (ucol[1] * 0.9 + 0.08) * k; pb += (ucol[2] * 0.9 + 0.08) * k;
          cv += k;
        }
      }
      if (cv <= 0.002) { out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = 0; continue; }
      const inv = 1 / cv;
      let r = pr * inv, g = pg * inv, b = pb * inv;
      if (Hh) {
        const hx = (x < W - 1 ? Hh[i + 1] : Hh[i]) - (x > 0 ? Hh[i - 1] : Hh[i]);
        const hy = Hh[i + yp] - Hh[i + ym];
        let nx = -hx * relief, ny = -hy * relief, nz = 1;
        const nm = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        nx *= nm; ny *= nm; nz *= nm;
        const ndl = nx * lx + ny * ly + nz * lz;
        const dif = (ndl - lz) * 1.15;
        const k = 1 + dif;
        r *= k; g *= k; b *= k;
        if (gloss > 0 && (!cfg.glossByHeight || Hh[i] > 0.08)) {
          const rv = 2 * ndl * nz - lz;
          if (rv > 0.6) {
            let sp = (rv - 0.6) / 0.4; sp = sp * sp; sp = sp * sp; sp = sp * sp;
            const add = sp * gloss * (cfg.glossByHeight ? C.smoothstep(0.08, 0.6, Hh[i]) : 1);
            r += add; g += add; b += add;
          }
        }
      }
      if (chalk) { r = r * 0.95 + 0.035; g = g * 0.95 + 0.035; b = b * 0.95 + 0.035; }
      let a = cv > 1 ? 1 : cv;
      if (selFull) a *= selFull[i] / 255;
      if (srcA) a *= data[i * comp + 3] / 255;
      out[o] = r <= 0 ? 0 : r >= 1 ? 255 : (r * 255 + 0.5) | 0;
      out[o + 1] = g <= 0 ? 0 : g >= 1 ? 255 : (g * 255 + 0.5) | 0;
      out[o + 2] = b <= 0 ? 0 : b >= 1 ? 255 : (b * 255 + 0.5) | 0;
      out[o + 3] = (a * 255 + 0.5) | 0;
    }
    if ((y & 31) === 0) await clock.tick(0.3 + 0.7 * y / H);
  }
  return out;
}

module.exports = { paint, finish, kindConfig };

};
__defs["painter2.js"] = function (module, exports, require) {
/*
 * Trazo · pintor opaco por manchas (Óleo, Gouache, Ceras)
 *
 * Como trabaja un pintor:
 *  1) MANCHA  — cada zona de color se cubre con su degradado (pintura fina y
 *     plana). Bordes perdidos en fondo y bajo contraste, nítidos en lo importante.
 *  2) FROTADO — pocas pasadas anchas y suaves que dan textura de pincel a lo plano.
 *  3) MODELADO — pinceladas largas que siguen la forma, solo dentro de su mancha.
 *     Si una pincelada no cabe entera, no se pinta (nada de puntitos).
 *  4) CONTORNO — pinceladas que recorren el borde de cada forma.
 *  5) ACENTOS — pasta gruesa en las luces importantes; las sombras quedan finas.
 * Cada pincelada es un trazo real de la biblioteca (forma, cerdas, final seco).
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");
const Seg = require("./segment.js");
const K = require("./kit.js");

const BODY = 0.7, VK = 0.9;

function config(kind, p, s) {
  if (kind === "oleo") return {
    Rb: (2.2 + p.grosor * 22) * s, Lk: 2 * (1.6 + p.longitud * 7), minLenK: 3.0,
    kappa: 1.0, flat: 0.62, scrub: 0.5, scrubN: 2.2, varK: 1.6, softK: 1.0, wobble: 0.35,
    op: 0.72 + 0.28 * p.intensidad, wet: 0.24, sK: 0.75 + 0.9 * p.empaste, dual: 0.6,
    thick: p.empaste, mancha: 0.05, edgeOp: 0.85, accent: 1, paperDep: 0,
    canvasTex: 0.55, shade: 1.0, gloss: 0.35,
  };
  if (kind === "gouache") return {
    Rb: (2.6 + p.grosor * 22) * s, Lk: 2 * (1.4 + p.longitud * 6), minLenK: 2.8,
    kappa: 0.6, flat: 0.38, scrub: 0.55, scrubN: 1.6, varK: 1.2, softK: 0.4, wobble: 0.25,
    op: 0.88 + 0.12 * p.intensidad, wet: 0.08, sK: 0.6 + 0.5 * p.empaste, dual: 0.4,
    thick: p.empaste * 0.4, mancha: 0.03, edgeOp: 0.95, accent: 0.4, paperDep: 0,
    canvasTex: 0.35, shade: 0.7, gloss: 0,
  };
  return { // ceras
    Rb: (2.2 + p.grosor * 13) * s, Lk: 2 * (2.2 + p.longitud * 9), minLenK: 3.6,
    kappa: 1.25, flat: 0.95, scrub: 0, scrubN: 0, varK: 1.4, softK: 0.5, wobble: 0.3,
    op: 0.9, pressure: 0.35 + 0.6 * p.intensidad, wet: 0, sK: 0.85 + 0.6 * p.empaste, dual: 0.5,
    thick: p.empaste * 0.55, mancha: 0.02, edgeOp: 0.9, accent: 0.5, paperDep: 0.32,
    canvasTex: 0, shade: 0.6, gloss: 0.12,
  };
}

/* ---------- trazado limitado a la mancha ---------- */
const _f = new Float32Array(2);
function traceInRegion(ctx, Lfull, r, path, x0, y0, o) {
  const W = ctx.W, H = ctx.H;
  const step = Math.max(0.8, o.step);
  const xs = path.xs, ys = path.ys;
  const runs = [];
  for (const sign of [1, -1]) {
    ctx.flowAt(x0, y0, _f, o.fine);
    let dx = _f[0] * o.ca - _f[1] * o.sa, dy = _f[0] * o.sa + _f[1] * o.ca;
    if (sign < 0) { dx = -dx; dy = -dy; }
    let x = x0, y = y0, out = 0, len = 0;
    const px = [], py = [];
    const budget = o.Lmax * 0.5;
    while (len < budget && px.length < 1500) {
      ctx.flowAt(x, y, _f, o.fine);
      let fx = _f[0] * o.ca - _f[1] * o.sa, fy = _f[0] * o.sa + _f[1] * o.ca;
      if (fx * dx + fy * dy < 0) { fx = -fx; fy = -fy; }
      let nx = dx + (fx - dx) * o.curv, ny = dy + (fy - dy) * o.curv;
      const m = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= m; ny /= m;
      const qx = x + nx * step, qy = y + ny * step;
      if (qx < 0 || qy < 0 || qx > W - 1 || qy > H - 1) break;
      let inside = Lfull[(qy | 0) * W + (qx | 0)] === r;
      if (inside && o.minDist > 0) {
        // la pincelada tiene anchura: solo avanza por donde cabe
        const ax = Math.min(o.aw - 1, (qx * o.axs) | 0), ay = Math.min(o.ah - 1, (qy * o.axs) | 0);
        if (o.dt[ay * o.aw + ax] < o.minDist) inside = false;
      }
      if (!inside) { out += step; if (out > o.over) break; } else out = 0;
      x = qx; y = qy; dx = nx; dy = ny; len += step;
      px.push(x); py.push(y);
    }
    // quitar la cola que se salió de la mancha más allá del margen permitido
    while (px.length && out > 0) { px.pop(); py.pop(); out -= step; }
    runs.push([px, py]);
  }
  let n = 0;
  const [bx, by] = runs[1], [fx, fy] = runs[0];
  for (let i = bx.length - 1; i >= 0; i--) { xs[n] = bx[i]; ys[n] = by[i]; n++; }
  xs[n] = x0; ys[n] = y0; n++;
  for (let i = 0; i < fx.length && n < S.MAXPTS - 1; i++) { xs[n] = fx[i]; ys[n] = fy[i]; n++; }
  path.n = n;
  let sl = 0; path.ss[0] = 0;
  for (let i = 1; i < n; i++) { const ddx = xs[i] - xs[i - 1], ddy = ys[i] - ys[i - 1]; sl += Math.sqrt(ddx * ddx + ddy * ddy); path.ss[i] = sl; }
  path.len = sl;
  return sl;
}

/** Copia una polilínea (px de salida) a la trayectoria. */
function setPath(path, xs, ys, n) {
  path.n = n;
  let sl = 0; path.ss[0] = 0;
  for (let i = 0; i < n; i++) { path.xs[i] = xs[i]; path.ys[i] = ys[i]; if (i) { const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1]; sl += Math.sqrt(dx * dx + dy * dy); path.ss[i] = sl; } }
  path.len = sl;
  return sl;
}

/** Ajustes de cada variante sobre la configuración base. */
function applyMode(cfg, kind, p) {
  const m = p.modo;
  Object.assign(cfg, { imprim: 0, brushLines: 0, tileAmt: 0.45, stamps: 0.6, lechoso: 0, steps: 0, earth: 0, satK: 1, gapW: 0, darkBg: 0, splat: 0, shift: 0 });
  if (kind === "oleo") {
    if (m === "planos") Object.assign(cfg, { imprim: 0.2, tileAmt: 0.55, stamps: 0.8, brushLines: 0.15 });
    if (m === "gestual") Object.assign(cfg, { imprim: 0.45, Rb: cfg.Rb * 1.3, Lk: cfg.Lk * 1.5, kappa: 0.75, tileAmt: 0.6, stamps: 1.0, dual: 0.85, satK: 1.18, brushLines: 0.35, softK: 0.6 });
    if (m === "boceto") Object.assign(cfg, { imprim: 0.9, thick: cfg.thick * 0.35, kappa: 0.55, scrub: 0.65, scrubN: 2.6, tileAmt: 0.3, stamps: 0.3, brushLines: 1.0, accent: 0.6 });
    if (m === "materico") Object.assign(cfg, { imprim: 0.25, earth: 0.65, tileAmt: 0.9, stamps: 1.2, brushLines: 0.75, gloss: 0.12, satK: 0.85 });
  } else if (kind === "gouache") {
    if (m === "pleinair") Object.assign(cfg, { steps: 5, lechoso: 0.14, tileAmt: 0.35, stamps: 0.5 });
    if (m === "lineaplano") Object.assign(cfg, { steps: 4, lechoso: 0.18, kappa: 0.25, scrub: 0.2, tileAmt: 0.2, stamps: 0.2, gapW: 2.2, shift: 0.5, brushLines: 0.85 });
    if (m === "expresivo") Object.assign(cfg, { lechoso: 0.08, darkBg: 0.75, splat: 1, brushLines: 0.7, tileAmt: 0.45, stamps: 0.8, satK: 1.15 });
    if (m === "diluido") Object.assign(cfg, { lechoso: 0.1, softK: 1.2, op: cfg.op * 0.8, wobble: 0.5, kappa: 0.4, tileAmt: 0.3, stamps: 0.4 });
  }
  return cfg;
}

async function paint(ctx, kind, p, seg, Lfull, clock) {
  const { W, H, N, s } = ctx;
  const cfg = applyMode(config(kind, p, s), kind, p);
  const rand = C.mulberry32(ctx.seed * 31 + 7);
  const reg = seg.reg;
  const Pr = new Float32Array(N), Pg = new Float32Array(N), Pb = new Float32Array(N);
  const Cv = new Float32Array(N), Hh = new Float32Array(N);
  const lib = ctx.lib && ctx.lib.samples && ctx.lib.samples.length ? ctx.lib.samples : Lib.synthetic(kind);
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H))) : null;
  const col = new Float32Array(3), col2 = new Float32Array(3), ts = new Float32Array(2);
  const stripes = new Float32Array(64);
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const fa = 1 / ctx.ax; // px de salida por px de análisis
  const varH = p.varTono * 0.4, varS = p.varSat * 0.5, varL = p.varLuz * 0.22;

  // color propio de cada mancha (pequeña desviación, como al mezclar en la paleta)
  const tint = new Float32Array(reg.n * 3);
  for (let r = 0; r < reg.n; r++) {
    C.varyColor(0.5, 0.5, 0.5, (rand() - 0.5) * varH * 0.6, 0, (rand() - 0.5) * varL * 0.5, col);
    tint[r * 3] = col[0] - 0.5; tint[r * 3 + 1] = col[1] - 0.5; tint[r * 3 + 2] = col[2] - 0.5;
  }
  // fondo oscuro del retrato expresivo: las zonas poco importantes y oscuras se hunden
  const lumSorted = Array.from(reg.lum).sort((a, b) => a - b);
  const lumMed = lumSorted[(lumSorted.length / 2) | 0] || 0.5;
  const sink = new Float32Array(reg.n);
  if (cfg.darkBg) for (let r = 0; r < reg.n; r++) sink[r] = reg.imp[r] < 0.45 && reg.lum[r] < lumMed + 0.1 ? cfg.darkBg : 0;
  const regionColor = (r, x, y, out) => {
    Seg.modelColor(seg, r, (x + 0.5) / W, (y + 0.5) / H, out);
    out[0] = C.clamp(out[0] + tint[r * 3], 0, 1); out[1] = C.clamp(out[1] + tint[r * 3 + 1], 0, 1); out[2] = C.clamp(out[2] + tint[r * 3 + 2], 0, 1);
    if (cfg.steps) {   // valores escalonados: el gouache se pinta por planos de valor
      const l = 0.299 * out[0] + 0.587 * out[1] + 0.114 * out[2];
      const q = Math.round(reg.lum[r] * cfg.steps) / cfg.steps, k = (q + 0.03) / Math.max(0.03, reg.lum[r] + 0.03);
      const l2 = l * (0.35 + 0.65 * k);
      for (let c = 0; c < 3; c++) out[c] = C.clamp(out[c] * (l2 / Math.max(0.02, l)), 0, 1);
    }
    if (cfg.earth) {   // paleta de tierras
      const l = 0.299 * out[0] + 0.587 * out[1] + 0.114 * out[2];
      const er = l * 1.18 + 0.03, eg = l * 0.98, eb = l * 0.72;
      out[0] = C.clamp(out[0] + (er - out[0]) * cfg.earth, 0, 1); out[1] = C.clamp(out[1] + (eg - out[1]) * cfg.earth, 0, 1); out[2] = C.clamp(out[2] + (eb - out[2]) * cfg.earth, 0, 1);
    }
    if (cfg.satK !== 1) { const l = 0.299 * out[0] + 0.587 * out[1] + 0.114 * out[2]; for (let c = 0; c < 3; c++) out[c] = C.clamp(l + (out[c] - l) * cfg.satK, 0, 1); }
    if (cfg.lechoso) { const l = 0.299 * out[0] + 0.587 * out[1] + 0.114 * out[2]; for (let c = 0; c < 3; c++) out[c] = C.clamp((l + (out[c] - l) * 0.85) * (1 - cfg.lechoso) + 0.97 * cfg.lechoso, 0, 1); }
    if (sink[r]) { const k = 1 - sink[r]; out[0] = out[0] * k * 0.9; out[1] = out[1] * k * 0.85; out[2] = out[2] * k * 0.95; }
    return out;
  };
  // textura repetible de pincelada por zona (cálida o fría según su color, girada con la forma)
  const tlib = ctx.assets && ctx.assets.tiles_pintura;
  const tsamp = new Array(reg.n).fill(null);
  const cch = new Float32Array(2);
  const tileFor = (r) => {
    if (!tlib || !cfg.tileAmt) return null;
    if (tsamp[r]) return tsamp[r];
    const wm = K.warmth(reg.mean[r * 3], reg.mean[r * 3 + 1], reg.mean[r * 3 + 2]);
    const tags = kind === "oleo" && reg.lum[r] > 0.55 ? ["brochazo", "pincelada"] : ["pincelada", "brochazo"];
    const it = K.pickTile(tlib, rand, tags, wm);
    const th = 0.5 * Math.atan2(reg.os[r], reg.oc[r]) - (it.ang || 0) + Math.PI / 2;
    tsamp[r] = K.tileSampler(it, K.tileScale(it, Math.max(W, H)), th, rand() * 999, rand() * 999);
    return tsamp[r];
  };
  const texture = (r, x, y, out, amt) => {
    const t = tileFor(r);
    if (!t) return 0;
    const l = t.l(x, y);
    const k = 1 + amt * 0.13 * l;
    out[0] *= k; out[1] *= k; out[2] *= k;
    if (t.prep.cr) {
      t.c(x, y, cch);
      const kc = amt * 0.6;
      out[0] += cch[0] * kc; out[2] += cch[1] * kc; out[1] -= (0.299 * cch[0] + 0.114 * cch[1]) / 0.587 * kc;
    }
    out[0] = C.clamp(out[0], 0, 1); out[1] = C.clamp(out[1], 0, 1); out[2] = C.clamp(out[2], 0, 1);
    return l;
  };
  // imprimatura: fondo de color cálido que asoma en lo fino y entre pinceladas
  const imp = new Float32Array(3);
  if (cfg.imprim) {
    let mr = 0, mg = 0, mb = 0;
    for (let r = 0; r < reg.n; r++) { mr += reg.mean[r * 3] * reg.cnt[r]; mg += reg.mean[r * 3 + 1] * reg.cnt[r]; mb += reg.mean[r * 3 + 2] * reg.cnt[r]; }
    const tot = seg.aw * seg.ah;
    imp[0] = 0.55 * 0.62 + 0.45 * mr / tot * 0.8; imp[1] = 0.55 * 0.38 + 0.45 * mg / tot * 0.7; imp[2] = 0.55 * 0.24 + 0.45 * mb / tot * 0.55;
  }

  /* ---------- 1) MANCHA ---------- */
  const gw = Math.max(4, Math.ceil(W / 48)), gh = Math.max(4, Math.ceil(H / 48));
  const nX = C.fbmGrid(gw, gh, Math.max(2, gw / 8), 3, ctx.seed + 71, 0.5);
  const nY = C.fbmGrid(gw, gh, Math.max(2, gw / 8), 3, ctx.seed + 72, 0.5);
  const wob = cfg.wobble * cfg.Rb;
  const fullCover = p.cobertura >= 0.995;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let m = fullCover ? 1 : ctx.at(ctx.cover, x, y);
      if (m < 0.003) continue;
      // bordes orgánicos: la etiqueta se consulta en un punto ligeramente desplazado
      const ox = (C.bilinear(nX, gw, gh, x / 48, y / 48) - 0.5) * 2 * wob;
      const oy = (C.bilinear(nY, gw, gh, x / 48, y / 48) - 0.5) * 2 * wob;
      const shx = cfg.shift * cfg.Rb, shy = cfg.shift * cfg.Rb * 0.6;
      const sx = C.clamp((x + ox - shx) | 0, 0, W - 1), sy = C.clamp((y + oy - shy) | 0, 0, H - 1);
      const r = Lfull[sy * W + sx];
      regionColor(r, x, y, col);
      const tl0 = texture(r, x, y, col, cfg.tileAmt);
      let a = m;
      if (cfg.gapW) {   // filo de papel entre planos (línea y plano)
        const e = ctx.at(ctx.edgeRaw, sx, sy);
        if (e > 0.32) {
          const d = ctx.at(seg.dt, sx, sy) * fa;
          a *= C.smoothstep(cfg.gapW * s * 0.4, cfg.gapW * s * 1.2, d + (C.hash2(x >> 2, y >> 2, 3) - 0.5) * cfg.gapW * s);
        }
      }
      if (cfg.imprim) {
        // la mancha cubre las luces; en las sombras y las zonas finas asoma la imprimatura
        const lum = reg.lum[r];
        const cov = 1 - cfg.imprim * (1 - C.smoothstep(0.3, 0.78, lum)) * (0.75 + 0.5 * (C.bilinear(nX, gw, gh, x / 48 + 31, y / 48) - 0.5));
        const am = a * C.clamp(cov, 0, 1);
        col[0] = imp[0] * (1 - am) + col[0] * am; col[1] = imp[1] * (1 - am) + col[1] * am; col[2] = imp[2] * (1 - am) + col[2] * am;
      }
      if (tl0) Hh[i] += cfg.tileAmt * 0.05 * tl0 * cfg.thick * (0.2 + reg.lum[r]);
      if (kind === "ceras") {
        // cera de canto: el pigmento se queda en los picos del papel
        const dark = 1 - (0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2]);
        const pr = cfg.pressure * (0.55 + 0.6 * dark);
        const gr = pap ? pap.eqN(x, y) : 0.5;
        a *= 0.5 + 0.5 * C.smoothstep(1 - pr - 0.3, 1 - pr + 0.15, gr);
      }
      Pr[i] = col[0] * a; Pg[i] = col[1] * a; Pb[i] = col[2] * a; Cv[i] = a;
      Hh[i] += cfg.mancha * a;
    }
    if ((y & 31) === 0) await clock.tick(0.12 * y / H);
  }
  // bordes perdidos: fundir la mancha donde importa poco o hay poco contraste
  if (cfg.softK > 0) {
    const rs = Math.max(1, Math.round(cfg.Rb * 0.6));
    const tmp = new Float32Array(N), bl = new Float32Array(N);
    const soft = (x, y) => {
      const im = ctx.at(seg.imp, x, y), e = ctx.at(ctx.edge, x, y);
      return C.clamp((1.15 - im * 1.5) * (1 - 0.6 * e), 0, 1) * cfg.softK;
    };
    for (const plane of [Pr, Pg, Pb, Cv]) {
      bl.set(plane);
      C.boxBlurH(bl, tmp, W, H, rs); C.boxBlurV(tmp, bl, W, H, rs);
      C.boxBlurH(bl, tmp, W, H, rs); C.boxBlurV(tmp, bl, W, H, rs);
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const k = soft(x, y);
          if (k > 0.01) plane[i] += (bl[i] - plane[i]) * k;
        }
      }
      await clock.tick(0.16);
    }
  }

  /* ---------- renderizado de una pincelada (muestra real) ---------- */
  function renderStroke(R, c, opacity, thick, sKmul, wetMul, darken) {
    const Rr = R / BODY, Rq = Rr * VK;
    const n = path.n;
    if (n < 2 || path.len < 1) return;
    for (let i = 0; i < n; i++) path.rs[i] = Rq;
    const nt = raster.rasterize(path, 0.04);
    if (nt === 0) return;
    const st = Lib.prepare(Lib.pick(lib, rand), path.len, Rr, rand, VK);
    const cr = c[0], cg = c[1], cb = c[2];
    const mixAmt = Math.min(0.9, cfg.dual * (0.4 + p.varLuz + p.varTono * 0.6) * (0.4 + 0.6 * rand()));
    C.varyColor(cr, cg, cb, (rand() - 0.5) * 0.4 * (0.3 + p.varTono), (rand() - 0.5) * 0.4, (rand() < 0.5 ? -1 : 1) * (0.05 + 0.1 * rand()), col2);
    const c2r = col2[0], c2g = col2[1], c2b = col2[2];
    const ph = rand() * 6.28, f1 = 5 + rand() * 9, f2 = 13 + rand() * 17;
    for (let q = 0; q < 64; q++) {
      const z = q / 63;
      stripes[q] = C.smoothstep(0.05, 0.7, 0.55 * Math.sin(z * f1 + ph) + 0.45 * Math.sin(z * f2 + ph * 1.7) + (rand() - 0.5) * 0.5);
    }
    const sK = cfg.sK * sKmul, wet = cfg.wet * wetMul, pdep = cfg.paperDep;
    const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
    const pres = kind === "ceras" ? cfg.pressure * (0.8 + 0.4 * rand()) : 1;
    for (let t = 0; t < nt; t++) {
      const li = tl[t], g = tg[t];
      const u = U[li];
      Lib.sampleAt(st, u, V[li], ts);
      let a = ts[0] * opacity * A[li];
      if (pdep > 0 && pap && a > 0.004) {
        const x = g % W, y = (g / W) | 0;
        a *= 1 - pdep + pdep * C.smoothstep(1 - pres - 0.2, 1 - pres + 0.2, pap.eqN(x, y));
      }
      if (a < 0.004) continue;
      // detalle de cerdas solo donde hay pintura plena: sin perfilado oscuro en el borde
      let sv = ts[1] * sK * C.smoothstep(0.45, 0.95, ts[0]);
      if (sv < 0) sv *= 0.55 * C.smoothstep(0.7, 1, ts[0]);
      const mz = stripes[((V[li] + 1) * 31.5) | 0] * mixAmt;
      let br = cr + (c2r - cr) * mz, bgc = cg + (c2g - cg) * mz, bbc = cb + (c2b - cb) * mz;
      if (darken) { br *= darken; bgc *= darken; bbc *= darken; }
      let rr, gg, bb;
      if (sv < 0) { const f = 1 + (sv < -0.9 ? -0.9 : sv); rr = br * f; gg = bgc * f; bb = bbc * f; }
      else { const f = (sv > 1 ? 0.85 : sv * 0.85) * (0.2 + 0.8 * (0.299 * br + 0.587 * bgc + 0.114 * bbc)); rr = br + (1 - br) * f; gg = bgc + (1 - bgc) * f; bb = bbc + (1 - bbc) * f; }
      const cv = Cv[g];
      if (wet > 0 && cv > 0.05) {
        const mm = wet * (0.15 + 0.85 * (u < 0 ? 0 : u > 1 ? 1 : u)) * cv, inv = 1 / cv;
        rr += (Pr[g] * inv - rr) * mm; gg += (Pg[g] * inv - gg) * mm; bb += (Pb[g] * inv - bb) * mm;
      }
      const ia = 1 - a;
      Pr[g] = Pr[g] * ia + rr * a; Pg[g] = Pg[g] * ia + gg * a; Pb[g] = Pb[g] * ia + bb * a;
      Cv[g] = cv * ia + a;
      if (thick > 0) Hh[g] = Hh[g] * (1 - a * 0.85) + a * thick * (0.45 + 0.55 * ts[0] + 0.35 * ts[1] * C.smoothstep(0.5, 0.95, ts[0]));
    }
    raster.clear();
  }

  /* ---------- semillas dentro de una mancha ---------- */
  function seedIn(r, out) {
    const a = seg.pixOff[r], b = seg.pixOff[r + 1];
    const pidx = seg.pix[a + ((rand() * (b - a)) | 0)];
    const ax = pidx % seg.aw, ay = (pidx / seg.aw) | 0;
    out[0] = Math.min(W - 1, (ax + rand()) * fa);
    out[1] = Math.min(H - 1, (ay + rand()) * fa);
    return out;
  }
  const seed = new Float32Array(2);
  const curv = 0.08 + 0.9 * p.curvatura;
  const dtOpt = { dt: seg.dt, aw: seg.aw, ah: seg.ah, axs: ctx.ax };
  /** semilla donde la pincelada de radio R cabe (hasta 6 intentos) */
  function seedFor(r, R) {
    for (let t = 0; t < 6; t++) {
      seedIn(r, seed);
      const ax = Math.min(seg.aw - 1, (seed[0] * ctx.ax) | 0), ay = Math.min(seg.ah - 1, (seed[1] * ctx.ax) | 0);
      if (seg.dt[ay * seg.aw + ax] * fa >= R * 0.75) return true;
    }
    return false;
  }
  const traceOpts = (o, R) => Object.assign(o, dtOpt, { minDist: (R * 0.6) / fa });

  // orden: de oscuro a claro (las luces, más empastadas, encima)
  const order = Array.from({ length: reg.n }, (_, i) => i).sort((a, b) => reg.lum[a] - reg.lum[b]);

  /* ---------- 2) FROTADO ---------- */
  if (cfg.scrub > 0) {
    for (let oi = 0; oi < order.length; oi++) {
      const r = order[oi];
      const area = reg.cnt[r] * fa * fa;
      const maxR = reg.maxDist[r] * fa * 0.95;
      const Rs = Math.min(cfg.Rb * 1.9, maxR);
      if (Rs < cfg.Rb * 0.8 || area < 40 * cfg.Rb * cfg.Rb) continue;
      const nS = Math.min(40, Math.max(1, Math.round(area / (Rs * 2 * Rs * 14) * cfg.scrubN)));
      for (let k = 0; k < nS; k++) {
        const Rsk = Rs * (0.7 + 0.5 * rand());
        if (!seedFor(r, Rsk)) continue;
        const ang = (rand() - 0.5) * 0.25;
        traceInRegion(ctx, Lfull, r, path, seed[0], seed[1], traceOpts({
          step: Rsk * 0.8, Lmax: Rsk * 2 * (5 + 6 * rand()), curv: 0.2, ca: Math.cos(ang), sa: Math.sin(ang), over: Rsk * 0.4, fine: false,
        }, Rsk));
        if (path.len < Rsk * 3) continue;
        regionColor(r, seed[0], seed[1], col);
        C.varyColor(col[0], col[1], col[2], (rand() - 0.5) * varH * 1.4, (rand() - 0.5) * varS * 1.4, (rand() - 0.5) * varL * 2.2, col);
        renderStroke(Rsk, col, cfg.scrub, cfg.thick * 0.12, 0.6, 1.4, 0);
      }
      if ((oi & 15) === 0) await clock.tick(0.2 + 0.1 * oi / order.length);
    }
  }

  /* ---------- 2b) MANCHAS REALES superpuestas en las zonas amplias ---------- */
  const stLib = ctx.assets && ctx.assets.manchas && ctx.assets.manchas.items;
  if (stLib && cfg.stamps > 0) {
    const big = stLib.filter((it) => /parche|relleno|remolino/.test(it.tags[0]));
    const toq = stLib.filter((it) => /toques|veta/.test(it.tags[0]));
    for (let oi = 0; oi < order.length; oi++) {
      const r = order[oi];
      const area = reg.cnt[r] * fa * fa;
      if (area < 40 * cfg.Rb * cfg.Rb) continue;
      const nS = Math.min(6, Math.floor(cfg.stamps * area / (cfg.Rb * cfg.Rb * 220) + rand() * 0.9));
      const dir = 0.5 * Math.atan2(reg.os[r], reg.oc[r]);
      for (let k = 0; k < nS; k++) {
        if (!seedFor(r, cfg.Rb)) continue;
        const pool = rand() < 0.7 && big.length ? big : toq.length ? toq : big;
        const it = pool[(rand() * pool.length) | 0];
        const size = Math.min(Math.sqrt(area) * (0.6 + 0.5 * rand()), reg.maxDist[r] * fa * 3.2);
        if (size < cfg.Rb * 2) continue;
        const ang = dir - (it.ang || 0) + (rand() - 0.5) * 0.4;
        regionColor(r, seed[0], seed[1], col);
        C.varyColor(col[0], col[1], col[2], (rand() - 0.5) * varH * cfg.varK, (rand() - 0.5) * varS * cfg.varK, (rand() - 0.5) * varL * cfg.varK, col);
        const cr = col[0], cg = col[1], cb = col[2];
        const thickR = cfg.thick * (0.15 + 0.85 * Math.pow(reg.lum[r], 1.5));
        K.drawStamp(it, seed[0], seed[1], size, ang, W, H, (i, av, sv) => {
          if (Lfull[i] !== r) return;
          const a2 = C.smoothstep(0.1, 0.7, av) * cfg.op * 0.6;
          const sk = sv * cfg.sK * 0.35 * C.smoothstep(0.5, 0.9, av);
          let rr = cr, gg = cg, bb = cb;
          if (sk < 0) { const f = 1 + Math.max(-0.35, sk * 0.5); rr *= f; gg *= f; bb *= f; } else { const f = Math.min(0.2, sk * 0.3); rr += (1 - rr) * f; gg += (1 - gg) * f; bb += (1 - bb) * f; }
          const ia = 1 - a2;
          Pr[i] = Pr[i] * ia + rr * a2; Pg[i] = Pg[i] * ia + gg * a2; Pb[i] = Pb[i] * ia + bb * a2;
          Cv[i] = Cv[i] * ia + a2;
          Hh[i] = Hh[i] * (1 - a2 * 0.8) + a2 * thickR * (0.45 + 0.4 * sv);
        });
      }
      if ((oi & 15) === 0) await clock.tick(0.3);
    }
  }

  /* ---------- 3) MODELADO ---------- */
  for (let oi = 0; oi < order.length; oi++) {
    const r = order[oi];
    const area = reg.cnt[r] * fa * fa;
    const maxR = reg.maxDist[r] * fa * 0.9;
    const imp = reg.imp[r], act = reg.act[r], lum = reg.lum[r];
    let R = cfg.Rb * (0.6 + 0.75 * (1 - imp)) * (1 - 0.3 * act);
    R = Math.min(R, Math.max(0.6, maxR));
    if (R < cfg.Rb * 0.18 || R < 0.7) continue; // mancha demasiado fina: la resuelven mancha + contorno
    const Lavg = Math.min(R * cfg.Lk, Math.sqrt(area) * 1.4);
    let count = cfg.kappa * (cfg.flat + 1.0 * act + 0.3 * imp) * (kind === "oleo" ? 0.8 + 0.4 * lum : 1) * area / (2 * R * Lavg);
    count = Math.min(count, 4000);
    let nInt = Math.floor(count) + (rand() < count - Math.floor(count) ? 1 : 0);
    const thickR = cfg.thick * (0.12 + 0.88 * Math.pow(lum, 1.6)) * (0.55 + 0.45 * imp);
    for (let k = 0; k < nInt; k++) {
      let Rk = R * (0.8 + 0.4 * rand());
      if (!seedFor(r, Rk)) { Rk *= 0.7; if (!seedFor(r, Rk)) continue; }
      const ang = (rand() - 0.5) * 0.3;
      let len = 0;
      for (let attempt = 0; attempt < 3 && len < Rk * cfg.minLenK; attempt++) {
        const a2 = attempt === 1 ? ang + Math.PI / 2 : ang;
        if (attempt === 2) Rk *= 0.7;
        len = traceInRegion(ctx, Lfull, r, path, seed[0], seed[1], traceOpts({
          step: Math.max(1, Rk * 0.75), Lmax: Lavg * (0.6 + 0.8 * rand()), curv, ca: Math.cos(a2), sa: Math.sin(a2),
          over: Rk * 0.35, fine: Rk < 5 * s,
        }, Rk));
      }
      if (len < Rk * cfg.minLenK) continue; // no cabe una pincelada entera: no se pinta
      regionColor(r, seed[0], seed[1], col);
      C.varyColor(col[0], col[1], col[2], (rand() - 0.5) * 2 * varH * cfg.varK, (rand() - 0.5) * 2 * varS * cfg.varK, (rand() - 0.5) * 2 * varL * cfg.varK, col);
      renderStroke(Rk, col, cfg.op * (0.85 + 0.15 * rand()), thickR * (0.7 + 0.6 * rand()), 1, 1, 0);
    }
    if ((oi & 7) === 0) await clock.tick(0.3 + 0.4 * oi / order.length);
  }

  /* ---------- 4) CONTORNO ---------- */
  const chains = Seg.boundaryChains(seg, 4);
  const lab = reg.lab;
  const xsT = new Float32Array(S.MAXPTS), ysT = new Float32Array(S.MAXPTS);
  for (let ci = 0; ci < chains.length; ci++) {
    const ch = chains[ci];
    const r = ch.r, q = ch.q;
    const d0 = lab[r * 3] - lab[q * 3], d1 = lab[r * 3 + 1] - lab[q * 3 + 1], d2 = lab[r * 3 + 2] - lab[q * 3 + 2];
    const contrast = Math.min(1, Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2) / 45);
    // fuerza del borde real de la foto a lo largo de la cadena (no los bordes de la segmentación)
    let edgeStr = 0;
    for (let k = 0; k < ch.n; k += 2) edgeStr += ctx.edgeRaw[Math.min(seg.ah - 1, ch.ys[k] | 0) * seg.aw + Math.min(seg.aw - 1, ch.xs[k] | 0)];
    edgeStr /= Math.max(1, Math.ceil(ch.n / 2));
    const imp = reg.imp[r];
    const pDraw = C.clamp(0.15 + contrast * 1.1 + imp * 0.3 - 0.25 * (1 - p.detalle), 0, 1);
    if (rand() > pDraw) continue;
    const maxR = reg.maxDist[r] * fa * 0.45;
    const Re = Math.max(0.6, Math.min(cfg.Rb * (0.32 + 0.25 * (1 - imp)), maxR));
    const found = contrast > 0.3 || imp > 0.65;
    // a resolución de salida, desplazada hacia dentro de r (borde encontrado) o centrada (perdido)
    const m = ch.n;
    const segLen = Re * (7 + 9 * p.longitud) * (0.7 + 0.6 * rand());
    let start = 0;
    while (start < m - 2) {
      // tramo de longitud segLen
      let n = 0, acc = 0;
      let i = start;
      for (; i < m && n < S.MAXPTS - 2; i++) {
        let x = ch.xs[i] * fa, y = ch.ys[i] * fa;
        // normal a partir de vecinos
        const a = Math.max(0, i - 2), b = Math.min(m - 1, i + 2);
        let tx = ch.xs[b] - ch.xs[a], ty = ch.ys[b] - ch.ys[a];
        const tm = Math.sqrt(tx * tx + ty * ty) || 1;
        let nx = -ty / tm, ny = tx / tm;
        const tx2 = C.clamp((x + nx * Re * 1.2) | 0, 0, W - 1), ty2 = C.clamp((y + ny * Re * 1.2) | 0, 0, H - 1);
        if (Lfull[ty2 * W + tx2] !== r) { nx = -nx; ny = -ny; }
        const off = found ? Re * 0.9 : 0;
        xsT[n] = x + nx * off; ysT[n] = y + ny * off;
        if (n) { const dx = xsT[n] - xsT[n - 1], dy = ysT[n] - ysT[n - 1]; acc += Math.sqrt(dx * dx + dy * dy); }
        n++;
        if (acc >= segLen) break;
      }
      const used = Math.max(2, i - start);
      start += used + ((rand() * 2) | 0);
      if (acc < Re * cfg.minLenK) continue;
      // remuestreo ligero para no tener puntos redundantes
      let k = 1;
      const step = Math.max(1, Re * 0.6);
      for (let j = 1, last = 0; j < n; j++) {
        const dx = xsT[j] - xsT[last], dy = ysT[j] - ysT[last];
        if (dx * dx + dy * dy >= step * step || j === n - 1) { xsT[k] = xsT[j]; ysT[k] = ysT[j]; k++; last = j; }
      }
      setPath(path, xsT, ysT, k);
      const mx = path.xs[(k / 2) | 0], my = path.ys[(k / 2) | 0];
      regionColor(r, mx, my, col);
      if (!found) { regionColor(q, mx, my, col2); col[0] = (col[0] + col2[0]) / 2; col[1] = (col[1] + col2[1]) / 2; col[2] = (col[2] + col2[2]) / 2; }
      const thickE = cfg.thick * (0.1 + 0.6 * Math.pow(reg.lum[r], 1.6));
      renderStroke(found ? Re : Re * 1.3, col, (found ? cfg.edgeOp : 0.5) * cfg.op, thickE, found ? 0.8 : 0.5, found ? 0.5 : 1.5, 0);
      if (cfg.brushLines && contrast > 0.3 && edgeStr > 0.3 && ch.n > 12 && rand() < cfg.brushLines * 0.75) {
        // dibujo a pincel: línea fina y oscura (siena, azul) que cierra la forma
        const dr = reg.lum[r] < reg.lum[q] ? r : q;
        regionColor(dr, mx, my, col2);
        const lc = [col2[0] * 0.35 + 0.1, col2[1] * 0.27 + 0.05, col2[2] * 0.3 + 0.04];
        if (kind === "gouache") { lc[0] = Math.min(1, col2[0] * 0.6 + 0.3); lc[1] = col2[1] * 0.4; lc[2] = col2[2] * 0.35; }
        renderStroke(Math.max(0.6, Re * 0.3), lc, 0.92 * cfg.op, cfg.thick * 0.08, 0.35, 0.25, 0);
      }
    }
    if ((ci & 31) === 0) await clock.tick(0.72 + 0.12 * ci / chains.length);
  }

  /* ---------- 5) ACENTOS (luces con pasta) ---------- */
  if (cfg.accent > 0) {
    const lumSorted = Array.from(reg.lum).sort((a, b) => a - b);
    const lumHi = lumSorted[Math.floor(lumSorted.length * 0.8)] || 0.8;
    for (let r = 0; r < reg.n; r++) {
      if (reg.lum[r] < lumHi || reg.imp[r] < 0.35) continue;
      const maxR = reg.maxDist[r] * fa * 0.8;
      const R = Math.min(cfg.Rb * 0.6, maxR);
      if (R < 1) continue;
      const area = reg.cnt[r] * fa * fa;
      const nA = Math.min(6, Math.max(1, Math.round(area / (R * R * 120) * cfg.accent)));
      for (let k = 0; k < nA; k++) {
        if (!seedFor(r, R)) continue;
        const len = traceInRegion(ctx, Lfull, r, path, seed[0], seed[1], traceOpts({
          step: Math.max(1, R * 0.75), Lmax: R * cfg.Lk * 0.7, curv, ca: 1, sa: 0, over: R * 0.3, fine: true,
        }, R));
        if (len < R * cfg.minLenK) continue;
        regionColor(r, seed[0], seed[1], col);
        C.varyColor(col[0], col[1], col[2], 0, 0.05, 0.07, col);
        renderStroke(R, col, cfg.op, cfg.thick * 1.35, 1.1, 0.4, 0);
      }
    }
  }
  /* ---------- 6) SALPICADURAS (retrato expresivo) ---------- */
  if (cfg.splat) {
    const nSp = Math.round(W * H / (6000 * s * s) * cfg.splat);
    for (let k = 0; k < nSp; k++) {
      let r = (rand() * reg.n) | 0;
      for (let t = 0; t < 4 && reg.imp[r] < 0.45; t++) r = (rand() * reg.n) | 0;
      seedIn(r, seed);
      const rr = (0.7 + 3.2 * Math.pow(rand(), 3)) * s;
      const light = rand() < 0.6;
      regionColor(r, seed[0], seed[1], col);
      const sc = light ? [0.96, 0.92, 0.84] : rand() < 0.5 ? [col[0] * 0.35, col[1] * 0.3, col[2] * 0.45 + 0.1] : [0.2, 0.3, 0.7];
      const x0 = Math.max(0, (seed[0] - rr - 2) | 0), x1 = Math.min(W - 1, (seed[0] + rr + 2) | 0);
      const y0 = Math.max(0, (seed[1] - rr - 2) | 0), y1 = Math.min(H - 1, (seed[1] + rr + 2) | 0);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - seed[0], (y - seed[1]) * 1.15);
        const a2 = C.smoothstep(rr + 0.7, rr - 0.7, d) * 0.92;
        if (a2 <= 0) continue;
        const i = y * W + x, ia = 1 - a2;
        Pr[i] = Pr[i] * ia + sc[0] * a2; Pg[i] = Pg[i] * ia + sc[1] * a2; Pb[i] = Pb[i] * ia + sc[2] * a2; Cv[i] = Cv[i] * ia + a2;
        Hh[i] += a2 * 0.15 * cfg.thick;
      }
    }
  }
  await clock.tick(0.95);
  const fcfg = { canvasTex: cfg.canvasTex, shade: cfg.shade, gloss: cfg.gloss, under: 0, R0: cfg.Rb, thick: cfg.thick, glossByHeight: true };
  return { Pr, Pg, Pb, Cv, Hh, cfg: fcfg, grain: null, gsInv: 1, real: true, pap };
}

module.exports = { paint, config };

};
__defs["paper.js"] = function (module, exports, require) {
/*
 * Trazo · soporte (papel o lienzo) para la capa inferior opcional.
 */
const C = require("./core.js");

const BASE = {
  lapiz:    { c: [247, 245, 240], amp: 9,  kind: "paper", scale: 1.2 },
  ceras:    { c: [246, 243, 236], amp: 13, kind: "rough", scale: 1.1 },
  acuarela: { c: [250, 248, 243], amp: 15, kind: "rough", scale: 2.0 },
  gouache:  { c: [244, 241, 234], amp: 10, kind: "paper", scale: 1.6 },
  oleo:     { c: [234, 228, 216], amp: 20, kind: "canvas", scale: 1.0 },
  rotulador:  { c: [251, 251, 249], amp: 5,  kind: "paper", scale: 1.2 },
  mixtalg:    { c: [246, 243, 236], amp: 9,  kind: "paper", scale: 1.2 },
  mixta:      { c: [232, 222, 202], amp: 11, kind: "paper", scale: 1.2 },
  xilografia: { c: [243, 237, 224], amp: 10, kind: "paper", scale: 1.4 },
};

async function makePaper(technique, W, H, seed, clock, prep) {
  const cfg = BASE[technique] || BASE.lapiz;
  if (prep) return realPaper(cfg, technique, W, H, seed, clock, prep);
  const s = Math.max(W, H) / 1000;
  const tile = C.makeGrainTile(seed + (technique === "oleo" ? 9 : technique === "acuarela" ? 21 : 3), cfg.kind);
  const inv = 1 / Math.max(1, Math.sqrt(s) * cfg.scale);
  const gw = Math.max(4, Math.ceil(W / 64)), gh = Math.max(4, Math.ceil(H / 64));
  const low = C.fbmGrid(gw, gh, Math.max(2, gw / 3), 3, seed + 77, 0.5);
  const out = new Uint8Array(W * H * 4);
  const [br, bg, bb] = cfg.c;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const t = C.tileAt(tile, x * inv, y * inv) - 0.5;
      const l = (C.bilinear(low, gw, gh, x / 64, y / 64) - 0.5) * 7;
      const d = t * cfg.amp + l;
      out[i] = C.clamp(br + d, 0, 255) | 0;
      out[i + 1] = C.clamp(bg + d, 0, 255) | 0;
      out[i + 2] = C.clamp(bb + d * 1.05, 0, 255) | 0;
      out[i + 3] = 255;
    }
    if (clock && (y & 63) === 0) await clock.tick(y / H);
  }
  return out;
}

/** Soporte a partir de la textura real (escaneada de los fondos), a escala física. */
async function realPaper(cfg, technique, W, H, seed, clock, prep) {
  const Lib = require("./library.js");
  const smp = Lib.paperSampler(prep, Lib.paperScale(Math.max(W, H)));
  const amp = technique === "oleo" ? 30 : technique === "acuarela" || technique === "gouache" ? 22 : 18;
  const gw = Math.max(4, Math.ceil(W / 64)), gh = Math.max(4, Math.ceil(H / 64));
  const low = C.fbmGrid(gw, gh, Math.max(2, gw / 3), 3, seed + 77, 0.5);
  const out = new Uint8Array(W * H * 4);
  const [br, bg, bb] = cfg.c;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = smp.raw(x, y) * amp + (C.bilinear(low, gw, gh, x / 64, y / 64) - 0.5) * 6;
      out[i] = C.clamp(br + d, 0, 255) | 0;
      out[i + 1] = C.clamp(bg + d, 0, 255) | 0;
      out[i + 2] = C.clamp(bb + d * 1.05, 0, 255) | 0;
      out[i + 3] = 255;
    }
    if (clock && (y & 63) === 0) await clock.tick(y / H);
  }
  return out;
}

module.exports = { makePaper };

};
__defs["pencil.js"] = function (module, exports, require) {
/*
 * Trazo · Lápiz (grafito o lápiz de color)
 * Rayado que sigue el campo de direcciones. Los trazos se colocan hasta que
 * la oscuridad acumulada alcanza el tono de la foto; en las sombras se
 * añaden capas cruzadas. Al final, contornos sobre los bordes fuertes.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");
const K = require("./kit.js");

async function paint(ctx, p, clock, seg, Lfull, opts) {
  opts = opts || {};
  const { W, H, N, s, aw, ah } = ctx;
  const colorMode = !!p.color;
  const mode = p.modo || "rayado";
  const onlyLines = opts.only === "contornos" || mode === "boceto";
  const noLines = opts.only === "tono";
  const rand = C.mulberry32(ctx.seed * 13 + 3);

  let libSrc = opts.lib || ctx.lib;
  if (mode === "carbon" && ctx.strokesOf) libSrc = ctx.strokesOf(["pin_cera"]) || libSrc;
  const lib = libSrc && libSrc.samples && libSrc.samples.length ? libSrc.samples : null;
  /* ----- tono objetivo (oscuridad 0..1) a resolución de análisis ----- */
  const n = aw * ah;
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = 1 - ctx.lum[i];
  const blur = Float32Array.from(tone);
  C.gaussBlur(blur, aw, ah, Math.max(2, 18 * s / ctx.fa));
  const lift = (1 - p.cobertura) * 0.32;
  for (let i = 0; i < n; i++) {
    let t = tone[i] + (tone[i] - blur[i]) * 0.7; // contraste local
    t = C.smoothstep(0.04, 0.97, t);
    t = Math.pow(t, 1.45) * (lib ? 0.8 : 0.85);
    t = Math.max(0, (t - lift) / (1 - lift));
    tone[i] = t * ctx.cover[i];
  }
  ctx.tone = tone;

  const D = new Float32Array(N); // oscuridad acumulada
  /* ----- difumino: tono base suave en las zonas lisas (piel, cielo, paredes) ----- */
  const regAng = seg ? new Float32Array(seg.reg.n) : null;
  if (seg && Lfull && !onlyLines) {
    const reg = seg.reg;
    const papS = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H))) : null;
    const smK = new Float32Array(reg.n);
    const rA = C.mulberry32(ctx.seed * 5 + 1);
    for (let r = 0; r < reg.n; r++) {
      smK[r] = Math.pow(1 - reg.act[r], 1.4) * (0.45 + 0.35 * (1 - reg.imp[r] * 0.5)) * (mode === "carbon" ? 1.6 : mode === "linea" ? 0.25 : mode === "mixta" ? 0.5 : 1);
      // negros expresivos: masas plenas de grafito/carbón en las zonas oscuras
      if (mode === "negros") smK[r] = 1 - reg.lum[r] > 0.5 ? 1.6 : smK[r] * 0.4;
      // dirección del rayado de la zona: sigue la forma si es clara; si no, diagonal de mano
      const th = 0.5 * Math.atan2(reg.os[r], reg.oc[r]);
      regAng[r] = reg.coh[r] > 0.45 ? th : -Math.PI / 4 + (rA() - 0.5) * 0.5;
    }
    // tono suavizado a resolución de análisis
    const tb = Float32Array.from(tone);
    C.gaussBlur(tb, aw, ah, Math.max(1.5, 4 * s / ctx.fa));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const k = smK[Lfull[i]];
        if (k < 0.02) continue;
        const t = ctx.at(tb, x, y);
        const g = papS ? papS.eq(x, y) : 0.5;
        const cap = mode === "negros" && k > 1.5 ? 0.93 : mode === "carbon" ? 0.75 : 0.6;
        D[i] = Math.min(cap, t * k) * (0.72 + 0.45 * (g - 0.5) + 0.28);
      }
      if ((y & 63) === 0) await clock.tick(0);
    }
  }
  let Tr = null, Tg = null, Tb = null;
  if (colorMode) { Tr = new Float32Array(N).fill(1); Tg = new Float32Array(N).fill(1); Tb = new Float32Array(N).fill(1); }

  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const grain = C.makeGrainTile(ctx.seed + 3, "fine");
  const gsInv = 1 / Math.max(1, Math.sqrt(s) * 0.8);
  const col = new Float32Array(3), tmpc = new Float32Array(3);

  // trazos reales de grafito/carbón: los más ligeros para las primeras pasadas
  const libLight = lib ? lib.filter((m) => m.fill < 0.62) : null;
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H))) : null;
  const ts = new Float32Array(2);
  const R = lib ? (2.4 + p.grosor * 13) * s : (0.35 + p.grosor * 2.4) * s;
  const L = lib ? (14 + p.longitud * 95) * s : (10 + p.longitud * 80) * s;
  const press = 0.22 + 0.62 * p.intensidad;
  // 4 pasadas de rayado: cada una oscurece hasta un tope; "cruzado" abre el ángulo entre ellas
  const nPass = 4;
  const cz = p.cruzado;
  const angles = [0, 0.1 + 0.85 * cz, -(0.08 + 0.8 * cz), 0.05 + 0.4 * cz];
  const caps = [0.38, 0.58, 0.78, 1];
  const ths = [0, 0.3, 0.5, 0.68];
  const varH = p.varTono * 0.5, varS = p.varSat * 0.6;
  const sel = ctx.sel, selDetail = ctx.selMode === "detalle";

  const totalStages = nPass + 1;

  // ángulo para que el rayado vaya en la dirección de la zona (relativo al flujo local)
  const _fl = new Float32Array(2);
  function hatchAngle(x, y, j) {
    if (!regAng) return angles[j];
    const r = Lfull[(y | 0) * W + (x | 0)];
    ctx.flowAt(x, y, _fl);
    const phi = Math.atan2(_fl[1], _fl[0]);
    return regAng[r] - phi + angles[j];
  }

  async function hatchPass(j, isContour, alt) {
    const Rj = isContour ? (lib ? Math.max(0.45, (0.32 + p.grosor * 1.4) * s) : R * 0.85) : R * (j === 0 ? 1 : 0.92);
    const useLib = lib && !isContour;
    const pool = useLib ? (j < 2 && libLight.length ? libLight : lib) : null;
    const Rc = lib ? Math.max(0.45, (0.32 + p.grosor * 1.4) * s) : R; // contornos: línea fina
    const sp = isContour ? Math.max(1, Rc * 3.2) : lib ? Math.max(1.0, R * 1.3, L * 0.16) : Math.max(1.0, R * 2.6 + 0.4 * s, L * 0.12);
    const cols = Math.ceil(W / sp), rows = Math.ceil(H / sp);
    const edgeThr = (0.42 - 0.3 * p.detalle) * (mode === "linea" || mode === "mixta" ? 0.75 : mode === "boceto" ? 0.9 : 1) * (alt ? 1.25 : 1);
    let cnt = 0, cap = 1 << 16;
    let cx = new Float32Array(cap), cy = new Float32Array(cap);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const x = (gx + rand()) * sp, y = (gy + rand()) * sp;
        if (x >= W || y >= H) continue;
        if (isContour) {
          let e = ctx.at(ctx.edgeRaw, x, y);
          if (selDetail && sel) e += ctx.at(sel, x, y) * 0.25;
          if (e < edgeThr || rand() > ctx.at(ctx.cover, x, y)) continue;
        } else {
          const t = ctx.at(tone, x, y);
          if (t <= ths[j] + 0.02) continue;
        }
        if (cnt >= cap) {
          cap *= 2;
          const nx = new Float32Array(cap); nx.set(cx); cx = nx;
          const ny = new Float32Array(cap); ny.set(cy); cy = ny;
        }
        cx[cnt] = x; cy[cnt] = y; cnt++;
      }
      if ((gy & 31) === 0) await clock.tick((j + 0.1 * gy / rows) / totalStages);
    }
    const order = new Int32Array(cnt);
    for (let i = 0; i < cnt; i++) order[i] = i;
    S.shuffle(order, cnt, rand);
    const level = ctx.levelFor(Math.max(1, R * 3));

    for (let oi = 0; oi < cnt; oi++) {
      const ci = order[oi];
      const x = cx[ci], y = cy[ci];
      const g0 = (y | 0) * W + (x | 0);
      const t = ctx.at(tone, x, y);
      let target;
      if (isContour) target = Math.min(1, t * 0.6 + 0.5);
      else target = Math.min(t, caps[j]);
      if (D[g0] >= target - 0.04) continue;

      ctx.colorAt(level, x, y, col);
      tmpc[0] = col[0]; tmpc[1] = col[1]; tmpc[2] = col[2];
      let lenMul = isContour ? 0.45 : 1;
      if (selDetail && sel) lenMul *= 1 - 0.4 * ctx.at(sel, x, y);
      S.traceStroke(ctx, path, x, y, {
        R: Rj, Lmax: L * lenMul * (0.55 + rand() * 0.9), step: Math.max(0.8, Rj * 2 + 1.5 * s),
        curv: isContour ? 0.95 : regAng ? 0.02 + 0.25 * p.curvatura : (j === 0 ? 0.05 + 0.9 * p.curvatura : 0.05 + 0.45 * p.curvatura),
        colorTol: isContour ? 0.45 : 0.55 - 0.25 * p.detalle, color: tmpc, level,
        angle: isContour ? 0 : hatchAngle(x, y, j) + (rand() - 0.5) * 0.1,
        minLen: Rj * 6, fine: isContour,
      });
      if (!isContour) S.wobblePath(path, useLib ? Rj * 0.12 : Rj * 0.6, Rj * (useLib ? 12 : 40), rand() * 6.28);
      const nP = path.n, len = path.len || 1;
      let st = null;
      if (useLib) {
        const Rr = Rj / 0.7;
        for (let i = 0; i < nP; i++) path.rs[i] = Rr * 0.9;
        st = Lib.prepare(pool[(rand() * pool.length) | 0], len, Rr, rand, 0.9);
      } else {
        for (let i = 0; i < nP; i++) {
          const u = path.ss[i] / len;
          path.rs[i] = Rj * (0.35 + 0.65 * Math.sqrt(Math.sin(Math.max(0.0001, u) * Math.PI)));
        }
      }
      const nt = raster.rasterize(path, useLib ? 0.04 : 0.4);
      if (nt === 0) continue;

      const pr = press * (isContour ? 0.75 + 0.4 * ctx.at(ctx.edgeRaw, x, y) : 0.45 + 0.4 * t) * (0.8 + rand() * 0.4);
      const lo = 1 - pr - 0.28, hi = 1 - pr + 0.12;
      let cr = 0, cg = 0, cb = 0;
      if (colorMode) {
        // lápiz de color: color de la foto, algo más saturado; los contornos más oscuros
        const y0 = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2];
        for (let c = 0; c < 3; c++) col[c] = C.clamp(y0 + (col[c] - y0) * 1.35, 0, 1);
        C.varyColor(col[0], col[1], col[2], (rand() - 0.5) * 2 * varH, (rand() - 0.5) * 2 * varS, 0, col);
        const dk = isContour ? 0.45 : 0.85;
        cr = col[0] * dk; cg = col[1] * dk; cb = col[2] * dk;
      }
      const A = raster.A, tl = raster.tl, tg = raster.tg, U = raster.U, V = raster.V;
      const prL = useLib ? pr * 0.85 : pr;
      let prC = lib && isContour ? 0.62 : 1; // contornos más ligeros sobre grafito real
      if (isContour) prC *= (mode === "linea" || mode === "mixta" ? 1.35 : mode === "negros" ? 1.5 : mode === "boceto" ? 0.8 : 1) * (alt ? 0.55 : 1) * (opts.contourMul || 1);
      for (let tt = 0; tt < nt; tt++) {
        const li = tl[tt], g = tg[tt];
        const xx = g % W, yy = (g / W) | 0;
        let a;
        if (useLib) {
          // grafito real de la muestra + el diente del papel (siempre el mismo)
          Lib.sampleAt(st, U[li], V[li], ts);
          const tooth = pap ? 0.55 + 0.45 * C.smoothstep(0.15, 0.75, pap.eqN(xx, yy)) : 1;
          a = ts[0] * A[li] * prL * tooth;
        } else {
          const gr = pap ? pap.eq(xx, yy) : C.tileAt(grain, xx * gsInv, yy * gsInv);
          const dep = 0.22 + 0.78 * C.smoothstep(lo, hi, gr);
          a = A[li] * dep * pr * prC;
        }
        if (a < 0.003) continue;
        if (colorMode) {
          const tr = 1 - a * (1 - cr), tgv = 1 - a * (1 - cg), tb = 1 - a * (1 - cb);
          Tr[g] *= tr; Tg[g] *= tgv; Tb[g] *= tb;
          D[g] = 1 - (0.299 * Tr[g] + 0.587 * Tg[g] + 0.114 * Tb[g]);
        } else {
          D[g] += a * (1 - D[g]) * 0.7;
        }
      }
      raster.clear();
      if ((oi & 31) === 0) await clock.tick((j + 0.1 + 0.9 * oi / cnt) / totalStages);
    }
  }

  // qué pasadas de rayado lleva cada variante
  const passes = onlyLines ? [] : mode === "linea" ? [2, 3] : mode === "negros" ? [0, 1] : mode === "mixta" ? [0, 1] : [0, 1, 2, 3];
  for (const j of passes) await hatchPass(j, false);
  if (mode === "carbon" && !onlyLines) {
    // difuminado con el dedo o el trapo y luces sacadas con goma
    const tmp = new Float32Array(N), bD = Float32Array.from(D);
    const rb = Math.max(1, Math.round(3 * s));
    C.boxBlurH(bD, tmp, W, H, rb); C.boxBlurV(tmp, bD, W, H, rb);
    for (let i = 0; i < N; i++) D[i] = D[i] * 0.45 + bD[i] * 0.55;
    const ovc = ctx.assets && ctx.assets.ov_carbon && ctx.assets.ov_carbon.items.length ? K.overlaySampler(ctx.assets.ov_carbon.items[0], W, H) : null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const l = ctx.at(ctx.lum, x, y);
      D[i] *= 1 - 0.75 * C.smoothstep(0.68, 0.9, l);
      if (ovc) D[i] *= 0.85 + 0.3 * (ovc(x, y) < 0.5 ? 0.5 + (0.5 - ovc(x, y)) : 0.5);
    }
  }
  if (!noLines && p.detalle > 0.02) {
    await hatchPass(nPass, true);
    // líneas de búsqueda: una segunda pasada de contorno más ligera y desplazada
    if (mode === "linea" || mode === "boceto" || mode === "mixta") await hatchPass(nPass, true, 1);
  }

  /* ----- salida ----- */
  const out = new Uint8Array(N * 4);
  const selFull = ctx.selFull, data = ctx.data, comp = ctx.comp, srcA = ctx.srcAlpha;
  const gr0 = 0.12, gg0 = 0.12, gb0 = 0.14; // grafito
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    let a, r, g, b;
    if (colorMode) {
      const tr = Tr[i], tgv = Tg[i], tb = Tb[i];
      a = Math.max(1 - tr, 1 - tgv, 1 - tb);
      if (a < 0.004) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 0; continue; }
      r = 1 - (1 - tr) / a; g = 1 - (1 - tgv) / a; b = 1 - (1 - tb) / a;
    } else {
      a = D[i];
      if (a < 0.004) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 0; continue; }
      r = gr0; g = gg0; b = gb0;
    }
    if (selFull) a *= selFull[i] / 255;
    if (srcA) a *= data[i * comp + 3] / 255;
    out[o] = C.clamp(r, 0, 1) * 255 + 0.5 | 0;
    out[o + 1] = C.clamp(g, 0, 1) * 255 + 0.5 | 0;
    out[o + 2] = C.clamp(b, 0, 1) * 255 + 0.5 | 0;
    out[o + 3] = C.clamp(a, 0, 1) * 255 + 0.5 | 0;
    if ((i & 0x3ffff) === 0) await clock.tick(nPass / totalStages);
  }
  return out;
}

module.exports = { paint };

};
__defs["rotuladores.js"] = function (module, exports, require) {
/*
 * Trazo · Rotuladores
 *
 * El rotulador no pinta manchas: pinta BANDAS de ancho fijo (la punta no cambia).
 * Cada zona se rellena con pasadas paralelas en la dirección de la mano; cada
 * pasada se multiplica sobre la anterior, así que donde se solapan aparecen las
 * vetas oscuras. Las zonas oscuras reciben una 2.ª y 3.ª pasada (a veces
 * cruzada). Mucho blanco del papel. Encima, la línea de fineliner.
 * Variantes: moda (alcohol + línea negra), vetas de alcohol, acuarelables
 * (borde con charco de tinta, agua que funde) y línea con relleno parcial.
 * Exporta las herramientas de banda y de línea para la técnica mixta.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");
const Seg = require("./segment.js");
const K = require("./kit.js");

const VK = 0.9;

function setPath(path, xs, ys, n) {
  path.n = n;
  let sl = 0; path.ss[0] = 0;
  for (let i = 0; i < n; i++) {
    path.xs[i] = xs[i]; path.ys[i] = ys[i];
    if (i) { const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1]; sl += Math.sqrt(dx * dx + dy * dy); path.ss[i] = sl; }
  }
  path.len = sl;
  return sl;
}

/**
 * Segmentos de banda que recorren la mancha r con ángulo th y separación sp (px de salida).
 * keep(ax, ay) opcional: el punto de análisis entra en esta pasada.
 * Devuelve [[x0,y0,x1,y1], ...] en px de salida.
 */
function scanBands(ctx, seg, r, th, sp, minLen, keep, rand) {
  const { aw, ah, labels } = seg;
  const fa = 1 / ctx.ax;
  const tx = Math.cos(th), ty = Math.sin(th), nx = -ty, ny = tx;
  const a = seg.pixOff[r], b = seg.pixOff[r + 1];
  let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9;
  for (let k = a; k < b; k++) {
    const pi = seg.pix[k], x = pi % aw + 0.5, y = ((pi / aw) | 0) + 0.5;
    const u = x * tx + y * ty, v = x * nx + y * ny;
    if (u < umin) umin = u; if (u > umax) umax = u; if (v < vmin) vmin = v; if (v > vmax) vmax = v;
  }
  const spa = Math.max(0.6, sp / fa), du = 0.7;
  const out = [];
  for (let v = vmin + spa * (0.3 + 0.4 * rand()); v <= vmax; v += spa) {
    let start = null, last = null;
    for (let u = umin - 1; u <= umax + 1; u += du) {
      const x = u * tx + v * nx, y = u * ty + v * ny;
      const ax = x | 0, ay = y | 0;
      const inside = ax >= 0 && ay >= 0 && ax < aw && ay < ah && labels[ay * aw + ax] === r && (!keep || keep(ax, ay));
      if (inside) { if (start === null) start = u; last = u; }
      else if (start !== null) {
        if ((last - start) * fa >= minLen) out.push(seg2(start, last, v, tx, ty, nx, ny, fa));
        start = null;
      }
    }
    if (start !== null && (last - start) * fa >= minLen) out.push(seg2(start, last, v, tx, ty, nx, ny, fa));
  }
  return out;
}
function seg2(u0, u1, v, tx, ty, nx, ny, fa) {
  return [(u0 * tx + v * nx) * fa, (u0 * ty + v * ny) * fa, (u1 * tx + v * nx) * fa, (u1 * ty + v * ny) * fa];
}

/**
 * Pinta una banda recta (con un leve temblor) usando una muestra real.
 * apply(g, a, u, v) recibe píxel, densidad, posición a lo largo (0..1) y a lo ancho (−1..1).
 */
function drawBand(ctx, raster, path, lib, rand, x0, y0, x1, y1, width, wobble, apply) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.sqrt(dx * dx + dy * dy);
  if (L < 1) return;
  const n = Math.max(2, Math.min(S.MAXPTS - 2, Math.ceil(L / Math.max(2, width * 0.8)) + 1));
  const ux = dx / L, uy = dy / L, px = -uy, py = ux;
  const ph = rand() * 6.28, fq = (1 + rand() * 2) * Math.PI / L;
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const w = Math.sin(t * L * fq + ph) * wobble;
    xs.push(x0 + dx * t + px * w); ys.push(y0 + dy * t + py * w);
  }
  setPath(path, xs, ys, n);
  const Rr = width / 2 / 0.7;
  for (let i = 0; i < path.n; i++) path.rs[i] = Rr * VK;
  const nt = raster.rasterize(path, 0.03);
  if (!nt) return;
  const st = Lib.prepare(Lib.pick(lib, rand), path.len, Rr, rand, VK);
  const ts = new Float32Array(2);
  const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
  for (let t = 0; t < nt; t++) {
    const li = tl[t];
    Lib.sampleAt(st, U[li], V[li], ts);
    const a = ts[0] * A[li];
    if (a > 0.004) apply(tg[t], a, U[li], V[li]);
  }
  raster.clear();
}

/**
 * Líneas de contorno (fineliner / pluma): cadenas de borde entre manchas con contraste,
 * cortadas en tramos con las puntas pasadas, como a mano.
 */
async function drawContours(ctx, seg, Lfull, opts, clock) {
  const { W, H } = ctx;
  const reg = seg.reg;
  const rand = C.mulberry32(ctx.seed * 23 + (opts.seed || 0));
  const fa = 1 / ctx.ax;
  const lib = opts.lib && opts.lib.length ? opts.lib : Lib.synthetic("lapiz");
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const chains = Seg.boundaryChains(seg, 4);
  const lab = reg.lab;
  const xs = [], ys = [];
  for (let ci = 0; ci < chains.length; ci++) {
    const ch = chains[ci];
    const r = ch.r, q = ch.q;
    const d0 = lab[r * 3] - lab[q * 3], d1 = lab[r * 3 + 1] - lab[q * 3 + 1], d2 = lab[r * 3 + 2] - lab[q * 3 + 2];
    const contrast = Math.min(1, Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2) / 40);
    // solo bordes con contraste y con recorrido: pocas líneas, decididas
    const want = C.clamp((contrast - opts.thr) * 2.2 + (reg.imp[r] - 0.5) * opts.impK, 0, 1) * C.smoothstep(6, 30, ch.n);
    if (rand() > want) continue;
    // suavizado fuerte de la cadena (sin escalones ni ondas de la segmentación)
    { const m = ch.n, w = 5, sx = new Float32Array(m), sy = new Float32Array(m);
      for (let k = 0; k < m; k++) { let ax2 = 0, ay2 = 0, c = 0; for (let q2 = -w; q2 <= w; q2++) { const j2 = Math.min(m - 1, Math.max(0, k + q2)); ax2 += ch.xs[j2]; ay2 += ch.ys[j2]; c++; } sx[k] = ax2 / c; sy[k] = ay2 / c; }
      ch.xs = sx; ch.ys = sy; }
    // tramos de longitud variable, con las puntas pasadas y huecos
    let i = 0;
    while (i < ch.n - 2) {
      const segLen = (opts.segLen || 60) * (0.6 + 0.9 * rand());
      xs.length = 0; ys.length = 0;
      let acc = 0, j = i;
      for (; j < ch.n && acc < segLen; j++) {
        xs.push(ch.xs[j] * fa); ys.push(ch.ys[j] * fa);
        const m = xs.length;
        if (m > 1) acc += Math.hypot(xs[m - 1] - xs[m - 2], ys[m - 1] - ys[m - 2]);
      }
      i = j + ((rand() * (opts.gap || 2)) | 0);
      if (xs.length < 2 || acc < 3) continue;
      // remuestreo y prolongación de las puntas
      const step = Math.max(1.5, opts.width * 1.5);
      const rx = [xs[0]], ry = [ys[0]];
      for (let k = 1; k < xs.length; k++) {
        const ddx = xs[k] - rx[rx.length - 1], ddy = ys[k] - ry[ry.length - 1];
        if (ddx * ddx + ddy * ddy >= step * step || k === xs.length - 1) { rx.push(xs[k]); ry.push(ys[k]); }
      }
      if (rx.length < 2) continue;
      const over = (opts.overshoot || 0) * acc;
      if (over > 0) {
        const m = rx.length;
        let ex = rx[m - 1] - rx[m - 2], ey = ry[m - 1] - ry[m - 2], el = Math.hypot(ex, ey) || 1;
        rx.push(rx[m - 1] + ex / el * over * rand()); ry.push(ry[m - 1] + ey / el * over * rand());
        let bx = rx[0] - rx[1], by = ry[0] - ry[1], bl2 = Math.hypot(bx, by) || 1;
        rx.unshift(rx[0] + bx / bl2 * over * rand()); ry.unshift(ry[0] + by / bl2 * over * rand());
      }
      const n = Math.min(rx.length, S.MAXPTS - 2);
      setPath(path, rx, ry, n);
      const wv = opts.width * (0.75 + 0.5 * rand()) * (0.7 + 0.6 * contrast);
      const Rr = wv / 2 / 0.7;
      for (let k = 0; k < n; k++) path.rs[k] = Rr * VK;
      const nt = raster.rasterize(path, 0.03);
      if (!nt) continue;
      const st = Lib.prepare(Lib.pick(lib, rand), path.len, Rr, rand, VK);
      const ts = new Float32Array(2);
      const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
      const mx = rx[(n / 2) | 0], my = ry[(n / 2) | 0];
      for (let t = 0; t < nt; t++) {
        const li = tl[t];
        Lib.sampleAt(st, U[li], V[li], ts);
        const a = ts[0] * A[li] * opts.opacity;
        if (a > 0.004) opts.apply(tg[t], a, r, q, mx, my);
      }
      raster.clear();
    }
    if (clock && (ci & 31) === 0) await clock.tick(ci / chains.length);
  }
}

/** Color de rotulador: más puro y luminoso que la foto (tintas de alcohol). */
function markerColor(r, g, b, satK, out) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  out[0] = C.clamp(y + (r - y) * satK, 0, 1); out[1] = C.clamp(y + (g - y) * satK, 0, 1); out[2] = C.clamp(y + (b - y) * satK, 0, 1);
  return out;
}

async function paint(ctx, p, seg, Lfull, clock) {
  const { W, H, N, s } = ctx;
  const reg = seg.reg;
  const mode = p.modo;
  const rand = C.mulberry32(ctx.seed * 29 + 3);
  const mk = (ctx.strokesOf(["pin_rotulador"]) || { samples: Lib.synthetic("rotulador") }).samples;
  const ln = (ctx.strokesOf(["pin_linea"]) || { samples: Lib.synthetic("lapiz") }).samples;
  const pc = (ctx.strokesOf(["pin_lapiz"]) || { samples: Lib.synthetic("lapiz") }).samples;
  const Tr = new Float32Array(N).fill(1), Tg = new Float32Array(N).fill(1), Tb = new Float32Array(N).fill(1);
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const col = new Float32Array(3), lay = new Float32Array(3);

  const Wn = Math.max(2, (3 + 13 * p.grosor) * s * (mode === "acuarelable" ? 1.15 : mode === "linea" ? 0.8 : 1));
  const spacing = mode === "vetas" ? 0.92 : mode === "acuarelable" ? 0.78 : 0.85;
  const handAng = mode === "vetas" ? -Math.PI / 2 + 0.12 : -Math.PI / 3;
  const op = 0.55 + 0.4 * p.intensidad;
  const sat = 1.25 + 0.5 * p.varSat;

  // qué zonas se rellenan
  const fillP = { moda: 0.15 + 0.7 * p.cobertura, vetas: 0.3 + 0.7 * p.cobertura, acuarelable: 0.2 + 0.7 * p.cobertura, linea: 0.05 + 0.55 * p.cobertura }[mode];
  const order = Array.from({ length: reg.n }, (_, i) => i).sort((a, b) => reg.lum[b] - reg.lum[a]); // de claro a oscuro
  const ax = ctx.ax;
  for (let oi = 0; oi < order.length; oi++) {
    const r = order[oi];
    const lum = reg.lum[r], dark = 1 - lum;
    if (lum > 0.86 - 0.08 * p.cobertura) continue;                       // blanco del papel
    const want = fillP * (0.55 + 0.6 * reg.imp[r]) * (0.6 + 0.6 * dark);
    if (rand() > want) continue;
    markerColor(reg.mean[r * 3], reg.mean[r * 3 + 1], reg.mean[r * 3 + 2], sat, col);
    C.varyColor(col[0], col[1], col[2], (rand() - 0.5) * p.varTono * 0.5, 0, 0, col);
    if (mode === "moda" && lum < 0.2) { col[0] = col[1] = col[2] = 0.06; }  // negros de rotulador
    // dirección: la de la forma si es clara; si no, la de la mano
    let th = reg.coh[r] > 0.5 ? 0.5 * Math.atan2(reg.os[r], reg.oc[r]) : handAng;
    th += (rand() - 0.5) * 0.15;
    const layers = 1 + (dark > 0.42 ? 1 : 0) + (dark > 0.68 ? 1 : 0);
    // primera pasada: color claro; las siguientes oscurecen (misma tinta)
    const k1 = 0.5 + 0.12 * (1 - p.intensidad);
    for (let L = 0; L < layers; L++) {
      const thL = th + (L > 0 ? (L % 2 ? 1 : -1) * p.cruzado * 0.9 : 0);
      const thr = L === 0 ? 2 : [0, 0.5, 0.32][L];
      const keep = L === 0 ? null : (gx, gy) => ctx.lum[gy * seg.aw + gx] < thr + 0.1 * (rand() - 0.5);
      const bands = scanBands(ctx, seg, r, thL, Wn * spacing, Wn * 1.2, keep, rand);
      for (let c = 0; c < 3; c++) lay[c] = 1 - (1 - col[c]) * (L === 0 ? 1 - k1 : 0.7);
      for (const bd of bands) {
        // las pasadas se pasan un poco del borde o se quedan cortas, como a mano
        const ex = bd[2] - bd[0], ey = bd[3] - bd[1], el = Math.hypot(ex, ey) || 1;
        const o0 = (rand() - 0.6) * Wn * 0.6, o1 = (rand() - 0.6) * Wn * 0.6;
        const x0 = bd[0] - ex / el * o0, y0 = bd[1] - ey / el * o0, x1 = bd[2] + ex / el * o1, y1 = bd[3] + ey / el * o1;
        const lr = lay[0], lg = lay[1], lb = lay[2];
        drawBand(ctx, raster, path, mk, rand, x0, y0, x1, y1, Wn, Wn * 0.08, (g, a, u, v) => {
          let aa = a * op;
          if (u < 0.03 || u > 0.97) aa = Math.min(1, aa * 1.25);                // charco al apoyar y levantar
          if (mode === "acuarelable") { const av = v < 0 ? -v : v; aa *= 0.75 + 0.55 * C.smoothstep(0.55, 1, av); }
          Tr[g] *= 1 - aa * (1 - lr); Tg[g] *= 1 - aa * (1 - lg); Tb[g] *= 1 - aa * (1 - lb);
        });
      }
    }
    if ((oi & 7) === 0) await clock.tick(0.65 * oi / order.length);
  }

  // acuarelables: el agua funde parte de cada zona (desenfoque dentro de la mancha)
  if (mode === "acuarelable") {
    const tmp = new Float32Array(N);
    const rb = Math.max(1, Math.round(Wn * 0.5));
    const wet = new Float32Array(reg.n);
    for (let r = 0; r < reg.n; r++) wet[r] = rand() < 0.55 ? 0.35 + 0.5 * rand() : 0;
    for (const T of [Tr, Tg, Tb]) {
      const b = Float32Array.from(T);
      C.boxBlurH(b, tmp, W, H, rb); C.boxBlurV(tmp, b, W, H, rb);
      C.boxBlurH(b, tmp, W, H, rb); C.boxBlurV(tmp, b, W, H, rb);
      for (let i = 0; i < N; i++) { const w = wet[Lfull[i]]; if (w > 0) T[i] += (b[i] - T[i]) * w; }
    }
  }
  await clock.tick(0.7);

  // lápiz de color en las sombras (línea y relleno)
  if (mode === "linea") {
    for (let r = 0; r < reg.n; r++) {
      const dark = 1 - reg.lum[r];
      if (dark < 0.45 || reg.imp[r] < 0.45 || rand() > 0.6) continue;
      markerColor(reg.mean[r * 3], reg.mean[r * 3 + 1], reg.mean[r * 3 + 2], 1.4, col);
      const bands = scanBands(ctx, seg, r, -Math.PI / 4 + (rand() - 0.5) * 0.3, Wn * 0.55, Wn * 1.5, (gx, gy) => ctx.lum[gy * seg.aw + gx] < 0.55, rand);
      for (const bd of bands) {
        drawBand(ctx, raster, path, pc, rand, bd[0], bd[1], bd[2], bd[3], Math.max(1.2, Wn * 0.28), Wn * 0.05, (g, a) => {
          const aa = a * 0.6 * (0.5 + 0.5 * dark);
          Tr[g] *= 1 - aa * (1 - col[0] * 0.8); Tg[g] *= 1 - aa * (1 - col[1] * 0.8); Tb[g] *= 1 - aa * (1 - col[2] * 0.8);
        });
      }
    }
  }

  // línea: negra de fineliner (moda), de color (línea y relleno) o suave (vetas, acuarelables)
  const lineCol = new Float32Array(3);
  const lw = Math.max(0.9, (0.7 + 2.2 * p.grosor) * s * (mode === "moda" ? 1 : 0.8));
  await drawContours(ctx, seg, Lfull, {
    lib: ln, width: lw, opacity: mode === "acuarelable" ? 0.6 : 0.9,
    thr: (mode === "moda" ? 0.3 : mode === "linea" ? 0.22 : 0.5) - 0.15 * p.detalle, impK: 0.8,
    segLen: (40 + 140 * p.longitud) * s, gap: 3, overshoot: mode === "moda" ? 0.25 : 0.12,
    apply: (g, a, r) => {
      if (mode === "moda") { lineCol[0] = 0.05; lineCol[1] = 0.05; lineCol[2] = 0.06; }
      else { markerColor(reg.mean[r * 3], reg.mean[r * 3 + 1], reg.mean[r * 3 + 2], 1.5, lineCol); lineCol[0] *= 0.45; lineCol[1] *= 0.45; lineCol[2] *= 0.45; }
      Tr[g] *= 1 - a * (1 - lineCol[0]); Tg[g] *= 1 - a * (1 - lineCol[1]); Tb[g] *= 1 - a * (1 - lineCol[2]);
    },
  }, { tick: async (f) => clock.tick(0.72 + 0.25 * f) });

  const out = K.transToRGBA(Tr, Tg, Tb);
  if (ctx.selFull) for (let i = 0; i < N; i++) out[i * 4 + 3] = out[i * 4 + 3] * ctx.selFull[i] / 255;
  return out;
}

module.exports = { paint, scanBands, drawBand, drawContours, markerColor, setPath };

};
__defs["segment.js"] = function (module, exports, require) {
/*
 * Trazo · segmentación en manchas
 *
 * Un pintor no copia píxeles: ve zonas de color ("manchas") con su degradado.
 * 1) Superpíxeles SLIC sobre una versión suavizada (Kuwahara) en Lab.
 * 2) Fusión jerárquica: se unen zonas vecinas mientras su color siga siendo
 *    coherente con UN degradado lineal (ajuste por mínimos cuadrados con
 *    estadísticos acumulados). En zonas poco importantes se simplifica más.
 * 3) Estadísticas por mancha: modelo de color (degradado RGB), luz, actividad
 *    (textura), orientación dominante, importancia y grosor máximo.
 * 4) Etiquetas a resolución completa ajustadas al borde real de la foto.
 * 5) Contornos: cadenas de borde entre pares de manchas.
 */
const C = require("./core.js");

/* ---------- color ---------- */
function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function labF(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
function rgbToLab(r, g, b, out) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = labF(X), fy = labF(Y), fz = labF(Z);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
  return out;
}

/* ---------- montículo binario para la fusión ---------- */
class Heap {
  constructor() { this.k = []; this.a = []; this.b = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, a, b, ver) {
    const K = this.k, A = this.a, B = this.b, V = this.v;
    let i = K.length; K.push(key); A.push(a); B.push(b); V.push(ver);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= K[i]) break;
      [K[p], K[i]] = [K[i], K[p]]; [A[p], A[i]] = [A[i], A[p]]; [B[p], B[i]] = [B[i], B[p]]; [V[p], V[i]] = [V[i], V[p]];
      i = p;
    }
  }
  pop(out) {
    const K = this.k, A = this.a, B = this.b, V = this.v;
    out[0] = K[0]; out[1] = A[0]; out[2] = B[0]; out[3] = V[0];
    const lk = K.pop(), la = A.pop(), lb = B.pop(), lv = V.pop();
    if (K.length) {
      K[0] = lk; A[0] = la; B[0] = lb; V[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < K.length && K[l] < K[m]) m = l;
        if (r < K.length && K[r] < K[m]) m = r;
        if (m === i) break;
        [K[m], K[i]] = [K[i], K[m]]; [A[m], A[i]] = [A[i], A[m]]; [B[m], B[i]] = [B[i], B[m]]; [V[m], V[i]] = [V[i], V[m]];
        i = m;
      }
    }
    return out;
  }
}

// estadísticos por nodo (Float64): n, Sx, Sy, Sxx, Sxy, Syy, luego por canal (L,a,b,R,G,B): S, Sx, Sy, Scc
const NS = 6 + 6 * 4;
const CH = 6;

function fitSSE(st, o, ch, beta) {
  // resuelve el modelo lineal c = b0 + b1 x + b2 y para el canal ch; devuelve SSE
  const n = st[o], Sx = st[o + 1], Sy = st[o + 2], Sxx = st[o + 3], Sxy = st[o + 4], Syy = st[o + 5];
  const lam = 1e-4 * n + 1e-9;
  const m00 = n, m01 = Sx, m02 = Sy, m11 = Sxx + lam, m12 = Sxy, m22 = Syy + lam;
  const c0 = m11 * m22 - m12 * m12, c1 = m02 * m12 - m01 * m22, c2 = m01 * m12 - m02 * m11;
  const det = m00 * c0 + m01 * c1 + m02 * c2;
  const q = o + 6 + ch * 4;
  const b0v = st[q], b1v = st[q + 1], b2v = st[q + 2], scc = st[q + 3];
  if (Math.abs(det) < 1e-18) {
    const mean = b0v / n;
    if (beta) { beta[0] = mean; beta[1] = 0; beta[2] = 0; }
    return Math.max(0, scc - mean * b0v);
  }
  const i00 = c0 / det, i01 = c1 / det, i02 = c2 / det;
  const i11 = (m00 * m22 - m02 * m02) / det, i12 = (m02 * m01 - m00 * m12) / det, i22 = (m00 * m11 - m01 * m01) / det;
  const B0 = i00 * b0v + i01 * b1v + i02 * b2v;
  const B1 = i01 * b0v + i11 * b1v + i12 * b2v;
  const B2 = i02 * b0v + i12 * b1v + i22 * b2v;
  if (beta) { beta[0] = B0; beta[1] = B1; beta[2] = B2; }
  return Math.max(0, scc - (B0 * b0v + B1 * b1v + B2 * b2v));
}

/**
 * @param ctx Context (planos de análisis listos y campo de direcciones)
 * @param o {detail 0..1, simplify 0..1}
 */
async function segment(ctx, o, clock) {
  const { aw, ah } = ctx;
  const n = aw * ah;
  const detail = o.detail;

  /* --- 1) imagen suavizada y Lab --- */
  const Water = require("./watercolor.js");
  let [sr, sg, sb] = Water.kuwahara(ctx.ar, ctx.ag, ctx.ab, aw, ah, Math.max(1, Math.round(aw / 700)));
  const La = new Float32Array(n), Aa = new Float32Array(n), Ba = new Float32Array(n);
  const lab = new Float32Array(3);
  for (let i = 0; i < n; i++) {
    rgbToLab(sr[i], sg[i], sb[i], lab);
    La[i] = lab[0]; Aa[i] = lab[1]; Ba[i] = lab[2];
  }
  await clock.tick(0.05);

  /* --- importancia (centro, contraste local, selección) --- */
  const imp = new Float32Array(n);
  {
    const ed = Float32Array.from(ctx.edgeRaw);
    C.gaussBlur(ed, aw, ah, Math.max(2, 0.03 * Math.min(aw, ah)));
    const e95 = C.percentile(ed, 0.95) || 1;
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      const i = y * aw + x;
      const dx = (x / aw - 0.5) / 0.42, dy = (y / ah - 0.47) / 0.48;
      const center = Math.exp(-(dx * dx + dy * dy));
      let v = 0.45 * center + 0.55 * Math.min(1, ed[i] / e95);
      if (ctx.sel && ctx.selMode === "detalle") v = Math.max(v, ctx.sel[i]);
      imp[i] = v;
    }
  }

  /* --- 2) SLIC --- */
  const S = Math.max(3, Math.round((14 - 9.5 * detail) * Math.max(0.45, aw / 1000)));
  const gx = Math.max(1, Math.round(aw / S)), gy = Math.max(1, Math.round(ah / S));
  const K = gx * gy;
  const cL = new Float32Array(K), cA = new Float32Array(K), cB = new Float32Array(K), cX = new Float32Array(K), cY = new Float32Array(K);
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const k = j * gx + i;
    let x = Math.min(aw - 1, Math.round((i + 0.5) * aw / gx)), y = Math.min(ah - 1, Math.round((j + 0.5) * ah / gy));
    const p = y * aw + x;
    cL[k] = La[p]; cA[k] = Aa[p]; cB[k] = Ba[p]; cX[k] = x; cY[k] = y;
  }
  const lbl = new Int32Array(n).fill(-1);
  const dist = new Float32Array(n);
  const m = 11; // compacidad
  const wS = (m * m) / (S * S);
  const sumL = new Float64Array(K), sumA = new Float64Array(K), sumB = new Float64Array(K), sumX = new Float64Array(K), sumY = new Float64Array(K), cnt = new Float64Array(K);
  for (let it = 0; it < 6; it++) {
    dist.fill(1e30);
    for (let k = 0; k < K; k++) {
      const x0 = Math.max(0, Math.floor(cX[k] - S)), x1 = Math.min(aw - 1, Math.ceil(cX[k] + S));
      const y0 = Math.max(0, Math.floor(cY[k] - S)), y1 = Math.min(ah - 1, Math.ceil(cY[k] + S));
      const l = cL[k], a = cA[k], b = cB[k], kx = cX[k], ky = cY[k];
      for (let y = y0; y <= y1; y++) {
        const row = y * aw, dy = y - ky;
        for (let x = x0; x <= x1; x++) {
          const p = row + x;
          const d1 = La[p] - l, d2 = Aa[p] - a, d3 = Ba[p] - b, dx = x - kx;
          const D = d1 * d1 + d2 * d2 + d3 * d3 + (dx * dx + dy * dy) * wS;
          if (D < dist[p]) { dist[p] = D; lbl[p] = k; }
        }
      }
    }
    sumL.fill(0); sumA.fill(0); sumB.fill(0); sumX.fill(0); sumY.fill(0); cnt.fill(0);
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      const p = y * aw + x, k = lbl[p];
      if (k < 0) continue;
      sumL[k] += La[p]; sumA[k] += Aa[p]; sumB[k] += Ba[p]; sumX[k] += x; sumY[k] += y; cnt[k]++;
    }
    for (let k = 0; k < K; k++) if (cnt[k] > 0) {
      cL[k] = sumL[k] / cnt[k]; cA[k] = sumA[k] / cnt[k]; cB[k] = sumB[k] / cnt[k]; cX[k] = sumX[k] / cnt[k]; cY[k] = sumY[k] / cnt[k];
    }
    await clock.tick(0.05 + 0.25 * (it + 1) / 6);
  }
  for (let p = 0; p < n; p++) if (lbl[p] < 0) lbl[p] = p > 0 ? lbl[p - 1] : 0;
  // conectividad: componentes conexas como superpíxeles independientes
  const comp = new Int32Array(n).fill(-1);
  let nc = 0;
  const stack = new Int32Array(n);
  for (let p0 = 0; p0 < n; p0++) {
    if (comp[p0] >= 0) continue;
    const k = lbl[p0];
    let sp = 0; stack[sp++] = p0; comp[p0] = nc;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % aw, y = (p / aw) | 0;
      if (x > 0 && comp[p - 1] < 0 && lbl[p - 1] === k) { comp[p - 1] = nc; stack[sp++] = p - 1; }
      if (x < aw - 1 && comp[p + 1] < 0 && lbl[p + 1] === k) { comp[p + 1] = nc; stack[sp++] = p + 1; }
      if (y > 0 && comp[p - aw] < 0 && lbl[p - aw] === k) { comp[p - aw] = nc; stack[sp++] = p - aw; }
      if (y < ah - 1 && comp[p + aw] < 0 && lbl[p + aw] === k) { comp[p + aw] = nc; stack[sp++] = p + aw; }
    }
    nc++;
  }
  await clock.tick(0.35);

  /* --- 3) estadísticos por superpíxel --- */
  const st = new Float64Array(nc * NS);
  const impSum = new Float64Array(nc);
  for (let y = 0; y < ah; y++) {
    const yn = (y + 0.5) / ah;
    for (let x = 0; x < aw; x++) {
      const p = y * aw + x, k = comp[p], o = k * NS;
      const xn = (x + 0.5) / aw;
      st[o] += 1; st[o + 1] += xn; st[o + 2] += yn; st[o + 3] += xn * xn; st[o + 4] += xn * yn; st[o + 5] += yn * yn;
      const vals = [La[p], Aa[p], Ba[p], ctx.ar[p], ctx.ag[p], ctx.ab[p]];
      for (let c = 0; c < CH; c++) {
        const q = o + 6 + c * 4, v = vals[c];
        st[q] += v; st[q + 1] += v * xn; st[q + 2] += v * yn; st[q + 3] += v * v;
      }
      impSum[k] += imp[p];
    }
  }
  // vecinos
  const adj = new Array(nc);
  for (let k = 0; k < nc; k++) adj[k] = new Set();
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const p = y * aw + x, k = comp[p];
    if (x < aw - 1) { const q = comp[p + 1]; if (q !== k) { adj[k].add(q); adj[q].add(k); } }
    if (y < ah - 1) { const q = comp[p + aw]; if (q !== k) { adj[k].add(q); adj[q].add(k); } }
  }
  await clock.tick(0.45);

  /* --- 4) fusión jerárquica --- */
  const parent = new Int32Array(nc);
  for (let k = 0; k < nc; k++) parent[k] = k;
  const ver = new Int32Array(nc);
  const alive = new Uint8Array(nc).fill(1);
  const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const meanLab = (k, out) => { const o = k * NS, nn = st[o]; out[0] = st[o + 6] / nn; out[1] = st[o + 10] / nn; out[2] = st[o + 14] / nn; return out; };
  const mA = new Float64Array(3), mB = new Float64Array(3);
  const dE = (a, b) => { meanLab(a, mA); meanLab(b, mB); const d0 = mA[0] - mB[0], d1 = mA[1] - mB[1], d2 = mA[2] - mB[2]; return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2); };
  const heap = new Heap();
  for (let k = 0; k < nc; k++) for (const q of adj[k]) if (q > k) heap.push(dE(k, q), k, q, 0);
  // reevaluación perezosa: cada entrada guarda ver[a]+ver[b]; si cambió, se recalcula al salir
  const totalPx = n;
  const minArea = Math.max(4, S * S * 0.5);
  const dEmax = 7 + 20 * (1 - detail);
  const resMax = 2.6 + 6 * (1 - detail);
  const tmpSt = new Float64Array(NS);
  const out4 = [0, 0, 0, 0];
  let merges = 0;
  const mergeInto = (a, b) => { // b → a
    const oa = a * NS, ob = b * NS;
    for (let t = 0; t < NS; t++) st[oa + t] += st[ob + t];
    impSum[a] += impSum[b];
    parent[b] = a; alive[b] = 0;
    ver[a]++;
    for (const q of adj[b]) {
      if (q === a) continue;
      adj[q].delete(b); adj[q].add(a); adj[a].add(q);
      // la vecina heredada entra en la cola con la mancha unida
      heap.push(dE(a, q), a < q ? a : q, a < q ? q : a, ver[a] + ver[q]);
    }
    adj[a].delete(b); adj[b] = null;
    merges++;
  };
  let guard = 0;
  while (heap.size > 0) {
    heap.pop(out4);
    const a = out4[1], b = out4[2];
    if (!alive[a] || !alive[b]) continue;
    if (out4[3] !== ver[a] + ver[b]) {
      if (adj[a] && adj[a].has(b)) heap.push(dE(a, b), a, b, ver[a] + ver[b]);
      continue;
    }
    const d = out4[0];
    const oa = a * NS, ob = b * NS;
    const na = st[oa], nb = st[ob];
    const small = na < minArea || nb < minArea;
    const impR = (impSum[a] + impSum[b]) / (na + nb);
    const thr = dEmax * (1 + 1.2 * (1 - impR) * (o.simplify === undefined ? 1 : o.simplify));
    if (d > thr && !small) continue;
    // residuo del degradado lineal de la mancha unida (Lab)
    for (let t = 0; t < NS; t++) tmpSt[t] = st[oa + t] + st[ob + t];
    const nn = tmpSt[0];
    const sse = fitSSE(tmpSt, 0, 0, null) + fitSSE(tmpSt, 0, 1, null) + fitSSE(tmpSt, 0, 2, null);
    const res = Math.sqrt(sse / nn);
    if (!small && res > resMax * (1 + 0.6 * (1 - impR))) continue;
    if (na >= nb) mergeInto(a, b); else mergeInto(b, a);
    if ((++guard & 1023) === 0) await clock.tick(0.45 + 0.3 * Math.min(1, merges / nc));
  }
  // restos diminutos → al vecino más parecido
  for (let k = 0; k < nc; k++) {
    if (!alive[k] || st[k * NS] >= minArea * 0.6 || !adj[k] || adj[k].size === 0) continue;
    let best = -1, bd = 1e9;
    for (const q of adj[k]) { const d = dE(k, q); if (d < bd) { bd = d; best = q; } }
    if (best >= 0) mergeInto(best, k);
  }

  /* --- 5) etiquetas finales y estadísticas --- */
  const remap = new Int32Array(nc).fill(-1);
  let R = 0;
  for (let k = 0; k < nc; k++) if (alive[k]) remap[k] = R++;
  const labels = new Int32Array(n);
  for (let p = 0; p < n; p++) labels[p] = remap[find(comp[p])];
  const reg = {
    n: R,
    cnt: new Float32Array(R), lum: new Float32Array(R), imp: new Float32Array(R),
    beta: new Float32Array(R * 9), // RGB: b0,b1,b2 por canal (coordenadas normalizadas 0..1)
    mean: new Float32Array(R * 3), lab: new Float32Array(R * 3),
    act: new Float32Array(R), oc: new Float32Array(R), os: new Float32Array(R), coh: new Float32Array(R),
    cx: new Float32Array(R), cy: new Float32Array(R), maxDist: new Float32Array(R),
    x0: new Int32Array(R).fill(1e9), y0: new Int32Array(R).fill(1e9), x1: new Int32Array(R).fill(-1), y1: new Int32Array(R).fill(-1),
  };
  const beta = [0, 0, 0];
  for (let k = 0; k < nc; k++) {
    if (!alive[k]) continue;
    const r = remap[k], o = k * NS, nn = st[o];
    reg.cnt[r] = nn;
    reg.imp[r] = impSum[k] / nn;
    reg.cx[r] = st[o + 1] / nn; reg.cy[r] = st[o + 2] / nn;
    for (let c = 0; c < 3; c++) {
      reg.lab[r * 3 + c] = st[o + 6 + c * 4] / nn;
      const mean = st[o + 6 + (3 + c) * 4] / nn;
      reg.mean[r * 3 + c] = mean;
      if (nn > 40) {
        fitSSE(st, o, 3 + c, beta);
        // limitar el degradado para que no se dispare fuera de la mancha
        reg.beta[r * 9 + c * 3] = beta[0]; reg.beta[r * 9 + c * 3 + 1] = beta[1]; reg.beta[r * 9 + c * 3 + 2] = beta[2];
      } else {
        reg.beta[r * 9 + c * 3] = mean;
      }
    }
    const mr = reg.mean[r * 3], mg = reg.mean[r * 3 + 1], mb = reg.mean[r * 3 + 2];
    reg.lum[r] = 0.299 * mr + 0.587 * mg + 0.114 * mb;
  }
  // actividad, orientación y caja por mancha
  const sAct = new Float64Array(R), sC = new Float64Array(R), sS = new Float64Array(R), sCoh = new Float64Array(R);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const p = y * aw + x, r = labels[p];
    sAct[r] += ctx.edgeRaw[p];
    const w = ctx.coh[p];
    sC[r] += ctx.c2[p] * w; sS[r] += ctx.s2[p] * w; sCoh[r] += w;
    if (x < reg.x0[r]) reg.x0[r] = x; if (x > reg.x1[r]) reg.x1[r] = x;
    if (y < reg.y0[r]) reg.y0[r] = y; if (y > reg.y1[r]) reg.y1[r] = y;
  }
  for (let r = 0; r < R; r++) {
    reg.act[r] = sAct[r] / reg.cnt[r];
    const mag = Math.sqrt(sC[r] * sC[r] + sS[r] * sS[r]);
    reg.oc[r] = mag > 0 ? sC[r] / mag : 1; reg.os[r] = mag > 0 ? sS[r] / mag : 0;
    reg.coh[r] = sCoh[r] > 0 ? mag / sCoh[r] : 0;
    // limitar el degradado: variación máxima ±0.25 dentro de la caja
    const bw = (reg.x1[r] - reg.x0[r] + 1) / aw, bh = (reg.y1[r] - reg.y0[r] + 1) / ah;
    for (let c = 0; c < 3; c++) {
      const q = r * 9 + c * 3;
      let b1 = reg.beta[q + 1], b2 = reg.beta[q + 2];
      const span = Math.abs(b1 * bw) + Math.abs(b2 * bh);
      if (span > 0.35) { const k = 0.35 / span; b1 *= k; b2 *= k; }
      // recentrar para que la media se conserve
      reg.beta[q] = reg.mean[r * 3 + c] - b1 * reg.cx[r] - b2 * reg.cy[r];
      reg.beta[q + 1] = b1; reg.beta[q + 2] = b2;
    }
  }
  const a95 = C.percentile(reg.act, 0.9) || 1;
  for (let r = 0; r < R; r++) reg.act[r] = Math.min(1, reg.act[r] / a95);

  /* --- 6) distancia al borde (chamfer 3-4), en px de análisis --- */
  const dt = new Float32Array(n);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const p = y * aw + x, l = labels[p];
    const edge = (x > 0 && labels[p - 1] !== l) || (x < aw - 1 && labels[p + 1] !== l) || (y > 0 && labels[p - aw] !== l) || (y < ah - 1 && labels[p + aw] !== l);
    dt[p] = edge ? 0 : 1e9;
  }
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const p = y * aw + x;
    let d = dt[p];
    if (x > 0) d = Math.min(d, dt[p - 1] + 1);
    if (y > 0) { d = Math.min(d, dt[p - aw] + 1); if (x > 0) d = Math.min(d, dt[p - aw - 1] + 1.414); if (x < aw - 1) d = Math.min(d, dt[p - aw + 1] + 1.414); }
    dt[p] = d;
  }
  for (let y = ah - 1; y >= 0; y--) for (let x = aw - 1; x >= 0; x--) {
    const p = y * aw + x;
    let d = dt[p];
    if (x < aw - 1) d = Math.min(d, dt[p + 1] + 1);
    if (y < ah - 1) { d = Math.min(d, dt[p + aw] + 1); if (x < aw - 1) d = Math.min(d, dt[p + aw + 1] + 1.414); if (x > 0) d = Math.min(d, dt[p + aw - 1] + 1.414); }
    dt[p] = d;
  }
  for (let p = 0; p < n; p++) { const r = labels[p]; if (dt[p] > reg.maxDist[r]) reg.maxDist[r] = dt[p]; }

  // lista de píxeles por mancha (para sembrar trazos)
  const off = new Int32Array(R + 1);
  for (let p = 0; p < n; p++) off[labels[p] + 1]++;
  for (let r = 0; r < R; r++) off[r + 1] += off[r];
  const fill = Int32Array.from(off.subarray(0, R));
  const pix = new Int32Array(n);
  for (let p = 0; p < n; p++) pix[fill[labels[p]]++] = p;

  await clock.tick(1);
  return { labels, reg, dt, imp, pixOff: off, pix, aw, ah, S };
}

/** Color del modelo de la mancha r en coordenadas normalizadas (u,v ∈ 0..1). */
function modelColor(seg, r, u, v, out) {
  const b = seg.reg.beta, q = r * 9;
  for (let c = 0; c < 3; c++) {
    const val = b[q + c * 3] + b[q + c * 3 + 1] * u + b[q + c * 3 + 2] * v;
    out[c] = val < 0 ? 0 : val > 1 ? 1 : val;
  }
  return out;
}

/**
 * Etiquetas a resolución completa: en los bordes elige, entre las manchas
 * vecinas, la que mejor explica el color real del píxel.
 */
async function fullLabels(ctx, seg, clock) {
  const { W, H, data, comp } = ctx;
  const { aw, ah, labels } = seg;
  const L = seg.reg.n < 65535 ? new Uint16Array(W * H) : new Int32Array(W * H);
  const col = new Float32Array(3);
  const cand = new Int32Array(9);
  for (let y = 0; y < H; y++) {
    const ay = Math.min(ah - 1, Math.floor((y + 0.5) * ah / H));
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const ax = Math.min(aw - 1, Math.floor((x + 0.5) * aw / W));
      const p = ay * aw + ax;
      const l0 = labels[p];
      let mixed = false;
      let nc = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = ay + dy;
        if (yy < 0 || yy >= ah) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = ax + dx;
          if (xx < 0 || xx >= aw) continue;
          const l = labels[yy * aw + xx];
          if (l !== l0) mixed = true;
          let seen = false;
          for (let t = 0; t < nc; t++) if (cand[t] === l) { seen = true; break; }
          if (!seen) cand[nc++] = l;
        }
      }
      const i = y * W + x;
      if (!mixed) { L[i] = l0; continue; }
      const di = i * comp;
      const pr = data[di] / 255, pg = data[di + 1] / 255, pb = data[di + 2] / 255;
      const u = (x + 0.5) / W;
      let best = l0, bd = 1e9;
      for (let t = 0; t < nc; t++) {
        modelColor(seg, cand[t], u, v, col);
        const d0 = col[0] - pr, d1 = col[1] - pg, d2 = col[2] - pb;
        const d = d0 * d0 + d1 * d1 + d2 * d2 + (cand[t] === l0 ? -0.002 : 0);
        if (d < bd) { bd = d; best = cand[t]; }
      }
      L[i] = best;
    }
    if ((y & 63) === 0) await clock.tick(y / H);
  }
  return L;
}

/**
 * Cadenas de borde entre manchas (en px de análisis). Cada cadena separa la
 * mancha `r` (lado interior) de la mancha `q`.
 * Devuelve [{r, q, xs:Float32Array, ys:Float32Array, n}]
 */
function boundaryChains(seg, minLen) {
  const { aw, ah, labels } = seg;
  const n = aw * ah;
  // propietario del borde: píxel de r con un vecino 4-conexo de otra mancha q (la de mayor contraste)
  const nb = new Int32Array(n).fill(-1);
  const lab = seg.reg.lab;
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const p = y * aw + x, r = labels[p];
    let best = -1, bd = -1;
    const test = (q) => {
      if (q === r) return;
      const d0 = lab[r * 3] - lab[q * 3], d1 = lab[r * 3 + 1] - lab[q * 3 + 1], d2 = lab[r * 3 + 2] - lab[q * 3 + 2];
      const d = d0 * d0 + d1 * d1 + d2 * d2;
      if (d > bd) { bd = d; best = q; }
    };
    if (x > 0) test(labels[p - 1]);
    if (x < aw - 1) test(labels[p + 1]);
    if (y > 0) test(labels[p - aw]);
    if (y < ah - 1) test(labels[p + aw]);
    nb[p] = best;
  }
  const used = new Uint8Array(n);
  const chains = [];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const xsB = [], ysB = [];
  for (let p0 = 0; p0 < n; p0++) {
    if (nb[p0] < 0 || used[p0]) continue;
    const r = labels[p0], q = nb[p0];
    // recorrer en ambos sentidos
    const walk = (start, sign) => {
      const xs = [], ys = [];
      let p = start, lastDir = -1;
      for (let guard = 0; guard < 100000; guard++) {
        const x = p % aw, y = (p / aw) | 0;
        let next = -1, nd = -1;
        for (let t = 0; t < 8; t++) {
          const di = lastDir < 0 ? t : (lastDir + (t % 2 === 0 ? t / 2 : -(t + 1) / 2) + 8) % 8;
          const xx = x + dirs[di][0] * sign, yy = y + dirs[di][1] * sign;
          if (xx < 0 || yy < 0 || xx >= aw || yy >= ah) continue;
          const pp = yy * aw + xx;
          if (used[pp] || nb[pp] !== q || labels[pp] !== r) continue;
          next = pp; nd = di; break;
        }
        if (next < 0) break;
        used[next] = 1;
        xs.push(next % aw); ys.push((next / aw) | 0);
        p = next; lastDir = nd;
      }
      return [xs, ys];
    };
    used[p0] = 1;
    const [fx, fy] = walk(p0, 1);
    const [bx, by] = walk(p0, -1);
    xsB.length = 0; ysB.length = 0;
    for (let i = bx.length - 1; i >= 0; i--) { xsB.push(bx[i]); ysB.push(by[i]); }
    xsB.push(p0 % aw); ysB.push((p0 / aw) | 0);
    for (let i = 0; i < fx.length; i++) { xsB.push(fx[i]); ysB.push(fy[i]); }
    if (xsB.length < minLen) continue;
    // suavizado (media móvil) para quitar la escalera de píxeles
    const m = xsB.length;
    const xs = new Float32Array(m), ys = new Float32Array(m);
    const w = 3;
    for (let i = 0; i < m; i++) {
      let sx = 0, sy = 0, c = 0;
      for (let k = -w; k <= w; k++) { const j = Math.min(m - 1, Math.max(0, i + k)); sx += xsB[j]; sy += ysB[j]; c++; }
      xs[i] = sx / c + 0.5; ys[i] = sy / c + 0.5;
    }
    chains.push({ r, q, xs, ys, n: m });
  }
  return chains;
}

module.exports = { segment, fullLabels, boundaryChains, modelColor, rgbToLab };

};
__defs["strokes.js"] = function (module, exports, require) {
/*
 * Trazo · trazos
 * - traceStroke: sigue el campo de direcciones desde un punto (en ambos
 *   sentidos), se detiene al cruzar un cambio fuerte de color.
 * - StrokeRaster: rasteriza la pincelada como cápsulas encadenadas en un
 *   búfer local con combinación "máximo" (sin doble mezcla en las uniones)
 *   y guarda, por píxel, la coordenada a lo largo (u) y a lo ancho (v).
 */
const MAXPTS = 4096;

class StrokePath {
  constructor() {
    this.xs = new Float32Array(MAXPTS);
    this.ys = new Float32Array(MAXPTS);
    this.rs = new Float32Array(MAXPTS);
    this.ss = new Float32Array(MAXPTS);
    this.n = 0;
    this.len = 0;
    this._fx = new Float32Array(MAXPTS);
    this._fy = new Float32Array(MAXPTS);
    this._bx = new Float32Array(MAXPTS);
    this._by = new Float32Array(MAXPTS);
  }
}

const _f = new Float32Array(2);
const _c = new Float32Array(3);

/**
 * @param ctx  Context
 * @param path StrokePath (salida)
 * @param x0,y0 punto inicial
 * @param o {R, Lmax, step, curv, colorTol, color:[r,g,b], level, angle, minLen, straight}
 */
function traceStroke(ctx, path, x0, y0, o) {
  const W = ctx.W, H = ctx.H;
  const step = Math.max(0.75, o.step);
  const curv = o.curv;
  const ca = Math.cos(o.angle || 0), sa = Math.sin(o.angle || 0);
  const tol = o.colorTol;
  const col = o.color;
  const minLen = o.minLen === undefined ? o.R : o.minLen;
  const level = o.level;

  const fine = !!o.fine;
  ctx.flowAt(x0, y0, _f, fine);
  let d0x = _f[0] * ca - _f[1] * sa, d0y = _f[0] * sa + _f[1] * ca;

  const half = o.Lmax * 0.5;
  // sentido +
  let nf = runDir(ctx, path._fx, path._fy, x0, y0, d0x, d0y, half, step, curv, ca, sa, tol, col, minLen * 0.5, level, W, H, fine);
  let lenF = (nf) * step;
  // sentido −, con el presupuesto restante
  let nb = runDir(ctx, path._bx, path._by, x0, y0, -d0x, -d0y, o.Lmax - lenF, step, curv, ca, sa, tol, col, minLen * 0.5, level, W, H, fine);

  // ensamblar: atrás invertido + inicio + adelante
  let n = 0;
  const xs = path.xs, ys = path.ys;
  for (let i = nb - 1; i >= 0; i--) { xs[n] = path._bx[i]; ys[n] = path._by[i]; n++; }
  xs[n] = x0; ys[n] = y0; n++;
  for (let i = 0; i < nf; i++) { xs[n] = path._fx[i]; ys[n] = path._fy[i]; n++; }
  if (n === 1) {
    // trazo mínimo: un pequeño segmento en la dirección del flujo
    xs[1] = x0 + d0x * step * 0.5; ys[1] = y0 + d0y * step * 0.5;
    xs[0] = x0 - d0x * step * 0.5; ys[0] = y0 - d0y * step * 0.5;
    n = 2;
  }
  path.n = n;
  let s = 0;
  path.ss[0] = 0;
  for (let i = 1; i < n; i++) {
    const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1];
    s += Math.sqrt(dx * dx + dy * dy);
    path.ss[i] = s;
  }
  path.len = s;
  return path;
}

function runDir(ctx, ox, oy, x, y, dx, dy, budget, step, curv, ca, sa, tol, col, minLen, level, W, H, fine) {
  let n = 0;
  let len = 0;
  const max = Math.min(MAXPTS / 2 - 2, Math.ceil(budget / step));
  for (let k = 0; k < max; k++) {
    ctx.flowAt(x, y, _f, fine);
    let fx = _f[0] * ca - _f[1] * sa, fy = _f[0] * sa + _f[1] * ca;
    if (fx * dx + fy * dy < 0) { fx = -fx; fy = -fy; }
    let nx = dx + (fx - dx) * curv, ny = dy + (fy - dy) * curv;
    const m = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= m; ny /= m;
    const px = x + nx * step, py = y + ny * step;
    if (px < -2 || py < -2 || px > W + 1 || py > H + 1) break;
    if (len >= minLen && tol < 3) {
      ctx.colorAt(level, px, py, _c);
      const diff = Math.abs(_c[0] - col[0]) + Math.abs(_c[1] - col[1]) + Math.abs(_c[2] - col[2]);
      if (diff > tol) break;
    }
    x = px; y = py; dx = nx; dy = ny;
    ox[n] = x; oy[n] = y; n++;
    len += step;
  }
  return n;
}

/** Desplaza los puntos perpendicularmente (temblor de la mano / ondulación). */
function wobblePath(path, amp, wavelength, phase) {
  if (amp <= 0 || path.n < 3) return;
  const { xs, ys, ss, n } = path;
  const k = (Math.PI * 2) / Math.max(1, wavelength);
  // normales por diferencias centrales
  const nxs = path._fx, nys = path._fy;
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : 0, b = i < n - 1 ? i + 1 : n - 1;
    let tx = xs[b] - xs[a], ty = ys[b] - ys[a];
    const m = Math.sqrt(tx * tx + ty * ty) || 1;
    nxs[i] = -ty / m; nys[i] = tx / m;
  }
  for (let i = 0; i < n; i++) {
    const off = amp * Math.sin(ss[i] * k + phase);
    xs[i] += nxs[i] * off; ys[i] += nys[i] * off;
  }
}

class StrokeRaster {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.cap = 0;
    this.A = null; this.U = null; this.V = null;
    this.tl = new Int32Array(1 << 16); // índices locales tocados
    this.tg = new Int32Array(1 << 16); // índices globales
    this.nt = 0;
    this.bx = 0; this.by = 0; this.bw = 0; this.bh = 0;
  }

  _ensure(size) {
    if (size > this.cap) {
      let c = Math.max(1 << 14, this.cap);
      while (c < size) c *= 2;
      this.cap = c;
      this.A = new Float32Array(c);
      this.U = new Float32Array(c);
      this.V = new Float32Array(c);
    }
  }

  _push(local, global) {
    if (this.nt >= this.tl.length) {
      const nl = new Int32Array(this.tl.length * 2); nl.set(this.tl); this.tl = nl;
      const ng = new Int32Array(this.tg.length * 2); ng.set(this.tg); this.tg = ng;
    }
    this.tl[this.nt] = local; this.tg[this.nt] = global; this.nt++;
  }

  /**
   * Rasteriza la trayectoria. rs: radio por punto. soft: fracción del radio
   * usada como borde suave (antialias mínimo de 0.7 px).
   */
  rasterize(path, soft) {
    const { xs, ys, rs, ss, n } = path;
    const W = this.W, H = this.H;
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, rmax = 0;
    for (let i = 0; i < n; i++) {
      if (xs[i] < minx) minx = xs[i]; if (xs[i] > maxx) maxx = xs[i];
      if (ys[i] < miny) miny = ys[i]; if (ys[i] > maxy) maxy = ys[i];
      if (rs[i] > rmax) rmax = rs[i];
    }
    const pad = rmax + 2;
    const bx = Math.max(0, Math.floor(minx - pad)), by = Math.max(0, Math.floor(miny - pad));
    const ex = Math.min(W - 1, Math.ceil(maxx + pad)), ey = Math.min(H - 1, Math.ceil(maxy + pad));
    this.nt = 0;
    if (ex < bx || ey < by) { this.bw = 0; return 0; }
    const bw = ex - bx + 1, bh = ey - by + 1;
    this.bx = bx; this.by = by; this.bw = bw; this.bh = bh;
    this._ensure(bw * bh);
    const A = this.A, U = this.U, V = this.V;
    const total = path.len > 0 ? path.len : 1;
    const invTotal = 1 / total;

    for (let i = 0; i < n - 1; i++) {
      const x0 = xs[i], y0 = ys[i], x1 = xs[i + 1], y1 = ys[i + 1];
      const r0 = rs[i], r1 = rs[i + 1];
      const ex_ = x1 - x0, ey_ = y1 - y0;
      let len2 = ex_ * ex_ + ey_ * ey_;
      const len = Math.sqrt(len2);
      if (len2 < 1e-8) len2 = 1e-8;
      const nx = len > 1e-6 ? -ey_ / len : 0, ny = len > 1e-6 ? ex_ / len : 1;
      const rM = (r0 > r1 ? r0 : r1);
      const aaMax = Math.max(0.7, rM * soft);
      const reach = rM + aaMax * 0.5 + 1;
      const sx0 = Math.max(bx, Math.floor(Math.min(x0, x1) - reach));
      const sx1 = Math.min(ex, Math.ceil(Math.max(x0, x1) + reach));
      const sy0 = Math.max(by, Math.floor(Math.min(y0, y1) - reach));
      const sy1 = Math.min(ey, Math.ceil(Math.max(y0, y1) + reach));
      const s0 = ss[i];
      const inv2 = 1 / len2;
      const dr = r1 - r0;
      const capA = i === 0, capB = i === n - 2;
      const ady = ey_ < 0 ? -ey_ : ey_;
      for (let py = sy0; py <= sy1; py++) {
        const qy = py + 0.5 - y0;
        // recorte de la fila: solo las x que pueden estar a distancia ≤ reach
        let xa = sx0, xb = sx1;
        if (ady > 1e-6) {
          let ta = (qy - reach) / ey_, tb = (qy + reach) / ey_;
          if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
          if (ta < 0) ta = 0; if (tb > 1) tb = 1;
          if (ta > tb) continue;
          const xA = x0 + ex_ * ta, xB = x0 + ex_ * tb;
          const lo = Math.floor((xA < xB ? xA : xB) - reach), hi = Math.ceil((xA > xB ? xA : xB) + reach);
          if (lo > xa) xa = lo; if (hi < xb) xb = hi;
        }
        const lrow = (py - by) * bw - bx;
        const grow = py * W;
        for (let px = xa; px <= xb; px++) {
          const qx = px + 0.5 - x0;
          const tu = (qx * ex_ + qy * ey_) * inv2;
          let t = tu < 0 ? 0 : tu > 1 ? 1 : tu;
          const dx = qx - ex_ * t, dy = qy - ey_ * t;
          const r = r0 + dr * t;
          const aa = r * soft > 0.7 ? r * soft : 0.7;
          const d2 = dx * dx + dy * dy;
          const lim = r + aa * 0.5;
          if (d2 >= lim * lim) continue;
          let a;
          const inner = r - aa * 0.5;
          if (inner > 0 && d2 <= inner * inner) a = 1;
          else {
            a = (r - Math.sqrt(d2)) / aa + 0.5;
            if (a > 1) a = 1;
            if (a <= 0) continue;
          }
          if (r < 0.5) a *= r * 2; // líneas finísimas: menos cobertura
          const li = lrow + px;
          const prev = A[li];
          if (a > prev) {
            if (prev === 0) this._push(li, grow + px);
            A[li] = a;
            // en los extremos u sale de [0,1]: permite remates irregulares
            U[li] = (s0 + ((capA && tu < 0) || (capB && tu > 1) ? tu : t) * len) * invTotal;
            const v = (dx * nx + dy * ny) / (r > 0.3 ? r : 0.3);
            V[li] = v < -1 ? -1 : v > 1 ? 1 : v;
          }
        }
      }
    }
    return this.nt;
  }

  clear() {
    const A = this.A, tl = this.tl;
    for (let k = 0; k < this.nt; k++) A[tl[k]] = 0;
    this.nt = 0;
  }
}

/** Mezcla Fisher–Yates de un Int32Array (in-place). */
function shuffle(arr, n, rand) {
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}

module.exports = { StrokePath, StrokeRaster, traceStroke, wobblePath, shuffle, MAXPTS };

};
__defs["techniques.js"] = function (module, exports, require) {
/*
 * Trazo · técnicas, parámetros y variantes.
 * Cada técnica tiene 4 variantes: al elegir una se rellenan todos los ajustes
 * (y el "modo" con el que pinta el motor); después se puede tocar cualquier ajuste.
 */

const PARAMS = {
  intensidad: { label: "Intensidad del trazo", hint: "Presión, carga y opacidad" },
  grosor:     { label: "Grosor del trazo", hint: "Ancho del pincel, la punta o la gubia" },
  longitud:   { label: "Longitud del trazo", hint: "Lo largo que es cada trazo" },
  curvatura:  { label: "Curvatura del trazo", hint: "0 = rectos · 100 = siguen las formas" },
  cobertura:  { label: "Cobertura del blanco", hint: "Cuánto se cubre. Lo no cubierto deja ver el papel (o queda transparente)" },
  empaste:    { label: "Empaste", hint: "Grosor de la pintura: relieve y brillo en las luces" },
  humedad:    { label: "Humedad", hint: "Cuánto se corre y se funde el color" },
  granulado:  { label: "Granulado", hint: "Grano del pigmento, de la tinta o de la impresión" },
  cruzado:    { label: "Sombreado cruzado", hint: "Capas de trazo superpuestas en distintas direcciones" },
  varTono:    { label: "Variación de tono", hint: "Cambio de matiz entre trazos" },
  varSat:     { label: "Variación de saturación", hint: "Cambio de intensidad de color entre trazos" },
  varLuz:     { label: "Variación de luz", hint: "Cambio de claridad entre trazos" },
  detalle:    { label: "Detalle", hint: "Más trazos y más finos en lo importante" },
};

const PAINT = ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "varTono", "varSat", "varLuz", "detalle"];

const TECHNIQUES = [
  {
    id: "oleo", name: "Óleo", desc: "Pinceladas cargadas sobre imprimatura, empaste en las luces",
    params: PAINT,
    variants: [
      { id: "planos", name: "Planos y espátula", values: { intensidad: 88, grosor: 50, longitud: 38, curvatura: 45, cobertura: 100, empaste: 70, varTono: 22, varSat: 25, varLuz: 22, detalle: 55 } },
      { id: "gestual", name: "Gestual", values: { intensidad: 80, grosor: 68, longitud: 70, curvatura: 65, cobertura: 92, empaste: 45, varTono: 35, varSat: 40, varLuz: 30, detalle: 40 } },
      { id: "boceto", name: "Boceto sobre imprimatura", values: { intensidad: 70, grosor: 42, longitud: 55, curvatura: 55, cobertura: 75, empaste: 30, varTono: 18, varSat: 18, varLuz: 18, detalle: 50 } },
      { id: "materico", name: "Matérico", values: { intensidad: 90, grosor: 55, longitud: 35, curvatura: 40, cobertura: 100, empaste: 85, varTono: 15, varSat: 12, varLuz: 25, detalle: 50 } },
    ],
  },
  {
    id: "lapiz", name: "Lápiz", desc: "Grafito y carboncillo en grises",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "cruzado", "detalle"],
    variants: [
      { id: "linea", name: "Línea suelta", values: { intensidad: 70, grosor: 22, longitud: 60, curvatura: 60, cobertura: 55, cruzado: 20, detalle: 70 } },
      { id: "rayado", name: "Rayado", values: { intensidad: 65, grosor: 24, longitud: 50, curvatura: 45, cobertura: 85, cruzado: 55, detalle: 60 } },
      { id: "carbon", name: "Carboncillo", values: { intensidad: 85, grosor: 55, longitud: 55, curvatura: 50, cobertura: 95, cruzado: 35, detalle: 55 } },
      { id: "negros", name: "Negros expresivos", values: { intensidad: 95, grosor: 40, longitud: 60, curvatura: 55, cobertura: 90, cruzado: 25, detalle: 50 } },
    ],
  },
  {
    id: "gouache", name: "Gouache", desc: "Planos mates y opacos con borde duro",
    params: PAINT,
    variants: [
      { id: "pleinair", name: "Plein air", values: { intensidad: 92, grosor: 48, longitud: 32, curvatura: 45, cobertura: 95, empaste: 18, varTono: 14, varSat: 14, varLuz: 18, detalle: 50 } },
      { id: "lineaplano", name: "Línea y plano", values: { intensidad: 90, grosor: 45, longitud: 45, curvatura: 55, cobertura: 70, empaste: 8, varTono: 8, varSat: 10, varLuz: 8, detalle: 60 } },
      { id: "expresivo", name: "Retrato expresivo", values: { intensidad: 88, grosor: 50, longitud: 40, curvatura: 55, cobertura: 100, empaste: 25, varTono: 28, varSat: 30, varLuz: 30, detalle: 55 } },
      { id: "diluido", name: "Diluido", values: { intensidad: 70, grosor: 55, longitud: 35, curvatura: 45, cobertura: 85, empaste: 5, varTono: 15, varSat: 15, varLuz: 15, detalle: 40 } },
    ],
  },
  {
    id: "acuarela", name: "Acuarela", desc: "Aguadas transparentes, bordes húmedos y pigmento",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "humedad", "granulado", "varTono", "varSat", "varLuz", "detalle"],
    variants: [
      { id: "humeda", name: "Manchas húmedas", values: { intensidad: 78, grosor: 55, longitud: 35, curvatura: 50, cobertura: 75, humedad: 85, granulado: 40, varTono: 25, varSat: 20, varLuz: 20, detalle: 40 } },
      { id: "capas", name: "Paisaje por capas", values: { intensidad: 72, grosor: 45, longitud: 40, curvatura: 50, cobertura: 85, humedad: 50, granulado: 45, varTono: 22, varSat: 20, varLuz: 20, detalle: 50 } },
      { id: "dibujo", name: "Con dibujo", values: { intensidad: 65, grosor: 45, longitud: 40, curvatura: 50, cobertura: 75, humedad: 45, granulado: 40, varTono: 18, varSat: 15, varLuz: 15, detalle: 60 } },
      { id: "densa", name: "Densa", values: { intensidad: 92, grosor: 45, longitud: 45, curvatura: 50, cobertura: 92, humedad: 55, granulado: 60, varTono: 25, varSat: 30, varLuz: 22, detalle: 60 } },
    ],
  },
  {
    id: "rotulador", name: "Rotulador", desc: "Bandas de ancho fijo que oscurecen al solaparse",
    params: ["intensidad", "grosor", "longitud", "cobertura", "cruzado", "varTono", "varSat", "detalle"],
    variants: [
      { id: "moda", name: "Moda (alcohol + línea)", values: { intensidad: 80, grosor: 45, longitud: 70, cobertura: 60, cruzado: 35, varTono: 10, varSat: 20, detalle: 65 } },
      { id: "vetas", name: "Vetas de alcohol", values: { intensidad: 75, grosor: 40, longitud: 60, cobertura: 90, cruzado: 55, varTono: 10, varSat: 15, detalle: 50 } },
      { id: "acuarelable", name: "Acuarelables", values: { intensidad: 80, grosor: 50, longitud: 40, cobertura: 70, cruzado: 25, varTono: 15, varSat: 25, detalle: 45 } },
      { id: "linea", name: "Línea y relleno", values: { intensidad: 70, grosor: 30, longitud: 55, cobertura: 50, cruzado: 40, varTono: 15, varSat: 15, detalle: 70 } },
    ],
  },
  {
    id: "mixtalg", name: "Mixta L+G", desc: "Dibujo a lápiz muy presente con manchas de gouache",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "cruzado", "varTono", "varSat", "varLuz", "detalle"],
    variants: [
      { id: "maslapiz", name: "Más lápiz", values: { intensidad: 75, grosor: 40, longitud: 45, curvatura: 50, cobertura: 40, empaste: 10, cruzado: 45, varTono: 12, varSat: 12, varLuz: 12, detalle: 70 } },
      { id: "equilibrada", name: "Equilibrada", values: { intensidad: 72, grosor: 45, longitud: 40, curvatura: 50, cobertura: 62, empaste: 12, cruzado: 35, varTono: 15, varSat: 15, varLuz: 15, detalle: 60 } },
      { id: "masgouache", name: "Más gouache", values: { intensidad: 70, grosor: 50, longitud: 38, curvatura: 50, cobertura: 85, empaste: 15, cruzado: 25, varTono: 15, varSat: 15, varLuz: 15, detalle: 55 } },
      { id: "manchas", name: "Manchas sueltas", values: { intensidad: 75, grosor: 55, longitud: 35, curvatura: 50, cobertura: 55, empaste: 10, cruzado: 30, varTono: 22, varSat: 22, varLuz: 18, detalle: 60 } },
    ],
  },
  {
    id: "mixta", name: "Mixta total", desc: "Collage, gouache, tinta, ceras e impresión en la misma lámina",
    params: ["intensidad", "grosor", "longitud", "cobertura", "granulado", "varTono", "varSat", "detalle"],
    variants: [
      { id: "cuaderno", name: "Cuaderno", values: { intensidad: 70, grosor: 40, longitud: 50, cobertura: 55, granulado: 40, varTono: 15, varSat: 20, detalle: 65 } },
      { id: "collage", name: "Collage", values: { intensidad: 75, grosor: 45, longitud: 45, cobertura: 85, granulado: 55, varTono: 15, varSat: 15, detalle: 55 } },
      { id: "cartel", name: "Cartel", values: { intensidad: 85, grosor: 55, longitud: 40, cobertura: 95, granulado: 45, varTono: 20, varSat: 35, detalle: 50 } },
      { id: "impresion", name: "Impresión", values: { intensidad: 80, grosor: 45, longitud: 45, cobertura: 85, granulado: 75, varTono: 10, varSat: 20, detalle: 55 } },
    ],
  },
  {
    id: "xilografia", name: "Xilografía", desc: "Grabado en madera: cortes de gubia y tinta estampada",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "granulado", "detalle"],
    variants: [
      { id: "realista", name: "Realista", values: { intensidad: 85, grosor: 35, longitud: 55, curvatura: 70, cobertura: 85, granulado: 45, detalle: 70 } },
      { id: "expresiva", name: "Expresiva", values: { intensidad: 92, grosor: 60, longitud: 45, curvatura: 35, cobertura: 90, granulado: 55, detalle: 40 } },
      { id: "dos", name: "Dos tintas", values: { intensidad: 85, grosor: 45, longitud: 50, curvatura: 55, cobertura: 85, granulado: 55, detalle: 55 } },
      { id: "tres", name: "Tres tintas", values: { intensidad: 85, grosor: 45, longitud: 50, curvatura: 55, cobertura: 85, granulado: 55, detalle: 50 } },
    ],
  },
];

const BY_ID = {};
for (const t of TECHNIQUES) {
  t.defaults = Object.assign({ modo: t.variants[0].id }, t.variants[0].values);
  t.presets = t.variants.map((v) => ({ name: v.name, values: Object.assign({ modo: v.id }, v.values) }));
  BY_ID[t.id] = t;
}

function defaultsFor(id) {
  return Object.assign({}, BY_ID[id].defaults);
}

/** Normaliza parámetros 0..100 → 0..1 rellenando los que falten; el modo se valida. */
function normalized(id, params) {
  const t = BY_ID[id];
  const p = Object.assign({}, t.defaults, params || {});
  const out = {};
  for (const k of Object.keys(PARAMS)) {
    const v = p[k] === undefined ? 50 : +p[k];
    out[k] = Math.max(0, Math.min(100, isFinite(v) ? v : 50)) / 100;
  }
  out.modo = t.variants.some((v) => v.id === p.modo) ? p.modo : t.variants[0].id;
  out.color = false;
  return out;
}

module.exports = { PARAMS, TECHNIQUES, BY_ID, defaultsFor, normalized };

};
__defs["watercolor.js"] = function (module, exports, require) {
/*
 * Trazo · Acuarela
 * 1) Abstracción: filtro Kuwahara suavizado (manchas planas, bordes nítidos).
 * 2) Sangrado húmedo: el color se funde con un desenfoque en zonas al azar.
 * 3) Densidad de pigmento (modelo de Bousseau): oscurecimiento de bordes,
 *    turbulencia, granulado en el grano del papel y marcas de pincel.
 * 4) Reserva de blancos (cobertura) y salida transparente: el papel es alfa.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");

/** Kuwahara generalizado con tablas de sumas (O(n) por radio). */
function kuwahara(r, g, b, w, h, rad) {
  const W1 = w + 1;
  const n1 = W1 * (h + 1);
  const sr = new Float64Array(n1), sg = new Float64Array(n1), sb = new Float64Array(n1);
  const sl = new Float64Array(n1), sl2 = new Float64Array(n1);
  for (let y = 0; y < h; y++) {
    let ar = 0, ag = 0, ab = 0, al = 0, al2 = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
      ar += r[i]; ag += g[i]; ab += b[i]; al += l; al2 += l * l;
      const o = (y + 1) * W1 + x + 1, u = y * W1 + x + 1;
      sr[o] = sr[u] + ar; sg[o] = sg[u] + ag; sb[o] = sb[u] + ab; sl[o] = sl[u] + al; sl2[o] = sl2[u] + al2;
    }
  }
  const or = new Float32Array(w * h), og = new Float32Array(w * h), ob = new Float32Array(w * h);
  const box = (T, x0, y0, x1, y1) => T[(y1 + 1) * W1 + x1 + 1] - T[y0 * W1 + x1 + 1] - T[(y1 + 1) * W1 + x0] + T[y0 * W1 + x0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let wsum = 0, mr = 0, mg = 0, mb = 0;
      for (let q = 0; q < 4; q++) {
        const x0 = q & 1 ? x : Math.max(0, x - rad), x1 = q & 1 ? Math.min(w - 1, x + rad) : x;
        const y0 = q & 2 ? y : Math.max(0, y - rad), y1 = q & 2 ? Math.min(h - 1, y + rad) : y;
        const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
        const inv = 1 / cnt;
        const ml = box(sl, x0, y0, x1, y1) * inv;
        const v = Math.max(0, box(sl2, x0, y0, x1, y1) * inv - ml * ml);
        const wt = 1 / (1e-5 + v * v * 1e3 + v);
        wsum += wt;
        mr += box(sr, x0, y0, x1, y1) * inv * wt;
        mg += box(sg, x0, y0, x1, y1) * inv * wt;
        mb += box(sb, x0, y0, x1, y1) * inv * wt;
      }
      const i = y * w + x;
      or[i] = mr / wsum; og[i] = mg / wsum; ob[i] = mb / wsum;
    }
  }
  return [or, og, ob];
}

async function paint(ctx, p, clock) {
  const { W, H, N, s, aw, ah, fa } = ctx;
  const n = aw * ah;
  const rand = C.mulberry32(ctx.seed * 17 + 11);

  /* ----- 1) abstracción ----- */
  const radFull = (2 + p.grosor * 13) * s * (1 - 0.35 * p.detalle);
  const rad = Math.max(1, Math.round(radFull / fa));
  let [kr, kg, kb] = kuwahara(ctx.ar, ctx.ag, ctx.ab, aw, ah, rad);
  await clock.tick(0.1);
  [kr, kg, kb] = kuwahara(kr, kg, kb, aw, ah, Math.max(1, Math.round(rad * 0.6)));
  await clock.tick(0.2);

  // variación de color por zonas (tono / saturación / luz)
  if (p.varTono + p.varSat + p.varLuz > 0.01) {
    const gw = Math.max(4, Math.ceil(aw / 6)), gh = Math.max(4, Math.ceil(ah / 6));
    const cell = Math.max(3, gw / 4);
    const nh = C.fbmGrid(gw, gh, cell, 2, ctx.seed + 401, 0.5);
    const ns = C.fbmGrid(gw, gh, cell, 2, ctx.seed + 402, 0.5);
    const nl = C.fbmGrid(gw, gh, cell, 2, ctx.seed + 403, 0.5);
    const tmp = new Float32Array(3);
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      const i = y * aw + x;
      const fx = x / 6, fy = y / 6;
      C.varyColor(kr[i], kg[i], kb[i],
        (C.bilinear(nh, gw, gh, fx, fy) - 0.5) * 2 * p.varTono * 0.5,
        (C.bilinear(ns, gw, gh, fx, fy) - 0.5) * 2 * p.varSat * 0.7,
        (C.bilinear(nl, gw, gh, fx, fy) - 0.5) * 2 * p.varLuz * 0.3, tmp);
      kr[i] = tmp[0]; kg[i] = tmp[1]; kb[i] = tmp[2];
    }
  }

  /* ----- 2) sangrado húmedo ----- */
  const sig = (1.5 + p.humedad * 9) * s / fa;
  const br = Float32Array.from(kr), bg = Float32Array.from(kg), bb = Float32Array.from(kb);
  const tmp = new Float32Array(n);
  C.gaussBlur(br, aw, ah, sig, tmp); C.gaussBlur(bg, aw, ah, sig, tmp); C.gaussBlur(bb, aw, ah, sig, tmp);
  const gw = Math.max(4, Math.ceil(aw / 4)), gh = Math.max(4, Math.ceil(ah / 4));
  const bleedN = C.fbmGrid(gw, gh, Math.max(3, gw / 6), 3, ctx.seed + 501, 0.55);
  const wr = new Float32Array(n), wg = new Float32Array(n), wb = new Float32Array(n);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const i = y * aw + x;
    const m = C.smoothstep(0.62 - p.humedad * 0.3, 0.8 - p.humedad * 0.2, C.bilinear(bleedN, gw, gh, x / 4, y / 4)) * (0.3 + 0.7 * p.humedad);
    wr[i] = kr[i] + (br[i] - kr[i]) * m;
    wg[i] = kg[i] + (bg[i] - kg[i]) * m;
    wb[i] = kb[i] + (bb[i] - kb[i]) * m;
  }
  await clock.tick(0.3);

  /* ----- 3) mapa de bordes de las manchas (oscurecimiento) ----- */
  const E = new Float32Array(n);
  for (let y = 0; y < ah; y++) {
    const ym = (y > 0 ? y - 1 : 0) * aw, yp = (y < ah - 1 ? y + 1 : y) * aw, y0 = y * aw;
    for (let x = 0; x < aw; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < aw - 1 ? x + 1 : x;
      const lx = 0.3 * (wr[y0 + xp] - wr[y0 + xm]) + 0.59 * (wg[y0 + xp] - wg[y0 + xm]) + 0.11 * (wb[y0 + xp] - wb[y0 + xm]);
      const ly = 0.3 * (wr[yp + x] - wr[ym + x]) + 0.59 * (wg[yp + x] - wg[ym + x]) + 0.11 * (wb[yp + x] - wb[ym + x]);
      E[y0 + x] = Math.sqrt(lx * lx + ly * ly);
    }
  }
  const e95 = C.percentile(E, 0.97) || 1e-3;
  for (let i = 0; i < n; i++) E[i] = Math.min(1, E[i] / e95);
  C.gaussBlur(E, aw, ah, Math.max(0.6, 0.8 * s / fa), tmp);

  // turbulencia de pigmento (baja frecuencia) y desplazamiento de bordes
  const turbN = C.fbmGrid(gw, gh, Math.max(3, gw / 10), 4, ctx.seed + 601, 0.55);
  const dxN = C.fbmGrid(gw, gh, Math.max(2, gw / 16), 3, ctx.seed + 602, 0.5);
  const dyN = C.fbmGrid(gw, gh, Math.max(2, gw / 16), 3, ctx.seed + 603, 0.5);
  await clock.tick(0.4);

  /* ----- 4) marcas de pincel (modulan la densidad) ----- */
  const Dn = new Float32Array(N);
  const lib = ctx.lib && ctx.lib.samples && ctx.lib.samples.length ? ctx.lib.samples : null;
  if (lib) {
    await realWashes(ctx, p, lib, Dn, rand, clock);
  } else if (p.longitud > 0.01) {
    const raster = new S.StrokeRaster(W, H);
    const path = new S.StrokePath();
    const R = (2.5 + p.grosor * 15) * s;
    const L = R * 2 * (0.6 + p.longitud * 4.5);
    const sp = R * 1.9;
    const cols = Math.ceil(W / sp), rows = Math.ceil(H / sp);
    const col = new Float32Array(3);
    const total = cols * rows;
    let done = 0;
    const level = ctx.levelFor(R);
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      done++;
      const x = (gx + rand()) * sp, y = (gy + rand()) * sp;
      if (x >= W || y >= H) continue;
      if (rand() > ctx.at(ctx.cover, x, y) * 0.85) continue;
      ctx.colorAt(level, x, y, col);
      S.traceStroke(ctx, path, x, y, {
        R, Lmax: L * (0.5 + rand()), step: Math.max(1, R * 0.6), curv: 0.1 + 0.85 * p.curvatura,
        colorTol: 0.5, color: col, level, angle: 0, minLen: R,
      });
      S.wobblePath(path, R * 0.15, R * 6, rand() * 6.28);
      const len = path.len || 1;
      for (let i = 0; i < path.n; i++) {
        const u = path.ss[i] / len;
        path.rs[i] = R * (0.6 + 0.4 * Math.sin(u * Math.PI)) * (0.85 + 0.3 * rand());
      }
      const nt = raster.rasterize(path, 0.5);
      const str = 0.18 + 0.3 * rand();
      const A = raster.A, V = raster.V, U = raster.U, tl = raster.tl, tg = raster.tg;
      for (let t = 0; t < nt; t++) {
        const li = tl[t], g = tg[t];
        const v = V[li], av = v < 0 ? -v : v;
        const u = U[li];
        const rim = C.smoothstep(0.55, 0.95, av) * 0.8 + 0.25 + C.smoothstep(0.85, 1, u) * 0.4;
        const add = A[li] * str * rim;
        Dn[g] = Dn[g] + add * (1 - Dn[g] * 0.6);
      }
      raster.clear();
      if ((done & 31) === 0) await clock.tick(0.4 + 0.3 * done / total);
    }
  }

  /* ----- 5) composición a resolución completa ----- */
  const grain = C.makeGrainTile(ctx.seed + 21, "rough");
  const gsInv = 1 / Math.max(1, Math.sqrt(s) * 2.0);
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H))) : null;
  // con aguadas reales: una aguada base más clara + veladuras que aportan el resto del pigmento
  const glaze = !!lib;
  const gk = 0.85 * (0.55 + 0.5 * p.intensidad);
  const amp = (0.8 + p.humedad * 3.5) * s; // ondulación de los bordes (px)
  const edgeDark = 0.45 + 0.6 * p.detalle;
  const turbK = 0.22 + 0.18 * p.humedad;
  const granK = 0.25 + 1.0 * p.granulado;
  const pig = 0.45 + 0.6 * p.intensidad;
  const brushK = 0.25 + 0.5 * p.longitud;
  const out = new Uint8Array(N * 4);
  const selFull = ctx.selFull, data = ctx.data, comp = ctx.comp, srcA = ctx.srcAlpha;
  const cover = ctx.cover;
  const ax = ctx.ax, ay = ctx.ay;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // coordenadas de análisis con ondulación
      const gx4 = (x + 0.5) * ax / 4, gy4 = (y + 0.5) * ay / 4;
      const ox = (C.bilinear(dxN, gw, gh, gx4, gy4) - 0.5) * 2 * amp;
      const oy = (C.bilinear(dyN, gw, gh, gx4, gy4) - 0.5) * 2 * amp;
      const sx = (x + ox + 0.5) * ax - 0.5, sy = (y + oy + 0.5) * ay - 0.5;
      let r = C.bilinear(wr, aw, ah, sx, sy);
      let g = C.bilinear(wg, aw, ah, sx, sy);
      let b = C.bilinear(wb, aw, ah, sx, sy);
      const e = C.bilinear(E, aw, ah, sx, sy);
      const m = C.bilinear(cover, aw, ah, sx, sy);
      const tu = C.bilinear(turbN, gw, gh, gx4, gy4);
      const gr = pap ? pap.eq(x, y) : C.tileAt(grain, x * gsInv, y * gsInv);
      const c0r = r, c0g = g, c0b = b;
      const lumv = 0.299 * r + 0.587 * g + 0.114 * b;
      // densidad de pigmento
      let d = (1 + edgeDark * e * e * 1.2) *
              (1 + turbK * (tu - 0.5) * 2) *
              (1 + granK * (gr - 0.5) * (0.4 + (1 - lumv))) *
              (glaze ? 1 : 1 + brushK * (Dn[i] - 0.2)) *
              (1 + 1.1 * 4 * m * (1 - m) * (m < 0.98 ? 1 : 0)); // borde de la mancha al reservar blancos
      const k = d - 1;
      r = r - (r - r * r) * k; g = g - (g - g * g) * k; b = b - (b - b * b) * k;
      // intensidad del pigmento y reserva del papel
      const pm = pig * m * (glaze ? 0.72 : 1);
      r = 1 - (1 - r) * pm; g = 1 - (1 - g) * pm; b = 1 - (1 - b) * pm;
      if (glaze && Dn[i] > 0.001) {
        // veladuras transparentes: cada aguada absorbe según su color (se oscurecen al superponerse)
        const dg = (1 - Math.exp(-Dn[i] * 1.1)) * gk * m; // las veladuras se saturan: no oscurecen sin límite
        r *= Math.exp(-(1 - c0r) * dg); g *= Math.exp(-(1 - c0g) * dg); b *= Math.exp(-(1 - c0b) * dg);
      }
      r = r < 0 ? 0 : r > 1 ? 1 : r; g = g < 0 ? 0 : g > 1 ? 1 : g; b = b < 0 ? 0 : b > 1 ? 1 : b;
      // papel blanco → transparente
      let a = Math.max(1 - r, 1 - g, 1 - b);
      const o = i * 4;
      if (a < 0.004) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 0; continue; }
      const ia = 1 / a;
      r = 1 - (1 - r) * ia; g = 1 - (1 - g) * ia; b = 1 - (1 - b) * ia;
      if (selFull) a *= selFull[i] / 255;
      if (srcA) a *= data[i * comp + 3] / 255;
      out[o] = r * 255 + 0.5 | 0; out[o + 1] = g * 255 + 0.5 | 0; out[o + 2] = b * 255 + 0.5 | 0;
      out[o + 3] = a * 255 + 0.5 | 0;
    }
    if ((y & 15) === 0) await clock.tick(0.7 + 0.3 * y / H);
  }
  return out;
}

/**
 * Aguadas reales: cada pincelada es una muestra escaneada (borde de pigmento,
 * floraciones, granulado) que se acumula como densidad de veladura.
 * Dos pasadas: toda la imagen y luego refuerzo en las zonas oscuras.
 */
async function realWashes(ctx, p, lib, Dn, rand, clock) {
  const { W, H, s } = ctx;
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const col = new Float32Array(3);
  const ts = new Float32Array(2);
  const R0 = (6 + p.grosor * 26) * s;
  const passes = [
    { R: R0, sp: 1.9, minDark: 0.06, prob: 0.9, str: 0.8 },
    { R: R0 * 0.62, sp: 2.2, minDark: 0.42, prob: 0.8, str: 0.75 },
  ];
  for (let pi = 0; pi < passes.length; pi++) {
    const P = passes[pi];
    const R = P.R, Rr = R / 0.7;
    const L = R * 2 * (1.4 + p.longitud * 6);
    const sp = R * P.sp;
    const cols = Math.ceil(W / sp), rows = Math.ceil(H / sp);
    const level = ctx.levelFor(R);
    const total = cols * rows;
    let done = 0;
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      done++;
      const x = (gx + rand()) * sp, y = (gy + rand()) * sp;
      if (x >= W || y >= H) continue;
      if (rand() > ctx.at(ctx.cover, x, y) * P.prob) continue;
      ctx.colorAt(level, x, y, col);
      const dark = 1 - (0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2]);
      if (dark < P.minDark) continue;
      if (rand() > 0.35 + 0.9 * dark) continue; // zonas claras: más aguada base y papel
      S.traceStroke(ctx, path, x, y, {
        R, Lmax: L * (0.55 + rand() * 0.8), step: Math.max(1, R * 0.8), curv: 0.1 + 0.85 * p.curvatura,
        colorTol: 0.55, color: col, level, angle: (rand() - 0.5) * 0.3, minLen: R * 1.5,
      });
      S.wobblePath(path, R * 0.08, R * 8, rand() * 6.28);
      for (let i = 0; i < path.n; i++) path.rs[i] = Rr * 0.9;
      const nt = raster.rasterize(path, 0.04);
      if (nt === 0) continue;
      const st = Lib.prepare(lib[(rand() * lib.length) | 0], path.len || 1, Rr, rand, 0.9);
      const str = P.str * (0.75 + 0.5 * rand());
      const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
      for (let t = 0; t < nt; t++) {
        const li = tl[t], g = tg[t];
        Lib.sampleAt(st, U[li], V[li], ts);
        const add = ts[0] * A[li] * str;
        if (add > 0.003) Dn[g] += add * (1 - Dn[g] * 0.25);
      }
      raster.clear();
      if ((done & 31) === 0) await clock.tick(0.4 + 0.3 * (pi + done / total) / passes.length);
    }
  }
}

module.exports = { paint, kuwahara };

};
__defs["watercolor2.js"] = function (module, exports, require) {
/*
 * Trazo · Acuarela por aguadas superpuestas
 *
 * Un acuarelista pinta de claro a oscuro con veladuras transparentes:
 *  · Cada mancha recibe tantas aguadas como oscura es; el color final es el
 *    producto (absorción) de todas ellas.
 *  · Las primeras aguadas, húmedas: bordes suaves, ondulados, colores que se
 *    funden entre manchas vecinas. Las últimas, en seco: bordes nítidos.
 *  · Al secarse, el pigmento se acumula en el borde de cada aguada (anillo
 *    oscuro) y se asienta en los valles del papel (granulado), sobre todo ahí.
 *  · Donde dos aguadas se pisan se mezclan por superposición.
 *  · El papel se reserva en las luces y, a veces, queda una línea blanca entre
 *    manchas de colores muy distintos.
 *  · Pinceladas reales (biblioteca) aportan la textura en zonas con detalle.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");
const Seg = require("./segment.js");
const Kit = require("./kit.js");

const LAYER_W = [1.15, 1.0, 0.9, 0.8, 0.75];

function blur(plane, w, h, sigma, tmp) {
  if (sigma >= 0.35) C.gaussBlur(plane, w, h, sigma, tmp);
  return plane;
}

async function paint(ctx, p, seg, Lfull, clock) {
  const { W, H, N, s } = ctx;
  const reg = seg.reg;
  const rand = C.mulberry32(ctx.seed * 17 + 11);
  const lib = ctx.lib && ctx.lib.samples && ctx.lib.samples.length ? ctx.lib.samples : Lib.synthetic("acuarela");
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H))) : null;

  /* ---------- rejilla de trabajo para las aguadas ---------- */
  const q = Math.max(1, Math.max(W, H) / 1400);
  const ww = Math.max(8, Math.round(W / q)), wh = Math.max(8, Math.round(H / q));
  const qx = W / ww, qy = H / wh;
  const wn = ww * wh;
  const ss = s / q; // escala relativa en px de trabajo

  // etiqueta y color del modelo en la rejilla
  const wl = new Int32Array(wn);
  const absR = new Float32Array(wn), absG = new Float32Array(wn), absB = new Float32Array(wn);
  const col = new Float32Array(3);
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const fx = Math.min(W - 1, ((x + 0.5) * qx) | 0), fy = Math.min(H - 1, ((y + 0.5) * qy) | 0);
    const r = Lfull[fy * W + fx];
    wl[y * ww + x] = r;
  }

  /* ---------- niveles de aguada ---------- */
  const dark = new Float32Array(reg.n);
  let dmax = 0;
  for (let r = 0; r < reg.n; r++) { dark[r] = 1 - reg.lum[r]; if (dark[r] > dmax) dmax = dark[r]; }
  const tWhite = 0.035 + (1 - p.cobertura) * 0.22; // luces reservadas
  // variantes: número de aguadas, humedad efectiva e intensidad
  const mode = p.modo || "capas";
  const K = mode === "densa" ? 5 : mode === "humeda" || mode === "dibujo" ? 3 : 4;
  const humX = mode === "humeda" ? 0.25 : mode === "densa" ? -0.05 : 0;
  const FR = K === 5 ? [0, 0.2, 0.4, 0.6, 0.78] : K === 3 ? [0, 0.35, 0.65] : [0, 0.26, 0.5, 0.72];
  const th = [];
  for (let k = 0; k < K; k++) th.push(tWhite + (Math.max(tWhite + 0.1, dmax) - tWhite) * FR[k]);
  const nCover = new Int8Array(reg.n);
  for (let r = 0; r < reg.n; r++) { let c = 0; for (let k = 0; k < K; k++) if (dark[r] >= th[k]) c++; nCover[r] = c; }
  const wsum = new Float32Array(K + 1);
  for (let k = 1; k <= K; k++) wsum[k] = wsum[k - 1] + LAYER_W[k - 1];

  // absorbancia objetivo (−ln color) en la rejilla
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const i = y * ww + x, r = wl[i];
    Seg.modelColor(seg, r, (x + 0.5) / ww, (y + 0.5) / wh, col);
    // la acuarela no llega al negro absoluto ni a colores de pantalla
    const pig = (mode === "densa" ? 0.9 : 0.82) + 0.18 * p.intensidad;
    absR[i] = -Math.log(Math.max(0.035, 1 - (1 - col[0]) * pig));
    absG[i] = -Math.log(Math.max(0.035, 1 - (1 - col[1]) * pig));
    absB[i] = -Math.log(Math.max(0.035, 1 - (1 - col[2]) * pig));
  }
  await clock.tick(0.05);

  // ruidos: ondulación de bordes, turbulencia de pigmento, floraciones
  const gw = Math.max(4, Math.ceil(ww / 6)), gh = Math.max(4, Math.ceil(wh / 6));
  const nzX = C.fbmGrid(gw, gh, Math.max(2, gw / 10), 4, ctx.seed + 801, 0.55);
  const nzY = C.fbmGrid(gw, gh, Math.max(2, gw / 10), 4, ctx.seed + 802, 0.55);
  const nzT = C.fbmGrid(gw, gh, Math.max(2, gw / 7), 5, ctx.seed + 803, 0.55);
  const nzB = C.fbmGrid(gw, gh, Math.max(2, gw / 4), 3, ctx.seed + 804, 0.5);

  const tmp = new Float32Array(wn);
  const layers = [];
  const bgw = Math.max(4, Math.ceil(ww / 2)), bgh = Math.max(4, Math.ceil(wh / 2));
  const bloomF = C.fbmGrid(bgw, bgh, Math.max(4, 40 * ss), 6, ctx.seed + 805, 0.6);
  // distancia (px de trabajo) de cada punto al borde de su mancha y límite de sangrado
  const dInW = new Float32Array(wn), thinW = new Float32Array(wn);
  {
    const fa = 1 / ctx.ax;
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const i = y * ww + x;
      const ax = Math.min(seg.aw - 1, ((x + 0.5) * qx * ctx.ax) | 0), ay = Math.min(seg.ah - 1, ((y + 0.5) * qy * ctx.ax) | 0);
      dInW[i] = seg.dt[ay * seg.aw + ax] * fa / q;
      thinW[i] = reg.maxDist[wl[i]] * fa / q;
    }
  }
  for (let k = 0; k < K; k++) {
    const wet = k === 0 ? 1 : k === 1 ? 0.65 : k === 2 ? 0.3 : 0.12; // humedad de cada pasada
    const hum = Math.min(1, p.humedad + humX);
    const amp = (0.8 + 4.5 * hum * wet) * ss * 1.6; // ondulación del borde (px de trabajo)
    // máscara con borde ondulado
    const m = new Float32Array(wn);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const gx = x / 6, gy = y / 6;
      const ox = (C.bilinear(nzX, gw, gh, gx, gy) - 0.5) * 2 * amp, oy = (C.bilinear(nzY, gw, gh, gx, gy) - 0.5) * 2 * amp;
      const sx = C.clamp(Math.round(x + ox), 0, ww - 1), sy = C.clamp(Math.round(y + oy), 0, wh - 1);
      const r = wl[sy * ww + sx];
      m[y * ww + x] = nCover[r] > k ? 1 : 0;
    }
    // borde: húmedo = suave y con flecos; seco = nítido
    const soft = Float32Array.from(m);
    blur(soft, ww, wh, (0.5 + (1.2 + 5 * hum) * wet) * ss * 1.4, tmp);
    const cov = new Float32Array(wn);
    for (let i = 0; i < wn; i++) {
      const x = i % ww, y = (i / ww) | 0;
      const fr = (C.bilinear(nzB, gw, gh, x / 6, y / 6) - 0.5) * 0.55 * wet * hum; // flecos de floración
      const sv = soft[i] + fr;
      const hard = C.smoothstep(0.42, 0.58, sv);
      cov[i] = hard + (C.clamp(sv * 1.15, 0, 1) - hard) * wet * hum * 0.85;
    }
    // proteger las formas claras: una aguada solo invade una mancha más clara
    // cerca del borde, y menos cuanto más estrecha es (se "pinta alrededor")
    {
      const fa = 1 / ctx.ax;
      for (let i = 0; i < wn; i++) {
        const r = wl[i];
        if (nCover[r] > k || cov[i] < 0.002) continue;
        const allowed = Math.min(1.2 * amp + 1.5, 0.3 * thinW[i] + 0.6);
        cov[i] *= C.clamp(1 - dInW[i] / allowed, 0, 1);
      }
    }
    // floraciones (coliflores): en aguadas húmedas y grandes, el agua empuja el
    // pigmento hacia fuera: interior más claro y borde oscuro y fractal
    const bloom = new Float32Array(wn).fill(1);
    if (wet > 0.5 && hum > 0.2) {
      // floraciones: contorno de un ruido fractal umbralizado (borde de coliflor natural)
      const t = 0.66 - 0.06 * hum;
      for (let i = 0; i < wn; i++) {
        const r = wl[i];
        if (thinW[i] < 30 * ss) continue; // solo en manchas grandes
        const x = i % ww, y = (i / ww) | 0;
        const f = C.bilinear(bloomF, bgw, bgh, x / 2, y / 2);
        const d = f - t;
        const inside = C.smoothstep(0, 0.02, d);
        const edge = Math.exp(-(d * d) / 0.00012);
        const fade = C.smoothstep(4 * ss, 18 * ss, dInW[i]) * hum;
        bloom[i] = 1 + fade * (-0.24 * inside + 0.7 * edge);
      }
    }
    // anillo de pigmento: banda interior junto al borde seco
    const hardM = new Float32Array(wn);
    for (let i = 0; i < wn; i++) hardM[i] = cov[i] > 0.5 ? 1 : cov[i] * 2 * 0.5;
    const bl = Float32Array.from(hardM);
    blur(bl, ww, wh, (0.9 + 1.6 * p.detalle) * ss * 1.4 * (1 + wet), tmp);
    const rim = new Float32Array(wn);
    for (let i = 0; i < wn; i++) rim[i] = C.clamp((hardM[i] - bl[i]) * 2.6, 0, 1);
    // color de la aguada: convolución normalizada dentro de la máscara (mezcla húmeda)
    const share = new Float32Array(wn);
    for (let i = 0; i < wn; i++) {
      const r = wl[i];
      share[i] = nCover[r] > k ? LAYER_W[k] / wsum[nCover[r]] : 0;
    }
    const aR = new Float32Array(wn), aG = new Float32Array(wn), aB = new Float32Array(wn), mw = new Float32Array(wn);
    for (let i = 0; i < wn; i++) {
      const w = share[i] > 0 ? 1 : 0;
      aR[i] = absR[i] * share[i]; aG[i] = absG[i] * share[i]; aB[i] = absB[i] * share[i]; mw[i] = w;
    }
    const sR = Float32Array.from(aR), sG = Float32Array.from(aG), sB = Float32Array.from(aB); // sin mezclar
    const sm = (0.6 + 5.5 * hum * wet) * ss * 1.4;
    blur(aR, ww, wh, sm, tmp); blur(aG, ww, wh, sm, tmp); blur(aB, ww, wh, sm, tmp); blur(mw, ww, wh, sm, tmp);
    // fuera de la máscara se extiende el color de la aguada vecina (para el fleco del borde)
    const ext = Math.max(2, 3 * amp);
    const eR = Float32Array.from(aR), eG = Float32Array.from(aG), eB = Float32Array.from(aB), eW = Float32Array.from(mw);
    blur(eR, ww, wh, ext, tmp); blur(eG, ww, wh, ext, tmp); blur(eB, ww, wh, ext, tmp); blur(eW, ww, wh, ext, tmp);
    for (let i = 0; i < wn; i++) {
      if (mw[i] > 0.02 && share[i] > 0) {
        // dentro de su mancha: color propio; cerca del borde, se funde con la vecina
        const iw = 1 / mw[i];
        const bleed = Math.min(sm * 1.6, 0.35 * thinW[i] + 0.5);
        const kb = Math.exp(-dInW[i] / Math.max(0.3, bleed));
        aR[i] = sR[i] + (aR[i] * iw - sR[i]) * kb; aG[i] = sG[i] + (aG[i] * iw - sG[i]) * kb; aB[i] = sB[i] + (aB[i] * iw - sB[i]) * kb;
      } else if (mw[i] > 0.02) { const iw = 1 / mw[i]; aR[i] *= iw; aG[i] *= iw; aB[i] *= iw; }
      else if (eW[i] > 1e-4) { const iw = 1 / eW[i]; aR[i] = eR[i] * iw; aG[i] = eG[i] * iw; aB[i] = eB[i] * iw; }
      else { aR[i] = 0; aG[i] = 0; aB[i] = 0; }
    }
    layers.push({ cov, rim, aR, aG, aB, wet, bloom });
    await clock.tick(0.08 + 0.4 * (k + 1) / K);
  }

  // líneas de papel blanco entre manchas de colores muy distintos (primera aguada)
  const gap = new Float32Array(wn);
  {
    const lab = reg.lab;
    for (let y = 1; y < wh - 1; y++) for (let x = 1; x < ww - 1; x++) {
      const i = y * ww + x, r = wl[i];
      const test = (j) => {
        const q2 = wl[j];
        if (q2 === r) return 0;
        const da = lab[r * 3 + 1] - lab[q2 * 3 + 1], db = lab[r * 3 + 2] - lab[q2 * 3 + 2], dl = lab[r * 3] - lab[q2 * 3];
        return Math.sqrt(da * da + db * db) > 28 && Math.abs(dl) < 45 ? 1 : 0;
      };
      gap[i] = Math.max(test(i - 1), test(i + 1), test(i - ww), test(i + ww));
    }
    blur(gap, ww, wh, 0.7 * ss * 1.4, tmp);
    for (let i = 0; i < wn; i++) {
      const x = i % ww, y = (i / ww) | 0;
      const g = C.bilinear(nzT, gw, gh, x / 6 + 37, y / 6 + 11);
      gap[i] = C.clamp(gap[i] * 1.6, 0, 1) * C.smoothstep(0.5, 0.62, g) * (1 - p.humedad * 0.7);
    }
  }

  /* ---------- pinceladas reales en zonas con textura (pincel seco, matices) ---------- */
  const Dn = new Float32Array(N);
  await brushMarks(ctx, p, seg, Lfull, lib, Dn, rand, clock);
  // texturas de aguada reales: una por capa, a escala física (las REALISTAS primero)
  const tl = ctx.assets && ctx.assets.tiles_acuarela;
  const ltiles = [];
  for (let k = 0; k < layers.length; k++) {
    if (!tl) { ltiles.push(null); continue; }
    const tags = mode === "humeda" && k < 2 ? ["manchas", "aguada"] : k === layers.length - 1 ? ["grano", "aguada"] : ["aguada"];
    const it = Kit.pickTile(tl, rand, tags);
    ltiles.push(Kit.tileSampler(it, Kit.tileScale(it, Math.max(W, H), 0.8 + 0.6 * rand()), rand() * 6.28, rand() * 999, rand() * 999));
  }
  const tileK = 0.12 + 0.18 * p.granulado + (mode === "humeda" ? 0.08 : 0);

  /* ---------- composición a resolución completa ---------- */
  const out = new Uint8Array(N * 4);
  const selFull = ctx.selFull, data = ctx.data, comp = ctx.comp, srcA = ctx.srcAlpha;
  const granK = 0.06 + 0.75 * p.granulado;
  const rimK = 0.45 + 0.9 * p.detalle;
  const turbK = 0.2 + 0.25 * p.humedad;
  const dnK = 0.55 + 0.4 * p.intensidad;
  const cover = ctx.cover, fullCover = p.cobertura >= 0.995;
  const L0 = layers.length;
  for (let y = 0; y < H; y++) {
    let wy = (y + 0.5) / qy - 0.5; if (wy < 0) wy = 0; if (wy > wh - 1) wy = wh - 1;
    const y0 = wy | 0, y1 = y0 < wh - 1 ? y0 + 1 : y0, fy = wy - y0;
    for (let x = 0; x < W; x++) {
      let wx = (x + 0.5) / qx - 0.5; if (wx < 0) wx = 0; if (wx > ww - 1) wx = ww - 1;
      const x0 = wx | 0, x1 = x0 < ww - 1 ? x0 + 1 : x0, fx = wx - x0;
      const i00 = y0 * ww + x0, i10 = y0 * ww + x1, i01 = y1 * ww + x0, i11 = y1 * ww + x1;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const i = y * W + x;
      const gr = pap ? 0.5 + (pap.eq(x, y) - 0.5) * 0.6 + (pap.eq(x * 0.5 + 97, y * 0.5 + 31) - 0.5) * 0.7 : 0.5;
      const tu = C.bilinear(nzT, gw, gh, (x / qx) / 6, (y / qy) / 6);
      let AR = 0, AG = 0, AB = 0;
      for (let k = 0; k < L0; k++) {
        const Lk = layers[k];
        let cv = Lk.cov[i00] * w00 + Lk.cov[i10] * w10 + Lk.cov[i01] * w01 + Lk.cov[i11] * w11;
        if (k === 0) cv *= 1 - (gap[i00] * w00 + gap[i10] * w10 + gap[i01] * w01 + gap[i11] * w11);
        if (cv < 0.002) continue;
        const rm = Lk.rim[i00] * w00 + Lk.rim[i10] * w10 + Lk.rim[i01] * w01 + Lk.rim[i11] * w11;
        // densidad: anillo de borde, turbulencia y granulado (más en el anillo y en lo oscuro)
        const bl = Lk.bloom[i00] * w00 + Lk.bloom[i10] * w10 + Lk.bloom[i01] * w01 + Lk.bloom[i11] * w11;
        const dens = (1 + rimK * rm) * (1 + turbK * (tu - 0.5) * 2 * (0.6 + Lk.wet)) *
                     (1 + granK * (0.5 - gr) * (0.25 + 1.9 * rm + 0.6 * Lk.wet)) * bl *
                     (ltiles[k] ? 1 + tileK * Math.max(-2, Math.min(2, ltiles[k].l(x, y))) : 1);
        const f = cv * (dens < 0.1 ? 0.1 : dens);
        AR += f * (Lk.aR[i00] * w00 + Lk.aR[i10] * w10 + Lk.aR[i01] * w01 + Lk.aR[i11] * w11);
        AG += f * (Lk.aG[i00] * w00 + Lk.aG[i10] * w10 + Lk.aG[i01] * w01 + Lk.aG[i11] * w11);
        AB += f * (Lk.aB[i00] * w00 + Lk.aB[i10] * w10 + Lk.aB[i01] * w01 + Lk.aB[i11] * w11);
      }
      // pinceladas: aportan más pigmento del mismo color local
      const dn = Dn[i];
      if (dn > 0.002) {
        const r = Lfull[i];
        const k2 = dn * dnK * (1 + granK * 0.6 * (0.5 - gr));
        const lm = (AR + AG + AB) / 3 + 0.15;
        AR += k2 * (AR / lm * 0.35 + 0.08) * (1 - reg.mean[r * 3] * 0.6);
        AG += k2 * (AG / lm * 0.35 + 0.08) * (1 - reg.mean[r * 3 + 1] * 0.6);
        AB += k2 * (AB / lm * 0.35 + 0.08) * (1 - reg.mean[r * 3 + 2] * 0.6);
      }
      let m = fullCover ? 1 : ctx.at(cover, x, y);
      let rr = Math.exp(-AR * m), gg = Math.exp(-AG * m), bb = Math.exp(-AB * m);
      // papel blanco → transparente
      let a = Math.max(1 - rr, 1 - gg, 1 - bb);
      const o = i * 4;
      if (a < 0.004) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 0; continue; }
      const ia = 1 / a;
      rr = 1 - (1 - rr) * ia; gg = 1 - (1 - gg) * ia; bb = 1 - (1 - bb) * ia;
      if (selFull) a *= selFull[i] / 255;
      if (srcA) a *= data[i * comp + 3] / 255;
      out[o] = C.clamp(rr, 0, 1) * 255 + 0.5 | 0; out[o + 1] = C.clamp(gg, 0, 1) * 255 + 0.5 | 0; out[o + 2] = C.clamp(bb, 0, 1) * 255 + 0.5 | 0;
      out[o + 3] = C.clamp(a, 0, 1) * 255 + 0.5 | 0;
    }
    if ((y & 15) === 0) await clock.tick(0.72 + 0.28 * y / H);
  }
  return out;
}

/** Pinceladas reales solo donde hay textura (follaje, rocas, pelo...). */
async function brushMarks(ctx, p, seg, Lfull, lib, Dn, rand, clock) {
  const { W, H, s } = ctx;
  const reg = seg.reg;
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const ts = new Float32Array(2), col = new Float32Array(3);
  const fa = 1 / ctx.ax;
  const R0 = (3 + p.grosor * 18) * s;
  for (let r = 0; r < reg.n; r++) {
    const act = reg.act[r];
    if (act < 0.25 || reg.lum[r] > 0.9) continue;
    const area = reg.cnt[r] * fa * fa;
    const R = Math.min(R0 * (0.8 + 0.4 * (1 - reg.imp[r])), Math.max(1, reg.maxDist[r] * fa));
    if (R < 1.2) continue;
    const L = R * 2 * (1.4 + p.longitud * 5);
    const count = Math.min(60, (act - 0.2) * 1.4 * area / (2 * R * L));
    for (let k = 0; k < count; k++) {
      const a = seg.pixOff[r], b = seg.pixOff[r + 1];
      const pidx = seg.pix[a + ((rand() * (b - a)) | 0)];
      const x = Math.min(W - 1, (pidx % seg.aw + rand()) * fa), y = Math.min(H - 1, (((pidx / seg.aw) | 0) + rand()) * fa);
      ctx.colorAt(ctx.levelFor(R), x, y, col);
      S.traceStroke(ctx, path, x, y, {
        R, Lmax: L * (0.6 + 0.8 * rand()), step: Math.max(1, R * 0.8), curv: 0.1 + 0.85 * p.curvatura,
        colorTol: 0.4, color: col, level: ctx.levelFor(R), angle: (rand() - 0.5) * 0.3, minLen: R * 3,
      });
      if (path.len < R * 3) continue;
      const Rr = R / 0.7;
      for (let i = 0; i < path.n; i++) path.rs[i] = Rr * 0.9;
      const nt = raster.rasterize(path, 0.04);
      if (nt === 0) continue;
      const st = Lib.prepare(lib[(rand() * lib.length) | 0], path.len, Rr, rand, 0.9);
      const str = 0.45 + 0.4 * rand();
      const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
      for (let t = 0; t < nt; t++) {
        const li = tl[t], g = tg[t];
        if (Lfull[g] !== r && rand() < 0.7) continue; // las marcas se quedan casi siempre en su mancha
        Lib.sampleAt(st, U[li], V[li], ts);
        const add = ts[0] * A[li] * str;
        if (add > 0.003) Dn[g] += add * (1 - Dn[g] * 0.4);
      }
      raster.clear();
    }
    if ((r & 15) === 0) await clock.tick(0.5 + 0.2 * r / reg.n);
  }
}

module.exports = { paint };

};
__defs["xilografia.js"] = function (module, exports, require) {
/*
 * Trazo · Xilografía
 *
 * Plancha de madera tallada con gubia: el tono se hace con cortes paralelos
 * cuyo ancho sigue la oscuridad. En las sombras quedan cortes blancos en punta
 * sobre la masa negra (talla blanca); en las luces, líneas negras finas.
 * Cada zona tiene su dirección de corte (facetas). Después, la estampación:
 * presión desigual, moteado de tinta, veta de la madera, bordes mellados,
 * restos de madera en los blancos y el grano del papel.
 * Variantes: realista, expresiva, dos tintas y tres tintas (planchas de color
 * desregistradas bajo la plancha negra).
 */
const C = require("./core.js");
const Seg = require("./segment.js");
const K = require("./kit.js");

async function paint(ctx, p, seg, Lfull, clock) {
  const { W, H, N, s, aw, ah } = ctx;
  const reg = seg.reg;
  const mode = p.modo;
  const rand = C.mulberry32(ctx.seed * 19 + 5);
  const color = mode === "dos" || mode === "tres";
  const expr = mode === "expresiva";
  const A = ctx.assets || {};

  /* ---------- tono (oscuridad) por píxel de análisis ---------- */
  const n = aw * ah;
  const T = new Float32Array(n);
  const bl = Float32Array.from(ctx.lum);
  C.gaussBlur(bl, aw, ah, Math.max(2, 14 * s / ctx.fa));
  for (let i = 0; i < n; i++) {
    let t = 1 - ctx.lum[i];
    t += (t - (1 - bl[i])) * 0.9;                     // contraste local
    t = C.smoothstep(0.08 + 0.1 * (1 - p.cobertura), 0.88, t);
    T[i] = t;
  }
  // expresiva: tono plano por faceta, en 4 niveles
  const levels = [0, 0.32, 0.62, 1];
  const regT = new Float32Array(reg.n), regA = new Float32Array(reg.n), regO = new Float32Array(reg.n);
  {
    const sum = new Float32Array(reg.n), cnt = new Float32Array(reg.n);
    for (let i = 0; i < n; i++) { sum[seg.labels[i]] += T[i]; cnt[seg.labels[i]]++; }
    for (let r = 0; r < reg.n; r++) {
      let t = sum[r] / Math.max(1, cnt[r]);
      if (expr) { let best = 0; for (let k = 1; k < 4; k++) if (Math.abs(levels[k] - t) < Math.abs(levels[best] - t)) best = k; t = levels[best]; }
      regT[r] = t;
      // dirección del corte: sigue la forma si la zona tiene dirección; si no, horizontal de taller
      let th = 0.5 * Math.atan2(reg.os[r], reg.oc[r]);
      if (reg.coh[r] < 0.35) th = (rand() - 0.5) * 0.25;
      const q = (Math.PI / 12) * (1 - p.curvatura) * 2;   // poca curvatura → ángulos de taller
      if (q > 0.02) th = Math.round(th / q) * q;
      regA[r] = th;
      regO[r] = rand();
    }
  }
  await clock.tick(0.1);

  /* ---------- planchas de color (dos / tres tintas) ---------- */
  let inks = [], regInk = null;
  if (color) {
    const nInk = mode === "dos" ? 1 : 2;
    const pal = K.palette(ctx, 5, ctx.seed, { skip: (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) < 0.12 || (r + g + b) / 3 > 0.9 || (r + g + b) / 3 < 0.15 });
    const cands = [];
    for (let k = 0; k < pal.K; k++) {
      const r = pal.r[k], g = pal.g[k], b = pal.b[k];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      cands.push({ r, g, b, sat: mx - mn, l: 0.299 * r + 0.587 * g + 0.114 * b });
    }
    cands.sort((a, b) => b.sat - a.sat);
    for (const c of cands) {
      if (inks.length >= nInk) break;
      if (inks.some((i) => Math.abs(i.r - c.r) + Math.abs(i.g - c.g) + Math.abs(i.b - c.b) < 0.35)) continue;
      // tinta de imprenta: color plano, saturado y claro
      const y = c.l, k2 = 1.5;
      inks.push({ r: C.clamp(y + (c.r - y) * k2 + 0.12, 0, 1), g: C.clamp(y + (c.g - y) * k2 + 0.12, 0, 1), b: C.clamp(y + (c.b - y) * k2 + 0.12, 0, 1) });
    }
    if (!inks.length) inks.push({ r: 0.86, g: 0.33, b: 0.2 });
    if (inks.length < nInk) inks.push({ r: 0.96, g: 0.78, b: 0.25 });
    // cada zona: papel, o la tinta más parecida a su color
    regInk = new Int8Array(reg.n).fill(-1);
    for (let r = 0; r < reg.n; r++) {
      const mr = reg.mean[r * 3], mg = reg.mean[r * 3 + 1], mb = reg.mean[r * 3 + 2];
      const l = reg.lum[r];
      if (l > 0.86) continue;
      let best = 0, bd = 1e9;
      for (let k = 0; k < inks.length; k++) {
        const ik = inks[k];
        const d = Math.abs(ik.r - mr) + Math.abs(ik.g - mg) + Math.abs(ik.b - mb);
        if (d < bd) { bd = d; best = k; }
      }
      const sat = Math.max(mr, mg, mb) - Math.min(mr, mg, mb);
      if (sat < 0.06 && l > 0.6) continue;
      regInk[r] = best;
    }
  }

  /* ---------- ruido de estampación y madera ---------- */
  const gw = Math.max(8, Math.ceil(W / 24)), gh = Math.max(8, Math.ceil(H / 24));
  const press = C.fbmGrid(gw, gh, Math.max(3, gw / 5), 3, ctx.seed + 901, 0.55);   // presión desigual
  const wob = C.fbmGrid(gw, gh, Math.max(2, gw / 12), 3, ctx.seed + 902, 0.5);     // pulso de la mano
  const mad = A.ov_madera && A.ov_madera.items.length ? K.overlaySampler(A.ov_madera.items[(rand() * A.ov_madera.items.length) | 0], W, H, { zoom: 0.8 }) : null;
  const imp = A.ov_impresion && A.ov_impresion.items.length ? K.overlaySampler(A.ov_impresion.items[(rand() * A.ov_impresion.items.length) | 0], W, H) : null;
  const madM = mad ? 0.28 : 0;

  const P = Math.max(2.2, (2.4 + 8 * p.grosor) * s * (expr ? 1.5 : 1));           // separación de cortes
  const Lc = Math.max(6, (14 + 90 * p.longitud) * s);                               // largo de cada corte
  const gran = 0.35 + 0.9 * p.granulado;
  const inkStr = 0.82 + 0.18 * p.intensidad;
  const keyShift = color ? 0.42 : 0;                                                 // con color, el negro solo en sombras

  /* ---------- plancha negra: máscara de tinta ---------- */
  const ink = new Float32Array(N);
  const cut = new Float32Array(reg.n * 4);
  for (let r = 0; r < reg.n; r++) { const a = regA[r]; cut[r * 4] = -Math.sin(a); cut[r * 4 + 1] = Math.cos(a); cut[r * 4 + 2] = Math.cos(a); cut[r * 4 + 3] = Math.sin(a); }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const r = Lfull[i];
      let t = expr ? regT[r] * 0.75 + ctx.at(T, x, y) * 0.25 : ctx.at(T, x, y);
      if (keyShift) t = C.smoothstep(keyShift, 1, t);
      // posición sobre el corte
      const nx = cut[r * 4], ny = cut[r * 4 + 1], tx = cut[r * 4 + 2], ty = cut[r * 4 + 3];
      const w1 = (C.bilinear(wob, gw, gh, x / 24, y / 24) - 0.5) * 0.9;
      const ph = (x * nx + y * ny) / P + regO[r] * 7 + w1;
      const si = Math.floor(ph), f = ph - si;
      const along = (x * tx + y * ty) / Lc + C.hash2(si, r, 3) * 3;
      const u = along - Math.floor(along);
      const env = Math.sqrt(Math.max(0, Math.sin(u * Math.PI)));                      // corte en punta (gubia en V)
      // ancho de la tinta: oscuridad, con los cortes blancos afinándose en los extremos
      let b = t;
      if (b > 0.5) b = 1 - (1 - b) * env * (0.75 + 0.5 * C.hash2(si, r, 7));          // cortes blancos en punta
      else b = b * (0.55 + 0.45 * env);                                                 // líneas negras que se afinan
      const half = b * P * 0.5;
      const dist = Math.abs(f - 0.5) * P;
      const rough = (C.hash2(x >> 1, y >> 1, 11) - 0.5) * 0.9 * Math.min(1.5, P * 0.12);   // borde mellado
      let a = C.clamp((half - dist + rough) / 0.9 + 0.5, 0, 1);
      // masas oscuras: casi plenas, con algún corte blanco suelto (fondo tallado)
      if (t > 0.9) { const keep = C.hash2(si, r, 41) < 0.35 + 0.4 * reg.imp[r]; if (!keep) a = 1; }
      else if (t < 0.04) a = 0;
      ink[i] = a;
    }
    if ((y & 31) === 0) await clock.tick(0.12 + 0.4 * y / H);
  }

  // contornos: la madera que se deja alrededor de las formas en las zonas claras
  if (p.detalle > 0.05) {
    const thr = 0.5 - 0.3 * p.detalle;
    const cw = Math.max(0.7, (0.6 + 1.6 * p.grosor) * s * (expr ? 1.6 : 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const e = ctx.at(ctx.edgeRaw, x, y);
      if (e < thr) continue;
      const i = y * W + x;
      const k = C.smoothstep(thr, thr + 0.25, e) * C.clamp(cw * 0.6, 0.4, 1);
      ink[i] = Math.max(ink[i], k);
    }
  }
  // marco irregular de la plancha (expresiva)
  if (expr) {
    const bw = Math.max(3, 0.012 * Math.max(W, H));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (d > bw * 1.6) continue;
      const jag = bw * (1 + 0.35 * (C.bilinear(wob, gw, gh, x / 24 + 50, y / 24) - 0.5) * 2) + (C.hash2(x, y, 5) - 0.5) * 1.2;
      if (d < jag) ink[y * W + x] = 1;
    }
  }
  await clock.tick(0.6);

  /* ---------- interior de las masas (para el moteado) y blancos grandes (restos) ---------- */
  const inter = Float32Array.from(ink);
  {
    const tmp = new Float32Array(N);
    const rb = Math.max(2, Math.round(P * 1.2));
    C.boxBlurH(inter, tmp, W, H, rb); C.boxBlurV(tmp, inter, W, H, rb);
  }

  /* ---------- estampación: transmitancia por canal ---------- */
  const Tr = new Float32Array(N).fill(1), Tg = new Float32Array(N).fill(1), Tb = new Float32Array(N).fill(1);
  if (color) {
    const dx = Math.round((2 + 3 * rand()) * s), dy = Math.round((1 + 3 * rand()) * s);
    for (let k = 0; k < inks.length; k++) {
      const ik = inks[k];
      const ox = k === 0 ? dx : -dy, oy = k === 0 ? dy : dx;
      for (let y = 0; y < H; y++) {
        const sy = C.clamp(y - oy, 0, H - 1);
        for (let x = 0; x < W; x++) {
          const sx = C.clamp(x - ox, 0, W - 1);
          const r = Lfull[sy * W + sx];
          if (regInk[r] !== k) continue;
          const i = y * W + x;
          let a = 0.95 * inkStr * (0.92 + 0.16 * (C.bilinear(press, gw, gh, x / 24 + k * 13, y / 24) - 0.5));
          if (mad) { const gv = mad(x, y); a *= 1 - madM * 0.8 * C.smoothstep(0.7, 0.95, gv); }
          if (imp) a *= 1 - gran * 0.4 * C.smoothstep(0.25, 0.05, imp(x * 1.3, y * 1.3));
          a *= 1 - gran * 0.25 * C.smoothstep(0.8, 1, C.hash2(x, y, 31 + k));
          Tr[i] *= 1 - a * (1 - ik.r); Tg[i] *= 1 - a * (1 - ik.g); Tb[i] *= 1 - a * (1 - ik.b);
        }
        if ((y & 63) === 0) await clock.tick(0.6 + 0.1 * (k + y / H) / inks.length);
      }
    }
  }
  const kr = 0.07, kg = 0.065, kb = 0.07;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let a = ink[i];
      const it = inter[i];
      // presión desigual: negros algo grisáceos en zonas
      let pr = Math.min(1, inkStr * (0.97 + 0.1 * (C.bilinear(press, gw, gh, x / 24, y / 24) - 0.5)));
      if (a > 0.01) {
        // moteado: poros sin tinta, más en el centro de las masas grandes
        const deep = C.smoothstep(0.75, 0.98, it);
        let speck = C.smoothstep(0.975 - 0.02 * gran, 0.995, C.hash2(x >> 1, y >> 1, 17));
        if (imp) speck = Math.max(speck, C.smoothstep(0.18, 0.04, imp(x, y)) * 0.8);
        pr *= 1 - gran * deep * speck * 0.9;
        // veta de la madera en las masas
        if (mad) pr *= 1 - madM * gran * deep * C.smoothstep(0.78, 0.97, mad(x, y));
        a *= pr;
      } else if (it < 0.04) {
        // restos de madera en los vaciados grandes, alineados con el corte
        if (mad) {
          const gv = mad(x * 0.7 + 40, y * 0.7);
          const chat = C.smoothstep(0.86, 0.95, gv) * C.smoothstep(0.04, 0.0, it) * 0.85 * (0.4 + 0.6 * p.granulado);
          if (chat > 0.02 && C.hash2(x >> 3, y >> 3, 23) > 0.55) a = chat * 0.8;
        }
      }
      if (a <= 0.003) continue;
      Tr[i] *= 1 - a * (1 - kr); Tg[i] *= 1 - a * (1 - kg); Tb[i] *= 1 - a * (1 - kb);
    }
    if ((y & 31) === 0) await clock.tick(0.72 + 0.26 * y / H);
  }
  const out = K.transToRGBA(Tr, Tg, Tb);
  if (ctx.selFull) for (let i = 0; i < N; i++) out[i * 4 + 3] = out[i * 4 + 3] * ctx.selFull[i] / 255;
  return out;
}

module.exports = { paint };

};
const Engine = __req("index.js");
if (typeof module !== "undefined" && module.exports) module.exports = Engine;
root.TrazoEngine = Engine;
})(typeof window !== "undefined" ? window : globalThis);
