"use strict";
/*
 * Trazo · punto de entrada del motor.
 *
 *   const Engine = require("./engine/index.js");
 *   const res = await Engine.render(
 *     { width, height, data: Uint8Array, components: 3|4 },
 *     { technique: "oleo", params: {...0..100}, seed: 1,
 *       selection: { mask: Uint8Array, mode: "solo"|"detalle" } | null,
 *       paper: true },
 *     { onProgress(f, texto), shouldCancel(), sliceMs }
 *   );
 *   // res = { paint: Uint8Array RGBA, paper: Uint8Array RGBA | null, width, height }
 */
const C = require("./core.js");
const { Context } = require("./analysis.js");
const T = require("./techniques.js");
const Painter = require("./painter.js");
const Pencil = require("./pencil.js");
const Water = require("./watercolor.js");
const Paper = require("./paper.js");
const Lib = require("./library.js");

// soporte real de cada técnica (archivo textures/soporte-<tipo>.bin)
const SUPPORT_FOR = { oleo: "lienzo", gouache: "acuarela", acuarela: "acuarela", lapiz: "dibujo", ceras: "dibujo" };

function flowOptions(tech, p) {
  switch (tech) {
    case "lapiz":    return { flowSigma: 8 + p.grosor * 8, baseAngle: -Math.PI / 4, wander: 0.2, bias: 0.15, localBias: 0.35 };
    case "ceras":    return { flowSigma: 5 + p.grosor * 8, baseAngle: -0.55, wander: 0.5, bias: 0.1, localBias: 0.2 };
    case "acuarela": return { flowSigma: 6 + p.grosor * 14, baseAngle: 0, wander: 0.6, bias: 0.1, localBias: 0.1 };
    case "gouache":  return { flowSigma: 4 + p.grosor * 16, baseAngle: 0, wander: 0.55, bias: 0.08, localBias: 0.08 };
    default:         return { flowSigma: 3 + p.grosor * 15, baseAngle: 0, wander: 0.5, bias: 0.08, localBias: 0.06 };
  }
}

async function render(input, opts, hooks) {
  const tech = T.BY_ID[opts.technique] ? opts.technique : "oleo";
  const p = T.normalized(tech, opts.params);
  const clock = C.makeClock(hooks);
  const seed = (opts.seed | 0) || 1;
  const ctx = new Context(input, { seed });
  // trazos y soporte reales (opcionales: sin ellos se usa el modelo procedural)
  ctx.lib = opts.library && opts.library.kind === "strokes" ? opts.library : null;
  ctx.paperPrep = opts.support ? Lib.preparePaper(opts.support) : null;

  clock.stage(0, 0.06, "Analizando la imagen");
  await ctx.buildBase(clock);
  clock.stage(0.06, 0.14, "Calculando la dirección de los trazos");
  await ctx.buildFlow(flowOptions(tech, p), clock);
  ctx.setSelection(opts.selection);
  ctx.buildCoverage(p.cobertura, { lumWeight: tech === "acuarela" ? 0.7 : tech === "lapiz" ? 0.4 : 0.55 });

  let paint;
  if (tech === "lapiz") {
    clock.stage(0.14, opts.paper ? 0.9 : 0.98, "Dibujando");
    paint = await Pencil.paint(ctx, p, clock);
  } else if (tech === "acuarela") {
    clock.stage(0.14, opts.paper ? 0.9 : 0.98, "Pintando acuarela");
    paint = await Water.paint(ctx, p, clock);
  } else {
    clock.stage(0.14, 0.8, "Pintando");
    const planes = await Painter.paint(ctx, tech, p, clock);
    clock.stage(0.8, opts.paper ? 0.9 : 0.98, "Acabado");
    paint = await Painter.finish(ctx, tech, p, planes, clock);
  }

  let paper = null;
  if (opts.paper) {
    clock.stage(0.9, 0.98, "Preparando el papel");
    paper = await Paper.makePaper(tech, ctx.W, ctx.H, seed, clock, ctx.paperPrep);
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
  parseTexture: Lib.parse, SUPPORT_FOR,
};
