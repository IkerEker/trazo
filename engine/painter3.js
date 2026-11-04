"use strict";
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
function config(kind, p, s) {
  const m = p.modo;
  let c;
  if (kind === "oleo") {
    c = {
      R0: (3.2 + p.grosor * 24) * s, layers: 3 + Math.round(p.detalle * 1.2), ratio: 0.5,
      Lk: 4 + p.longitud * 12, curv: 0.12 + 0.8 * p.curvatura,
      op: 0.88 + 0.12 * p.intensidad, wet: 0.2, thick: 0.25 + 0.75 * p.empaste,
      sK: 0.6 + 0.8 * p.empaste, dual: 0.55, varK: 1,
      tolStop: 0.34 + 0.22 * (1 - p.detalle), tolClip: 0.5, lost: 0.9, refineT: 0.32 - 0.16 * p.detalle,
      minLenK: 2.6, planeK: 0.15, steps: 0, earth: 0, satK: 1.06, lechoso: 0, sink: 0,
      ground: 0, groundShow: 0, baseOp: 1, cov0: 0.82, gloss: 0.3, shade: 1, canvasTex: 0.5,
      paperBreak: 0, chalk: false, libs: ["pin_oleo", "pin_gouache"], dirJit: 0.18, edgeN: 0.42, edgeT: 0.9, temp: 0.06, reliefK: 0.5,
    };
    if (m === "gestual") Object.assign(c, { R0: c.R0 * 1.3, Lk: c.Lk * 1.45, curv: Math.min(1, c.curv * 1.4 + 0.1), wet: 0.32, varK: 1.6, dual: 0.8, satK: 1.15, lost: 1.5, planeK: 0, layers: c.layers - 1, dirJit: 0.32 });
    if (m === "boceto") Object.assign(c, { ground: 1, groundShow: 0.55, thick: c.thick * 0.35, op: c.op * 0.86, cov0: 0.6, wet: 0.12, layers: Math.max(2, c.layers - 1), sK: c.sK * 0.6, lost: 1.6, gloss: 0.12, canvasTex: 0.75, planeK: 0.3 });
    if (m === "materico") Object.assign(c, { thick: Math.min(1.4, c.thick * 1.7 + 0.15), sK: c.sK * 1.35, earth: 0.35, satK: 0.95, Lk: c.Lk * 0.7, R0: c.R0 * 1.1, planeK: 0.35, wet: 0.12, gloss: 0.38, dual: 0.4 });
  } else {
    c = {
      R0: (3 + p.grosor * 22) * s, layers: 3 + Math.round(p.detalle * 1.2), ratio: 0.5,
      Lk: 3.5 + p.longitud * 10, curv: 0.1 + 0.7 * p.curvatura,
      op: 0.94 + 0.06 * p.intensidad, wet: 0.06, thick: 0.12 + 0.3 * p.empaste,
      sK: 0.35 + 0.45 * p.empaste, dual: 0.35, varK: 0.8,
      tolStop: 0.3 + 0.2 * (1 - p.detalle), tolClip: 0.42, lost: 0.6, refineT: 0.3 - 0.15 * p.detalle,
      minLenK: 2.4, planeK: 0.35, steps: 0, earth: 0, satK: 1.06, lechoso: 0.03, sink: 0,
      ground: 0, groundShow: 0, baseOp: 1, cov0: 0.85, gloss: 0, shade: 0.55, canvasTex: 0.3,
      paperBreak: 0.6, chalk: true, libs: ["pin_gouache"], dirJit: 0.15, edgeN: 0.35, edgeT: 0.7, temp: 0.045, reliefK: 0.6,
    };
    if (m === "planos") Object.assign(c, { planeK: 0.85, steps: 5, lechoso: 0.05, Lk: c.Lk * 0.85, curv: c.curv * 0.5, lost: 0.25, varK: 0.45, dual: 0.15, tolClip: 0.34, sK: c.sK * 0.6, dirJit: 0.08 });
    if (m === "expresivo") Object.assign(c, { R0: c.R0 * 1.25, Lk: c.Lk * 1.3, sink: 0.7, satK: 1.18, lechoso: 0.04, varK: 1.4, dual: 0.6, lost: 1.4, planeK: 0.2, layers: c.layers - 1, paperBreak: 0.9, dirJit: 0.3 });
    if (m === "diluido") Object.assign(c, { op: 0.72 + 0.1 * p.intensidad, baseOp: 0.55, lechoso: 0.05, thick: c.thick * 0.4, sK: c.sK * 0.6, lost: 1.1, planeK: 0.25, paperBreak: 1, cov0: 0.7, wet: 0.14, layers: Math.max(2, c.layers - 1) });
  }
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
  const col = new Float32Array(3), col2 = new Float32Array(3), base = new Float32Array(3), tmp = new Float32Array(3), ts = new Float32Array(2);
  const stripes = new Float32Array(64), jit = new Float32Array(66), tanX = new Float32Array(64), tanY = new Float32Array(64);
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
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
  { let R = cfg.R0; const minR = Math.max(1.1, 0.9 * s); for (let k = 0; k < cfg.layers; k++) { radii.push(Math.max(minR, R)); R *= cfg.ratio; if (R < minR) break; } }
  const nL = radii.length;
  const refs = [];
  for (let k = 0; k < nL; k++) {
    const sig = Math.max(1.2, radii[k] * ctx.ax * 1.3);
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
        let r = col[0], g = col[1], b = col[2];
        if (cfg.ground) {
          // imprimatura: asoma en las sombras y los medios tonos; en las luces queda una veladura clara
          const l = 0.299 * r + 0.587 * g + 0.114 * b;
          const k = 0.85 * C.smoothstep(0.92, 0.35, l);
          r = gcol[0] * k + r * (1 - k); g = gcol[1] * k + g * (1 - k); b = gcol[2] * k + b * (1 - k);
        }
        const a = m * cfg.baseOp;
        Pr[i] = r * a; Pg[i] = g * a; Pb[i] = b * a; Cv[i] = a;
        Hh[i] = 0.04 * a;
        Bc[i * 3] = (col[0] * 255 + 0.5) | 0; Bc[i * 3 + 1] = (col[1] * 255 + 0.5) | 0; Bc[i * 3 + 2] = (col[2] * 255 + 0.5) | 0;
        Pc[i * 3] = (r * 255 + 0.5) | 0; Pc[i * 3 + 1] = (g * 255 + 0.5) | 0; Pc[i * 3 + 2] = (b * 255 + 0.5) | 0;
      }
      if ((y & 31) === 0) await clock.tick(0.12 + 0.06 * y / H);
    }
  }

  /* --- elegir muestra con la proporción adecuada (sin estirar ni repetir) --- */
  const logAsp = lib.map((sm) => Math.log(Math.max(1.2, sm.aspect || sm.h / sm.w)));
  const wts = new Float32Array(lib.length);
  function pickSample(L, Rr) {
    const want = Math.log(Math.max(1.2, (L + Rr) / (2 * Rr)));
    let tot = 0;
    for (let i = 0; i < lib.length; i++) { const d = logAsp[i] - want; wts[i] = (lib[i].q || 1) * Math.exp(-d * d * 2.2); tot += wts[i]; }
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
      if (sign < 0) { dx = -dx; dy = -dy; }
      let x = x0, y = y0, len = 0, n = 0;
      const budget = sign > 0 ? o.Lmax * (0.35 + 0.3 * rand()) : o.Lmax - nf * step;
      const ox = sign > 0 ? path._fx : bx, oy = sign > 0 ? path._fy : by;
      while (len < budget && n < S.MAXPTS / 2 - 2) {
        ctx.flowAt(x, y, _f, o.fine);
        let fx = _f[0] * o.ca - _f[1] * o.sa, fy = _f[0] * o.sa + _f[1] * o.ca;
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
      // pincel seco: el borde parcial se rompe sobre el grano del papel
      if (pbk > 0 && ts[0] < 0.92) {
        const x = g % W, y = (g / W) | 0;
        const e = (0.92 - ts[0]) * 1.6 * pbk;
        a *= C.smoothstep(e - 0.25, e + 0.15, pap.eqN(x, y));
        if (a < 0.004) continue;
      }
      let sv = ts[1] * sK * C.smoothstep(0.45, 0.95, ts[0]);
      if (sv < 0) sv *= 0.55 * C.smoothstep(0.7, 1, ts[0]);
      const mz = stripes[((v + 1) * 31.5) | 0] * mixAmt;
      const br = cr + (c2r - cr) * mz, bgc = cg + (c2g - cg) * mz, bbc = cb + (c2b - cb) * mz;
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
      if (a > 0.45) { Bc[o3] = br0; Bc[o3 + 1] = bg0; Bc[o3 + 2] = bb0; Pc[o3] = pr8; Pc[o3 + 1] = pg8; Pc[o3 + 2] = pb8; }
      if (thick > 0) Hh[g] = Hh[g] * (1 - a * 0.85) + a * thick * (0.45 + 0.55 * ts[0] + 0.35 * ts[1] * C.smoothstep(0.5, 0.95, ts[0]));
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
    const minLen = Rk * cfg.minLenK;
    const showGround = cfg.groundShow * (k === 0 ? 1 : 0.5);
    for (let oi = 0; oi < cnt; oi++) {
      const ci = order[oi];
      let x = cand.x[ci], y = cand.y[ci];
      const g0 = (y | 0) * W + (x | 0);
      if (k === 0) {
        // ya pasó una pincelada por esta celda: solo se repasa a veces
        if (occ[((y / sp) | 0) * cols + ((x / sp) | 0)] && rand() > 1 - cfg.cov0 * 0.95) continue;
        if (Sc[g0] > 200 && rand() > 0.05) continue;
        if (showGround) { refAt(ref, x, y, col); const l = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2]; if (rand() < showGround * 0.6 * C.smoothstep(0.9, 0.3, l)) continue; }
      } else {
        // ¿dónde se aleja más el color pintado del de la referencia en esta celda?
        let best = -1, bi = 0, sum = 0;
        for (let j = 0; j < 5; j++) {
          const px = j === 0 ? x : C.clamp(x + (rand() - 0.5) * sp, 0, W - 1), py = j === 0 ? y : C.clamp(y + (rand() - 0.5) * sp, 0, H - 1);
          const g = (py | 0) * W + (px | 0), o3 = g * 3;
          refAt(ref, px, py, col);
          const e = Cv[g] < 0.3 ? 1 : Math.abs(Bc[o3] / 255 - col[0]) + Math.abs(Bc[o3 + 1] / 255 - col[1]) + Math.abs(Bc[o3 + 2] / 255 - col[2]);
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
      // trazado (si no cabe una pincelada entera, se prueba en otra dirección)
      const ang = (rand() - 0.5) * 2 * cfg.dirJit;
      let Rs = Rk * (0.85 + 0.3 * rand());
      let len = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        const a2 = attempt === 1 ? ang + Math.PI / 2 : attempt === 2 ? ang + Math.PI / 4 : ang;
        if (attempt === 2) Rs *= 0.75;
        len = trace(ref, x, y, base, { step: Math.max(1, Rs * 1.15), Lmax: Lmax * (0.6 + 0.8 * rand()), curv: cfg.curv, tol: tolStop, ca: Math.cos(a2), sa: Math.sin(a2), fine: Rs < 6 * s });
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
      const lum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];
      const im = impAt(x, y);
      const thick = cfg.thick * (0.5 + 0.5 * lum) * (0.7 + 0.3 * im) * (0.55 + 0.9 * rand()) * (k === 0 ? 0.85 : 1);
      const tolC = tolClip * (1 + cfg.lost * C.smoothstep(0.55, 0.15, im));
      renderStroke(Rs, col, base, cfg.op * (0.9 + 0.1 * rand()), thick, tolC, k);
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
  await clock.tick(0.97);
  const fcfg = { reliefK: cfg.reliefK, hBlur: 1.6, canvasTex: cfg.canvasTex, shade: cfg.shade, gloss: cfg.gloss, under: 0, R0: cfg.R0, thick: cfg.thick, glossByHeight: true, chalk: cfg.chalk };
  return { Pr, Pg, Pb, Cv, Hh, cfg: fcfg, grain: null, gsInv: 1, real: true, pap };
}

module.exports = { paint, config, dtFilter };
