"use strict";
/*
 * Trazo · Lápiz (boceto a lápiz)
 *
 * Método de Lu, Xu y Jia (NPAR 2012, «Combining Sketch and Tone for Pencil
 * Drawing Production»), adaptado:
 *  1) LÍNEAS — cada punto de borde de la foto se dibuja como un segmento a lo
 *     largo del borde (dirección del tensor de estructura). Al acumularse, salen
 *     líneas de dibujante que se pasan un poco en las puntas y se cruzan en las
 *     esquinas; más oscuras donde el borde es más fuerte.
 *  2) TONO — el histograma de la foto se ajusta al de un dibujo a lápiz real:
 *     mucho papel blanco, una capa amplia de medios tonos y pocos oscuros.
 *  3) RAYADO — el tono se dibuja con una textura de rayado hecha con trazos
 *     reales de grafito (TEXTURES): T = H^β, así cada zona oscura es la misma
 *     textura «con más pasadas». En las sombras se cruza con un segundo rayado.
 *  4) PAPEL — el grafito se queda en los picos del grano del papel; nunca llega
 *     al negro y brilla donde está muy cargado (el carboncillo, negro mate).
 * Variantes: línea suelta, rayado, carboncillo y negros expresivos.
 */
const C = require("./core.js");
const Lib = require("./library.js");
const K = require("./kit.js");

/* ---------- filtro que conserva bordes (transformada de dominio), un canal ---------- */
function dtFilter1(I0, w, h, sigmaS, sigmaR, iters) {
  const n = w * h, I = Float32Array.from(I0), ratio = sigmaS / sigmaR;
  const dH = new Uint16Array(n), dV = new Uint16Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x > 0) dH[i] = (Math.abs(I0[i] - I0[i - 1]) * 768 + 0.5) | 0;
    if (y > 0) dV[i] = (Math.abs(I0[i] - I0[i - w]) * 768 + 0.5) | 0;
  }
  const tab = new Float32Array(770);
  for (let it = 0; it < iters; it++) {
    const sH = sigmaS * Math.sqrt(3) * Math.pow(2, iters - (it + 1)) / Math.sqrt(Math.pow(4, iters) - 1);
    const la = -Math.SQRT2 / Math.max(0.05, sH);
    for (let j = 0; j < 770; j++) tab[j] = Math.exp(la * (1 + ratio * j / 256));
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 1; x < w; x++) { const i = row + x; I[i] += tab[dH[i] > 769 ? 769 : dH[i]] * (I[i - 1] - I[i]); }
      for (let x = w - 2; x >= 0; x--) { const i = row + x; I[i] += tab[dH[i + 1] > 769 ? 769 : dH[i + 1]] * (I[i + 1] - I[i]); }
    }
    for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; I[i] += tab[dV[i] > 769 ? 769 : dV[i]] * (I[i - w] - I[i]); }
    for (let y = h - 2; y >= 0; y--) for (let x = 0; x < w; x++) { const i = y * w + x; I[i] += tab[dV[i + w] > 769 ? 769 : dV[i + w]] * (I[i + w] - I[i]); }
  }
  return I;
}

/* ---------- variantes ---------- */
function config(p, s) {
  const m = p.modo;
  // pesos de la distribución tonal de Lu et al.: papel blanco · medios tonos · oscuros
  const c = {
    w: [50, 40, 10], lineK: 0.75, lineLen: 1, toneK: 1, hatchW: 1, hatchLen: 1, cross: 0.25 + 0.75 * p.cruzado,
    charcoal: false, smudge: 0, lineBlur: 0, handAng: -0.82, hatchDense: 1, gThr: 0.07,
  };
  if (m === "linea") Object.assign(c, { w: [74, 23, 3], lineK: 1.0, lineLen: 1.35, toneK: 0.7, hatchDense: 0.8, cross: 0.15 + 0.4 * p.cruzado });
  if (m === "carbon") Object.assign(c, { w: [45, 37, 18], lineK: 0.7, lineLen: 0.9, charcoal: true, smudge: 0.55, lineBlur: 1.4, hatchW: 2.2, hatchLen: 0.8, hatchDense: 1.15 });
  if (m === "negros") Object.assign(c, { w: [42, 33, 25], lineK: 0.95, lineLen: 1.1, hatchW: 1.25, hatchDense: 1.2, cross: 0.4 + 0.6 * p.cruzado });
  if (m === "boceto") Object.assign(c, { w: [88, 11, 1], lineK: 0.6, lineLen: 1.2, toneK: 0, gThr: 0.1 });
  if (m === "mixta") Object.assign(c, { w: [70, 26, 4], lineK: 0.85, lineLen: 1.25 });
  // realismo: más alto, el tono se ajusta más a la foto y las líneas recogen más detalle
  const d = (p.realismo === undefined ? 0.5 : p.realismo) - 0.5;
  c.gThr = Math.max(0.02, c.gThr * (1 - d * 1.2));
  c.lineLen *= 1 - d * 0.5;
  c.real = d;
  return c;
}

/* ---------- distribución tonal objetivo y ajuste de histograma ---------- */
function targetCDF(w) {
  const sb = 9 / 255, ua = 105 / 255, ub = 225 / 255, md = 90 / 255, sd = 11 / 255;
  const pdf = new Float64Array(256);
  let tot = 0;
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    const p1 = Math.exp(-(1 - v) / sb) / sb;
    const p2 = v >= ua && v <= ub ? 1 / (ub - ua) : 0;
    const p3 = Math.exp(-((v - md) * (v - md)) / (2 * sd * sd)) / (Math.sqrt(2 * Math.PI) * sd);
    pdf[i] = w[0] * p1 + w[1] * p2 + w[2] * p3;
    tot += pdf[i];
  }
  const cdf = new Float64Array(256);
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += pdf[i] / tot; cdf[i] = acc; }
  return cdf;
}

/* ---------- textura de rayado con trazos reales de grafito ---------- */
function hatchTile(lib, TS, cfg, p, s, rand) {
  const H = new Float32Array(TS * TS).fill(1);
  const ts = new Float32Array(2);
  const width = (2.2 + 5.5 * p.grosor) * s * cfg.hatchW;            // ancho de la mina (px)
  const len = (34 + 110 * p.longitud) * s * cfg.hatchLen;            // largo de cada trazo
  const pool = lib.filter((m) => (m.aspect || m.h / m.w) > 3.5 && (m.aspect || m.h / m.w) < 30 && m.fill > 0.45);
  const L = pool.length ? pool : lib;
  // parches de trazos paralelos (como se raya de verdad), solapados al azar
  const area = TS * TS;
  let covered = 0;
  const target = area * 0.55 * cfg.hatchDense;
  let guard = 0;
  while (covered < target && guard++ < 20000) {
    const cx0 = rand() * TS, cy0 = rand() * TS;
    const ang = cfg.handAng + (rand() - 0.5) * 0.22;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const nStr = 5 + ((rand() * 10) | 0);
    const gap = width * (0.9 + 0.7 * rand());
    const pres0 = 0.28 + 0.42 * rand();
    for (let k = 0; k < nStr; k++) {
      const Lk = len * (0.7 + 0.5 * rand());
      const off = (k - nStr / 2) * gap;
      const cx = cx0 - sa * off + ca * (rand() - 0.5) * len * 0.25, cy = cy0 + ca * off + sa * (rand() - 0.5) * len * 0.25;
      const Rr = width / 2 / 0.7;
      const st = Lib.prepare(Lib.pick(L, rand), Lk, Rr, rand, 0.9);
      const pres = Math.min(0.92, pres0 * (0.8 + 0.4 * rand()));
      const ex = Math.abs(ca) * Lk / 2 + Math.abs(sa) * Rr + 2, ey = Math.abs(sa) * Lk / 2 + Math.abs(ca) * Rr + 2;
      for (let yy = Math.floor(cy - ey); yy <= Math.ceil(cy + ey); yy++) {
        for (let xx = Math.floor(cx - ex); xx <= Math.ceil(cx + ex); xx++) {
          const dx = xx - cx, dy = yy - cy;
          const along = dx * ca + dy * sa, across = -dx * sa + dy * ca;
          const v = across / (Rr * 0.9);
          if (v < -1 || v > 1) continue;
          const u = along / Lk + 0.5;
          if (u < -0.05 || u > 1.05) continue;
          Lib.sampleAt(st, u, v, ts);
          const a = ts[0] * pres;
          if (a < 0.01) continue;
          const tx = ((xx % TS) + TS) % TS, ty = ((yy % TS) + TS) % TS;
          H[ty * TS + tx] *= 1 - a;
        }
      }
      covered += Lk * width * pres;
    }
  }
  let mean = 0;
  for (let i = 0; i < area; i++) { if (H[i] < 0.04) H[i] = 0.04; mean += H[i]; }
  return { H, TS, mean: mean / area };
}

async function paint(ctx, p, clock, seg, Lfull, opts) {
  opts = opts || {};
  const { W, H, N, s, data, comp } = ctx;
  const cfg = config(p, s);
  const rand = C.mulberry32(ctx.seed * 13 + 3);
  const only = opts.only || null;
  const doLines = only !== "tono", doTone = only !== "lineas" && cfg.toneK > 0;
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H), ctx.physMM)) : null;

  /* --- gris a resolución completa --- */
  const I = new Float32Array(N);
  for (let i = 0; i < N; i++) { const o = i * comp; I[i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255; }
  await clock.tick(0.04);

  /* --- 1) LÍNEAS a resolución de trabajo --- */
  const lw = Math.min(1, 2000 / Math.max(W, H));
  const ww = Math.max(8, Math.round(W * lw)), wh = Math.max(8, Math.round(H * lw));
  const sw = Math.max(ww, wh) / 1000;
  let lines = null;
  let Is = null;
  {
    const Iw = ww === W && wh === H ? Float32Array.from(I) : C.resample(I, W, H, ww, wh);
    // sin la textura menuda de la foto: las líneas salen de las formas, no del ruido
    Is = dtFilter1(Iw, ww, wh, (2 + 9 * (1 - p.detalle)) * sw, 0.12 + 0.1 * (1 - p.detalle), 2);
    await clock.tick(0.12);
  }
  if (doLines) {
    const G = new Float32Array(ww * wh);
    for (let y = 1; y < wh - 1; y++) for (let x = 1; x < ww - 1; x++) {
      const i = y * ww + x;
      const gx = (Is[i - ww + 1] + 2 * Is[i + 1] + Is[i + ww + 1] - Is[i - ww - 1] - 2 * Is[i - 1] - Is[i + ww - 1]) * 0.125;
      const gy = (Is[i + ww - 1] + 2 * Is[i + ww] + Is[i + ww + 1] - Is[i - ww - 1] - 2 * Is[i - ww] - Is[i - ww + 1]) * 0.125;
      G[i] = Math.sqrt(gx * gx + gy * gy);
    }
    const g99 = C.percentile(G, 0.992) || 1e-3;
    const thr = cfg.gThr;
    for (let i = 0; i < G.length; i++) { const v = G[i] / g99 - thr; G[i] = v <= 0 ? 0 : v / (1 - thr); }
    // cada punto de borde se dibuja como un segmento a lo largo del borde
    const Sacc = new Float32Array(ww * wh);
    const Lh = Math.max(4, Math.round(Math.max(ww, wh) / 75 * (0.6 + 0.9 * p.longitud) * cfg.lineLen));
    const wt = new Float32Array(2 * Lh + 1);
    for (let k = -Lh; k <= Lh; k++) { const t = k / Lh; wt[k + Lh] = 1 - t * t; }
    const f = new Float32Array(2), fx = W / ww;
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        const g = G[y * ww + x];
        if (g < 0.02) continue;
        ctx.flowAt(x * fx, y * fx, f, true);
        const tx = f[0], ty = f[1];
        for (let k = -Lh; k <= Lh; k++) {
          const px = x + tx * k, py = y + ty * k;
          if (px < 0 || py < 0 || px >= ww - 1 || py >= wh - 1) continue;
          const x0 = px | 0, y0 = py | 0, ax = px - x0, ay = py - y0, w0 = g * wt[k + Lh];
          const o = y0 * ww + x0;
          Sacc[o] += w0 * (1 - ax) * (1 - ay); Sacc[o + 1] += w0 * ax * (1 - ay);
          Sacc[o + ww] += w0 * (1 - ax) * ay; Sacc[o + ww + 1] += w0 * ax * ay;
        }
      }
      if ((y & 31) === 0) await clock.tick(0.12 + 0.3 * y / wh);
    }
    if (cfg.lineBlur > 0) { const tmp = new Float32Array(ww * wh); C.gaussBlur(Sacc, ww, wh, cfg.lineBlur * sw, tmp); }
    const s99 = C.percentile(Sacc, 0.995) || 1e-3;
    const lk = cfg.lineK * (0.55 + 0.6 * p.intensidad) * (opts.lineMul || 1);
    for (let i = 0; i < Sacc.length; i++) { const v = Sacc[i] / s99; Sacc[i] = (v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, 0.8)) * lk; }
    lines = Sacc;
  }
  await clock.tick(0.45);

  /* --- 2) TONO: histograma de dibujo a lápiz --- */
  let T = null;
  if (doTone) {
    // con menos realismo, el tono se simplifica (manchas de valor en vez del detalle de la foto)
    const simp = C.clamp(0.55 - cfg.real * 1.1, 0, 1);
    const hist = new Float64Array(256);
    const Tin = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      const ay = (y + 0.5) * wh / H - 0.5;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const v = I[i] + (C.bilinear(Is, ww, wh, (x + 0.5) * ww / W - 0.5, ay) - I[i]) * simp;
        Tin[i] = v;
        hist[Math.min(255, Math.max(0, (v * 255) | 0))]++;
      }
      if ((y & 63) === 0) await clock.tick(0.45 + 0.05 * y / H);
    }
    const cdf = new Float64Array(256);
    let acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i] / N; cdf[i] = acc; }
    const tc = targetCDF(cfg.w);
    const map = new Float32Array(256);
    for (let i = 0, j = 0; i < 256; i++) { while (j < 255 && tc[j] < cdf[i]) j++; map[i] = j / 255; }
    const lift = (1 - p.cobertura) * 0.45;
    const tk = cfg.toneK * (opts.toneMul || 1);
    T = Tin;
    for (let i = 0; i < N; i++) {
      const v = map[Math.min(255, Math.max(0, (T[i] * 255) | 0))];
      let t = 1 - (1 - v) * tk;
      t = 1 - (1 - t) * (1 - lift);
      T[i] = t < 0.02 ? 0.02 : t;
    }
  }
  await clock.tick(0.55);

  /* --- 3) RAYADO con trazos reales --- */
  const libSrc = cfg.charcoal ? (ctx.strokesOf && (ctx.strokesOf(["pin_cera", "pin_pastel"]) || ctx.strokesOf(["pin_lapiz"]))) : ((ctx.strokesOf && ctx.strokesOf(["pin_lapiz"])) || ctx.lib);
  const lib = libSrc && libSrc.samples && libSrc.samples.length ? libSrc.samples : Lib.synthetic("lapiz");
  let tile = null, tile2 = null;
  if (doTone) {
    const TS = Math.max(256, Math.min(2048, Math.round(560 * s)));
    tile = hatchTile(lib, TS, cfg, p, s, rand);
    if (cfg.cross > 0.02) {
      // segundo rayado, en otra dirección, para las sombras
      tile2 = hatchTile(lib, TS, Object.assign({}, cfg, { handAng: cfg.handAng + 1.25 + (rand() - 0.5) * 0.3 }), p, s, rand);
    }
    if (cfg.smudge > 0) {
      // carboncillo: parte del rayado difuminado con el dedo
      const tmp = new Float32Array(TS * TS), b = Float32Array.from(tile.H);
      C.gaussBlur(b, TS, TS, 2.5 * s, tmp);
      for (let i = 0; i < b.length; i++) tile.H[i] += (b[i] - tile.H[i]) * cfg.smudge;
    }
  }
  await clock.tick(0.65);

  /* --- 4) composición sobre el papel --- */
  // ángulo del rayado por zona: con curvatura, cada plano se raya en su dirección (si la tiene clara)
  let regRot = null;
  if (doTone && seg && Lfull && p.curvatura > 0.3) {
    const reg = seg.reg;
    regRot = new Float32Array(reg.n * 2);
    for (let r = 0; r < reg.n; r++) {
      const th = 0.5 * Math.atan2(reg.os[r], reg.oc[r]);
      let d = th - cfg.handAng;
      while (d > Math.PI / 2) d -= Math.PI; while (d < -Math.PI / 2) d += Math.PI;
      const k = reg.coh[r] > 0.45 ? C.clamp((p.curvatura - 0.3) * 1.2, 0, 0.7) : 0;
      d = C.clamp(d * k, -0.6, 0.6);
      regRot[r * 2] = Math.cos(d); regRot[r * 2 + 1] = Math.sin(d);
    }
  }
  const out = new Uint8Array(N * 4);
  const selFull = ctx.selFull, srcA = ctx.srcAlpha;
  const charcoal = cfg.charcoal;
  const gr0 = charcoal ? 0.07 : 0.15, gg0 = charcoal ? 0.065 : 0.155, gb0 = charcoal ? 0.06 : 0.18;
  const dMax = charcoal ? 0.97 : 0.9;
  const ovc = charcoal && ctx.assets && ctx.assets.ov_carbon && ctx.assets.ov_carbon.items.length ? K.overlaySampler(ctx.assets.ov_carbon.items[0], W, H) : null;
  const lnMean = tile ? Math.log(tile.mean) : -0.5, ln2Mean = tile2 ? Math.log(tile2.mean) : -0.5;
  const TSz = tile ? tile.TS : 1;
  for (let y = 0; y < H; y++) {
    const ly = (y + 0.5) * wh / H - 0.5;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let R = 1;
      if (T) {
        const t = T[i];
        if (t < 0.995) {
          // β: cuántas "pasadas" de la misma textura hacen falta para ese tono
          const beta = Math.log(t) / lnMean;
          let ux = x, uy = y;
          if (regRot) { const r = Lfull[i], c = regRot[r * 2], sn = regRot[r * 2 + 1]; ux = x * c - y * sn; uy = x * sn + y * c; }
          const tx = ((ux | 0) % TSz + TSz) % TSz, ty = ((uy | 0) % TSz + TSz) % TSz;
          const h1 = tile.H[ty * TSz + tx];
          let cr = 0;
          if (tile2) cr = cfg.cross * C.smoothstep(0.62, 0.22, t);
          R = Math.pow(h1, beta * (1 - cr));
          if (cr > 0) { const h2 = tile2.H[ty * TSz + tx]; R *= Math.pow(h2, beta * cr * lnMean / ln2Mean); }
        }
      }
      if (lines) {
        const lv = C.bilinear(lines, ww, wh, (x + 0.5) * ww / W - 0.5, ly);
        R *= 1 - (lv > 1 ? 1 : lv);
      }
      let D = 1 - R;
      if (D < 0.004) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255; out[i * 4 + 3] = 0; continue; }
      // el grafito se queda en los picos del papel; lo cargado llena también los valles
      if (pap) { const g = pap.eqN(x, y); D *= 1 - 0.55 * (1 - g) * (1 - D) * (1 - D); }
      if (ovc) D *= 0.9 + 0.2 * ovc(x, y);
      let a = D > dMax ? dMax + (D - dMax) * 0.15 : D;
      let r = gr0, g = gg0, b = gb0;
      if (!charcoal && D > 0.6) {
        // brillo del grafito bruñido
        const sh = C.smoothstep(0.65, 0.98, D) * 0.32;
        r += (0.3 - r) * sh; g += (0.31 - g) * sh; b += (0.35 - b) * sh;
      }
      if (selFull) a *= selFull[i] / 255;
      if (srcA) a *= data[i * comp + 3] / 255;
      const o = i * 4;
      out[o] = (r * 255 + 0.5) | 0; out[o + 1] = (g * 255 + 0.5) | 0; out[o + 2] = (b * 255 + 0.5) | 0;
      out[o + 3] = a <= 0 ? 0 : a >= 1 ? 255 : (a * 255 + 0.5) | 0;
    }
    if ((y & 31) === 0) await clock.tick(0.65 + 0.35 * y / H);
  }
  return out;
}

module.exports = { paint };
