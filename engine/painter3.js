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
      dirt: 0.28, groundTint: 0.16, finalPass: 0.6, matte: 0, bristle: 1,
    };
    // gestual: el punto de partida que funciona (decidido, abstracto)
    if (m === "gestual") Object.assign(c, { dirt: 0.38, finalPass: 1.0, R0: c.R0 * 1.3, Lk: c.Lk * 1.45, curv: Math.min(1, c.curv * 1.4 + 0.1), wet: 0.32, varK: 1.6, dual: 0.8, satK: 1.15, lost: 1.5, planeK: 0, layers: 2 + Math.round(p.detalle * 0.8), dirJit: 0.1 });
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
      // gouache SIN VOLUMEN: solo la variación de tono de los trazos reales, nada de relieve
      op: 0.94 + 0.06 * p.intensidad, wet: 0.06, thick: 0,
      sK: 0.55, dual: 0.4, varK: 1.0, ridge: 0,
      tolStop: 0.3 + 0.2 * (1 - p.detalle), tolClip: 0.42, lost: 0.9, refineT: 0.3 - 0.15 * p.detalle,
      minLenK: 2.4, planeK: 0.35, steps: 0, earth: 0, satK: 1.08, lechoso: 0.03, sink: 0,
      ground: 0, groundShow: 0, baseOp: 1, cov0: 0.85, gloss: 0, shade: 0, canvasTex: 0,
      paperBreak: 0.7, chalk: true, libs: ["pin_guache"], dirJit: 0.06, edgeN: 0.35, edgeT: 0.7, temp: 0.05, reliefK: 0,
      tools: null, hBlur: 1.6,
      sizeVar: 0.4, lenVar: 0.5, loadK: 0.45, shapes: 1.0, shapeOp: 0.75, shapeSkip: 0.6, tileAmt: 0.5,
      dirt: 0.12, groundTint: 0, finalPass: 0.5, matte: 1,
    };
    if (m === "pleinair") Object.assign(c, { R0: c.R0 * 1.15, varK: 1.3, temp: 0.07, dual: 0.5, edgeN: 0.45 });
    // planos opacos: valores por planos, pero cada plano hecho con brochazos planos visibles y filo seco
    if (m === "planos") Object.assign(c, { R0: c.R0 * 1.45, planeK: 0.7, steps: 4, lechoso: 0.03, Lk: c.Lk * 1.2, curv: 0.15, lost: 1.3, varK: 1.5, dual: 0.55, tolClip: 0.52,
      dirJit: 0.1, paperBreak: 1.0, edgeN: 0.6, edgeT: 1.0, sK: c.sK * 1.1, satK: 1.15, temp: 0.08, layers: 2 + Math.round(p.detalle * 0.9) });
    // retrato expresivo: gestual, color subido, pincel seco y papel entre trazos
    if (m === "expresivo") Object.assign(c, { finalPass: 1.0, dirt: 0.2, R0: c.R0 * 1.5, Lk: c.Lk * 1.6, curv: Math.min(1, c.curv * 1.4 + 0.12), sink: 0, satK: 1.25, lechoso: 0.02, varK: 2.0, dual: 0.9,
      lost: 1.8, tolClip: 0.55, planeK: 0, layers: 2 + Math.round(p.detalle * 0.7), paperBreak: 1.2, dirJit: 0.1, wet: 0.16, temp: 0.1, cov0: 0.72, edgeN: 0.6, edgeT: 1.1, sK: c.sK * 1.2 });
    if (m === "diluido") Object.assign(c, { overWash: true, shapes: 0, shapeSkip: 0, baseOp: 0, op: 0.9, cov0: 0.7, wet: 0.1, lechoso: 0.03, lost: 1.0, planeK: 0.15,
      paperBreak: 1.1, layers: Math.max(2, c.layers), R0: c.R0 * 0.9, finalPass: 0 });
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
      paperBreak: 0, chalk: false, libs: ["pin_barra"], dirJit: 0.05, edgeN: 0.3, edgeT: 0.6, temp: 0.03, reliefK: 0.5,
      tools: null, hBlur: 1.2, media: "cera", impRate: 0.01, ridge: 0.25, libs0: true, tooth: 0.75, press: 0.22 + 0.36 * p.intensidad, palK: 0, palN: 16, paperWhite: 0.86, sparse: 0.45,
      hand: -Math.PI / 4, handK: 0.15, cross: p.cruzado || 0, smudge: 0,
      sizeVar: 0.3, lenVar: 0.45, loadK: 0.35, shapes: 0, shapeOp: 0, shapeSkip: 0, tileAmt: 0,
      dirt: 0, groundTint: 0, finalPass: 0, matte: 0,
    };
    // óleo en barra: pasta espesa y untuosa, apenas deja ver el papel
    if (m === "barra") Object.assign(c, { dirt: 0.22, libs: ["pin_barra"], R0: c.R0 * 1.45, Lk: c.Lk * 0.75, tooth: 0.3, paperWhite: 0.97, sparse: 0.15, thick: 0.6 + 0.8 * p.empaste, sK: 0.7, ridge: 0.3, wet: 0.3,
      gloss: 0.3, reliefK: 1.0, shade: 1.0, handK: 0.05, dual: 0.55, varK: 1.3, hBlur: 0.9 });
    // pastel graso: cubriente, se arrastra y mezcla; algo de grano
    if (m === "pastelgraso") Object.assign(c, { dirt: 0.25, libs: ["pin_barra"], R0: c.R0 * 1.1, tooth: 0.5, thick: 0.25 + 0.4 * p.empaste, sK: 0.7, ridge: 0.4, wet: 0.35,
      gloss: 0.12, reliefK: 0.7, handK: 0.1, dual: 0.5, palK: 0.35 });
    // pastel seco: polvo de color, de canto en los fondos, difuminado con el dedo
    if (m === "pastelseco") Object.assign(c, { luminous: 1, libs: ["pin_barra"], R0: c.R0 * 1.3, tooth: 0.8, op: 0.88, thick: 0, ridge: 0, sK: 0.35, wet: 0.08, chalk: true,
      lechoso: 0.05, satK: 1.05, smudge: 0.55 + 0.3 * (1 - p.intensidad), handK: 0.12, palK: 0.25, reliefK: 0.3 });
    // ceras escolares (Manley): trazo estrecho, rayado a mano, caja de colores limitada, mucho grano
    if (m === "manley") Object.assign(c, { libs: ["pin_barra", "pin_manley"], R0: c.R0 * 0.75, tooth: 0.92, op: 0.88, sparse: 0.6, thick: 0.08, sK: 0.4, ridge: 0.1, wet: 0, gloss: 0.06, handK: 0.3,
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

/* ---------- mezcla de pigmentos (aproximación sustractiva) ----------
 * Dos pinturas que se mezclan no promedian su luz: se acercan a la mezcla
 * geométrica de sus reflectancias (como en Kubelka-Munk), así un amarillo y un
 * azul dan un verde apagado y no un gris. Se usa una mezcla de ambas para no
 * ensuciar en exceso; tablas para que sea barato. */
const _LOGT = new Float32Array(1025), _EXPT = new Float32Array(1025);
for (let i = 0; i <= 1024; i++) { _LOGT[i] = Math.log(i / 1024 + 0.02); _EXPT[i] = Math.exp(-i / 1024 * 4); }
const _LMIN = Math.log(0.02);
function plog(v) { const i = (v <= 0 ? 0 : v >= 1 ? 1024 : (v * 1024 + 0.5) | 0); return _LOGT[i]; }
function pexp(l) { const d = -l / 4; const i = d <= 0 ? 0 : d >= 1 ? 1024 : (d * 1024 + 0.5) | 0; return _EXPT[i]; }
function pmix(a, b, t) {
  const lin = a + (b - a) * t;
  const geo = pexp(plog(a) * (1 - t) + plog(b) * t) - 0.02;
  return lin * 0.4 + (geo < 0 ? 0 : geo) * 0.6;
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
  const Gl = new Uint8Array(N);     // brillo de la pintura en cada punto (el barniz no es uniforme)
  let lib = [];
  for (const nm of cfg.libs) { const a = ctx.assets && ctx.assets[nm]; if (a && a.kind === "strokes") lib = lib.concat(a.samples); }
  if (!lib.length) lib = Lib.synthetic(kind);
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H), ctx.physMM)) : null;
  // ceras: el grano del papel se calcula una vez por píxel (se consulta muchísimas veces)
  let toothMap = null, toothFill = null;
  if (cfg.media) toothFill = new Uint8Array(N); // cuánto se ha llenado el diente del papel
  if (cfg.media || pap) {
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
  const brs = new Float32Array(168);
  // separación entre cerdas: ~0,7 mm en el tamaño físico supuesto del cuadro
  const bristleSp = Math.max(1.6, 0.7 * Math.max(W, H) / (ctx.physMM || 600));
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
        if (cfg.groundTint && !cfg.ground) {
          // lo que asoma entre pinceladas es la imprimatura cálida, no un color limpio
          const k = cfg.groundTint;
          r = r * (1 - k) + gcol[0] * k; g = g * (1 - k) + gcol[1] * k; b = b * (1 - k) + gcol[2] * k;
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
    // pincel sucio: color del lienzo donde se apoya el pincel
    let dirt = cfg.dirt || 0, dr0 = 0, dg0 = 0, db0 = 0;
    if (dirt > 0) {
      const gx = C.clamp(path.xs[0] | 0, 0, W - 1), gy = C.clamp(path.ys[0] | 0, 0, H - 1), g0 = gy * W + gx;
      if (Cv[g0] > 0.5) { dr0 = Pc[g0 * 3] / 255; dg0 = Pc[g0 * 3 + 1] / 255; db0 = Pc[g0 * 3 + 2] / 255; dirt *= 0.5 + rand(); } else dirt = 0;
      if (dirt > 0 && Math.abs(dr0 - cr) + Math.abs(dg0 - cg) + Math.abs(db0 - cb) > 1.2) dirt *= 0.3;
    }
    // brillo de este trazo (más médium / más pasta = más brillo); el gouache y el pastel no brillan
    const gl8 = Math.min(255, (cfg.gloss > 0 ? (0.35 + 0.65 * rand()) * (0.6 + 0.4 * Math.min(1.5, thick / Math.max(0.05, cfg.thick))) : 0) * 200) | 0;
    // cerdas a escala real (~0,7 mm): cada una lleva algo más o menos pintura y deja su surco
    const bri = cfg.bristle || 0;
    let nbr = 0;
    if (bri > 0) {
      nbr = Math.max(6, Math.min(160, Math.round(2 * R / bristleSp)));
      let pb0 = rand();
      for (let q = 0; q <= nbr + 1; q++) {
        // grupos de cerdas (mechones) más un detalle fino por cerda
        if (q % (3 + ((rand() * 5) | 0)) === 0) pb0 = rand();
        brs[q] = pb0 * 0.6 + rand() * 0.4;
      }
    }
    const drift = (rand() - 0.5) * 2.2, drift2 = rand() * 6.28;
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
        // el diente se va llenando: cada pasada alcanza valles más hondos (y deja de agarrar al final)
        const tf = toothFill[g];
        const gr = Math.min(1, (toothMap[g] + tf * 0.55) * (1 / 255));
        // la punta aprieta más en el centro y deja vetas a lo largo del trazo
        const pr = press * (0.7 + 0.3 * ts[0]) * (0.78 + 0.22 * (1 - v * v) + (stripes[((v + 1) * 31.5) | 0] - 0.5) * 0.35);
        const e0 = 0.8 - pr, tt = (gr - e0) * 3.3333;
        a *= 1 - tooth + tooth * (tt <= 0 ? 0 : tt >= 1 ? 1 : tt * tt * (3 - 2 * tt));
        if (a < 0.004) continue;
        const nf = tf + a * 70;
        toothFill[g] = nf > 255 ? 255 : nf;
      }
      // pincel seco: el borde parcial se rompe sobre el grano del papel
      if (pbk > 0 && ts[0] < 0.92) {
        const e = (0.92 - ts[0]) * 1.6 * pbk;
        a *= C.smoothstep(e - 0.25, e + 0.15, toothMap[g] * (1 / 255));
        if (a < 0.004) continue;
      }
      // al final del trazo queda menos pintura: se abre en vetas de cerdas y deja ver lo de debajo
      const uc = u < 0 ? 0 : u > 1 ? 1 : u;
      const load = 1 + loadK * (0.35 - uc);
      let bval = 0.5, bgro = 0.5;
      if (nbr) {
        // posición sobre las cerdas (derivan un poco a lo largo del trazo)
        const qf = (v + 1) * 0.5 * nbr + drift * Math.sin(uc * 3.1 + drift2);
        const q0 = qf < 0 ? 0 : qf > nbr ? nbr : qf | 0, fq = qf - Math.floor(qf);
        bval = brs[q0] + (brs[q0 + 1] - brs[q0]) * fq;
        bgro = 0.5 + 0.5 * Math.cos(qf * 6.2832);
        // filo deshilachado: las cerdas exteriores dejan menos pintura
        const av = v < 0 ? -v : v;
        if (av > 0.72) { a *= C.smoothstep(0.1, 0.55, bval + (0.95 - av) * 1.6); if (a < 0.004) continue; }
      }
      if (loadK > 0 && uc > dryU) {
        const e = (uc - dryU) / (1 - dryU) * loadK * 1.4;
        const bv = nbr ? bval * 0.7 + stripes[((v + 1) * 31.5) | 0] * 0.3 : stripes[((v + 1) * 31.5) | 0];
        const sh = toothMap ? toothMap[g] * (1 / 255) : 0.5;
        a *= C.smoothstep(e - 0.35, e + 0.05, bv * 0.5 + sh * 0.38 + 0.12 * ts[0]);
        if (a < 0.004) continue;
      }
      // con mucha carga las cerdas apenas marcan; al quedarse seco, las estrías se ven más
      let sv = ts[1] * sK * (1.3 - 0.45 * load) * C.smoothstep(0.45, 0.95, ts[0]);
      if (sv < 0) sv *= 0.55 * C.smoothstep(0.7, 1, ts[0]);
      const mz = stripes[((v + 1) * 31.5) | 0] * mixAmt;
      // más carga = tono algo más hondo; menos carga = algo más claro
      const kl = 1 - 0.1 * (load - 1) * 2;
      let kb = kl;
      if (nbr) kb *= 1 + bri * (0.12 * (bval - 0.5) + 0.05 * (bgro - 0.5));   // vetas de cerdas
      let br = (cr + (c2r - cr) * mz) * kb, bgc = (cg + (c2g - cg) * mz) * kb, bbc = (cb + (c2b - cb) * mz) * kb;
      // pincel sucio: al empezar arrastra algo del color de donde se apoyó (mezcla de pigmentos)
      if (dirt > 0 && uc < 0.4) { const kd = dirt * (1 - uc / 0.4); br = pmix(br, dr0, kd); bgc = pmix(bgc, dg0, kd); bbc = pmix(bbc, db0, kd); }
      let rr, gg, bb;
      if (sv < 0) { const f = 1 + (sv < -0.6 ? -0.6 : sv) * 0.55; rr = br * f; gg = bgc * f; bb = bbc * f; }
      else { const f = (sv > 1 ? 0.5 : sv * 0.5) * (0.25 + 0.75 * (0.299 * br + 0.587 * bgc + 0.114 * bbc)); rr = br + (1 - br) * f; gg = bgc + (1 - bgc) * f; bb = bbc + (1 - bbc) * f; }
      const cv = Cv[g];
      if (wet > 0 && cv > 0.05) {
        // mezcla húmeda como pigmento (no como luz): entre colores distintos da un tono
        // intermedio apagado, no un gris; cuanto más distintos, menos se mezclan
        const inv = 1 / cv, ur = Pr[g] * inv, ug = Pg[g] * inv, ub = Pb[g] * inv;
        const dd = Math.abs(ur - br) + Math.abs(ug - bgc) + Math.abs(ub - bbc);
        if (dd < 1.1) {
          const mm = wet * (0.15 + 0.85 * uc) * (cv > 1 ? 1 : cv) * (1 - dd / 1.1);
          rr = pmix(rr, ur > 1 ? 1 : ur, mm); gg = pmix(gg, ug > 1 ? 1 : ug, mm); bb = pmix(bb, ub > 1 ? 1 : ub, mm);
        }
      }
      const ia = 1 - a;
      Pr[g] = Pr[g] * ia + rr * a; Pg[g] = Pg[g] * ia + gg * a; Pb[g] = Pb[g] * ia + bb * a;
      Cv[g] = cv * ia + a;
      const a8 = (a * 255) | 0;
      if (a8 > Sc[g]) Sc[g] = a8;
      if (a > bcT) { Bc[o3] = br0; Bc[o3 + 1] = bg0; Bc[o3 + 2] = bb0; Pc[o3] = pr8; Pc[o3 + 1] = pg8; Pc[o3 + 2] = pb8; }
      if (a > 0.3) Gl[g] = gl8;
      if (thick > 0) {
        // relieve de la pincelada: cuerpo, surcos de las cerdas y crestas en los bordes
        const av = v < 0 ? -v : v;
        const rg = ridge * C.smoothstep(0.5, 0.82, av) * (1 - C.smoothstep(0.86, 1, av));
        const grv = nbr ? bri * (0.22 * (bgro - 0.5) + 0.18 * (bval - 0.5)) * (1.25 - 0.4 * load) : 0;
        Hh[g] = Hh[g] * (1 - a * 0.85) + a * thick * load * (0.45 + 0.55 * ts[0] + 0.35 * ts[1] * C.smoothstep(0.5, 0.95, ts[0]) + rg + grv);
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
      if (a > 0.3) Gl[g] = 190;
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
        if (cfg.overWash) { const im = impAt(x, y); if (rand() > 0.05 + 0.5 * im * im) continue; }
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
          const e = cvN < 0.3 ? (cfg.overWash ? 0 : 1) : (cfg.overWash ? 0.6 : 1) * Math.abs(Bc[o3] / 255 - col[0]) + Math.abs(Bc[o3 + 1] / 255 - col[1]) + Math.abs(Bc[o3 + 2] / 255 - col[2]);
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
      // luces gruesas, oscuros finos (regla de taller): el relieve sigue al valor
      let thick = cfg.thick * (0.18 + 0.82 * Math.pow(lum, 1.25)) * (0.75 + 0.25 * im) * tier * (k === 0 ? 0.85 : 1);
      // ceras: casi todo plano; solo ~1 % de los trazos lleva pasta, y nunca en lo importante (caras)
      if (cfg.impRate !== undefined) thick = rand() < cfg.impRate * 2 * (1 - im) ? cfg.thick * (0.7 + 0.4 * rand()) : 0;
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
  if (cfg.finalPass > 0) {
    const reFin = 1.3 - (p.realismo === undefined ? 0.5 : p.realismo) * 1.2;
    const Rf = cfg.R0 * 1.05;
    const nF = Math.round(cfg.finalPass * reFin * W * H / (Rf * Rf * 260));
    const ref = refs[0];
    for (let k = 0; k < nF; k++) {
      let x = rand() * W, y = rand() * H;
      const im = impAt(x, y);
      if (im > 0.42 || rand() < im * 1.5) continue;                 // solo fuera del foco
      refAt(ref, x, y, base);
      const len = trace(ref, x, y, base, { step: Math.max(1, Rf), Lmax: Rf * cfg.Lk * (0.6 + 0.8 * rand()), curv: cfg.curv, tol: cfg.tolStop * 1.2,
        ca: 1, sa: 0, fine: false, handK: 0, hx: 1, hy: 0 });
      if (len < Rf * 2.5) continue;
      C.varyColor(base[0], base[1], base[2], (rand() - 0.5) * 2 * varH, (rand() - 0.5) * varS, (rand() - 0.5) * 2 * varL, col);
      const lum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];
      renderStroke(Rf * (0.8 + 0.5 * rand()), col, base, cfg.op * (0.75 + 0.2 * rand()), cfg.thick * (0.18 + 0.82 * Math.pow(lum, 1.25)) * (0.5 + 0.6 * rand()), cfg.tolClip * (1 + cfg.lost), 0);
      if ((k & 15) === 0) await clock.tick(0.955);
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
  const fcfg = { matte: cfg.matte, luminous: cfg.luminous, reliefK: cfg.reliefK, hBlur: cfg.hBlur || 1.6, canvasTex: cfg.canvasTex, shade: cfg.shade, gloss: cfg.gloss, under: 0, R0: cfg.R0, thick: cfg.thick, glossByHeight: true, chalk: cfg.chalk };
  return { Pr, Pg, Pb, Cv, Hh, Gl, cfg: fcfg, grain: null, gsInv: 1, real: true, pap };
}

module.exports = { paint, config, dtFilter };
