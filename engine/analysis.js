"use strict";
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
