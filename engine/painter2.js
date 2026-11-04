"use strict";
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
