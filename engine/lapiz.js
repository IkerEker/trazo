"use strict";
/*
 * Trazo · Lápiz (a la manera del efecto «Lápiz» de Word / Office)
 *
 * Cómo se ve ese efecto (y un dibujo a lápiz real bien sombreado):
 *  · El TONO es el de la foto: los oscuros son oscuros y las luces, papel. No
 *    hay contornos negros: los bordes salen del propio contraste, algo realzado.
 *  · Encima, un GARABATO de trazos de grafito finos en muchas direcciones (unos
 *    siguen la forma, otros no), que hace vibrar el tono: en los medios tonos se
 *    ven mucho, en las luces apenas, y en las sombras dejan huecos más claros.
 *  · Grano del papel y el brillo del grafito; nunca negro puro.
 * Lo que NO hace (lo que delata un filtro barato): contornos gruesos negros,
 * ruido granulado, blancos quemados, rayado mecánico de una sola dirección.
 *
 * Los trazos del garabato son trazos reales de grafito (TEXTURES → pin_lapiz).
 * Variantes: línea suelta, rayado (tono completo), carboncillo, negros expresivos.
 */
const C = require("./core.js");
const Lib = require("./library.js");
const K = require("./kit.js");

/* ---------- filtro que conserva bordes (un canal) para simplificar el tono ---------- */
function dtFilter1(I0, w, h, sigmaS, sigmaR, iters) {
  const n = w * h, I = Float32Array.from(I0), ratio = sigmaS / sigmaR;
  const dH = new Uint16Array(n), dV = new Uint16Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x > 0) dH[i] = Math.min(769, (Math.abs(I0[i] - I0[i - 1]) * 768 + 0.5) | 0);
    if (y > 0) dV[i] = Math.min(769, (Math.abs(I0[i] - I0[i - w]) * 768 + 0.5) | 0);
  }
  const tab = new Float32Array(770);
  for (let it = 0; it < iters; it++) {
    const sH = sigmaS * Math.sqrt(3) * Math.pow(2, iters - (it + 1)) / Math.sqrt(Math.pow(4, iters) - 1);
    const la = -Math.SQRT2 / Math.max(0.05, sH);
    for (let j = 0; j < 770; j++) tab[j] = Math.exp(la * (1 + ratio * j / 256));
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 1; x < w; x++) { const i = row + x; I[i] += tab[dH[i]] * (I[i - 1] - I[i]); }
      for (let x = w - 2; x >= 0; x--) { const i = row + x; I[i] += tab[dH[i + 1]] * (I[i + 1] - I[i]); }
    }
    for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; I[i] += tab[dV[i]] * (I[i - w] - I[i]); }
    for (let y = h - 2; y >= 0; y--) for (let x = 0; x < w; x++) { const i = y * w + x; I[i] += tab[dV[i + w]] * (I[i + w] - I[i]); }
  }
  return I;
}

/* ---------- variantes ---------- */
function config(p) {
  const m = p.modo;
  const c = {
    toneK: 1, gamma: 1, lc: 0.55, cov: 1.5, lenK: 1, widK: 1, ampL: 0.04, ampD: 0.62, ampG: 0.45,
    flow: 0.5 + 0.4 * p.curvatura, charcoal: false, smudge: 0, dMax: 0.9, lines: 0, contrast: 0,
  };
  if (m === "linea") Object.assign(c, { toneK: 0.5, lc: 0.9, cov: 1.0, lenK: 1.25, ampL: 0.03, ampD: 0.75, lines: 0.75 });
  if (m === "carbon") Object.assign(c, { toneK: 1.08, gamma: 0.88, lc: 0.4, cov: 1.3, widK: 2.4, lenK: 0.85, ampD: 0.38, ampG: 0.3, charcoal: true, smudge: 0.55, dMax: 0.97 });
  if (m === "negros") Object.assign(c, { toneK: 1.06, gamma: 0.92, lc: 0.65, cov: 1.8, contrast: 0.35, ampD: 0.68, widK: 1.15 });
  // realismo: alto = tono fiel y trazo fino; bajo = tono simplificado y garabato más presente
  const d = (p.realismo === undefined ? 0.5 : p.realismo) - 0.5;
  c.simp = C.clamp(0.35 - d * 0.9, 0, 0.8);
  c.ampD *= 1 - d * 0.5; c.ampG *= 1 - d * 0.4;
  c.widK *= 1 - d * 0.4;
  return c;
}

async function paint(ctx, p, clock, seg, Lfull) {
  const { W, H, N, s, data, comp } = ctx;
  const cfg = config(p);
  const rand = C.mulberry32(ctx.seed * 13 + 3);
  const gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += rand(); return (u - 2) * 1.732; };
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H), ctx.physMM)) : null;

  /* --- gris y tono (resolución completa) --- */
  const I = new Float32Array(N);
  for (let i = 0; i < N; i++) { const o = i * comp; I[i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255; }
  await clock.tick(0.03);
  // resolución de trabajo para el tono simplificado y el garabato
  const lw = Math.min(1, 1800 / Math.max(W, H));
  const ww = Math.max(8, Math.round(W * lw)), wh = Math.max(8, Math.round(H * lw));
  const sw = Math.max(ww, wh) / 1000;
  const Iw = ww === W && wh === H ? Float32Array.from(I) : C.resample(I, W, H, ww, wh);
  const Is = cfg.simp > 0.01 ? dtFilter1(Iw, ww, wh, 14 * sw, 0.14, 2) : Iw;
  await clock.tick(0.1);
  // realce del contraste local: bordes nítidos sin dibujar contornos
  const B = Float32Array.from(I);
  { const tmp = new Float32Array(N); C.gaussBlur(B, W, H, Math.max(1.2, 3.2 * s), tmp); }
  const D = new Float32Array(N);         // oscuridad del tono 0..1
  const lift = (1 - p.cobertura) * 0.5;
  const fx = ww / W, fy = wh / H;
  for (let y = 0; y < H; y++) {
    const ay = (y + 0.5) * fy - 0.5;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = I[i];
      if (cfg.simp > 0.01) v += (C.bilinear(Is, ww, wh, (x + 0.5) * fx - 0.5, ay) - v) * cfg.simp;
      v += (I[i] - B[i]) * cfg.lc;
      let d = 1 - (v < 0 ? 0 : v > 1 ? 1 : v);
      if (cfg.contrast) d = C.clamp(d + (d - 0.5) * cfg.contrast, 0, 1);
      d = Math.pow(d, cfg.gamma) * cfg.toneK;
      // las luces más claras se quedan en papel
      d *= C.smoothstep(0.03, 0.1, d);
      D[i] = Math.max(0, d * (1 - lift) - lift * 0.08);
    }
    if ((y & 63) === 0) await clock.tick(0.1 + 0.1 * y / H);
  }

  /* --- garabato de trazos reales de grafito (resolución de trabajo) --- */
  const libSrc = cfg.charcoal ? (ctx.strokesOf && (ctx.strokesOf(["pin_cera"]) || ctx.strokesOf(["pin_lapiz"]))) : (ctx.strokesOf && ctx.strokesOf(["pin_lapiz"]));
  let lib = libSrc && libSrc.samples && libSrc.samples.length ? libSrc.samples : Lib.synthetic("lapiz");
  const pool = lib.filter((m) => { const a = m.aspect || m.h / m.w; return a > 4 && a < 30 && m.fill > 0.4; });
  if (pool.length > 4) lib = pool;
  const St = new Float32Array(ww * wh);
  const longW = Math.max(ww, wh);
  const Lbase = (0.016 + 0.034 * p.longitud) * longW * cfg.lenK;
  const Wbase = Math.max(1.2, (0.0011 + 0.0019 * p.grosor) * longW * cfg.widK);
  const target = ww * wh * 0.55 * cfg.cov * (0.6 + 0.6 * p.intensidad);
  const ts = new Float32Array(2), f = new Float32Array(2);
  let covered = 0, guard = 0;
  while (covered < target && guard++ < 200000) {
    const cx = rand() * ww, cy = rand() * wh;
    // dirección: siguiendo la forma (estructura de la foto) o suelta, como un garabato
    let ang;
    if (rand() < cfg.flow) { ctx.flowAt(cx / fx, cy / fy, f, false); ang = Math.atan2(f[1], f[0]) + gauss() * 0.18; }
    else ang = rand() * Math.PI;
    const L = Math.min(longW * 0.1, Lbase * Math.exp(0.35 * gauss()));
    const wdt = Wbase * (0.75 + 0.5 * rand());
    const Rr = wdt / 2 / 0.7;
    const sag = (rand() - 0.5) * 0.22 * L;            // trazo un poco curvo, de muñeca
    const pres = 0.3 + 0.6 * rand() * rand() + 0.2 * rand();
    const st = Lib.prepare(Lib.pick(lib, rand), L, Rr, rand, 0.9);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const ex = Math.abs(ca) * L / 2 + Math.abs(sa) * (Rr + Math.abs(sag)) + 2, ey = Math.abs(sa) * L / 2 + Math.abs(ca) * (Rr + Math.abs(sag)) + 2;
    const x0 = Math.max(0, Math.floor(cx - ex)), x1 = Math.min(ww - 1, Math.ceil(cx + ex));
    const y0 = Math.max(0, Math.floor(cy - ey)), y1 = Math.min(wh - 1, Math.ceil(cy + ey));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx - cx, dy = yy - cy;
        const along = dx * ca + dy * sa;
        const u = along / L + 0.5;
        if (u < -0.04 || u > 1.04) continue;
        const uc = u < 0 ? 0 : u > 1 ? 1 : u;
        const across = -dx * sa + dy * ca - sag * 4 * uc * (1 - uc);
        const v = across / (Rr * 0.9);
        if (v < -1 || v > 1) continue;
        Lib.sampleAt(st, u, v, ts);
        const a = ts[0] * pres;
        if (a < 0.01) continue;
        const o = yy * ww + xx;
        St[o] += a * (1 - St[o]);
      }
    }
    covered += L * wdt * pres;
    if ((guard & 255) === 0) await clock.tick(0.2 + 0.45 * Math.min(1, covered / target));
  }
  if (cfg.smudge > 0) {
    // carboncillo: parte del garabato difuminado con el dedo
    const b = Float32Array.from(St), tmp = new Float32Array(ww * wh);
    C.gaussBlur(b, ww, wh, 2.2 * sw, tmp);
    for (let i = 0; i < St.length; i++) St[i] += (b[i] - St[i]) * cfg.smudge;
  }
  // garabato centrado: >0 trazo (más oscuro), <0 hueco entre trazos (más claro)
  let mu = 0;
  for (let i = 0; i < St.length; i++) mu += St[i];
  mu /= St.length;
  const sNorm = 1 / Math.max(0.2, Math.max(mu, 1 - mu));
  await clock.tick(0.68);

  /* --- líneas sueltas (solo «Línea suelta»): trazos de dibujante a lo largo de los bordes --- */
  let lines = null;
  if (cfg.lines > 0) {
    const Sk = require("./sketch.js");
    lines = await Sk.paint(ctx, Object.assign({}, p, { modo: "boceto", intensidad: 0.5 + 0.4 * p.intensidad }), { tick: async () => clock.tick(0.72), stage() {}, report() {}, force: async () => {} }, seg, Lfull, { only: "lineas", lineMul: cfg.lines });
  }

  /* --- composición sobre el papel --- */
  const out = new Uint8Array(N * 4);
  const selFull = ctx.selFull, srcA = ctx.srcAlpha;
  const charcoal = cfg.charcoal;
  const gr0 = charcoal ? 0.07 : 0.16, gg0 = charcoal ? 0.065 : 0.165, gb0 = charcoal ? 0.06 : 0.19;
  const ovc = charcoal && ctx.assets && ctx.assets.ov_carbon && ctx.assets.ov_carbon.items.length ? K.overlaySampler(ctx.assets.ov_carbon.items[0], W, H) : null;
  for (let y = 0; y < H; y++) {
    const ay = (y + 0.5) * fy - 0.5;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const d = D[i];
      const sv = (C.bilinear(St, ww, wh, (x + 0.5) * fx - 0.5, ay) - mu) * sNorm;
      // el garabato hace vibrar el tono: trazos visibles incluso en las luces, huecos en las sombras
      let o = sv > 0 ? d + sv * (cfg.ampL + cfg.ampD * d) * (1 - 0.55 * d) : d + sv * cfg.ampG * d;
      if (lines) { const la = lines[i * 4 + 3] / 255; o = 1 - (1 - o) * (1 - la * 0.9); }
      if (o < 0.004) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255; out[i * 4 + 3] = 0; continue; }
      // el grafito se queda en los picos del papel; lo cargado llena también los valles
      if (pap) { const g = pap.eqN(x, y); o *= 1 - 0.5 * (1 - g) * (1 - o) * (1 - o); }
      if (ovc) o *= 0.9 + 0.2 * ovc(x, y);
      let a = o > cfg.dMax ? cfg.dMax + (o - cfg.dMax) * 0.15 : o;
      let r = gr0, g = gg0, b = gb0;
      if (!charcoal && o > 0.62) {
        // brillo del grafito bruñido: lo más cargado refleja y se lee algo más claro
        const sh = C.smoothstep(0.62, 0.98, o) * 0.3;
        r += (0.3 - r) * sh; g += (0.31 - g) * sh; b += (0.35 - b) * sh;
      }
      if (selFull) a *= selFull[i] / 255;
      if (srcA) a *= data[i * comp + 3] / 255;
      const q = i * 4;
      out[q] = (r * 255 + 0.5) | 0; out[q + 1] = (g * 255 + 0.5) | 0; out[q + 2] = (b * 255 + 0.5) | 0;
      out[q + 3] = a <= 0 ? 0 : a >= 1 ? 255 : (a * 255 + 0.5) | 0;
    }
    if ((y & 31) === 0) await clock.tick(0.75 + 0.25 * y / H);
  }
  return out;
}

module.exports = { paint };
