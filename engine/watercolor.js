"use strict";
/*
 * Trazo · Acuarela
 * 1) Abstracción: filtro Kuwahara suavizado (manchas planas, bordes nítidos).
 * 2) Sangrado húmedo: el color se funde con un desenfoque en zonas al azar.
 * 3) Densidad de pigmento (modelo de Bousseau): oscurecimiento de bordes,
 *    turbulencia, granulado en el grano del papel y marcas de pincel.
 * 4) Reserva de blancos (cobertura) y salida transparente: el papel es alfa.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");

/** Kuwahara generalizado con tablas de sumas (O(n) por radio). */
function kuwahara(r, g, b, w, h, rad) {
  const W1 = w + 1;
  const n1 = W1 * (h + 1);
  const sr = new Float64Array(n1), sg = new Float64Array(n1), sb = new Float64Array(n1);
  const sl = new Float64Array(n1), sl2 = new Float64Array(n1);
  for (let y = 0; y < h; y++) {
    let ar = 0, ag = 0, ab = 0, al = 0, al2 = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
      ar += r[i]; ag += g[i]; ab += b[i]; al += l; al2 += l * l;
      const o = (y + 1) * W1 + x + 1, u = y * W1 + x + 1;
      sr[o] = sr[u] + ar; sg[o] = sg[u] + ag; sb[o] = sb[u] + ab; sl[o] = sl[u] + al; sl2[o] = sl2[u] + al2;
    }
  }
  const or = new Float32Array(w * h), og = new Float32Array(w * h), ob = new Float32Array(w * h);
  const box = (T, x0, y0, x1, y1) => T[(y1 + 1) * W1 + x1 + 1] - T[y0 * W1 + x1 + 1] - T[(y1 + 1) * W1 + x0] + T[y0 * W1 + x0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let wsum = 0, mr = 0, mg = 0, mb = 0;
      for (let q = 0; q < 4; q++) {
        const x0 = q & 1 ? x : Math.max(0, x - rad), x1 = q & 1 ? Math.min(w - 1, x + rad) : x;
        const y0 = q & 2 ? y : Math.max(0, y - rad), y1 = q & 2 ? Math.min(h - 1, y + rad) : y;
        const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
        const inv = 1 / cnt;
        const ml = box(sl, x0, y0, x1, y1) * inv;
        const v = Math.max(0, box(sl2, x0, y0, x1, y1) * inv - ml * ml);
        const wt = 1 / (1e-5 + v * v * 1e3 + v);
        wsum += wt;
        mr += box(sr, x0, y0, x1, y1) * inv * wt;
        mg += box(sg, x0, y0, x1, y1) * inv * wt;
        mb += box(sb, x0, y0, x1, y1) * inv * wt;
      }
      const i = y * w + x;
      or[i] = mr / wsum; og[i] = mg / wsum; ob[i] = mb / wsum;
    }
  }
  return [or, og, ob];
}

async function paint(ctx, p, clock) {
  const { W, H, N, s, aw, ah, fa } = ctx;
  const n = aw * ah;
  const rand = C.mulberry32(ctx.seed * 17 + 11);

  /* ----- 1) abstracción ----- */
  const radFull = (2 + p.grosor * 13) * s * (1 - 0.35 * p.detalle);
  const rad = Math.max(1, Math.round(radFull / fa));
  let [kr, kg, kb] = kuwahara(ctx.ar, ctx.ag, ctx.ab, aw, ah, rad);
  await clock.tick(0.1);
  [kr, kg, kb] = kuwahara(kr, kg, kb, aw, ah, Math.max(1, Math.round(rad * 0.6)));
  await clock.tick(0.2);

  // variación de color por zonas (tono / saturación / luz)
  if (p.varTono + p.varSat + p.varLuz > 0.01) {
    const gw = Math.max(4, Math.ceil(aw / 6)), gh = Math.max(4, Math.ceil(ah / 6));
    const cell = Math.max(3, gw / 4);
    const nh = C.fbmGrid(gw, gh, cell, 2, ctx.seed + 401, 0.5);
    const ns = C.fbmGrid(gw, gh, cell, 2, ctx.seed + 402, 0.5);
    const nl = C.fbmGrid(gw, gh, cell, 2, ctx.seed + 403, 0.5);
    const tmp = new Float32Array(3);
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      const i = y * aw + x;
      const fx = x / 6, fy = y / 6;
      C.varyColor(kr[i], kg[i], kb[i],
        (C.bilinear(nh, gw, gh, fx, fy) - 0.5) * 2 * p.varTono * 0.5,
        (C.bilinear(ns, gw, gh, fx, fy) - 0.5) * 2 * p.varSat * 0.7,
        (C.bilinear(nl, gw, gh, fx, fy) - 0.5) * 2 * p.varLuz * 0.3, tmp);
      kr[i] = tmp[0]; kg[i] = tmp[1]; kb[i] = tmp[2];
    }
  }

  /* ----- 2) sangrado húmedo ----- */
  const sig = (1.5 + p.humedad * 9) * s / fa;
  const br = Float32Array.from(kr), bg = Float32Array.from(kg), bb = Float32Array.from(kb);
  const tmp = new Float32Array(n);
  C.gaussBlur(br, aw, ah, sig, tmp); C.gaussBlur(bg, aw, ah, sig, tmp); C.gaussBlur(bb, aw, ah, sig, tmp);
  const gw = Math.max(4, Math.ceil(aw / 4)), gh = Math.max(4, Math.ceil(ah / 4));
  const bleedN = C.fbmGrid(gw, gh, Math.max(3, gw / 6), 3, ctx.seed + 501, 0.55);
  const wr = new Float32Array(n), wg = new Float32Array(n), wb = new Float32Array(n);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const i = y * aw + x;
    const m = C.smoothstep(0.62 - p.humedad * 0.3, 0.8 - p.humedad * 0.2, C.bilinear(bleedN, gw, gh, x / 4, y / 4)) * (0.3 + 0.7 * p.humedad);
    wr[i] = kr[i] + (br[i] - kr[i]) * m;
    wg[i] = kg[i] + (bg[i] - kg[i]) * m;
    wb[i] = kb[i] + (bb[i] - kb[i]) * m;
  }
  await clock.tick(0.3);

  /* ----- 3) mapa de bordes de las manchas (oscurecimiento) ----- */
  const E = new Float32Array(n);
  for (let y = 0; y < ah; y++) {
    const ym = (y > 0 ? y - 1 : 0) * aw, yp = (y < ah - 1 ? y + 1 : y) * aw, y0 = y * aw;
    for (let x = 0; x < aw; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < aw - 1 ? x + 1 : x;
      const lx = 0.3 * (wr[y0 + xp] - wr[y0 + xm]) + 0.59 * (wg[y0 + xp] - wg[y0 + xm]) + 0.11 * (wb[y0 + xp] - wb[y0 + xm]);
      const ly = 0.3 * (wr[yp + x] - wr[ym + x]) + 0.59 * (wg[yp + x] - wg[ym + x]) + 0.11 * (wb[yp + x] - wb[ym + x]);
      E[y0 + x] = Math.sqrt(lx * lx + ly * ly);
    }
  }
  const e95 = C.percentile(E, 0.97) || 1e-3;
  for (let i = 0; i < n; i++) E[i] = Math.min(1, E[i] / e95);
  C.gaussBlur(E, aw, ah, Math.max(0.6, 0.8 * s / fa), tmp);

  // turbulencia de pigmento (baja frecuencia) y desplazamiento de bordes
  const turbN = C.fbmGrid(gw, gh, Math.max(3, gw / 10), 4, ctx.seed + 601, 0.55);
  const dxN = C.fbmGrid(gw, gh, Math.max(2, gw / 16), 3, ctx.seed + 602, 0.5);
  const dyN = C.fbmGrid(gw, gh, Math.max(2, gw / 16), 3, ctx.seed + 603, 0.5);
  await clock.tick(0.4);

  /* ----- 4) marcas de pincel (modulan la densidad) ----- */
  const Dn = new Float32Array(N);
  const lib = ctx.lib && ctx.lib.samples && ctx.lib.samples.length ? ctx.lib.samples : null;
  if (lib) {
    await realWashes(ctx, p, lib, Dn, rand, clock);
  } else if (p.longitud > 0.01) {
    const raster = new S.StrokeRaster(W, H);
    const path = new S.StrokePath();
    const R = (2.5 + p.grosor * 15) * s;
    const L = R * 2 * (0.6 + p.longitud * 4.5);
    const sp = R * 1.9;
    const cols = Math.ceil(W / sp), rows = Math.ceil(H / sp);
    const col = new Float32Array(3);
    const total = cols * rows;
    let done = 0;
    const level = ctx.levelFor(R);
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      done++;
      const x = (gx + rand()) * sp, y = (gy + rand()) * sp;
      if (x >= W || y >= H) continue;
      if (rand() > ctx.at(ctx.cover, x, y) * 0.85) continue;
      ctx.colorAt(level, x, y, col);
      S.traceStroke(ctx, path, x, y, {
        R, Lmax: L * (0.5 + rand()), step: Math.max(1, R * 0.6), curv: 0.1 + 0.85 * p.curvatura,
        colorTol: 0.5, color: col, level, angle: 0, minLen: R,
      });
      S.wobblePath(path, R * 0.15, R * 6, rand() * 6.28);
      const len = path.len || 1;
      for (let i = 0; i < path.n; i++) {
        const u = path.ss[i] / len;
        path.rs[i] = R * (0.6 + 0.4 * Math.sin(u * Math.PI)) * (0.85 + 0.3 * rand());
      }
      const nt = raster.rasterize(path, 0.5);
      const str = 0.18 + 0.3 * rand();
      const A = raster.A, V = raster.V, U = raster.U, tl = raster.tl, tg = raster.tg;
      for (let t = 0; t < nt; t++) {
        const li = tl[t], g = tg[t];
        const v = V[li], av = v < 0 ? -v : v;
        const u = U[li];
        const rim = C.smoothstep(0.55, 0.95, av) * 0.8 + 0.25 + C.smoothstep(0.85, 1, u) * 0.4;
        const add = A[li] * str * rim;
        Dn[g] = Dn[g] + add * (1 - Dn[g] * 0.6);
      }
      raster.clear();
      if ((done & 31) === 0) await clock.tick(0.4 + 0.3 * done / total);
    }
  }

  /* ----- 5) composición a resolución completa ----- */
  const grain = C.makeGrainTile(ctx.seed + 21, "rough");
  const gsInv = 1 / Math.max(1, Math.sqrt(s) * 2.0);
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H))) : null;
  // con aguadas reales: una aguada base más clara + veladuras que aportan el resto del pigmento
  const glaze = !!lib;
  const gk = 0.85 * (0.55 + 0.5 * p.intensidad);
  const amp = (0.8 + p.humedad * 3.5) * s; // ondulación de los bordes (px)
  const edgeDark = 0.45 + 0.6 * p.detalle;
  const turbK = 0.22 + 0.18 * p.humedad;
  const granK = 0.25 + 1.0 * p.granulado;
  const pig = 0.45 + 0.6 * p.intensidad;
  const brushK = 0.25 + 0.5 * p.longitud;
  const out = new Uint8Array(N * 4);
  const selFull = ctx.selFull, data = ctx.data, comp = ctx.comp, srcA = ctx.srcAlpha;
  const cover = ctx.cover;
  const ax = ctx.ax, ay = ctx.ay;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // coordenadas de análisis con ondulación
      const gx4 = (x + 0.5) * ax / 4, gy4 = (y + 0.5) * ay / 4;
      const ox = (C.bilinear(dxN, gw, gh, gx4, gy4) - 0.5) * 2 * amp;
      const oy = (C.bilinear(dyN, gw, gh, gx4, gy4) - 0.5) * 2 * amp;
      const sx = (x + ox + 0.5) * ax - 0.5, sy = (y + oy + 0.5) * ay - 0.5;
      let r = C.bilinear(wr, aw, ah, sx, sy);
      let g = C.bilinear(wg, aw, ah, sx, sy);
      let b = C.bilinear(wb, aw, ah, sx, sy);
      const e = C.bilinear(E, aw, ah, sx, sy);
      const m = C.bilinear(cover, aw, ah, sx, sy);
      const tu = C.bilinear(turbN, gw, gh, gx4, gy4);
      const gr = pap ? pap.eq(x, y) : C.tileAt(grain, x * gsInv, y * gsInv);
      const c0r = r, c0g = g, c0b = b;
      const lumv = 0.299 * r + 0.587 * g + 0.114 * b;
      // densidad de pigmento
      let d = (1 + edgeDark * e * e * 1.2) *
              (1 + turbK * (tu - 0.5) * 2) *
              (1 + granK * (gr - 0.5) * (0.4 + (1 - lumv))) *
              (glaze ? 1 : 1 + brushK * (Dn[i] - 0.2)) *
              (1 + 1.1 * 4 * m * (1 - m) * (m < 0.98 ? 1 : 0)); // borde de la mancha al reservar blancos
      const k = d - 1;
      r = r - (r - r * r) * k; g = g - (g - g * g) * k; b = b - (b - b * b) * k;
      // intensidad del pigmento y reserva del papel
      const pm = pig * m * (glaze ? 0.72 : 1);
      r = 1 - (1 - r) * pm; g = 1 - (1 - g) * pm; b = 1 - (1 - b) * pm;
      if (glaze && Dn[i] > 0.001) {
        // veladuras transparentes: cada aguada absorbe según su color (se oscurecen al superponerse)
        const dg = (1 - Math.exp(-Dn[i] * 1.1)) * gk * m; // las veladuras se saturan: no oscurecen sin límite
        r *= Math.exp(-(1 - c0r) * dg); g *= Math.exp(-(1 - c0g) * dg); b *= Math.exp(-(1 - c0b) * dg);
      }
      r = r < 0 ? 0 : r > 1 ? 1 : r; g = g < 0 ? 0 : g > 1 ? 1 : g; b = b < 0 ? 0 : b > 1 ? 1 : b;
      // papel blanco → transparente
      let a = Math.max(1 - r, 1 - g, 1 - b);
      const o = i * 4;
      if (a < 0.004) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 0; continue; }
      const ia = 1 / a;
      r = 1 - (1 - r) * ia; g = 1 - (1 - g) * ia; b = 1 - (1 - b) * ia;
      if (selFull) a *= selFull[i] / 255;
      if (srcA) a *= data[i * comp + 3] / 255;
      out[o] = r * 255 + 0.5 | 0; out[o + 1] = g * 255 + 0.5 | 0; out[o + 2] = b * 255 + 0.5 | 0;
      out[o + 3] = a * 255 + 0.5 | 0;
    }
    if ((y & 15) === 0) await clock.tick(0.7 + 0.3 * y / H);
  }
  return out;
}

/**
 * Aguadas reales: cada pincelada es una muestra escaneada (borde de pigmento,
 * floraciones, granulado) que se acumula como densidad de veladura.
 * Dos pasadas: toda la imagen y luego refuerzo en las zonas oscuras.
 */
async function realWashes(ctx, p, lib, Dn, rand, clock) {
  const { W, H, s } = ctx;
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const col = new Float32Array(3);
  const ts = new Float32Array(2);
  const R0 = (6 + p.grosor * 26) * s;
  const passes = [
    { R: R0, sp: 1.9, minDark: 0.06, prob: 0.9, str: 0.8 },
    { R: R0 * 0.62, sp: 2.2, minDark: 0.42, prob: 0.8, str: 0.75 },
  ];
  for (let pi = 0; pi < passes.length; pi++) {
    const P = passes[pi];
    const R = P.R, Rr = R / 0.7;
    const L = R * 2 * (1.4 + p.longitud * 6);
    const sp = R * P.sp;
    const cols = Math.ceil(W / sp), rows = Math.ceil(H / sp);
    const level = ctx.levelFor(R);
    const total = cols * rows;
    let done = 0;
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      done++;
      const x = (gx + rand()) * sp, y = (gy + rand()) * sp;
      if (x >= W || y >= H) continue;
      if (rand() > ctx.at(ctx.cover, x, y) * P.prob) continue;
      ctx.colorAt(level, x, y, col);
      const dark = 1 - (0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2]);
      if (dark < P.minDark) continue;
      if (rand() > 0.35 + 0.9 * dark) continue; // zonas claras: más aguada base y papel
      S.traceStroke(ctx, path, x, y, {
        R, Lmax: L * (0.55 + rand() * 0.8), step: Math.max(1, R * 0.8), curv: 0.1 + 0.85 * p.curvatura,
        colorTol: 0.55, color: col, level, angle: (rand() - 0.5) * 0.3, minLen: R * 1.5,
      });
      S.wobblePath(path, R * 0.08, R * 8, rand() * 6.28);
      for (let i = 0; i < path.n; i++) path.rs[i] = Rr * 0.9;
      const nt = raster.rasterize(path, 0.04);
      if (nt === 0) continue;
      const st = Lib.prepare(lib[(rand() * lib.length) | 0], path.len || 1, Rr, rand, 0.9);
      const str = P.str * (0.75 + 0.5 * rand());
      const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
      for (let t = 0; t < nt; t++) {
        const li = tl[t], g = tg[t];
        Lib.sampleAt(st, U[li], V[li], ts);
        const add = ts[0] * A[li] * str;
        if (add > 0.003) Dn[g] += add * (1 - Dn[g] * 0.25);
      }
      raster.clear();
      if ((done & 31) === 0) await clock.tick(0.4 + 0.3 * (pi + done / total) / passes.length);
    }
  }
}

module.exports = { paint, kuwahara };
