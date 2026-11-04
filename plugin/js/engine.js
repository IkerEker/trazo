/*! Trazo 1.7.0 · motor de pintura (generado por tools/bundle.js, no editar) */
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

    // direcciones heredadas: en las zonas planas manda la estructura que las rodea
    // (tensor muy suavizado), no una dirección inventada
    let Lxx = null, Lxy = null, Lyy = null, lowT = 0, highT = 0;
    if (opts.propagate) {
      Lxx = Float32Array.from(jxx); Lxy = Float32Array.from(jxy); Lyy = Float32Array.from(jyy);
      const sigL = sig * 4;
      C.gaussBlur(Lxx, aw, ah, sigL, tmp); C.gaussBlur(Lxy, aw, ah, sigL, tmp); C.gaussBlur(Lyy, aw, ah, sigL, tmp);
      C.gaussBlur(Lxx, aw, ah, sigL, tmp); C.gaussBlur(Lxy, aw, ah, sigL, tmp); C.gaussBlur(Lyy, aw, ah, sigL, tmp);
      lowT = 0.01 * mean; highT = 0.12 * mean;
    }
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
        let Jxx, Jxy, Jyy;
        if (Lxx) {
          // la dirección de fondo sale de la estructura cercana; solo si no hay ninguna, de la mano
          const tl = Lxx[i] + Lyy[i];
          const cL = C.smoothstep(lowT, highT, tl), iL = tl > 1e-12 ? cL / tl : 0;
          const bx = (Lxx[i] * iL + gxx * gxx * (1 - cL)), bxy = (Lxy[i] * iL + gxx * gyy * (1 - cL)), by = (Lyy[i] * iL + gyy * gyy * (1 - cL));
          Jxx = jxx[i] + e * bx; Jxy = jxy[i] + e * bxy; Jyy = jyy[i] + e * by;
        } else {
          Jxx = jxx[i] + e * gxx * gxx; Jxy = jxy[i] + e * gxx * gyy; Jyy = jyy[i] + e * gyy * gyy;
        }
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
const Painter3 = require("./painter3.js");
const Water2 = require("./watercolor2.js");
const Xilo = require("./xilografia.js");
const Mixta = require("./mixta.js");
const K = require("./kit.js");

const SUPPORT_FOR = {
  oleo: "lienzo", gouache: "acuarela", acuarela: "acuarela", lapiz: "dibujo", ceras: "dibujo",
  mixtalg: "dibujo", xilografia: "dibujo",
};
const ASSETS_FOR = {
  oleo: ["pin_oleo", "pin_gouache", "manchas", "tiles_pintura"],
  gouache: ["pin_gouache", "manchas", "tiles_pintura"],
  acuarela: ["pin_acuarela", "tiles_acuarela", "pin_lapiz", "ov_goteos"],
  lapiz: ["pin_lapiz", "pin_cera", "ov_grafito", "ov_carbon"],
  ceras: ["pin_barra", "pin_manley", "pin_pastel"],
  mixtalg: ["pin_lapiz", "pin_gouache", "manchas"],
  xilografia: ["ov_madera", "ov_impresion"],
};
// cómo se marca el papel en lo velado
const TOOTH = {
  oleo: ["lienzo", 0.55], gouache: ["lienzo", 0.4], acuarela: ["valles", 0.55], lapiz: ["picos", 0.8],
  ceras: ["picos", 0.45], mixtalg: ["picos", 0.5], xilografia: ["picos", 0.55],
};
const DETAIL = { oleo: [0.25, 0.7], gouache: [0.25, 0.7], acuarela: [0.3, 0.6], lapiz: [0.3, 0.6], ceras: [0.25, 0.65], mixtalg: [0.2, 0.55], xilografia: [0.3, 0.6] };

function flowOptions(tech, p) {
  switch (tech) {
    case "lapiz": case "mixtalg": return { flowSigma: 8 + p.grosor * 8, baseAngle: -Math.PI / 4, wander: 0.2, bias: 0.15, localBias: 0.35 };
    case "acuarela": return { flowSigma: 6 + p.grosor * 14, baseAngle: 0, wander: 0.6, bias: 0.1, localBias: 0.1 };
    case "ceras": return { flowSigma: 6 + p.grosor * 12, baseAngle: -Math.PI / 4, wander: 0.15, bias: 0.1, localBias: 0.12, propagate: true };
    case "xilografia": return { flowSigma: 6 + p.grosor * 10, baseAngle: 0, wander: 0.3, bias: 0.1, localBias: 0.15 };
    case "gouache": return { flowSigma: 4 + p.grosor * 14, baseAngle: 0, wander: 0.15, bias: 0.1, localBias: 0.08, propagate: true };
    default: return { flowSigma: 3 + p.grosor * 13, baseAngle: 0, wander: 0.15, bias: 0.1, localBias: 0.06, propagate: true };
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
  const mainLib = { oleo: ["pin_gouache", "pin_oleo"], gouache: ["pin_gouache"], acuarela: ["pin_acuarela"], lapiz: ["pin_lapiz"], ceras: ["pin_manley"], mixtalg: ["pin_gouache"], xilografia: [] }[tech];
  ctx.lib = strokesOf(assets, mainLib) || (opts.library && opts.library.kind === "strokes" ? opts.library : null);

  clock.stage(0, 0.05, "Analizando la imagen");
  await ctx.buildBase(clock);
  clock.stage(0.05, 0.11, "Calculando la dirección de los trazos");
  await ctx.buildFlow(flowOptions(tech, p), clock);
  ctx.setSelection(opts.selection);
  ctx.buildCoverage(p.cobertura, { lumWeight: tech === "acuarela" ? 0.7 : tech === "lapiz" || tech === "ceras" ? 0.45 : 0.55 });

  const [d0, d1] = DETAIL[tech];
  let detail = tech === "xilografia" && p.modo === "expresiva" ? 0.12 + 0.3 * p.detalle : d0 + d1 * p.detalle;
  // realismo: más alto = la imagen se divide en más manchas (más parecido a la foto)
  detail = Math.max(0.05, Math.min(1.15, detail * (0.5 + p.realismo)));
  clock.stage(0.11, 0.2, "Viendo la imagen en manchas");
  const seg = await Seg.segment(ctx, { detail }, clock);
  // etiquetas a resolución completa (el pintor por capas no las necesita)
  const Lfull = tech === "oleo" || tech === "gouache" || tech === "ceras" ? null : (clock.stage(0.2, 0.25, "Ajustando los bordes"), await Seg.fullLabels(ctx, seg, clock));
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
  } else if (tech === "mixtalg") {
    clock.stage(0.25, end, "Lápiz y gouache");
    paint = await Mixta.paintLG(ctx, p, seg, Lfull, clock);
  } else {
    clock.stage(0.2, 0.84, tech === "ceras" ? "Pintando con ceras" : "Pintando");
    const planes = await Painter3.paint(ctx, tech, p, seg, clock);
    clock.stage(0.84, end, "Acabado");
    paint = await Painter.finish(ctx, tech, p, planes, clock);
  }

  // el papel se marca siempre en lo velado (esté o no visible)
  const [tm, ta] = TOOTH[tech];
  clock.stage(end, end + 0.03, "Grano del papel");
  await K.paperTooth(paint, ctx, tm, ta, clock);

  let paper = null;
  if (opts.paper) {
    clock.stage(end + 0.03, 0.98, "Preparando el papel");
    paper = await Paper.makePaper(tech, ctx.W, ctx.H, seed, clock, ctx.paperPrep, p.modo);
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
 * Trazo · Mixta lápiz + gouache
 *
 * paintLG — dibujo a lápiz completo; gouache opaco en una parte de las zonas,
 *   desalineado de la línea y con borde irregular (o con manchas reales
 *   sueltas); y la línea de lápiz otra vez por encima, suelta.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");
const Painter = require("./painter.js");
const Painter3 = require("./painter3.js");
const Pencil = require("./pencil.js");
const K = require("./kit.js");

/* ---------- gouache completo (RGBA) ---------- */
async function gouacheLayer(ctx, p, seg, Lfull, clock, modo) {
  const gp = Object.assign({}, p, { modo: modo || "pleinair", cobertura: 1 });
  const planes = await Painter3.paint(ctx, "gouache", gp, seg, clock);
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
  // gouache de planos: menos capas finas (el detalle lo da el lápiz)
  const gou = await gouacheLayer(ctx, Object.assign({}, p, { grosor: p.grosor * 0.9, detalle: p.detalle * 0.35 }), seg, Lfull, tick(0.3, 0.7), "pleinair");
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
  const lines = await Pencil.paint(ctx, Object.assign({}, p, { modo: "mixta" }), tick(0.75, 0.98), seg, Lfull, { lib: pencilLib, only: "contornos", contourMul: 0.8 + 0.35 * p.intensidad });
  K.multU8(out, lines);
  return out;
}

/* ---------- filtros de impresión sobre un recorte de la foto ---------- */
const RISO = [[1.0, 0.28, 0.69], [0.0, 0.47, 0.75], [1.0, 0.91, 0.0], [0.0, 0.66, 0.36], [1.0, 0.42, 0.18], [0.38, 0.33, 0.66]];

function luminanceAt(ctx, x, y) {
  const i = ((y | 0) * ctx.W + (x | 0)) * ctx.comp, d = ctx.data;
  return (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
}

module.exports = { paintLG };

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
    const rb0 = Math.max(1, Math.round((cfg.hBlur || 0.9) * Math.sqrt(s)));
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
  // LUZ: intensidad de la luz rasante (0 = sin volumen visible, 0.5 = normal, 1 = muy marcada)
  const luz = p.luz === undefined ? 0.5 : p.luz;
  const luzK = luz <= 0.5 ? luz * 2 : 1 + (luz - 0.5) * 2.4;
  const relief = (0.12 + 0.95 * p.empaste) * cfg.shade * Math.max(0.6, Math.sqrt(s)) * (planes.real ? 0.55 : 1) * (cfg.reliefK || 1) * luzK;
  const gloss = cfg.gloss * (0.3 + p.empaste) * Math.min(1.6, luzK);
  // oclusión: los surcos de la pasta reciben menos luz (más profundidad)
  let Hm = null;
  if (Hh && luzK > 0.02) {
    Hm = Float32Array.from(Hh);
    const tmpA = new Float32Array(N), ra = Math.max(2, Math.round(2.5 * Math.sqrt(s)));
    C.boxBlurH(Hm, tmpA, W, H, ra); C.boxBlurV(tmpA, Hm, W, H, ra);
    C.boxBlurH(Hm, tmpA, W, H, ra); C.boxBlurV(tmpA, Hm, W, H, ra);
  }
  const aoK = 0.9 * luzK * (0.3 + p.empaste) * cfg.shade;
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
        let k = 1 + dif;
        if (Hm) { const dv = Hm[i] - Hh[i]; if (dv > 0) k *= 1 - Math.min(0.25, dv * aoK); }
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
__defs["painter3.js"] = function (module, exports, require) {
/*
 * Trazo · pintor por capas (Óleo y Gouache) — 1.4
 *
 * Pinta como un pintor, de grueso a fino y solo con pinceladas reales:
 *  0) ENCAJE  — capa fina con el color de cada zona, de borde roto (sin
 *     desenfoque: nada de halos alrededor de las formas).
 *  1..n) CAPAS — pinceles cada vez más pequeños. Una pincelada solo se da
 *     donde el lienzo aún no se parece a la referencia; sigue las formas y se
 *     detiene al llegar a otro color.
 * La referencia de cada capa se simplifica CONSERVANDO LOS BORDES (transformada
 * de dominio, Gastal y Oliveira 2011), así que el pincel nunca toma colores
 * intermedios del borde. Cada pincelada se recorta contra los cambios fuertes de
 * color con el filo irregular de las cerdas: los bordes quedan rotos, nunca
 * redondeados, y no hay perfiles oscuros, puntos ni salpicaduras.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");
const Seg = require("./segment.js");
const K = require("./kit.js");

const BODY = 0.7, VK = 0.9;

/* ---------- transformada de dominio (filtro recursivo que conserva bordes) ---------- */
async function dtFilter(src, w, h, sigmaS, sigmaR, iters, clock) {
  const n = w * h;
  const [r0, g0, b0] = src;
  const out = [Float32Array.from(r0), Float32Array.from(g0), Float32Array.from(b0)];
  const ratio = sigmaS / sigmaR;
  // diferencias cuantizadas (1/256): el peso a^d sale de una tabla
  const dH = new Uint16Array(n), dV = new Uint16Array(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 1; x < w; x++) {
      const i = row + x;
      dH[i] = ((Math.abs(r0[i] - r0[i - 1]) + Math.abs(g0[i] - g0[i - 1]) + Math.abs(b0[i] - b0[i - 1])) * 256 + 0.5) | 0;
    }
    if (y > 0) for (let x = 0; x < w; x++) {
      const i = row + x;
      dV[i] = ((Math.abs(r0[i] - r0[i - w]) + Math.abs(g0[i] - g0[i - w]) + Math.abs(b0[i] - b0[i - w])) * 256 + 0.5) | 0;
    }
  }
  const tab = new Float32Array(770);
  for (let it = 0; it < iters; it++) {
    const sH = sigmaS * Math.sqrt(3) * Math.pow(2, iters - (it + 1)) / Math.sqrt(Math.pow(4, iters) - 1);
    const la = -Math.SQRT2 / Math.max(0.05, sH); // ln(a)
    for (let j = 0; j < 770; j++) tab[j] = Math.exp(la * (1 + ratio * j / 256));
    for (const I of out) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 1; x < w; x++) { const i = row + x; I[i] += tab[dH[i]] * (I[i - 1] - I[i]); }
        for (let x = w - 2; x >= 0; x--) { const i = row + x; I[i] += tab[dH[i + 1]] * (I[i + 1] - I[i]); }
      }
    }
    for (const I of out) {
      for (let y = 1; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) { const i = row + x; I[i] += tab[dV[i]] * (I[i - w] - I[i]); }
      }
      for (let y = h - 2; y >= 0; y--) {
        const row = y * w;
        for (let x = 0; x < w; x++) { const i = row + x; I[i] += tab[dV[i + w]] * (I[i + w] - I[i]); }
      }
    }
    if (clock) await clock.tick();
  }
  return out;
}

/* ---------- bordes decididos: cada píxel de la franja de transición toma el color de su lado ---------- */
function snapEdges(src, w, h, iters, dist, thr) {
  let [R, G, B] = src.map((a) => Float32Array.from(a));
  const n = w * h;
  const L = new Float32Array(n);
  const tmp = new Float32Array(n);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) L[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
    C.gaussBlur(L, w, h, 1.0, tmp);
    const R2 = Float32Array.from(R), G2 = Float32Array.from(G), B2 = Float32Array.from(B);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = L[i + 1] - L[i - 1], gy = L[i + w] - L[i - w];
        const gm = Math.sqrt(gx * gx + gy * gy);
        if (gm < 0.02) continue;
        const nx = gx / gm * dist, ny = gy / gm * dist;
        const ax = x + nx, ay = y + ny, bx = x - nx, by = y - ny;
        const ar = C.bilinear(R, w, h, ax, ay), ag = C.bilinear(G, w, h, ax, ay), ab = C.bilinear(B, w, h, ax, ay);
        const br = C.bilinear(R, w, h, bx, by), bg = C.bilinear(G, w, h, bx, by), bb = C.bilinear(B, w, h, bx, by);
        const dAB = Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
        if (dAB < thr) continue;
        const dA = Math.abs(R[i] - ar) + Math.abs(G[i] - ag) + Math.abs(B[i] - ab);
        const dB = Math.abs(R[i] - br) + Math.abs(G[i] - bg) + Math.abs(B[i] - bb);
        const k = C.smoothstep(thr, thr * 2, dAB);
        if (dA < dB) { R2[i] += (ar - R2[i]) * k; G2[i] += (ag - G2[i]) * k; B2[i] += (ab - B2[i]) * k; }
        else { R2[i] += (br - R2[i]) * k; G2[i] += (bg - G2[i]) * k; B2[i] += (bb - B2[i]) * k; }
      }
    }
    R = R2; G = G2; B = B2;
  }
  return [R, G, B];
}

/* ---------- configuración por técnica y variante ---------- */
// Todas las variantes parten de la misma idea: pinceladas decididas, pocas capas
// (la foto no se calca) y color que vibra entre trazos.
function config(kind, p, s) {
  const m = p.modo;
  let c;
  const L = (k) => 2 + Math.round(p.detalle * k); // capas según el detalle
  if (kind === "oleo") {
    c = {
      R0: (3.2 + p.grosor * 24) * s, layers: L(1.2), ratio: 0.5,
      Lk: 4 + p.longitud * 12, curv: 0.12 + 0.8 * p.curvatura,
      op: 0.88 + 0.12 * p.intensidad, wet: 0.22, thick: 0.25 + 0.75 * p.empaste,
      sK: 0.6 + 0.8 * p.empaste, dual: 0.6, varK: 1.2, ridge: 0.35,
      tolStop: 0.34 + 0.22 * (1 - p.detalle), tolClip: 0.5, lost: 1.1, refineT: 0.32 - 0.16 * p.detalle,
      minLenK: 2.6, planeK: 0.1, steps: 0, earth: 0, satK: 1.1, lechoso: 0, sink: 0,
      ground: 0, groundShow: 0, baseOp: 1, cov0: 0.82, gloss: 0.3, shade: 1, canvasTex: 0.5,
      paperBreak: 0, chalk: false, libs: ["pin_oleo", "pin_gouache"], dirJit: 0.06, edgeN: 0.42, edgeT: 0.9, temp: 0.06, reliefK: 0.5,
      tools: null, hBlur: 1.6,
      sizeVar: 0.42, lenVar: 0.55, loadK: 0.55, shapes: 1.0, shapeOp: 0.8, shapeSkip: 0.6, tileAmt: 0.7,
    };
    // gestual: el punto de partida que funciona (decidido, abstracto)
    if (m === "gestual") Object.assign(c, { R0: c.R0 * 1.3, Lk: c.Lk * 1.45, curv: Math.min(1, c.curv * 1.4 + 0.1), wet: 0.32, varK: 1.6, dual: 0.8, satK: 1.15, lost: 1.5, planeK: 0, layers: 2 + Math.round(p.detalle * 0.8), dirJit: 0.1 });
    // planos y espátula: pincel ancho para encajar y espátula para construir los planos
    if (m === "planos") Object.assign(c, { R0: c.R0 * 1.25, layers: L(1.2), tools: ["brush", "knife", "knife", "knife"], curv: 0.06, dirJit: 0.18, Lk: c.Lk * 0.9,
      knifeLk: 2.2 + p.longitud * 4, varK: 1.4, dual: 0.75, satK: 1.12, lost: 1.3, planeK: 0.35, thick: 0.5 + 0.6 * p.empaste, reliefK: 0.75, gloss: 0.4, wet: 0.15, hBlur: 1.0 });
    if (m === "boceto") Object.assign(c, { shapes: 0.6, shapeOp: 0.6, R0: c.R0 * 1.15, ground: 1, groundShow: 0.55, thick: c.thick * 0.35, op: c.op * 0.86, cov0: 0.6, wet: 0.12, layers: Math.max(2, c.layers - 1), sK: c.sK * 0.6, lost: 1.6, gloss: 0.12, canvasTex: 0.75, planeK: 0.2, varK: 1.3 });
    // matérico: pocas pinceladas grandes muy cargadas; el relieve lo hace cada trazo (crestas y surcos)
    if (m === "materico") Object.assign(c, { R0: c.R0 * 1.35, Lk: c.Lk * 1.15, layers: 2 + Math.round(p.detalle * 0.9), thick: 0.7 + 0.7 * p.empaste, sK: 1.0 + 0.9 * p.empaste, ridge: 1.0,
      wet: 0.3, dual: 0.85, varK: 1.4, satK: 1.12, lost: 1.4, planeK: 0.05, reliefK: 1.0, hBlur: 0.9, gloss: 0.45, canvasTex: 0.2, dirJit: 0.08, curv: Math.min(1, c.curv * 1.2) });
  } else if (kind === "gouache") {
    c = {
      R0: (3 + p.grosor * 22) * s, layers: L(1.2), ratio: 0.5,
      Lk: 3.5 + p.longitud * 10, curv: 0.1 + 0.7 * p.curvatura,
      op: 0.94 + 0.06 * p.intensidad, wet: 0.06, thick: 0.12 + 0.3 * p.empaste,
      sK: 0.35 + 0.45 * p.empaste, dual: 0.4, varK: 1.0, ridge: 0.15,
      tolStop: 0.3 + 0.2 * (1 - p.detalle), tolClip: 0.42, lost: 0.9, refineT: 0.3 - 0.15 * p.detalle,
      minLenK: 2.4, planeK: 0.35, steps: 0, earth: 0, satK: 1.08, lechoso: 0.03, sink: 0,
      ground: 0, groundShow: 0, baseOp: 1, cov0: 0.85, gloss: 0, shade: 0.55, canvasTex: 0.3,
      paperBreak: 0.7, chalk: true, libs: ["pin_gouache"], dirJit: 0.06, edgeN: 0.35, edgeT: 0.7, temp: 0.05, reliefK: 0.6,
      tools: null, hBlur: 1.6,
      sizeVar: 0.4, lenVar: 0.5, loadK: 0.45, shapes: 1.0, shapeOp: 0.75, shapeSkip: 0.6, tileAmt: 0.5,
    };
    if (m === "pleinair") Object.assign(c, { R0: c.R0 * 1.15, varK: 1.3, temp: 0.07, dual: 0.5, edgeN: 0.45 });
    // planos opacos: valores por planos, pero cada plano hecho con brochazos planos visibles y filo seco
    if (m === "planos") Object.assign(c, { R0: c.R0 * 1.45, planeK: 0.7, steps: 4, lechoso: 0.03, Lk: c.Lk * 1.2, curv: 0.15, lost: 1.3, varK: 1.5, dual: 0.55, tolClip: 0.52,
      dirJit: 0.1, paperBreak: 1.0, edgeN: 0.6, edgeT: 1.0, sK: c.sK * 1.1, satK: 1.15, temp: 0.08, layers: 2 + Math.round(p.detalle * 0.9) });
    // retrato expresivo: gestual, color subido, pincel seco y papel entre trazos
    if (m === "expresivo") Object.assign(c, { R0: c.R0 * 1.5, Lk: c.Lk * 1.6, curv: Math.min(1, c.curv * 1.4 + 0.12), sink: 0, satK: 1.25, lechoso: 0.02, varK: 2.0, dual: 0.9,
      lost: 1.8, tolClip: 0.55, planeK: 0, layers: 2 + Math.round(p.detalle * 0.7), paperBreak: 1.2, dirJit: 0.1, wet: 0.16, temp: 0.1, cov0: 0.72, edgeN: 0.6, edgeT: 1.1, sK: c.sK * 1.2 });
    if (m === "diluido") Object.assign(c, { shapes: 1.4, shapeOp: 0.55, shapeSkip: 0.75, op: 0.72 + 0.1 * p.intensidad, baseOp: 0.55, lechoso: 0.05, thick: c.thick * 0.4, sK: c.sK * 0.6, lost: 1.1, planeK: 0.25, paperBreak: 1, cov0: 0.7, wet: 0.14, layers: Math.max(2, c.layers - 1) });
  } else {
    // ceras de colores: sin capa base; el color se queda en los picos del papel
    c = {
      R0: (2.4 + p.grosor * 15) * s, layers: L(1.1), ratio: 0.55,
      Lk: 7 + p.longitud * 16, curv: 0.05 + 0.5 * p.curvatura,
      op: 0.96, wet: 0, thick: 0.1 + 0.3 * p.empaste,
      sK: 0.5, dual: 0.3, varK: 1.1, ridge: 0.2,
      tolStop: 0.4 + 0.2 * (1 - p.detalle), tolClip: 0.55, lost: 1.1, refineT: 0.36 - 0.14 * p.detalle,
      minLenK: 3.5, planeK: 0.3, steps: 0, earth: 0, satK: 1.15, lechoso: 0, sink: 0,
      ground: 0, groundShow: 0, baseOp: 0, cov0: 0.6, gloss: 0, shade: 0.5, canvasTex: 0,
      paperBreak: 0, chalk: false, libs: ["pin_manley"], dirJit: 0.05, edgeN: 0.3, edgeT: 0.6, temp: 0.03, reliefK: 0.5,
      tools: null, hBlur: 1.2, media: "cera", tooth: 0.75, press: 0.22 + 0.36 * p.intensidad, palK: 0, palN: 16, paperWhite: 0.86, sparse: 0.45,
      hand: -Math.PI / 4, handK: 0.15, cross: p.cruzado || 0, smudge: 0,
      sizeVar: 0.3, lenVar: 0.45, loadK: 0.35, shapes: 0, shapeOp: 0, shapeSkip: 0, tileAmt: 0,
    };
    // óleo en barra: pasta espesa y untuosa, apenas deja ver el papel
    if (m === "barra") Object.assign(c, { libs: ["pin_barra"], R0: c.R0 * 1.45, Lk: c.Lk * 0.75, tooth: 0.3, paperWhite: 0.97, sparse: 0.15, thick: 0.6 + 0.8 * p.empaste, sK: 1.1, ridge: 0.8, wet: 0.3,
      gloss: 0.3, reliefK: 1.0, shade: 1.0, handK: 0.05, dual: 0.55, varK: 1.3, hBlur: 0.9 });
    // pastel graso: cubriente, se arrastra y mezcla; algo de grano
    if (m === "pastelgraso") Object.assign(c, { libs: ["pin_barra", "pin_manley"], R0: c.R0 * 1.1, tooth: 0.5, thick: 0.25 + 0.4 * p.empaste, sK: 0.7, ridge: 0.4, wet: 0.35,
      gloss: 0.12, reliefK: 0.7, handK: 0.1, dual: 0.5, palK: 0.35 });
    // pastel seco: polvo de color, de canto en los fondos, difuminado con el dedo
    if (m === "pastelseco") Object.assign(c, { libs: ["pin_pastel", "pin_barra"], R0: c.R0 * 1.3, tooth: 0.8, op: 0.88, thick: 0, ridge: 0, sK: 0.35, wet: 0.08, chalk: true,
      lechoso: 0.05, satK: 1.05, smudge: 0.55 + 0.3 * (1 - p.intensidad), handK: 0.12, palK: 0.25, reliefK: 0.3 });
    // ceras escolares (Manley): trazo estrecho, rayado a mano, caja de colores limitada, mucho grano
    if (m === "manley") Object.assign(c, { libs: ["pin_manley"], R0: c.R0 * 0.75, tooth: 0.92, op: 0.88, sparse: 0.6, thick: 0.08, sK: 0.4, ridge: 0.1, wet: 0, gloss: 0.06, handK: 0.3,
      palK: 0.85, palN: 14, satK: 1.3, layers: L(1.3), minLenK: 5 });
  }
  // REALISMO (0..1, 0.5 = la variante tal cual): más alto se parece más a la foto, más bajo es más abstracto
  const d = (p.realismo === undefined ? 0.5 : p.realismo) - 0.5;
  c.layers = Math.max(1, Math.min(6, Math.round(c.layers + d * 4.5)));
  c.refineT *= 1 - d * 1.1;
  c.lost = Math.max(0, c.lost * (1 - d * 1.5));
  c.planeK = C.clamp(c.planeK - d * 0.7, 0, 1);
  c.varK *= 1 - d * 0.8;
  c.temp *= 1 - d * 0.7;
  c.R0 *= 1 - d * 0.55;
  c.tolStop *= 1 - d * 0.45;
  c.refSig = 1.3 * (1 - d * 0.9);       // cuánto se simplifica la referencia de cada capa
  c.minRK = 1 - d * 1.0;                // pincel más fino posible
  c.sizeVar = (c.sizeVar || 0.15) * (1 - d * 0.5);
  return c;
}

/* ---------- utilidades ---------- */
function sample3(ref, aw, ah, ax, ay, out) {
  if (ax < 0) ax = 0; else if (ax > aw - 1) ax = aw - 1;
  if (ay < 0) ay = 0; else if (ay > ah - 1) ay = ah - 1;
  const x0 = ax | 0, y0 = ay | 0;
  const x1 = x0 < aw - 1 ? x0 + 1 : x0, y1 = y0 < ah - 1 ? y0 + 1 : y0;
  const fx = ax - x0, fy = ay - y0;
  const i00 = y0 * aw + x0, i10 = y0 * aw + x1, i01 = y1 * aw + x0, i11 = y1 * aw + x1;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  const r = ref[0], g = ref[1], b = ref[2];
  out[0] = r[i00] * w00 + r[i10] * w10 + r[i01] * w01 + r[i11] * w11;
  out[1] = g[i00] * w00 + g[i10] * w10 + g[i01] * w01 + g[i11] * w11;
  out[2] = b[i00] * w00 + b[i10] * w10 + b[i01] * w01 + b[i11] * w11;
  return out;
}

/** Ajustes de color de la variante, aplicados a una referencia (resolución de análisis). */
function adjustRef(ref, ctx, seg, cfg, model, lumMed) {
  const { aw, ah } = ctx;
  const [R, G, B] = ref;
  const reg = seg.reg, labels = seg.labels, imp = seg.imp;
  for (let i = 0, n = aw * ah; i < n; i++) {
    let r = R[i], g = G[i], b = B[i];
    if (cfg.planeK > 0) { const k = cfg.planeK; r += (model[0][i] - r) * k; g += (model[1][i] - g) * k; b += (model[2][i] - b) * k; }
    if (cfg.steps) {
      const rr = labels[i];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const lr = reg.lum[rr];
      const q = Math.round(lr * cfg.steps) / cfg.steps;
      const l2 = l + (q - lr) * 0.8;
      const k = l > 0.02 ? Math.max(0, l2) / l : 1;
      r *= k; g *= k; b *= k;
      if (l < 0.02) { r += l2 - l; g += l2 - l; b += l2 - l; }
    }
    if (cfg.earth) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const er = l * 1.16 + 0.03, eg = l * 0.98, eb = l * 0.74;
      r += (er - r) * cfg.earth; g += (eg - g) * cfg.earth; b += (eb - b) * cfg.earth;
    }
    if (cfg.satK !== 1) { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = l + (r - l) * cfg.satK; g = l + (g - l) * cfg.satK; b = l + (b - l) * cfg.satK; }
    if (cfg.lechoso) { const l = 0.299 * r + 0.587 * g + 0.114 * b; const k = cfg.lechoso * (0.4 + 0.6 * l); r = (l + (r - l) * 0.88) * (1 - k) + 0.96 * k; g = (l + (g - l) * 0.88) * (1 - k) + 0.95 * k; b = (l + (b - l) * 0.88) * (1 - k) + 0.92 * k; }
    if (cfg.sink) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const k = cfg.sink * C.smoothstep(0.5, 0.25, imp[i]) * C.smoothstep(lumMed + 0.25, lumMed - 0.05, l);
      if (k > 0) { r *= 1 - k * 0.8; g *= 1 - k * 0.84; b *= 1 - k * 0.72; }
    }
    R[i] = r < 0 ? 0 : r > 1 ? 1 : r; G[i] = g < 0 ? 0 : g > 1 ? 1 : g; B[i] = b < 0 ? 0 : b > 1 ? 1 : b;
  }
}

/* ---------- pintor ---------- */
async function paint(ctx, kind, p, seg, clock) {
  const { W, H, N, s, aw, ah } = ctx;
  const cfg = config(kind, p, s);
  const rand = C.mulberry32(ctx.seed * 31 + 7);
  const Pr = new Float32Array(N), Pg = new Float32Array(N), Pb = new Float32Array(N);
  const Cv = new Float32Array(N), Hh = new Float32Array(N);
  const Sc = new Uint8Array(N); // cobertura de pinceladas (la capa base no cuenta)
  const Bc = new Uint8Array(N * 3); // color que se quiso poner (sin textura ni variación)
  const Pc = new Uint8Array(N * 3); // color de la pintura que quedó (sin el sombreado de las cerdas)
  let lib = [];
  for (const nm of cfg.libs) { const a = ctx.assets && ctx.assets[nm]; if (a && a.kind === "strokes") lib = lib.concat(a.samples); }
  if (!lib.length) lib = Lib.synthetic(kind);
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H))) : null;
  // ceras: el grano del papel se calcula una vez por píxel (se consulta muchísimas veces)
  let toothMap = null;
  if (cfg.media) {
    toothMap = new Uint8Array(N);
    const grainT = pap ? null : C.makeGrainTile(ctx.seed + 3, "tooth"), gInv = 1 / Math.max(1, Math.sqrt(s) * 0.9);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) toothMap[y * W + x] = ((pap ? pap.eqN(x, y) : C.tileAt(grainT, x * gInv, y * gInv)) * 255 + 0.5) | 0;
      if ((y & 63) === 0) await clock.tick(0.02);
    }
  }
  // caja de colores (ceras): paleta limitada sacada de la imagen
  const pal = cfg.palK ? K.palette(ctx, cfg.palN, ctx.seed, {}) : null;
  if (pal) for (let k = 0; k < pal.K; k++) { const l = 0.299 * pal.r[k] + 0.587 * pal.g[k] + 0.114 * pal.b[k]; pal.r[k] = C.clamp(l + (pal.r[k] - l) * 1.25, 0, 1); pal.g[k] = C.clamp(l + (pal.g[k] - l) * 1.25, 0, 1); pal.b[k] = C.clamp(l + (pal.b[k] - l) * 1.25, 0, 1); }
  const col = new Float32Array(3), col2 = new Float32Array(3), base = new Float32Array(3), tmp = new Float32Array(3), ts = new Float32Array(2);
  const stripes = new Float32Array(64), jit = new Float32Array(66), tanX = new Float32Array(64), tanY = new Float32Array(64);
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += rand(); return (u - 2) * 1.732; }; // ~N(0,1)
  const _f0 = new Float32Array(2);
  const varH = p.varTono * 0.32 * cfg.varK, varS = p.varSat * 0.4 * cfg.varK, varL = p.varLuz * 0.16 * cfg.varK;
  const sel = ctx.sel, selDetail = ctx.selMode === "detalle";
  const fullCover = p.cobertura >= 0.995;

  /* --- referencias que conservan bordes --- */
  const src = snapEdges([ctx.ar, ctx.ag, ctx.ab], aw, ah, 2, 1.5, 0.25);
  const model = [new Float32Array(aw * ah), new Float32Array(aw * ah), new Float32Array(aw * ah)];
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const i = y * aw + x;
    Seg.modelColor(seg, seg.labels[i], (x + 0.5) / aw, (y + 0.5) / ah, tmp);
    model[0][i] = tmp[0]; model[1][i] = tmp[1]; model[2][i] = tmp[2];
  }
  const lumSorted = Array.from(seg.reg.lum).sort((a, b) => a - b);
  const lumMed = lumSorted[(lumSorted.length / 2) | 0] || 0.5;
  const radii = [];
  { let R = cfg.R0; const minR = Math.max(1.1, 0.9 * s * (cfg.minRK || 1)); for (let k = 0; k < cfg.layers; k++) { radii.push(Math.max(minR, R)); R *= cfg.ratio; if (R < minR) break; } }
  const nL = radii.length;
  const refs = [];
  for (let k = 0; k < nL; k++) {
    const sig = Math.max(1.0, radii[k] * ctx.ax * (cfg.refSig || 1.3));
    const ref = await dtFilter(src, aw, ah, sig, 0.32, 2, clock);
    adjustRef(ref, ctx, seg, cfg, model, lumMed);
    refs.push(ref);
    await clock.tick(0.08 * (k + 1) / nL);
  }
  // referencia para recortar las pinceladas (nítida) a resolución de salida
  const clipA = await dtFilter(src, aw, ah, Math.max(1, 1.2), 0.25, 2, clock);
  adjustRef(clipA, ctx, seg, cfg, model, lumMed);
  const clip = new Uint8Array(N * 3);
  {
    const kx = aw / W, ky = ah / H;
    for (let y = 0; y < H; y++) {
      const ay = (y + 0.5) * ky - 0.5;
      for (let x = 0; x < W; x++) {
        sample3(clipA, aw, ah, (x + 0.5) * kx - 0.5, ay, tmp);
        const o = (y * W + x) * 3;
        clip[o] = (tmp[0] * 255 + 0.5) | 0; clip[o + 1] = (tmp[1] * 255 + 0.5) | 0; clip[o + 2] = (tmp[2] * 255 + 0.5) | 0;
      }
      if ((y & 63) === 0) await clock.tick(0.08 + 0.04 * y / H);
    }
  }
  const refAt = (ref, x, y, out) => sample3(ref, aw, ah, (x + 0.5) * ctx.ax - 0.5, (y + 0.5) * ctx.ay - 0.5, out);
  const impAt = (x, y) => ctx.at(seg.imp, x, y);

  /* --- 0) ENCAJE: capa base de borde roto --- */
  const gw = Math.max(4, Math.ceil(W / 24)), gh = Math.max(4, Math.ceil(H / 24));
  const nX = C.fbmGrid(gw, gh, Math.max(2, gw / 10), 4, ctx.seed + 71, 0.55);
  const nY = C.fbmGrid(gw, gh, Math.max(2, gw / 10), 4, ctx.seed + 72, 0.55);
  const wob = radii[Math.min(1, nL - 1)] * 0.45;
  const gcol = [0.62, 0.4, 0.25]; // imprimatura de tierra
  // textura real de pincelada (TEXTURAS REALISTAS TILEABLES) por zona: cálida o fría, girada con la forma
  const tlib = cfg.tileAmt && ctx.assets && ctx.assets.tiles_pintura;
  const tsamp = tlib ? new Array(seg.reg.n).fill(null) : null;
  const tileFor = (r) => {
    if (tsamp[r]) return tsamp[r];
    const reg = seg.reg;
    const wm = K.warmth(reg.mean[r * 3], reg.mean[r * 3 + 1], reg.mean[r * 3 + 2]);
    const it = K.pickTile(tlib, rand, ["pincelada", "brochazo"], wm);
    const th = 0.5 * Math.atan2(reg.os[r], reg.oc[r]) - (it.ang || 0) + Math.PI / 2;
    tsamp[r] = K.tileSampler(it, K.tileScale(it, Math.max(W, H), 0.8 + 0.5 * rand()), th, rand() * 999, rand() * 999);
    return tsamp[r];
  };
  const cch = new Float32Array(2);
  {
    const ref0 = refs[0];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const m = fullCover ? 1 : ctx.at(ctx.cover, x, y);
        if (m < 0.003) continue;
        const ox = (C.bilinear(nX, gw, gh, x / 24, y / 24) - 0.5) * 2 * wob;
        const oy = (C.bilinear(nY, gw, gh, x / 24, y / 24) - 0.5) * 2 * wob;
        refAt(ref0, x + ox, y + oy, col);
        let r = col[0], g = col[1], b = col[2], tRel = 0;
        if (tsamp) {
          // la capa de fondo no es plana: lleva la textura de un frotado real
          const rg = seg.labels[Math.min(ah - 1, ((y + oy) * ctx.ay) | 0) * aw + Math.min(aw - 1, Math.max(0, ((x + ox) * ctx.ax) | 0))];
          const t = tileFor(rg);
          const l = t.l(x, y), lc = l < -2.5 ? -2.5 : l > 2.5 ? 2.5 : l, k = 1 + cfg.tileAmt * 0.11 * lc;
          r *= k; g *= k; b *= k;
          // la textura real también es relieve (la pintura frotada tiene cuerpo)
          tRel = cfg.tileAmt * cfg.thick * 0.07 * (lc + 2.5);
          if (t.prep.cr) { t.c(x, y, cch); const kc = cfg.tileAmt * 0.5; r += cch[0] * kc; b += cch[1] * kc; g -= (0.299 * cch[0] + 0.114 * cch[1]) / 0.587 * kc; }
          r = r < 0 ? 0 : r > 1 ? 1 : r; g = g < 0 ? 0 : g > 1 ? 1 : g; b = b < 0 ? 0 : b > 1 ? 1 : b;
        }
        if (cfg.ground) {
          // imprimatura: asoma en las sombras y los medios tonos; en las luces queda una veladura clara
          const l = 0.299 * r + 0.587 * g + 0.114 * b;
          const k = 0.85 * C.smoothstep(0.92, 0.35, l);
          r = gcol[0] * k + r * (1 - k); g = gcol[1] * k + g * (1 - k); b = gcol[2] * k + b * (1 - k);
        }
        const a = m * cfg.baseOp;
        Pr[i] = r * a; Pg[i] = g * a; Pb[i] = b * a; Cv[i] = a;
        Hh[i] = (0.04 + tRel) * a;
        Bc[i * 3] = (col[0] * 255 + 0.5) | 0; Bc[i * 3 + 1] = (col[1] * 255 + 0.5) | 0; Bc[i * 3 + 2] = (col[2] * 255 + 0.5) | 0;
        Pc[i * 3] = (r * 255 + 0.5) | 0; Pc[i * 3 + 1] = (g * 255 + 0.5) | 0; Pc[i * 3 + 2] = (b * 255 + 0.5) | 0;
      }
      if ((y & 31) === 0) await clock.tick(0.12 + 0.06 * y / H);
    }
  }


  /* --- FORMAS: las zonas amplias de un color se cubren con manchas reales (no con pinceladas iguales) --- */
  const big = new Float32Array(seg.reg.n); // 0..1: cuánto de "zona amplia y lisa" tiene cada mancha
  {
    const reg = seg.reg, fa = 1 / ctx.ax;
    for (let r = 0; r < reg.n; r++) {
      const side = Math.sqrt(reg.cnt[r]) * fa;
      big[r] = C.smoothstep(cfg.R0 * 3, cfg.R0 * 10, side) * (1 - 0.8 * reg.act[r]) * (1 - 0.5 * reg.imp[r]);
    }
  }
  const stLib = cfg.shapes > 0 && ctx.assets && ctx.assets.manchas && ctx.assets.manchas.items
    ? ctx.assets.manchas.items.filter((it) => /parche|relleno|remolino/.test(it.tags[0])) : [];
  if (stLib.length) {
    const reg = seg.reg, fa = 1 / ctx.ax;
    const order = Array.from({ length: reg.n }, (_, i) => i).sort((a, b) => reg.cnt[b] - reg.cnt[a]);
    const sh = new Float32Array(3);
    for (let oi = 0; oi < order.length; oi++) {
      const r = order[oi];
      if (big[r] < 0.05) continue;
      const side = Math.sqrt(reg.cnt[r]) * fa;
      const nS = Math.min(14, Math.max(1, Math.round(cfg.shapes * big[r] * side / (cfg.R0 * 5) * (0.7 + 0.6 * rand()))));
      for (let k = 0; k < nS; k++) {
        const a0 = seg.pixOff[r], b0 = seg.pixOff[r + 1];
        const pi = seg.pix[a0 + ((rand() * (b0 - a0)) | 0)];
        const cx = (pi % aw + rand()) * fa, cy = (((pi / aw) | 0) + rand()) * fa;
        // tamaños muy distintos: unas pocas grandes, varias medianas
        const size = C.clamp(side * Math.exp(-0.25 + 0.55 * gauss()), cfg.R0 * 2.2, side * 1.5);
        const it = Lib.pick(stLib, rand);
        ctx.flowAt(cx, cy, _f0);
        const ang = Math.atan2(_f0[1], _f0[0]) + Math.PI / 2 - (it.ang || 0) + (rand() - 0.5) * 0.15;
        refAt(refs[0], cx, cy, sh);
        const b8r = (sh[0] * 255 + 0.5) | 0, b8g = (sh[1] * 255 + 0.5) | 0, b8b = (sh[2] * 255 + 0.5) | 0;
        C.varyColor(sh[0], sh[1], sh[2], (rand() - 0.5) * varH * 1.6, (rand() - 0.5) * varS, (rand() - 0.5) * varL * 2.2, col);
        const tp = (rand() - 0.5) * 2 * cfg.temp * (0.4 + p.varTono);
        const cr = C.clamp(col[0] + tp, 0, 1), cg = C.clamp(col[1] + tp * 0.25, 0, 1), cb = C.clamp(col[2] - tp, 0, 1);
        const op = cfg.shapeOp * (0.6 + 0.4 * rand());
        const thS = cfg.thick * (0.1 + 0.35 * rand());
        const tol = cfg.tolClip * 255 * (1 + cfg.lost * 0.5);
        K.drawStamp(it, cx, cy, size, ang, W, H, (i, av, sv) => {
          const o3 = i * 3;
          // la forma no invade otro color (con un margen roto)
          const d = Math.abs(clip[o3] - b8r) + Math.abs(clip[o3 + 1] - b8g) + Math.abs(clip[o3 + 2] - b8b);
          if (d > tol * 1.3) return;
          let a = C.smoothstep(0.08, 0.75, av) * op;
          if (d > tol * 0.8) a *= 1 - (d - tol * 0.8) / (tol * 0.5);
          if (a < 0.01) return;
          // la densidad del sello real da el tono: más pintura, algo más oscuro
          const kd = 1 + 0.1 * (0.55 - av) + 0.12 * sv;
          const ia = 1 - a;
          Pr[i] = Pr[i] * ia + cr * kd * a; Pg[i] = Pg[i] * ia + cg * kd * a; Pb[i] = Pb[i] * ia + cb * kd * a;
          Cv[i] = Cv[i] * ia + a;
          Hh[i] = Hh[i] * (1 - a * 0.6) + a * thS * (0.6 + 0.4 * av + 0.3 * sv);
          if (a > 0.4) { Bc[o3] = b8r; Bc[o3 + 1] = b8g; Bc[o3 + 2] = b8b; Pc[o3] = (cr * 255) | 0; Pc[o3 + 1] = (cg * 255) | 0; Pc[o3 + 2] = (cb * 255) | 0; }
        });
      }
      if ((oi & 15) === 0) await clock.tick(0.19);
    }
  }

  /* --- elegir muestra con la proporción adecuada (sin estirar ni repetir) --- */
  const logAsp = lib.map((sm) => Math.log(Math.max(1.2, sm.aspect || sm.h / sm.w)));
  const wts = new Float32Array(lib.length);
  function pickSample(L, Rr) {
    const want = Math.log(Math.max(1.2, (L + Rr) / (2 * Rr)));
    let tot = 0;
    for (let i = 0; i < lib.length; i++) {
      const d = logAsp[i] - want;
      // escala de las cerdas: la textura debe mapearse cerca de 1:1 (ni cerdas gigantes ni borrosas)
      const ks = Math.log(Math.max(0.05, lib[i].w / (2 * Rr)));
      wts[i] = (lib[i].q || 1) * Math.exp(-d * d * 2.2) * Math.exp(-ks * ks * 0.6); tot += wts[i];
    }
    let t = rand() * tot;
    for (let i = 0; i < lib.length; i++) { t -= wts[i]; if (t <= 0) return lib[i]; }
    return lib[lib.length - 1];
  }

  /* --- trazado: sigue las formas y se detiene al cambiar el color --- */
  const _f = new Float32Array(2), _c = new Float32Array(3);
  const bx = new Float32Array(S.MAXPTS), by = new Float32Array(S.MAXPTS);
  function trace(ref, x0, y0, c0, o) {
    const step = Math.max(0.8, o.step);
    let nb = 0, nf = 0;
    const xs = path.xs, ys = path.ys;
    for (const sign of [1, -1]) {
      ctx.flowAt(x0, y0, _f, o.fine);
      let dx = _f[0] * o.ca - _f[1] * o.sa, dy = _f[0] * o.sa + _f[1] * o.ca;
      if (o.handK) { dx += (o.hx - dx) * o.handK; dy += (o.hy - dy) * o.handK; const dm = Math.sqrt(dx * dx + dy * dy) || 1; dx /= dm; dy /= dm; }
      if (sign < 0) { dx = -dx; dy = -dy; }
      let x = x0, y = y0, len = 0, n = 0;
      const budget = sign > 0 ? o.Lmax * (0.35 + 0.3 * rand()) : o.Lmax - nf * step;
      const ox = sign > 0 ? path._fx : bx, oy = sign > 0 ? path._fy : by;
      while (len < budget && n < S.MAXPTS / 2 - 2) {
        ctx.flowAt(x, y, _f, o.fine);
        let fx = _f[0] * o.ca - _f[1] * o.sa, fy = _f[0] * o.sa + _f[1] * o.ca;
        if (o.handK) { fx += (o.hx - fx) * o.handK; fy += (o.hy - fy) * o.handK; const fm = Math.sqrt(fx * fx + fy * fy) || 1; fx /= fm; fy /= fm; }
        if (fx * dx + fy * dy < 0) { fx = -fx; fy = -fy; }
        let nx = dx + (fx - dx) * o.curv, ny = dy + (fy - dy) * o.curv;
        const mm = Math.sqrt(nx * nx + ny * ny) || 1;
        nx /= mm; ny /= mm;
        const qx = x + nx * step, qy = y + ny * step;
        if (qx < -1 || qy < -1 || qx > W || qy > H) break;
        refAt(ref, qx, qy, _c);
        const d = Math.abs(_c[0] - c0[0]) + Math.abs(_c[1] - c0[1]) + Math.abs(_c[2] - c0[2]);
        if (d > o.tol) break;
        x = qx; y = qy; dx = nx; dy = ny; len += step;
        ox[n] = x; oy[n] = y; n++;
      }
      if (sign > 0) nf = n; else nb = n;
    }
    let n = 0;
    for (let i = nb - 1; i >= 0; i--) { xs[n] = bx[i]; ys[n] = by[i]; n++; }
    xs[n] = x0; ys[n] = y0; n++;
    for (let i = 0; i < nf; i++) { xs[n] = path._fx[i]; ys[n] = path._fy[i]; n++; }
    path.n = n;
    let sl = 0; path.ss[0] = 0;
    for (let i = 1; i < n; i++) { const ddx = xs[i] - xs[i - 1], ddy = ys[i] - ys[i - 1]; sl += Math.sqrt(ddx * ddx + ddy * ddy); path.ss[i] = sl; }
    path.len = sl;
    return sl;
  }

  /* --- una pincelada real, recortada con el filo roto del pincel --- */
  function renderStroke(R, c, cbase, opacity, thick, tolC, layerK) {
    const Rr = R / BODY, Rq = Rr * VK;
    const n = path.n;
    if (n < 2 || path.len < 1) return;
    for (let i = 0; i < n; i++) path.rs[i] = Rq;
    const nt = raster.rasterize(path, 0.04);
    if (nt === 0) return;
    const st = Lib.prepare(pickSample(path.len, Rr), path.len, Rr, rand, VK);
    const cr = c[0], cg = c[1], cb = c[2];
    // pincel cargado con dos tonos: vetas finas a lo largo de las cerdas
    const mixAmt = Math.min(0.85, cfg.dual * (0.35 + p.varLuz + p.varTono * 0.5) * (0.4 + 0.6 * rand()));
    C.varyColor(cr, cg, cb, (rand() - 0.5) * 0.3 * (0.3 + p.varTono) * cfg.varK, (rand() - 0.5) * 0.3, (rand() < 0.5 ? -1 : 1) * (0.04 + 0.08 * rand()) * cfg.varK, col2);
    const c2r = col2[0], c2g = col2[1], c2b = col2[2];
    const ph = rand() * 6.28, f1 = 5 + rand() * 9, f2 = 13 + rand() * 17;
    for (let q = 0; q < 64; q++) {
      const z = q / 63;
      stripes[q] = C.smoothstep(0.05, 0.7, 0.55 * Math.sin(z * f1 + ph) + 0.45 * Math.sin(z * f2 + ph * 1.7) + (rand() - 0.5) * 0.5);
    }
    // ondulación del filo a lo largo del trazo (bordes rotos, no redondeados)
    const nj = Math.max(4, Math.min(64, Math.round(path.len / (R * 0.45))));
    let pv = rand() - 0.5;
    for (let q = 0; q <= nj; q++) { pv = pv * 0.35 + (rand() - 0.5) * 0.65; jit[q] = pv; }
    const tc0 = tolC * 0.85, tc1 = tolC * 1.2;
    // dirección del trazo por tramos (para desplazar el filo)
    for (let q = 0, i = 0; q < 64; q++) {
      const sq = q / 63 * path.len;
      while (i < n - 2 && path.ss[i + 1] < sq) i++;
      let dx = path.xs[i + 1] - path.xs[i], dy = path.ys[i + 1] - path.ys[i];
      const m = Math.sqrt(dx * dx + dy * dy) || 1;
      tanX[q] = dx / m; tanY[q] = dy / m;
    }
    const ampN = R * cfg.edgeN, ampT = R * cfg.edgeT;
    const near = tc0 * 255 * 0.12; // por debajo, el píxel es del mismo color que el trazo: no hace falta desplazar
    const br0 = (cbase[0] * 255 + 0.5) | 0, bg0 = (cbase[1] * 255 + 0.5) | 0, bb0 = (cbase[2] * 255 + 0.5) | 0, inv3 = 1 / 255;
    const pr8 = (cr * 255 + 0.5) | 0, pg8 = (cg * 255 + 0.5) | 0, pb8 = (cb * 255 + 0.5) | 0;
    const sK = cfg.sK, wet = cfg.wet, pbk = cfg.paperBreak && pap ? cfg.paperBreak : 0;
    const tooth = cfg.tooth || 0, ridge = cfg.ridge || 0, bcT = cfg.media ? 0.25 : 0.45;
    // carga del pincel: empieza cargado y se va quedando seco (unos trazos más que otros)
    const loadK = (cfg.loadK || 0) * (0.4 + 0.9 * rand());
    const dryU = 0.55 + 0.4 * rand();
    // presión: más fuerte en los colores oscuros y distinta en cada trazo
    const press = cfg.press ? cfg.press * (0.8 + 0.4 * rand()) * (0.75 + 0.45 * (1 - (0.299 * cr + 0.587 * cg + 0.114 * cb))) : 1;
    const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
    for (let t = 0; t < nt; t++) {
      const li = tl[t], g = tg[t];
      const u = U[li], v = V[li];
      Lib.sampleAt(st, u, v, ts);
      let a = ts[0] * opacity * A[li];
      if (a < 0.004) continue;
      // recorte contra el color de la referencia, con el filo irregular del pincel:
      // cerca de un cambio de color, la consulta se desplaza a lo ancho (ondulación)
      // y a lo largo (cerdas desiguales)
      const o3 = g * 3;
      if (Math.abs(clip[o3] - br0) + Math.abs(clip[o3 + 1] - bg0) + Math.abs(clip[o3 + 2] - bb0) > near) {
        const uu = u < 0 ? 0 : u > 1 ? 1 : u;
        const qf = uu * nj, q0 = qf | 0, fq = qf - q0;
        const jv = jit[q0] + (jit[q0 + 1 > nj ? nj : q0 + 1] - jit[q0]) * fq;
        const qb = (uu * 63 + 0.5) | 0, tx = tanX[qb], ty = tanY[qb];
        const sv0 = stripes[((v + 1) * 31.5) | 0] - 0.5;
        const y = (g / W) | 0, x = g - y * W;
        const offN = jv * ampN + (((x * 73856093) ^ (y * 19349663)) & 255) * (0.5 / 255) - 0.25, offT = sv0 * ampT;
        let lx = (x - ty * offN + tx * offT + 0.5) | 0, ly = (y + tx * offN + ty * offT + 0.5) | 0;
        lx = lx < 0 ? 0 : lx >= W ? W - 1 : lx; ly = ly < 0 ? 0 : ly >= H ? H - 1 : ly;
        const l3 = (ly * W + lx) * 3;
        const d = (Math.abs(clip[l3] - br0) + Math.abs(clip[l3 + 1] - bg0) + Math.abs(clip[l3 + 2] - bb0)) * inv3;
        if (d > tc0) { a *= d >= tc1 ? 0 : 1 - C.smoothstep(tc0, tc1, d); if (a < 0.004) continue; }
      }
      // ceras: el color se queda en los picos del papel (más presión, menos huecos)
      if (tooth > 0) {
        const gr = toothMap[g] * (1 / 255);
        // la punta aprieta más en el centro y deja vetas a lo largo del trazo
        const pr = press * (0.7 + 0.3 * ts[0]) * (0.78 + 0.22 * (1 - v * v) + (stripes[((v + 1) * 31.5) | 0] - 0.5) * 0.35);
        const e0 = 0.8 - pr, tt = (gr - e0) * 3.3333;
        a *= 1 - tooth + tooth * (tt <= 0 ? 0 : tt >= 1 ? 1 : tt * tt * (3 - 2 * tt));
        if (a < 0.004) continue;
      }
      // pincel seco: el borde parcial se rompe sobre el grano del papel
      if (pbk > 0 && ts[0] < 0.92) {
        const x = g % W, y = (g / W) | 0;
        const e = (0.92 - ts[0]) * 1.6 * pbk;
        a *= C.smoothstep(e - 0.25, e + 0.15, pap.eqN(x, y));
        if (a < 0.004) continue;
      }
      // al final del trazo queda menos pintura: se abre en vetas de cerdas y deja ver lo de debajo
      const uc = u < 0 ? 0 : u > 1 ? 1 : u;
      const load = 1 + loadK * (0.35 - uc);
      if (loadK > 0 && uc > dryU) {
        const e = (uc - dryU) / (1 - dryU) * loadK * 1.4;
        const bv = stripes[((v + 1) * 31.5) | 0];
        a *= C.smoothstep(e - 0.35, e + 0.05, bv * 0.85 + 0.15 * ts[0]);
        if (a < 0.004) continue;
      }
      let sv = ts[1] * sK * C.smoothstep(0.45, 0.95, ts[0]);
      if (sv < 0) sv *= 0.55 * C.smoothstep(0.7, 1, ts[0]);
      const mz = stripes[((v + 1) * 31.5) | 0] * mixAmt;
      // más carga = tono algo más hondo; menos carga = algo más claro
      const kl = 1 - 0.1 * (load - 1) * 2;
      const br = (cr + (c2r - cr) * mz) * kl, bgc = (cg + (c2g - cg) * mz) * kl, bbc = (cb + (c2b - cb) * mz) * kl;
      let rr, gg, bb;
      if (sv < 0) { const f = 1 + (sv < -0.6 ? -0.6 : sv) * 0.55; rr = br * f; gg = bgc * f; bb = bbc * f; }
      else { const f = (sv > 1 ? 0.5 : sv * 0.5) * (0.25 + 0.75 * (0.299 * br + 0.587 * bgc + 0.114 * bbc)); rr = br + (1 - br) * f; gg = bgc + (1 - bgc) * f; bb = bbc + (1 - bbc) * f; }
      const cv = Cv[g];
      if (wet > 0 && cv > 0.05) {
        // mezcla húmeda solo con colores parecidos (nada de barro en los bordes)
        const inv = 1 / cv, ur = Pr[g] * inv, ug = Pg[g] * inv, ub = Pb[g] * inv;
        const dd = Math.abs(ur - br) + Math.abs(ug - bgc) + Math.abs(ub - bbc);
        if (dd < 0.6) {
          const mm = wet * (0.15 + 0.85 * (u < 0 ? 0 : u > 1 ? 1 : u)) * (cv > 1 ? 1 : cv) * (1 - dd / 0.6);
          rr += (ur - rr) * mm; gg += (ug - gg) * mm; bb += (ub - bb) * mm;
        }
      }
      const ia = 1 - a;
      Pr[g] = Pr[g] * ia + rr * a; Pg[g] = Pg[g] * ia + gg * a; Pb[g] = Pb[g] * ia + bb * a;
      Cv[g] = cv * ia + a;
      const a8 = (a * 255) | 0;
      if (a8 > Sc[g]) Sc[g] = a8;
      if (a > bcT) { Bc[o3] = br0; Bc[o3 + 1] = bg0; Bc[o3 + 2] = bb0; Pc[o3] = pr8; Pc[o3 + 1] = pg8; Pc[o3 + 2] = pb8; }
      if (thick > 0) {
        // relieve de la pincelada: cuerpo, surcos de las cerdas y crestas en los bordes
        const av = v < 0 ? -v : v;
        const rg = ridge * C.smoothstep(0.5, 0.82, av) * (1 - C.smoothstep(0.86, 1, av));
        Hh[g] = Hh[g] * (1 - a * 0.85) + a * thick * load * (0.45 + 0.55 * ts[0] + 0.35 * ts[1] * C.smoothstep(0.5, 0.95, ts[0]) + rg);
      }
    }
    raster.clear();
  }


  /* --- espátula: plano de pasta de borde recto, con vetas de dos colores, raspados y crestas --- */
  const endE = new Float32Array(64), skS = new Float32Array(64);
  function renderKnife(R, c, cbase, opacity, thick, tolC) {
    const n = path.n;
    if (n < 2 || path.len < 1) return;
    for (let i = 0; i < n; i++) path.rs[i] = R;
    const nt = raster.rasterize(path, 0.02);
    if (nt === 0) return;
    const cr = c[0], cg = c[1], cb = c[2];
    C.varyColor(cr, cg, cb, (rand() - 0.5) * 0.4 * (0.3 + p.varTono) * cfg.varK, (rand() - 0.5) * 0.3, (rand() < 0.5 ? -1 : 1) * (0.05 + 0.1 * rand()) * cfg.varK, col2);
    const c2r = col2[0], c2g = col2[1], c2b = col2[2];
    const mixAmt = Math.min(0.9, cfg.dual * (0.45 + 0.55 * rand()));
    const ph = rand() * 6.28, f1 = 1.5 + rand() * 3, f2 = 0.6 + rand() * 1.4, Lr = path.len / R;
    let pv = rand(), pe = rand(), ps = rand();
    for (let q = 0; q < 64; q++) {
      pv = pv * 0.6 + rand() * 0.4; stripes[q] = pv;
      pe = pe * 0.7 + rand() * 0.3; endE[q] = 0.9 + 0.1 * pe;          // filo trasero irregular (al levantar)
      ps = ps * 0.45 + rand() * 0.55; skS[q] = ps;                      // vetas raspadas
    }
    const skipK = 0.25 + 0.45 * rand();
    for (let q = 0, i = 0; q < 64; q++) {
      const sq = q / 63 * path.len;
      while (i < n - 2 && path.ss[i + 1] < sq) i++;
      let dx = path.xs[i + 1] - path.xs[i], dy = path.ys[i + 1] - path.ys[i];
      const m = Math.sqrt(dx * dx + dy * dy) || 1;
      tanX[q] = dx / m; tanY[q] = dy / m;
    }
    const tc0 = tolC * 0.85, tc1 = tolC * 1.2, near = tc0 * 255 * 0.12, ampN = R * 0.12, ampT = R * 0.25;
    const br0 = (cbase[0] * 255 + 0.5) | 0, bg0 = (cbase[1] * 255 + 0.5) | 0, bb0 = (cbase[2] * 255 + 0.5) | 0, inv3 = 1 / 255;
    const pr8 = (cr * 255 + 0.5) | 0, pg8 = (cg * 255 + 0.5) | 0, pb8 = (cb * 255 + 0.5) | 0;
    const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
    for (let t = 0; t < nt; t++) {
      const li = tl[t], g = tg[t];
      const u = U[li], v = V[li];
      const qv = ((v + 1) * 31.5) | 0;
      const endU = endE[qv];
      if (u > endU || u < -0.08) continue;
      let a = A[li] * opacity;
      if (u > endU - 0.025) a *= (endU - u) / 0.025;
      if (u < 0) a *= 1 + u / 0.08;
      // raspado: la espátula deja ver lo de debajo en vetas, más hacia el final
      const skipAmt = skipK * C.smoothstep(0.3, 1, u);
      if (skS[qv] < skipAmt) a *= 0.12 + 0.88 * C.smoothstep(skipAmt - 0.15, skipAmt, skS[qv]);
      if (a < 0.004) continue;
      const o3 = g * 3;
      if (Math.abs(clip[o3] - br0) + Math.abs(clip[o3 + 1] - bg0) + Math.abs(clip[o3 + 2] - bb0) > near) {
        const uu = u < 0 ? 0 : u > 1 ? 1 : u;
        const qb = (uu * 63 + 0.5) | 0, tx = tanX[qb], ty = tanY[qb];
        const y = (g / W) | 0, x = g - y * W;
        const offN = (stripes[qv] - 0.5) * ampN, offT = (endE[qv] - 0.95) * 10 * ampT;
        let lx = (x - ty * offN + tx * offT + 0.5) | 0, ly = (y + tx * offN + ty * offT + 0.5) | 0;
        lx = lx < 0 ? 0 : lx >= W ? W - 1 : lx; ly = ly < 0 ? 0 : ly >= H ? H - 1 : ly;
        const l3 = (ly * W + lx) * 3;
        const d = (Math.abs(clip[l3] - br0) + Math.abs(clip[l3 + 1] - bg0) + Math.abs(clip[l3 + 2] - bb0)) * inv3;
        if (d > tc0) { a *= d >= tc1 ? 0 : 1 - C.smoothstep(tc0, tc1, d); if (a < 0.004) continue; }
      }
      // dos colores arrastrados juntos: vetas marmoladas en la dirección de la espátula
      const mz = C.smoothstep(0.3, 0.7, 0.5 + 0.5 * Math.sin(u * Lr * f2 + v * f1 + ph + stripes[qv] * 3)) * mixAmt;
      const rr = cr + (c2r - cr) * mz, gg = cg + (c2g - cg) * mz, bb = cb + (c2b - cb) * mz;
      const ia = 1 - a;
      Pr[g] = Pr[g] * ia + rr * a; Pg[g] = Pg[g] * ia + gg * a; Pb[g] = Pb[g] * ia + bb * a;
      Cv[g] = Cv[g] * ia + a;
      const a8 = (a * 255) | 0;
      if (a8 > Sc[g]) Sc[g] = a8;
      if (a > 0.45) { Bc[o3] = br0; Bc[o3 + 1] = bg0; Bc[o3 + 2] = bb0; Pc[o3] = pr8; Pc[o3 + 1] = pg8; Pc[o3 + 2] = pb8; }
      // relieve: meseta lisa, cresta en los lados (pasta empujada) y al final
      const av = v < 0 ? -v : v;
      const h = thick * (0.7 + 0.75 * C.smoothstep(0.78, 0.97, av) + 0.9 * C.smoothstep(endU - 0.1, endU - 0.02, u));
      Hh[g] = Hh[g] * ia + h * a;
    }
    raster.clear();
  }

  /* --- capas de grueso a fino --- */
  const cand = { x: new Float32Array(1 << 16), y: new Float32Array(1 << 16) };
  const ex = new Float32Array(6), ey = new Float32Array(6);
  const mx = new Float32Array(6), my = new Float32Array(6), mr = new Float32Array(6), mg = new Float32Array(6), mb = new Float32Array(6);
  for (let k = 0; k < nL; k++) {
    const Rk = radii[k], ref = refs[k];
    const sp = Math.max(1, Rk * (k === 0 ? 1.1 : 0.95));
    const cols = Math.ceil(W / sp), rows = Math.ceil(H / sp);
    let cnt = 0;
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      const x = Math.min(W - 1, (gx + rand()) * sp), y = Math.min(H - 1, (gy + rand()) * sp);
      if (!fullCover) { const m = ctx.at(ctx.cover, x, y); if (m < 0.999 && rand() > m) continue; }
      if (cnt >= cand.x.length) { const nx = new Float32Array(cnt * 2); nx.set(cand.x); cand.x = nx; const ny = new Float32Array(cnt * 2); ny.set(cand.y); cand.y = ny; }
      cand.x[cnt] = x; cand.y[cnt] = y; cnt++;
    }
    const order = new Int32Array(cnt);
    const occ = k === 0 ? new Uint8Array(cols * rows) : null;
    for (let i = 0; i < cnt; i++) order[i] = i;
    S.shuffle(order, cnt, rand);
    const Lmax = Rk * cfg.Lk * (k === 0 ? 1 : 0.7);
    const tolStop = cfg.tolStop * (1 + 0.25 * (nL - 1 - k) / Math.max(1, nL - 1));
    const tolClip = cfg.tolClip * (k === 0 ? 1.25 : 1);
    const T = cfg.refineT * (1 + 0.35 * k / Math.max(1, nL - 1));
    const tool = cfg.tools ? cfg.tools[Math.min(k, cfg.tools.length - 1)] : "brush";
    const knife = tool === "knife";
    const minLen = Rk * (knife ? 1.6 : cfg.minLenK);
    const showGround = cfg.groundShow * (k === 0 ? 1 : 0.5);
    // ceras: dirección de la mano; cada capa se cruza con la anterior
    const hang = (cfg.hand || 0) + (k % 2 ? 1 : 0) * (cfg.cross || 0) * 1.2;
    const hx = Math.cos(hang), hy = Math.sin(hang), handK = cfg.handK || 0;
    for (let oi = 0; oi < cnt; oi++) {
      const ci = order[oi];
      let x = cand.x[ci], y = cand.y[ci];
      const g0 = (y | 0) * W + (x | 0);
      if (k === 0) {
        // ya pasó una pincelada por esta celda: solo se repasa a veces
        if (occ[((y / sp) | 0) * cols + ((x / sp) | 0)] && rand() > 1 - cfg.cov0 * 0.95) continue;
        if (Sc[g0] > 200 && rand() > 0.05) continue;
        // zonas amplias y lisas: ya las cubren las formas; solo algunas pinceladas encima
        if (cfg.shapeSkip && stLib.length) {
          const rg = seg.labels[Math.min(ah - 1, (y * ctx.ay) | 0) * aw + Math.min(aw - 1, (x * ctx.ax) | 0)];
          if (rand() < cfg.shapeSkip * big[rg]) continue;
        }
        if (showGround) { refAt(ref, x, y, col); const l = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2]; if (rand() < showGround * 0.6 * C.smoothstep(0.9, 0.3, l)) continue; }
      } else {
        // ¿dónde se aleja más el color pintado del de la referencia en esta celda?
        let best = -1, bi = 0, sum = 0;
        for (let j = 0; j < 5; j++) {
          const px = j === 0 ? x : C.clamp(x + (rand() - 0.5) * sp, 0, W - 1), py = j === 0 ? y : C.clamp(y + (rand() - 0.5) * sp, 0, H - 1);
          const g = (py | 0) * W + (px | 0), o3 = g * 3;
          refAt(ref, px, py, col);
          // ceras: los huecos del grano no cuentan como "sin pintar" (se mira el entorno)
          let cvN = Cv[g];
          if (cfg.media && cvN < 0.3) {
            const d2 = Math.max(2, Math.round(Rk * 0.35)), yy = py | 0, xx = px | 0;
            if (xx >= d2 && xx < W - d2 && yy >= d2 && yy < H - d2) cvN = Math.max(cvN, Cv[g - d2], Cv[g + d2], Cv[g - d2 * W], Cv[g + d2 * W]);
          }
          const e = cvN < 0.3 ? 1 : Math.abs(Bc[o3] / 255 - col[0]) + Math.abs(Bc[o3 + 1] / 255 - col[1]) + Math.abs(Bc[o3 + 2] / 255 - col[2]);
          ex[j] = px; ey[j] = py; sum += e;
          if (e > best) { best = e; bi = j; }
        }
        best = best * 0.5 + sum * 0.1;
        let Tk = T * (1.3 - 0.6 * impAt(x, y));
        if (selDetail && sel) Tk *= 1 - 0.6 * ctx.at(sel, x, y);
        if (best < Tk) continue;
        x = ex[bi]; y = ey[bi];
      }
      // color dominante alrededor de la semilla (nunca el color intermedio de un borde)
      {
        const rr = Math.max(Rk * 0.5, 2.2 / ctx.ax);
        for (let j = 0; j < 6; j++) {
          const a = j * 1.047 + rand() * 0.5, d = j === 0 ? 0 : rr * (0.4 + 0.6 * rand());
          const px = C.clamp(x + Math.cos(a) * d, 0, W - 1), py = C.clamp(y + Math.sin(a) * d, 0, H - 1);
          // muestra sin interpolar: siempre un color real de la referencia
          const ai = Math.min(ah - 1, (py * ctx.ay) | 0) * aw + Math.min(aw - 1, (px * ctx.ax) | 0);
          col[0] = ref[0][ai]; col[1] = ref[1][ai]; col[2] = ref[2][ai];
          mx[j] = px; my[j] = py; mr[j] = col[0]; mg[j] = col[1]; mb[j] = col[2];
        }
        let bj = 0, bd = 1e9;
        for (let j = 0; j < 6; j++) {
          let d = 0;
          for (let q = 0; q < 6; q++) d += Math.abs(mr[j] - mr[q]) + Math.abs(mg[j] - mg[q]) + Math.abs(mb[j] - mb[q]);
          if (d < bd) { bd = d; bj = j; }
        }
        x = mx[bj]; y = my[bj]; base[0] = mr[bj]; base[1] = mg[bj]; base[2] = mb[bj];
      }
      if (cfg.media) {
        const lb = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];
        if (lb > cfg.paperWhite) continue;                                  // el blanco lo pone el papel
        if (rand() < cfg.sparse * C.smoothstep(0.35, 0.9, lb)) continue;    // en los claros, menos trazos
      }
      // trazado (si no cabe una pincelada entera, se prueba en otra dirección)
      const ang = (rand() - 0.5) * 2 * cfg.dirJit;
      // anchos muy distintos (no solo largos): más anchos en lo poco importante
      const im0 = impAt(x, y);
      let Rs = Rk * C.clamp(Math.exp((cfg.sizeVar || 0.15) * gauss()), 0.4, 2.3) * (knife ? 1 : 1.15 - 0.3 * im0);
      // largos muy distintos: los más largos donde la forma tiene una dirección clara
      const coh0 = ctx.at(ctx.coh, x, y);
      const Lst = (knife ? Rk * cfg.knifeLk : Lmax) * C.clamp(Math.exp((cfg.lenVar || 0.3) * gauss()), 0.3, 3) * (0.7 + 0.6 * coh0);
      let len = 0;
      // siempre en la dirección de la foto: si no cabe, se prueba con un pincel más estrecho
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) Rs *= 0.7;
        len = trace(ref, x, y, base, { step: Math.max(1, Rs * (knife ? 0.8 : 1.15)), Lmax: Lst, curv: knife ? 0.03 : cfg.curv, tol: tolStop,
          ca: Math.cos(ang), sa: Math.sin(ang), fine: Rs < 6 * s, handK, hx, hy });
        if (len >= minLen * (Rs / Rk)) break;
      }
      if (len < minLen * (Rs / Rk) * 0.75) continue; // nada de toques sueltos
      // en las capas finas se continúa la pintura que ya hay alrededor (sin costuras)
      let cont = 0;
      if (k > 0) {
        let sr = 0, sg = 0, sb = 0;
        const rr = Rk * 2.2;
        for (let j = 0; j < 8; j++) {
          const a = j * 0.785 + rand() * 0.4;
          const px = (x + Math.cos(a) * rr) | 0, py = (y + Math.sin(a) * rr) | 0;
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const g = py * W + px, o3 = g * 3, cv = Cv[g];
          if (cv < 0.6) continue;
          if (Math.abs(Bc[o3] - base[0] * 255) + Math.abs(Bc[o3 + 1] - base[1] * 255) + Math.abs(Bc[o3 + 2] - base[2] * 255) > 34) continue;
          sr += Pc[o3] / 255; sg += Pc[o3 + 1] / 255; sb += Pc[o3 + 2] / 255; cont++;
        }
        if (cont >= 2) { col[0] = sr / cont; col[1] = sg / cont; col[2] = sb / cont; }
      }
      if (cont >= 2) C.varyColor(col[0], col[1], col[2], (rand() - 0.5) * 0.5 * varH, (rand() - 0.5) * 0.5 * varS, (rand() - 0.5) * 0.5 * varL, col);
      else C.varyColor(base[0], base[1], base[2], (rand() - 0.5) * 2 * varH, (rand() - 0.5) * 2 * varS, (rand() - 0.5) * 2 * varL, col);
      if (cont < 2) {
        // temperatura: blancos cremosos o azulados, sombras cálidas o frías
        const tp = (rand() - 0.5) * 2 * cfg.temp * (0.4 + p.varTono + p.varSat * 0.5);
        col[0] = C.clamp(col[0] + tp, 0, 1); col[1] = C.clamp(col[1] + tp * 0.25, 0, 1); col[2] = C.clamp(col[2] - tp, 0, 1);
      }
      if (pal) {
        // la cera más parecida de la caja (a veces la segunda: se mezclan por capas)
        let b1 = 0, b2 = 0, d1 = 1e9, d2 = 1e9;
        for (let q = 0; q < pal.K; q++) {
          const dr = col[0] - pal.r[q], dg = col[1] - pal.g[q], db = col[2] - pal.b[q];
          const d = dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.7;
          if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = q; } else if (d < d2) { d2 = d; b2 = q; }
        }
        const q = rand() < 0.28 && d2 < d1 * 4 + 0.01 ? b2 : b1;
        col[0] += (pal.r[q] - col[0]) * cfg.palK; col[1] += (pal.g[q] - col[1]) * cfg.palK; col[2] += (pal.b[q] - col[2]) * cfg.palK;
      }
      const lum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];
      const im = impAt(x, y);
      // empaste desigual: frotados finos, pinceladas normales y algunas muy cargadas
      const tr = rand();
      const tier = tr < 0.3 ? 0.15 + 0.2 * rand() : tr < 0.78 ? 0.5 + 0.35 * rand() : 1.1 + 0.6 * rand();
      const thick = cfg.thick * (0.55 + 0.45 * lum) * (0.75 + 0.25 * im) * tier * (k === 0 ? 0.85 : 1);
      const tolC = tolClip * (1 + cfg.lost * C.smoothstep(0.55, 0.15, im));
      if (knife) renderKnife(Rs, col, base, cfg.op, thick, tolC);
      else renderStroke(Rs, col, base, cfg.op * (0.9 + 0.1 * rand()), thick, tolC, k);
      if (occ) {
        // marcar las celdas que cubre el cuerpo de la pincelada
        for (let i = 0; i < path.n; i++) {
          const a = i > 0 ? i - 1 : 0, b = i < path.n - 1 ? i + 1 : i;
          let tx = path.xs[b] - path.xs[a], ty = path.ys[b] - path.ys[a];
          const m = Math.sqrt(tx * tx + ty * ty) || 1; tx /= m; ty /= m;
          for (const o of [-0.8, -0.4, 0, 0.4, 0.8]) {
            const px = path.xs[i] - ty * o * Rs, py = path.ys[i] + tx * o * Rs;
            if (px < 0 || py < 0 || px >= W || py >= H) continue;
            occ[((py / sp) | 0) * cols + ((px / sp) | 0)] = 1;
          }
        }
      }
      if ((oi & 15) === 0) await clock.tick(0.2 + 0.75 * (k + oi / cnt) / nL);
    }
  }
  if (cfg.smudge > 0) {
    // pastel seco: zonas difuminadas con el dedo (sobre todo en lo poco importante)
    const rb = Math.max(2, Math.round(cfg.R0 * 0.3));
    const tmpB = new Float32Array(N), bl = new Float32Array(N);
    const sg = Math.max(4, Math.ceil(W / 32)), sh = Math.max(4, Math.ceil(H / 32));
    const nzS = C.fbmGrid(sg, sh, Math.max(2, sg / 6), 3, ctx.seed + 91, 0.55);
    const mk = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = C.smoothstep(0.42, 0.62, C.bilinear(nzS, sg, sh, x / 32, y / 32));
      mk[y * W + x] = v * cfg.smudge * (1 - 0.6 * impAt(x, y));
    }
    for (const plane of [Pr, Pg, Pb, Cv]) {
      bl.set(plane);
      C.boxBlurH(bl, tmpB, W, H, rb); C.boxBlurV(tmpB, bl, W, H, rb);
      C.boxBlurH(bl, tmpB, W, H, rb); C.boxBlurV(tmpB, bl, W, H, rb);
      for (let i = 0; i < N; i++) { const k2 = mk[i]; if (k2 > 0.01) plane[i] += (bl[i] - plane[i]) * k2; }
      await clock.tick(0.96);
    }
  }
  await clock.tick(0.97);
  const fcfg = { reliefK: cfg.reliefK, hBlur: cfg.hBlur || 1.6, canvasTex: cfg.canvasTex, shade: cfg.shade, gloss: cfg.gloss, under: 0, R0: cfg.R0, thick: cfg.thick, glossByHeight: true, chalk: cfg.chalk };
  return { Pr, Pg, Pb, Cv, Hh, cfg: fcfg, grain: null, gsInv: 1, real: true, pap };
}

module.exports = { paint, config, dtFilter };

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
  mixtalg:    { c: [246, 243, 236], amp: 9,  kind: "paper", scale: 1.2 },
  // pastel seco: papel de color (tipo Canson Mi-Teintes)
  ceras_pastelseco: { c: [214, 204, 186], amp: 12, kind: "rough", scale: 1.1 },
  xilografia: { c: [243, 237, 224], amp: 10, kind: "paper", scale: 1.4 },
};

async function makePaper(technique, W, H, seed, clock, prep, modo) {
  const cfg = BASE[technique + "_" + modo] || BASE[technique] || BASE.lapiz;
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
    C.gaussBlur(tb, aw, ah, Math.max(1, (mode === "carbon" ? 4 : 1.5) * s / ctx.fa));
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
  const toneFloor = mode === "mixta" ? 0 : mode === "carbon" ? 0.6 : 0.35;

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
    const sketch = isContour && (mode === "boceto" || mode === "mixta");
    const sp = isContour ? Math.max(1, Rc * 3.2, sketch ? 9 * s : 0) : lib ? Math.max(1.0, R * 1.3, L * 0.16) : Math.max(1.0, R * 2.6 + 0.4 * s, L * 0.12);
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
      if (sketch) target = mode === "mixta" ? Math.min(0.8, t * 0.35 + 0.42) : Math.min(0.55, t * 0.25 + 0.3);
      else if (isContour) target = Math.min(1, t * 0.6 + 0.5);
      else target = Math.min(t, caps[j]);
      if (D[g0] >= target - 0.04) continue;

      ctx.colorAt(level, x, y, col);
      tmpc[0] = col[0]; tmpc[1] = col[1]; tmpc[2] = col[2];
      let lenMul = sketch ? 0.9 : isContour ? 0.45 : 1;
      if (selDetail && sel) lenMul *= 1 - 0.4 * ctx.at(sel, x, y);
      // boceto: la línea no calca el borde, va un poco al lado
      const jx = sketch ? (rand() - 0.5) * 3 * s : 0, jy = sketch ? (rand() - 0.5) * 3 * s : 0;
      S.traceStroke(ctx, path, C.clamp(x + jx, 0, W - 1), C.clamp(y + jy, 0, H - 1), {
        R: Rj, Lmax: L * lenMul * (0.55 + rand() * 0.9), step: Math.max(0.8, Rj * 2 + 1.5 * s),
        curv: isContour ? 0.95 : regAng ? 0.02 + 0.25 * p.curvatura : (j === 0 ? 0.05 + 0.9 * p.curvatura : 0.05 + 0.45 * p.curvatura),
        colorTol: isContour ? 0.45 : 0.55 - 0.25 * p.detalle, color: tmpc, level,
        angle: isContour ? 0 : hatchAngle(x, y, j) + (rand() - 0.5) * 0.1,
        minLen: Rj * 6, fine: isContour,
      });
      if (!isContour) S.wobblePath(path, useLib ? Rj * 0.12 : Rj * 0.6, Rj * (useLib ? 12 : 40), rand() * 6.28);
      else if (sketch) S.wobblePath(path, 0.8 * s, 60 * s, rand() * 6.28);
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
      if (isContour) prC *= (mode === "linea" || mode === "mixta" ? 1.35 : mode === "negros" ? 1.5 : mode === "boceto" ? 0.5 : 1) * (alt ? 0.55 : 1) * (opts.contourMul || 1);
      for (let tt = 0; tt < nt; tt++) {
        const li = tl[tt], g = tg[tt];
        const xx = g % W, yy = (g / W) | 0;
        let a;
        if (useLib) {
          // grafito real de la muestra + el diente del papel (siempre el mismo)
          Lib.sampleAt(st, U[li], V[li], ts);
          const tooth = pap ? 0.55 + 0.45 * C.smoothstep(0.15, 0.75, pap.eqN(xx, yy)) : 1;
          a = ts[0] * A[li] * prL * tooth;
          // el rayado no ensucia el blanco: se aclara donde la foto es clara
          if (a > 0.003) { const tl0 = ctx.at(tone, xx, yy); a *= toneFloor + (1 - toneFloor) * C.smoothstep(0.02, 0.14, tl0); }
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
  realismo:   { label: "Realismo", hint: "Alto: se parece más a la fotografía · Bajo: más abstracto" },
  luz:        { label: "Luz", hint: "Luz rasante sobre la pintura. Al mínimo no se ven los volúmenes del empaste" },
};

const PAINT = ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "varTono", "varSat", "varLuz", "detalle", "realismo", "luz"];

const TECHNIQUES = [
  {
    id: "oleo", name: "Óleo", desc: "Pinceladas cargadas sobre imprimatura, empaste en las luces",
    params: PAINT,
    variants: [
      { id: "planos", name: "Planos y espátula", values: { intensidad: 90, grosor: 52, longitud: 40, curvatura: 35, cobertura: 100, empaste: 65, varTono: 28, varSat: 30, varLuz: 26, detalle: 50 } },
      { id: "gestual", name: "Gestual", values: { intensidad: 80, grosor: 68, longitud: 70, curvatura: 65, cobertura: 92, empaste: 45, varTono: 35, varSat: 40, varLuz: 30, detalle: 40 } },
      { id: "boceto", name: "Boceto sobre imprimatura", values: { intensidad: 70, grosor: 42, longitud: 55, curvatura: 55, cobertura: 75, empaste: 30, varTono: 18, varSat: 18, varLuz: 18, detalle: 50 } },
      { id: "materico", name: "Matérico", values: { intensidad: 92, grosor: 60, longitud: 45, curvatura: 50, cobertura: 100, empaste: 90, varTono: 28, varSat: 28, varLuz: 28, detalle: 45 } },
    ],
  },
  {
    id: "lapiz", name: "Lápiz", desc: "Grafito y carboncillo en grises",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "cruzado", "detalle", "realismo"],
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
      { id: "planos", name: "Planos opacos", values: { intensidad: 95, grosor: 50, longitud: 35, curvatura: 35, cobertura: 100, empaste: 10, varTono: 8, varSat: 8, varLuz: 10, detalle: 55 } },
      { id: "expresivo", name: "Retrato expresivo", values: { intensidad: 88, grosor: 50, longitud: 40, curvatura: 55, cobertura: 100, empaste: 25, varTono: 28, varSat: 30, varLuz: 30, detalle: 55 } },
      { id: "diluido", name: "Diluido", values: { intensidad: 70, grosor: 55, longitud: 35, curvatura: 45, cobertura: 85, empaste: 5, varTono: 15, varSat: 15, varLuz: 15, detalle: 40 } },
    ],
  },
  {
    id: "acuarela", name: "Acuarela", desc: "Aguadas transparentes, bordes húmedos y pigmento",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "humedad", "granulado", "varTono", "varSat", "varLuz", "detalle", "realismo"],
    variants: [
      { id: "humeda", name: "Manchas húmedas", values: { intensidad: 78, grosor: 55, longitud: 35, curvatura: 50, cobertura: 75, humedad: 85, granulado: 40, varTono: 25, varSat: 20, varLuz: 20, detalle: 40 } },
      { id: "capas", name: "Paisaje por capas", values: { intensidad: 72, grosor: 45, longitud: 40, curvatura: 50, cobertura: 85, humedad: 50, granulado: 45, varTono: 22, varSat: 20, varLuz: 20, detalle: 50 } },
      { id: "dibujo", name: "Con dibujo", values: { intensidad: 65, grosor: 45, longitud: 40, curvatura: 50, cobertura: 75, humedad: 45, granulado: 40, varTono: 18, varSat: 15, varLuz: 15, detalle: 60 } },
      { id: "densa", name: "Densa", values: { intensidad: 92, grosor: 45, longitud: 45, curvatura: 50, cobertura: 92, humedad: 55, granulado: 60, varTono: 25, varSat: 30, varLuz: 22, detalle: 60 } },
      { id: "gotas", name: "Gotas de agua", values: { intensidad: 82, grosor: 50, longitud: 40, curvatura: 50, cobertura: 85, humedad: 75, granulado: 45, varTono: 22, varSat: 22, varLuz: 20, detalle: 50 } },
    ],
  },
  {
    id: "ceras", name: "Ceras", desc: "Óleo en barra, pastel y ceras de colores sobre el grano del papel",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "cruzado", "varTono", "varSat", "varLuz", "detalle", "realismo", "luz"],
    variants: [
      { id: "barra", name: "Óleo en barra", values: { intensidad: 88, grosor: 58, longitud: 45, curvatura: 50, cobertura: 95, empaste: 70, cruzado: 25, varTono: 25, varSat: 25, varLuz: 22, detalle: 45 } },
      { id: "pastelgraso", name: "Pastel graso", values: { intensidad: 80, grosor: 48, longitud: 40, curvatura: 55, cobertura: 92, empaste: 35, cruzado: 40, varTono: 28, varSat: 28, varLuz: 22, detalle: 55 } },
      { id: "pastelseco", name: "Pastel seco", values: { intensidad: 70, grosor: 55, longitud: 45, curvatura: 45, cobertura: 90, empaste: 5, cruzado: 35, varTono: 22, varSat: 20, varLuz: 25, detalle: 50 } },
      { id: "manley", name: "Ceras Manley", values: { intensidad: 78, grosor: 35, longitud: 55, curvatura: 40, cobertura: 88, empaste: 12, cruzado: 55, varTono: 18, varSat: 22, varLuz: 15, detalle: 55 } },
    ],
  },
  {
    id: "mixtalg", name: "Mixta L+G", desc: "Dibujo a lápiz muy presente con manchas de gouache",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "cruzado", "varTono", "varSat", "varLuz", "detalle", "realismo", "luz"],
    variants: [
      { id: "maslapiz", name: "Más lápiz", values: { intensidad: 75, grosor: 40, longitud: 45, curvatura: 50, cobertura: 40, empaste: 10, cruzado: 45, varTono: 12, varSat: 12, varLuz: 12, detalle: 70 } },
      { id: "equilibrada", name: "Equilibrada", values: { intensidad: 72, grosor: 45, longitud: 40, curvatura: 50, cobertura: 62, empaste: 12, cruzado: 35, varTono: 15, varSat: 15, varLuz: 15, detalle: 60 } },
      { id: "masgouache", name: "Más gouache", values: { intensidad: 70, grosor: 50, longitud: 38, curvatura: 50, cobertura: 85, empaste: 15, cruzado: 25, varTono: 15, varSat: 15, varLuz: 15, detalle: 55 } },
      { id: "manchas", name: "Manchas sueltas", values: { intensidad: 75, grosor: 55, longitud: 35, curvatura: 50, cobertura: 55, empaste: 10, cruzado: 30, varTono: 22, varSat: 22, varLuz: 18, detalle: 60 } },
    ],
  },
  {
    id: "xilografia", name: "Xilografía", desc: "Grabado en madera: cortes de gubia y tinta estampada",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "granulado", "detalle", "realismo"],
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
  // realismo y luz no dependen de la variante (se conservan al cambiarla)
  t.defaults = Object.assign({ modo: t.variants[0].id, realismo: 50, luz: 50 }, t.variants[0].values);
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
  const K = mode === "densa" ? 5 : mode === "humeda" || mode === "dibujo" || mode === "gotas" ? 3 : 4;
  const humX = mode === "humeda" ? 0.25 : mode === "gotas" ? 0.15 : mode === "densa" ? -0.05 : 0;
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
  // ruido fino del filo (bordes rotos, no redondeados)
  const fgw = Math.max(4, Math.ceil(ww / 2)), fgh = Math.max(4, Math.ceil(wh / 2));
  const nfX = C.fbmGrid(fgw, fgh, Math.max(2, 3 * ss), 3, ctx.seed + 806, 0.6);
  const nfY = C.fbmGrid(fgw, fgh, Math.max(2, 3 * ss), 3, ctx.seed + 807, 0.6);

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
      const famp = (1.2 + 1.4 * wet) * ss;
      const ox = (C.bilinear(nzX, gw, gh, gx, gy) - 0.5) * 2 * amp + (C.bilinear(nfX, fgw, fgh, x / 2, y / 2) - 0.5) * 2 * famp;
      const oy = (C.bilinear(nzY, gw, gh, gx, gy) - 0.5) * 2 * amp + (C.bilinear(nfY, fgw, fgh, x / 2, y / 2) - 0.5) * 2 * famp;
      const sx = C.clamp(Math.round(x + ox), 0, ww - 1), sy = C.clamp(Math.round(y + oy), 0, wh - 1);
      const r = wl[sy * ww + sx];
      m[y * ww + x] = nCover[r] > k ? 1 : 0;
    }
    // borde: húmedo = suave y con flecos; seco = nítido
    // campo suave del borde (poco desenfoque: las esquinas no se redondean);
    // el umbral se decide a resolución completa contra el grano del papel
    const soft = Float32Array.from(m);
    blur(soft, ww, wh, (0.55 + 1.1 * hum * wet) * ss, tmp);
    const cov = new Float32Array(wn);
    for (let i = 0; i < wn; i++) {
      const x = i % ww, y = (i / ww) | 0;
      const fr = (C.bilinear(nzB, gw, gh, x / 6, y / 6) - 0.5) * 0.4 * wet * hum; // flecos de floración
      cov[i] = C.clamp(soft[i] + fr, 0, 1);
    }
    // proteger las formas claras: una aguada solo invade una mancha más clara
    // cerca del borde, y menos cuanto más estrecha es (se "pinta alrededor")
    {
      const fa = 1 / ctx.ax;
      for (let i = 0; i < wn; i++) {
        const r = wl[i];
        if (nCover[r] > k || cov[i] < 0.002) continue;
        const allowed = Math.min(0.45 * amp + 0.6, 0.12 * thinW[i] + 0.3);
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
    layers.push({ cov, rim, aR, aG, aB, wet, bloom, ws: 0.04 + 0.16 * wet * hum });
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

  const edgeTile = C.makeGrainTile(ctx.seed + 808, "paper");
  const etInv = 1 / Math.max(1, Math.sqrt(s) * 1.4);
  /* ---------- gotas de agua sobre la aguada húmeda ---------- */
  // Cada gota empuja el pigmento hacia fuera: centro lavado, anillo oscuro de coliflor,
  // gotitas satélite y, en las grandes, un corrimiento hacia abajo.
  let dropMul = null;
  if (mode === "gotas") {
    dropMul = new Float32Array(N).fill(1);
    const rnd = C.mulberry32(ctx.seed * 97 + 5);
    const ang = new Float32Array(64);
    const nDrops = Math.round((10 + 26 * p.humedad) * Math.sqrt(W * H) / 1400);
    const rMin = 5 * s, rMax = (24 + 40 * p.grosor) * s;
    const drop = (cx, cy, r, strength) => {
      // borde irregular: radio que cambia con el ángulo (lóbulos de coliflor)
      let a0 = rnd(), a1 = rnd(), a2 = rnd();
      for (let q = 0; q < 64; q++) { a0 = a0 * 0.8 + rnd() * 0.2; a1 = a1 * 0.5 + rnd() * 0.5; a2 = a2 * 0.2 + rnd() * 0.8; ang[q] = 1 + (a0 - 0.5) * 0.55 + (a1 - 0.5) * 0.22 + (a2 - 0.5) * 0.08; }
      for (let q = 56; q < 64; q++) ang[q] += (ang[0] - ang[q]) * (q - 55) / 9; // cerrar el contorno
      const R = r * 1.45;
      const x0 = Math.max(0, (cx - R) | 0), x1 = Math.min(W - 1, (cx + R) | 0), y0 = Math.max(0, (cy - R) | 0), y1 = Math.min(H - 1, (cy + R) | 0);
      const rimW = 0.22 + 0.12 * rnd(), sc = 1 / Math.max(2, r * 0.18);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        const th = Math.atan2(dy, dx), qf = (th / 6.2832 + 0.5) * 63.999, q0 = qf | 0;
        const rr = r * (ang[q0] + (ang[(q0 + 1) & 63] - ang[q0]) * (qf - q0));
        // filo de coliflor: ruido a la escala de la gota y grano del papel
        const nb = C.bilinear(bloomF, bgw, bgh, (x * sc) % (bgw - 1), (y * sc) % (bgh - 1)) - 0.5;
        const g = C.tileAt(edgeTile, x * etInv * 0.7, y * etInv * 0.7) - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) / rr + nb * 0.35 + g * 0.05;
        if (d > 1.12) continue;
        let m;
        if (d < 1 - rimW) m = 1 - strength * (0.5 - 0.2 * Math.pow(Math.max(0, d) / (1 - rimW), 2));     // centro lavado
        else if (d < 1) m = 1 - strength * 0.3 + strength * 1.05 * C.smoothstep(1 - rimW, 1, d);       // el pigmento se acumula hacia el filo
        else m = 1 + strength * 0.75 * (1 - C.smoothstep(1, 1.12, d));                                   // fleco que se abre
        dropMul[y * W + x] *= m;
      }
    };
    for (let k = 0; k < nDrops; k++) {
      // las gotas caen donde hay color
      let cx = 0, cy = 0;
      for (let t = 0; t < 6; t++) {
        cx = rnd() * W; cy = rnd() * H;
        const r = wl[Math.min(wh - 1, (cy / qy) | 0) * ww + Math.min(ww - 1, (cx / qx) | 0)];
        if (nCover[r] > 0) break;
      }
      const r = rMin + (rMax - rMin) * Math.pow(rnd(), 2.2);
      const st = 0.75 + 0.25 * rnd();
      drop(cx, cy, r, st);
      // gotitas satélite al salpicar
      const ns = (rnd() * 3) | 0;
      for (let j = 0; j < ns; j++) {
        const a = rnd() * 6.28, dd = r * (1.4 + 1.2 * rnd());
        drop(cx + Math.cos(a) * dd, cy + Math.sin(a) * dd, Math.max(rMin, r * (0.15 + 0.2 * rnd())), st * 0.7);
      }
      // corrimiento: el agua de las gotas grandes baja arrastrando pigmento
      if (r > rMin + (rMax - rMin) * 0.35 && rnd() < 0.35) {
        const L = r * (2 + 4 * rnd()), w0 = r * (0.18 + 0.12 * rnd());
        let x = cx + (rnd() - 0.5) * r * 0.5;
        for (let t = 0; t < L; t += 1) {
          x += (rnd() - 0.5) * 0.6;
          const y = (cy + r * 0.8 + t) | 0;
          if (y >= H) break;
          const w = w0 * (1 - 0.6 * t / L);
          for (let xx = Math.max(0, (x - w - 1) | 0); xx <= Math.min(W - 1, (x + w + 1) | 0); xx++) {
            const e = Math.abs(xx - x) / w;
            if (e > 1) continue;
            dropMul[y * W + xx] *= 0.7 + 0.55 * C.smoothstep(0.45, 1, e);
          }
        }
        drop(x, cy + r * 0.8 + L, w0 * 1.3, 0.9); // gota al final del corrimiento
      }
      if ((k & 7) === 0) await clock.tick(0.7);
    }
  }

  /* ---------- composición a resolución completa ---------- */
  const out = new Uint8Array(N * 4);
  const selFull = ctx.selFull, data = ctx.data, comp = ctx.comp, srcA = ctx.srcAlpha;
  const granK = 0.06 + 0.75 * p.granulado;
  const rimK = 0.45 + 0.9 * p.detalle;
  const turbK = 0.2 + 0.25 * p.humedad;
  const dnK = 0.55 + 0.4 * p.intensidad;
  const cover = ctx.cover, fullCover = p.cobertura >= 0.995;
  const L0 = layers.length;
  const edgeG = 0.3 + 0.25 * p.granulado, edgeF = 0.22, dryK = 0.35 + 0.5 * p.granulado;
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
        const cf = Lk.cov[i00] * w00 + Lk.cov[i10] * w10 + Lk.cov[i01] * w01 + Lk.cov[i11] * w11;
        if (cf < 0.02) continue;
        // filo roto: el agua se detiene en las fibras del papel
        const fn = C.tileAt(edgeTile, x * etInv, y * etInv);
        const ws = Lk.ws;
        let cv = cf >= 0.98 ? 1 : C.smoothstep(0.5 - ws, 0.5 + ws, cf + (gr - 0.5) * edgeG + (fn - 0.5) * edgeF);
        // pincel seco en el filo de las aguadas más secas: el papel asoma en los picos
        if (Lk.wet < 0.5 && cf < 0.95 && cv > 0) {
          const band = C.smoothstep(0.45, 0.6, cf) * (1 - C.smoothstep(0.7, 0.92, cf));
          cv *= 1 - dryK * (1 - Lk.wet) * band * C.smoothstep(0.5, 0.75, gr * 0.7 + fn * 0.3);
        }
        if (k === 0) cv *= 1 - (gap[i00] * w00 + gap[i10] * w10 + gap[i01] * w01 + gap[i11] * w11);
        if (cv < 0.002) continue;
        const rm = Lk.rim[i00] * w00 + Lk.rim[i10] * w10 + Lk.rim[i01] * w01 + Lk.rim[i11] * w11;
        // densidad: anillo de borde, turbulencia y granulado (más en el anillo y en lo oscuro)
        const bl = Lk.bloom[i00] * w00 + Lk.bloom[i10] * w10 + Lk.bloom[i01] * w01 + Lk.bloom[i11] * w11;
        const dens = (1 + rimK * rm) * (1 + turbK * (tu - 0.5) * 2 * (0.6 + Lk.wet)) *
                     (1 + granK * (0.5 - gr) * (0.25 + 1.9 * rm + 0.6 * Lk.wet)) * bl *
                     (ltiles[k] ? 1 + tileK * Math.max(-2, Math.min(2, ltiles[k].l(x, y))) : 1);
        const dm = dropMul && Lk.wet > 0.5 ? dropMul[i] : 1;
        const f = cv * (dens < 0.1 ? 0.1 : dens) * dm;
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
  // (solo en la expresiva: en las demás la forma la definen los cortes, sin perfil gris)
  if (expr && p.detalle > 0.05) {
    const thr = 0.5 - 0.3 * p.detalle;
    const cw = Math.max(0.7, (0.6 + 1.6 * p.grosor) * s * (expr ? 1.6 : 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const e = ctx.at(ctx.edgeRaw, x, y);
      if (e < thr) continue;
      const i = y * W + x;
      const k = C.smoothstep(thr, thr + 0.12, e);
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
          // filo mellado de la plancha de color (la gubia no sigue la forma al píxel)
          const jx = (C.bilinear(wob, gw, gh, x / 24 + 20 * k, y / 24) - 0.5) * 3 * s + (C.hash2(x >> 1, y >> 1, 41 + k) - 0.5) * 1.5;
          const jy = (C.bilinear(wob, gw, gh, x / 24, y / 24 + 20 * k) - 0.5) * 3 * s;
          const sx = C.clamp((x - ox + jx) | 0, 0, W - 1), sy2 = C.clamp((sy + jy) | 0, 0, H - 1);
          const r = Lfull[sy2 * W + sx];
          if (regInk[r] !== k) continue;
          const i = y * W + x;
          // presión desigual (zonas más pálidas) y veta de la madera en la tinta de color
          let a = 0.95 * inkStr * (0.86 + 0.28 * (C.bilinear(press, gw, gh, x / 24 + k * 13, y / 24) - 0.5));
          if (mad) a *= 1 - 0.35 * C.smoothstep(0.55, 0.9, mad(x * 0.9 + 77 * k, y * 0.9));
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
      let pr = Math.min(1, inkStr * (0.95 + 0.18 * (C.bilinear(press, gw, gh, x / 24, y / 24) - 0.5)));
      if (a > 0.01) {
        // moteado: poros sin tinta, más en el centro de las masas grandes
        const deep = C.smoothstep(0.75, 0.98, it);
        let speck = C.smoothstep(0.975 - 0.02 * gran, 0.995, C.hash2(x >> 1, y >> 1, 17));
        if (imp) speck = Math.max(speck, C.smoothstep(0.18, 0.04, imp(x, y)) * 0.8);
        pr *= 1 - gran * deep * speck * 0.9;
        // veta de la madera en las masas
        if (mad) pr *= 1 - (madM * 1.4 + 0.08) * (0.4 + gran) * deep * C.smoothstep(0.74, 0.96, mad(x, y));
        a *= pr;
      } else if (it < 0.04) {
        // restos de madera en los vaciados grandes, alineados con el corte
        if (mad) {
          const gv = mad(x * 0.7 + 40, y * 0.7);
          const chat = C.smoothstep(0.86, 0.95, gv) * C.smoothstep(0.04, 0.0, it) * 0.85 * (0.4 + 0.6 * p.granulado);
          if (chat > 0.02 && C.hash2(x >> 3, y >> 3, 23) > (color ? 0.85 : 0.65)) a = Math.min(1, chat * 1.1);
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
