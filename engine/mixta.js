"use strict";
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
const Pencil = require("./sketch.js");
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
  const base = await Pencil.paint(ctx, Object.assign({}, p, { modo: "mixta", cobertura: 0.55 + 0.3 * (1 - p.cobertura) }), tick(0, 0.3), seg, Lfull, { only: "tono", toneMul: 0.75 });
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
  const lines = await Pencil.paint(ctx, Object.assign({}, p, { modo: "mixta" }), tick(0.75, 0.98), seg, Lfull, { only: "lineas", lineMul: 0.8 + 0.3 * p.intensidad });
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
