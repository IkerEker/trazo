"use strict";
/*
 * Trazo · soporte (papel o lienzo) para la capa inferior opcional.
 */
const C = require("./core.js");

const BASE = {
  lapiz:    { c: [247, 245, 240], amp: 9,  kind: "paper", scale: 1.2 },
  ceras:    { c: [246, 243, 236], amp: 13, kind: "rough", scale: 1.1 },
  acuarela: { c: [250, 248, 243], amp: 15, kind: "rough", scale: 2.0 },
  gouache:  { c: [244, 241, 234], amp: 10, kind: "paper", scale: 1.6 },
  oleo:     { c: [234, 228, 216], amp: 20, kind: "canvas", scale: 1.0 },
  mixtalg:    { c: [246, 243, 236], amp: 9,  kind: "paper", scale: 1.2 },
  // pastel seco: papel de color (tipo Canson Mi-Teintes)
  ceras_pastelseco: { c: [214, 204, 186], amp: 12, kind: "rough", scale: 1.1 },
  xilografia: { c: [243, 237, 224], amp: 10, kind: "paper", scale: 1.4 },
};

async function makePaper(technique, W, H, seed, clock, prep, modo) {
  const cfg = BASE[technique + "_" + modo] || BASE[technique] || BASE.lapiz;
  if (prep) return realPaper(cfg, technique, W, H, seed, clock, prep);
  const s = Math.max(W, H) / 1000;
  const tile = C.makeGrainTile(seed + (technique === "oleo" ? 9 : technique === "acuarela" ? 21 : 3), cfg.kind);
  const inv = 1 / Math.max(1, Math.sqrt(s) * cfg.scale);
  const gw = Math.max(4, Math.ceil(W / 64)), gh = Math.max(4, Math.ceil(H / 64));
  const low = C.fbmGrid(gw, gh, Math.max(2, gw / 3), 3, seed + 77, 0.5);
  const out = new Uint8Array(W * H * 4);
  const [br, bg, bb] = cfg.c;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const t = C.tileAt(tile, x * inv, y * inv) - 0.5;
      const l = (C.bilinear(low, gw, gh, x / 64, y / 64) - 0.5) * 7;
      const d = t * cfg.amp + l;
      out[i] = C.clamp(br + d, 0, 255) | 0;
      out[i + 1] = C.clamp(bg + d, 0, 255) | 0;
      out[i + 2] = C.clamp(bb + d * 1.05, 0, 255) | 0;
      out[i + 3] = 255;
    }
    if (clock && (y & 63) === 0) await clock.tick(y / H);
  }
  return out;
}

/** Soporte a partir de la textura real (escaneada de los fondos), a escala física. */
async function realPaper(cfg, technique, W, H, seed, clock, prep) {
  const Lib = require("./library.js");
  const smp = Lib.paperSampler(prep, Lib.paperScale(Math.max(W, H), Lib.physMM(technique)));
  const amp = technique === "oleo" ? 30 : technique === "acuarela" || technique === "gouache" ? 22 : 18;
  const gw = Math.max(4, Math.ceil(W / 64)), gh = Math.max(4, Math.ceil(H / 64));
  const low = C.fbmGrid(gw, gh, Math.max(2, gw / 3), 3, seed + 77, 0.5);
  const out = new Uint8Array(W * H * 4);
  const [br, bg, bb] = cfg.c;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = smp.raw(x, y) * amp + (C.bilinear(low, gw, gh, x / 64, y / 64) - 0.5) * 6;
      out[i] = C.clamp(br + d, 0, 255) | 0;
      out[i + 1] = C.clamp(bg + d, 0, 255) | 0;
      out[i + 2] = C.clamp(bb + d * 1.05, 0, 255) | 0;
      out[i + 3] = 255;
    }
    if (clock && (y & 63) === 0) await clock.tick(y / H);
  }
  return out;
}

module.exports = { makePaper };
