/*! Trazo 1.0.0 · motor de pintura (generado por tools/bundle.js, no editar) */
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
 *   const Engine = require("./engine/index.js");
 *   const res = await Engine.render(
 *     { width, height, data: Uint8Array, components: 3|4 },
 *     { technique: "oleo", params: {...0..100}, seed: 1,
 *       selection: { mask: Uint8Array, mode: "solo"|"detalle" } | null,
 *       paper: true },
 *     { onProgress(f, texto), shouldCancel(), sliceMs }
 *   );
 *   // res = { paint: Uint8Array RGBA, paper: Uint8Array RGBA | null, width, height }
 */
const C = require("./core.js");
const { Context } = require("./analysis.js");
const T = require("./techniques.js");
const Painter = require("./painter.js");
const Pencil = require("./pencil.js");
const Water = require("./watercolor.js");
const Paper = require("./paper.js");

function flowOptions(tech, p) {
  switch (tech) {
    case "lapiz":    return { flowSigma: 8 + p.grosor * 8, baseAngle: -Math.PI / 4, wander: 0.2, bias: 0.15, localBias: 0.35 };
    case "ceras":    return { flowSigma: 5 + p.grosor * 8, baseAngle: -0.55, wander: 0.5, bias: 0.1, localBias: 0.2 };
    case "acuarela": return { flowSigma: 6 + p.grosor * 14, baseAngle: 0, wander: 0.6, bias: 0.1, localBias: 0.1 };
    case "gouache":  return { flowSigma: 4 + p.grosor * 16, baseAngle: 0, wander: 0.55, bias: 0.08, localBias: 0.08 };
    default:         return { flowSigma: 3 + p.grosor * 15, baseAngle: 0, wander: 0.5, bias: 0.08, localBias: 0.06 };
  }
}

async function render(input, opts, hooks) {
  const tech = T.BY_ID[opts.technique] ? opts.technique : "oleo";
  const p = T.normalized(tech, opts.params);
  const clock = C.makeClock(hooks);
  const seed = (opts.seed | 0) || 1;
  const ctx = new Context(input, { seed });

  clock.stage(0, 0.06, "Analizando la imagen");
  await ctx.buildBase(clock);
  clock.stage(0.06, 0.14, "Calculando la dirección de los trazos");
  await ctx.buildFlow(flowOptions(tech, p), clock);
  ctx.setSelection(opts.selection);
  ctx.buildCoverage(p.cobertura, { lumWeight: tech === "acuarela" ? 0.7 : tech === "lapiz" ? 0.4 : 0.55 });

  let paint;
  if (tech === "lapiz") {
    clock.stage(0.14, opts.paper ? 0.9 : 0.98, "Dibujando");
    paint = await Pencil.paint(ctx, p, clock);
  } else if (tech === "acuarela") {
    clock.stage(0.14, opts.paper ? 0.9 : 0.98, "Pintando acuarela");
    paint = await Water.paint(ctx, p, clock);
  } else {
    clock.stage(0.14, 0.8, "Pintando");
    const planes = await Painter.paint(ctx, tech, p, clock);
    clock.stage(0.8, opts.paper ? 0.9 : 0.98, "Acabado");
    paint = await Painter.finish(ctx, tech, p, planes, clock);
  }

  let paper = null;
  if (opts.paper) {
    clock.stage(0.9, 0.98, "Preparando el papel");
    paper = await Paper.makePaper(tech, ctx.W, ctx.H, seed, clock);
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

module.exports = { render, flatten, Techniques: T, CancelError: C.CancelError };

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
    };
  }
  if (kind === "gouache") {
    const R0 = (1.8 + p.grosor * 17) * s;
    return {
      R0, layers: 1 + Math.round(p.detalle * 3), ratio: 0.5, minR: 0.8,
      Lk: 2 * (1.0 + p.longitud * 5.5), spacing: 1.0, soft: 0.1,
      opacity: 0.8 + 0.2 * p.intensidad, streak: 0.12, wet: 0.06,
      dry: 0.6 + 0.3 * p.intensidad, thick: p.empaste * 0.45, sat: 1.04,
      tol: 0.36 - 0.2 * p.detalle, refineT: 0.12 - 0.08 * p.detalle,
      needCov: 0.85, gloss: 0.0, shade: 0.7, palette: 0.5, canvasTex: 0.35, under: 1.0,
    };
  }
  // ceras
  const R0 = (1.0 + p.grosor * 6.5) * s;
  return {
    R0, layers: 2 + Math.round(p.detalle * 1.4), ratio: 0.72, minR: 0.6,
    Lk: 2 * (2.5 + p.longitud * 12), spacing: 1.9, soft: 0.35,
    opacity: 0.92, pressure: 0.3 + 0.62 * p.intensidad, streak: 0.12, wet: 0.0,
    dry: 0.7, thick: p.empaste * 0.6, sat: 1.22,
    tol: 0.5 - 0.22 * p.detalle, refineT: 0.18 - 0.1 * p.detalle,
    needCov: 0.8, gloss: 0.12, shade: 0.6, canvasTex: 0.0, under: 0,
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
        colorTol: tolK, color: tmpc, level, angle: angle + (kind === "ceras" ? (rand() - 0.5) * 0.25 : 0),
        minLen: Rk * (kind === "ceras" ? 3 : 1.2), fine: k >= 2 && Rk < 6 * s,
      });
      if (kind === "ceras") S.wobblePath(path, Rk * (0.3 + 0.9 * p.curvatura), Rk * (10 + rand() * 12), rand() * 6.28);

      // perfil de anchura
      const n = path.n, len = path.len || 1;
      const rs = path.rs;
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
  return { Pr, Pg, Pb, Cv, Hh, cfg, grain, gsInv };
}

/**
 * Sombreado final (relieve del empaste, brillo, textura de soporte) y salida RGBA.
 */
async function finish(ctx, kind, p, planes, clock) {
  const { W, H, N, s } = ctx;
  const { Pr, Pg, Pb, Cv, Hh, cfg, grain } = planes;
  const out = new Uint8Array(N * 4);
  let weave = null, wInv = 1;
  if (Hh && cfg.canvasTex > 0) {
    weave = C.makeGrainTile(ctx.seed + 9, kind === "oleo" ? "canvas" : "paper");
    wInv = 1 / Math.max(1, Math.sqrt(s) * (kind === "oleo" ? 1.0 : 1.6));
  }
  if (Hh) {
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
  const relief = (0.12 + 0.95 * p.empaste) * cfg.shade * Math.max(0.6, Math.sqrt(s));
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
        if (gloss > 0) {
          const rv = 2 * ndl * nz - lz;
          if (rv > 0.6) {
            let sp = (rv - 0.6) / 0.4; sp = sp * sp; sp = sp * sp; sp = sp * sp;
            const add = sp * gloss;
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
};

async function makePaper(technique, W, H, seed, clock) {
  const cfg = BASE[technique] || BASE.lapiz;
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

async function paint(ctx, p, clock) {
  const { W, H, N, s, aw, ah } = ctx;
  const colorMode = !!p.color;
  const rand = C.mulberry32(ctx.seed * 13 + 3);

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
    t = Math.pow(t, 1.45) * 0.85;
    t = Math.max(0, (t - lift) / (1 - lift));
    tone[i] = t * ctx.cover[i];
  }
  ctx.tone = tone;

  const D = new Float32Array(N); // oscuridad acumulada
  let Tr = null, Tg = null, Tb = null;
  if (colorMode) { Tr = new Float32Array(N).fill(1); Tg = new Float32Array(N).fill(1); Tb = new Float32Array(N).fill(1); }

  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const grain = C.makeGrainTile(ctx.seed + 3, "fine");
  const gsInv = 1 / Math.max(1, Math.sqrt(s) * 0.8);
  const col = new Float32Array(3), tmpc = new Float32Array(3);

  const R = (0.35 + p.grosor * 2.4) * s;
  const L = (10 + p.longitud * 80) * s;
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

  async function hatchPass(j, isContour) {
    const Rj = isContour ? R * 0.85 : R * (j === 0 ? 1 : 0.92);
    const sp = isContour ? Math.max(1, R * 3.2) : Math.max(1.0, R * 2.6 + 0.4 * s, L * 0.12);
    const cols = Math.ceil(W / sp), rows = Math.ceil(H / sp);
    const edgeThr = 0.42 - 0.3 * p.detalle;
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
        curv: isContour ? 0.95 : (j === 0 ? 0.05 + 0.9 * p.curvatura : 0.05 + 0.45 * p.curvatura),
        colorTol: isContour ? 0.45 : 0.55 - 0.25 * p.detalle, color: tmpc, level,
        angle: isContour ? 0 : angles[j] + (rand() - 0.5) * 0.12,
        minLen: Rj * 6, fine: isContour,
      });
      if (!isContour) S.wobblePath(path, Rj * 0.6, Rj * 40, rand() * 6.28);
      const nP = path.n, len = path.len || 1;
      for (let i = 0; i < nP; i++) {
        const u = path.ss[i] / len;
        path.rs[i] = Rj * (0.35 + 0.65 * Math.sqrt(Math.sin(Math.max(0.0001, u) * Math.PI)));
      }
      const nt = raster.rasterize(path, 0.4);
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
      const A = raster.A, tl = raster.tl, tg = raster.tg;
      for (let tt = 0; tt < nt; tt++) {
        const li = tl[tt], g = tg[tt];
        const xx = g % W, yy = (g / W) | 0;
        const gr = C.tileAt(grain, xx * gsInv, yy * gsInv);
        const dep = 0.22 + 0.78 * C.smoothstep(lo, hi, gr);
        const a = A[li] * dep * pr;
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

  for (let j = 0; j < nPass; j++) await hatchPass(j, false);
  if (p.detalle > 0.02) await hatchPass(nPass, true);

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
 * Trazo · definición de técnicas, parámetros y presets.
 * La interfaz y el motor leen de aquí: un único sitio para ajustar valores.
 */

const PARAMS = {
  intensidad: { label: "Intensidad del trazo", hint: "Presión y opacidad de cada trazo" },
  grosor:     { label: "Grosor del trazo", hint: "Ancho del pincel o de la punta" },
  longitud:   { label: "Longitud del trazo", hint: "Lo largo que es cada pincelada" },
  curvatura:  { label: "Curvatura del trazo", hint: "0 = rectos · 100 = siguen las formas" },
  cobertura:  { label: "Cobertura del blanco", hint: "Cuánto lienzo queda cubierto. Lo no cubierto será transparente" },
  empaste:    { label: "Empaste", hint: "Grosor de la pintura: relieve y brillo" },
  humedad:    { label: "Humedad", hint: "Cuánto se corre y se funde el color" },
  granulado:  { label: "Granulado", hint: "Pigmento que se asienta en el grano del papel" },
  cruzado:    { label: "Sombreado cruzado", hint: "Capas de rayado en distintas direcciones" },
  varTono:    { label: "Variación de tono", hint: "Cambio de matiz entre trazos" },
  varSat:     { label: "Variación de saturación", hint: "Cambio de intensidad de color entre trazos" },
  varLuz:     { label: "Variación de luz", hint: "Cambio de claridad entre trazos" },
  detalle:    { label: "Detalle", hint: "Trazos finos en bordes y zonas importantes" },
};

const TECHNIQUES = [
  {
    id: "lapiz",
    name: "Lápiz",
    desc: "Grafito con rayado que sigue las formas",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "cruzado", "detalle"],
    colorParams: ["varTono", "varSat"],
    toggles: [{ key: "color", label: "Lápiz de color", def: false }],
    defaults: { intensidad: 65, grosor: 22, longitud: 50, curvatura: 55, cobertura: 85, cruzado: 55, detalle: 60, varTono: 15, varSat: 20, color: false },
    presets: [
      { name: "Boceto suelto", values: { intensidad: 55, grosor: 28, longitud: 75, curvatura: 40, cobertura: 70, cruzado: 25, detalle: 40 } },
      { name: "Sombreado fino", values: { intensidad: 60, grosor: 14, longitud: 45, curvatura: 60, cobertura: 90, cruzado: 80, detalle: 75 } },
      { name: "Grafito intenso", values: { intensidad: 90, grosor: 32, longitud: 55, curvatura: 55, cobertura: 95, cruzado: 60, detalle: 65 } },
    ],
  },
  {
    id: "oleo",
    name: "Óleo",
    desc: "Pinceladas cargadas con relieve y brillo",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "varTono", "varSat", "varLuz", "detalle"],
    defaults: { intensidad: 85, grosor: 45, longitud: 40, curvatura: 60, cobertura: 100, empaste: 55, varTono: 25, varSat: 30, varLuz: 25, detalle: 55 },
    presets: [
      { name: "Impresionista", values: { grosor: 35, longitud: 22, curvatura: 45, empaste: 60, varTono: 50, varSat: 45, varLuz: 35, detalle: 45 } },
      { name: "Empaste grueso", values: { grosor: 62, longitud: 35, curvatura: 55, empaste: 92, varTono: 25, varSat: 25, varLuz: 25, detalle: 40 } },
      { name: "Detallado", values: { grosor: 30, longitud: 45, curvatura: 70, empaste: 35, varTono: 15, varSat: 20, varLuz: 15, detalle: 88 } },
    ],
  },
  {
    id: "gouache",
    name: "Gouache",
    desc: "Color opaco y mate, zonas planas",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "varTono", "varSat", "varLuz", "detalle"],
    defaults: { intensidad: 90, grosor: 50, longitud: 30, curvatura: 45, cobertura: 95, empaste: 20, varTono: 15, varSat: 15, varLuz: 20, detalle: 45 },
    presets: [
      { name: "Ilustración plana", values: { grosor: 45, longitud: 25, empaste: 8, varTono: 5, varSat: 5, varLuz: 8, detalle: 55 } },
      { name: "Pincel seco", values: { intensidad: 70, grosor: 40, longitud: 45, cobertura: 80, empaste: 30, detalle: 50 } },
      { name: "Manchas grandes", values: { grosor: 75, longitud: 20, curvatura: 30, detalle: 25, varLuz: 30 } },
    ],
  },
  {
    id: "ceras",
    name: "Ceras",
    desc: "Trazo graso con el grano del papel",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "varTono", "varSat", "varLuz", "detalle"],
    defaults: { intensidad: 70, grosor: 35, longitud: 45, curvatura: 55, cobertura: 90, empaste: 30, varTono: 30, varSat: 25, varLuz: 25, detalle: 50 },
    presets: [
      { name: "Infantil", values: { intensidad: 75, grosor: 55, longitud: 55, curvatura: 75, varSat: 40, varTono: 40, detalle: 35 } },
      { name: "Pastel suave", values: { intensidad: 50, grosor: 45, longitud: 35, empaste: 10, cobertura: 85, detalle: 45 } },
      { name: "Trazo denso", values: { intensidad: 92, grosor: 30, longitud: 40, cobertura: 100, empaste: 45, detalle: 65 } },
    ],
  },
  {
    id: "acuarela",
    name: "Acuarela",
    desc: "Manchas transparentes con bordes de pigmento",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "humedad", "granulado", "varTono", "varSat", "varLuz", "detalle"],
    defaults: { intensidad: 70, grosor: 45, longitud: 40, curvatura: 50, cobertura: 85, humedad: 50, granulado: 45, varTono: 25, varSat: 20, varLuz: 20, detalle: 45 },
    presets: [
      { name: "Húmedo sobre húmedo", values: { humedad: 88, granulado: 30, grosor: 55, detalle: 35 } },
      { name: "Seco y definido", values: { humedad: 15, granulado: 55, grosor: 35, detalle: 75 } },
      { name: "Manchas sueltas", values: { cobertura: 55, grosor: 65, humedad: 60, detalle: 25 } },
    ],
  },
];

const BY_ID = {};
for (const t of TECHNIQUES) BY_ID[t.id] = t;

function defaultsFor(id) {
  const t = BY_ID[id];
  return Object.assign({}, t.defaults);
}

/** Normaliza parámetros 0..100 → 0..1 rellenando los que falten. */
function normalized(id, params) {
  const t = BY_ID[id];
  const p = Object.assign({}, t.defaults, params || {});
  const out = {};
  for (const k of Object.keys(PARAMS)) {
    const v = p[k] === undefined ? 50 : +p[k];
    out[k] = Math.max(0, Math.min(100, isFinite(v) ? v : 50)) / 100;
  }
  out.color = !!p.color;
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
  if (p.longitud > 0.01) {
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
      const gr = C.tileAt(grain, x * gsInv, y * gsInv);
      const lumv = 0.299 * r + 0.587 * g + 0.114 * b;
      // densidad de pigmento
      let d = (1 + edgeDark * e * e * 1.2) *
              (1 + turbK * (tu - 0.5) * 2) *
              (1 + granK * (gr - 0.5) * (0.4 + (1 - lumv))) *
              (1 + brushK * (Dn[i] - 0.2)) *
              (1 + 1.1 * 4 * m * (1 - m) * (m < 0.98 ? 1 : 0)); // borde de la mancha al reservar blancos
      const k = d - 1;
      r = r - (r - r * r) * k; g = g - (g - g * g) * k; b = b - (b - b * b) * k;
      // intensidad del pigmento y reserva del papel
      const pm = pig * m;
      r = 1 - (1 - r) * pm; g = 1 - (1 - g) * pm; b = 1 - (1 - b) * pm;
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

module.exports = { paint, kuwahara };

};
const Engine = __req("index.js");
if (typeof module !== "undefined" && module.exports) module.exports = Engine;
root.TrazoEngine = Engine;
})(typeof window !== "undefined" ? window : globalThis);
