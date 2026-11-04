"use strict";
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
