"use strict";
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
const Painter3 = require("./painter3.js");
const Pencil = require("./pencil.js");
const K = require("./kit.js");
const M = require("./rotuladores.js");

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
  const gou = await gouacheLayer(ctx, gp, seg, Lfull, tick(0, 0.4), mode === "cartel" ? "planos" : "pleinair");
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
    lib: ink, width: Math.max(0.9, (0.8 + 2.4 * p.grosor) * s * (mode === "cartel" ? 1.3 : 1)), opacity: 0.85,
    density: { cuaderno: 0.55, collage: 0.35, cartel: 0.5, impresion: 0.25 }[mode],
    thr: { cuaderno: 0.12, collage: 0.35, cartel: 0.25, impresion: 0.45 }[mode] - 0.12 * p.detalle, impK: 0.9,
    segLen: (50 + 160 * p.longitud) * s, gap: 4, overshoot: 0.08,
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
