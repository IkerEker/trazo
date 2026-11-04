"use strict";
/*
 * Trazo · Xilografía
 *
 * Plancha de madera tallada con gubia: el tono se hace con cortes paralelos
 * cuyo ancho sigue la oscuridad. En las sombras quedan cortes blancos en punta
 * sobre la masa negra (talla blanca); en las luces, líneas negras finas.
 * Cada zona tiene su dirección de corte (facetas). Después, la estampación:
 * presión desigual, moteado de tinta, veta de la madera, bordes mellados,
 * restos de madera en los blancos y el grano del papel.
 * Variantes: realista, expresiva, dos tintas y tres tintas (planchas de color
 * desregistradas bajo la plancha negra).
 */
const C = require("./core.js");
const Seg = require("./segment.js");
const K = require("./kit.js");

async function paint(ctx, p, seg, Lfull, clock) {
  const { W, H, N, s, aw, ah } = ctx;
  const reg = seg.reg;
  const mode = p.modo;
  const rand = C.mulberry32(ctx.seed * 19 + 5);
  const color = mode === "dos" || mode === "tres";
  const expr = mode === "expresiva";
  const A = ctx.assets || {};

  /* ---------- tono (oscuridad) por píxel de análisis ---------- */
  const n = aw * ah;
  const T = new Float32Array(n);
  const bl = Float32Array.from(ctx.lum);
  C.gaussBlur(bl, aw, ah, Math.max(2, 14 * s / ctx.fa));
  for (let i = 0; i < n; i++) {
    let t = 1 - ctx.lum[i];
    t += (t - (1 - bl[i])) * 0.9;                     // contraste local
    t = C.smoothstep(0.08 + 0.1 * (1 - p.cobertura), 0.88, t);
    T[i] = t;
  }
  // expresiva: tono plano por faceta, en 4 niveles
  const levels = [0, 0.32, 0.62, 1];
  const regT = new Float32Array(reg.n), regA = new Float32Array(reg.n), regO = new Float32Array(reg.n);
  {
    const sum = new Float32Array(reg.n), cnt = new Float32Array(reg.n);
    for (let i = 0; i < n; i++) { sum[seg.labels[i]] += T[i]; cnt[seg.labels[i]]++; }
    for (let r = 0; r < reg.n; r++) {
      let t = sum[r] / Math.max(1, cnt[r]);
      if (expr) { let best = 0; for (let k = 1; k < 4; k++) if (Math.abs(levels[k] - t) < Math.abs(levels[best] - t)) best = k; t = levels[best]; }
      regT[r] = t;
      // dirección del corte: sigue la forma si la zona tiene dirección; si no, horizontal de taller
      let th = 0.5 * Math.atan2(reg.os[r], reg.oc[r]);
      if (reg.coh[r] < 0.35) th = (rand() - 0.5) * 0.25;
      const q = (Math.PI / 12) * (1 - p.curvatura) * 2;   // poca curvatura → ángulos de taller
      if (q > 0.02) th = Math.round(th / q) * q;
      regA[r] = th;
      regO[r] = rand();
    }
  }
  await clock.tick(0.1);

  /* ---------- planchas de color (dos / tres tintas) ---------- */
  let inks = [], regInk = null;
  if (color) {
    const nInk = mode === "dos" ? 1 : 2;
    const pal = K.palette(ctx, 5, ctx.seed, { skip: (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) < 0.12 || (r + g + b) / 3 > 0.9 || (r + g + b) / 3 < 0.15 });
    const cands = [];
    for (let k = 0; k < pal.K; k++) {
      const r = pal.r[k], g = pal.g[k], b = pal.b[k];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      cands.push({ r, g, b, sat: mx - mn, l: 0.299 * r + 0.587 * g + 0.114 * b });
    }
    cands.sort((a, b) => b.sat - a.sat);
    for (const c of cands) {
      if (inks.length >= nInk) break;
      if (inks.some((i) => Math.abs(i.r - c.r) + Math.abs(i.g - c.g) + Math.abs(i.b - c.b) < 0.35)) continue;
      // tinta de imprenta: color plano, saturado y claro
      const y = c.l, k2 = 1.5;
      inks.push({ r: C.clamp(y + (c.r - y) * k2 + 0.12, 0, 1), g: C.clamp(y + (c.g - y) * k2 + 0.12, 0, 1), b: C.clamp(y + (c.b - y) * k2 + 0.12, 0, 1) });
    }
    if (!inks.length) inks.push({ r: 0.86, g: 0.33, b: 0.2 });
    if (inks.length < nInk) inks.push({ r: 0.96, g: 0.78, b: 0.25 });
    // cada zona: papel, o la tinta más parecida a su color
    regInk = new Int8Array(reg.n).fill(-1);
    for (let r = 0; r < reg.n; r++) {
      const mr = reg.mean[r * 3], mg = reg.mean[r * 3 + 1], mb = reg.mean[r * 3 + 2];
      const l = reg.lum[r];
      if (l > 0.86) continue;
      let best = 0, bd = 1e9;
      for (let k = 0; k < inks.length; k++) {
        const ik = inks[k];
        const d = Math.abs(ik.r - mr) + Math.abs(ik.g - mg) + Math.abs(ik.b - mb);
        if (d < bd) { bd = d; best = k; }
      }
      const sat = Math.max(mr, mg, mb) - Math.min(mr, mg, mb);
      if (sat < 0.06 && l > 0.6) continue;
      regInk[r] = best;
    }
  }

  /* ---------- ruido de estampación y madera ---------- */
  const gw = Math.max(8, Math.ceil(W / 24)), gh = Math.max(8, Math.ceil(H / 24));
  const press = C.fbmGrid(gw, gh, Math.max(3, gw / 5), 3, ctx.seed + 901, 0.55);   // presión desigual
  const wob = C.fbmGrid(gw, gh, Math.max(2, gw / 12), 3, ctx.seed + 902, 0.5);     // pulso de la mano
  const mad = A.ov_madera && A.ov_madera.items.length ? K.overlaySampler(A.ov_madera.items[(rand() * A.ov_madera.items.length) | 0], W, H, { zoom: 0.8 }) : null;
  const imp = A.ov_impresion && A.ov_impresion.items.length ? K.overlaySampler(A.ov_impresion.items[(rand() * A.ov_impresion.items.length) | 0], W, H) : null;
  const madM = mad ? 0.28 : 0;
  const papS = ctx.paperPrep ? require("./library.js").paperSampler(ctx.paperPrep, require("./library.js").paperScale(Math.max(W, H), ctx.physMM)) : null;

  const P = Math.max(2.2, (2.4 + 8 * p.grosor) * s * (expr ? 1.5 : 1));           // separación de cortes
  const Lc = Math.max(6, (14 + 90 * p.longitud) * s);                               // largo de cada corte
  const gran = 0.35 + 0.9 * p.granulado;
  const inkStr = 0.82 + 0.18 * p.intensidad;
  const keyShift = color ? 0.42 : 0;                                                 // con color, el negro solo en sombras

  /* ---------- plancha negra: máscara de tinta ---------- */
  const ink = new Float32Array(N);
  const cut = new Float32Array(reg.n * 4);
  for (let r = 0; r < reg.n; r++) { const a = regA[r]; cut[r * 4] = -Math.sin(a); cut[r * 4 + 1] = Math.cos(a); cut[r * 4 + 2] = Math.cos(a); cut[r * 4 + 3] = Math.sin(a); }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const r = Lfull[i];
      let t = expr ? regT[r] * 0.75 + ctx.at(T, x, y) * 0.25 : ctx.at(T, x, y);
      if (keyShift) t = C.smoothstep(keyShift, 1, t);
      // posición sobre el corte
      const nx = cut[r * 4], ny = cut[r * 4 + 1], tx = cut[r * 4 + 2], ty = cut[r * 4 + 3];
      const w1 = (C.bilinear(wob, gw, gh, x / 24, y / 24) - 0.5) * 0.9;
      const ph = (x * nx + y * ny) / P + regO[r] * 7 + w1;
      const si = Math.floor(ph), f = ph - si;
      const along = (x * tx + y * ty) / Lc + C.hash2(si, r, 3) * 3;
      const u = along - Math.floor(along);
      const env = Math.sqrt(Math.max(0, Math.sin(u * Math.PI)));                      // corte en punta (gubia en V)
      // tres zonas (como en los grabados reales): luces de papel limpio, sombras de negro pleno
      // y solo los medios tonos hechos con líneas
      const tz = C.smoothstep(0.1, 0.84, t);
      // ancho de la tinta: oscuridad, con los cortes blancos afinándose en los extremos
      let b = tz;
      if (b > 0.5) b = 1 - (1 - b) * env * (0.75 + 0.5 * C.hash2(si, r, 7));          // cortes blancos en punta
      else b = b * (0.55 + 0.45 * env);                                                 // líneas negras que se afinan
      const half = b * P * 0.5;
      const dist = Math.abs(f - 0.5) * P;
      const rough = (C.hash2(x >> 1, y >> 1, 11) - 0.5) * 0.9 * Math.min(1.5, P * 0.12);   // borde mellado
      let a = C.clamp((half - dist + rough) / 0.9 + 0.5, 0, 1);
      // masas oscuras: casi plenas, con algún corte blanco suelto (fondo tallado)
      if (t > 0.84) { const keep = C.hash2(si, r, 41) < 0.02 + 0.22 * reg.imp[r] * reg.imp[r] * (1 - C.smoothstep(0.84, 0.95, t)); if (!keep) a = 1; }
      else if (t < 0.1) a = 0;
      ink[i] = a;
    }
    if ((y & 31) === 0) await clock.tick(0.12 + 0.4 * y / H);
  }

  // contornos: la madera que se deja alrededor de las formas en las zonas claras
  // (solo en la expresiva: en las demás la forma la definen los cortes, sin perfil gris)
  if (expr && p.detalle > 0.05) {
    const thr = 0.5 - 0.3 * p.detalle;
    const cw = Math.max(0.7, (0.6 + 1.6 * p.grosor) * s * (expr ? 1.6 : 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const e = ctx.at(ctx.edgeRaw, x, y);
      if (e < thr) continue;
      const i = y * W + x;
      const k = C.smoothstep(thr, thr + 0.12, e);
      ink[i] = Math.max(ink[i], k);
    }
  }
  // marco irregular de la plancha (expresiva)
  if (expr) {
    const bw = Math.max(3, 0.012 * Math.max(W, H));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (d > bw * 1.6) continue;
      const jag = bw * (1 + 0.35 * (C.bilinear(wob, gw, gh, x / 24 + 50, y / 24) - 0.5) * 2) + (C.hash2(x, y, 5) - 0.5) * 1.2;
      if (d < jag) ink[y * W + x] = 1;
    }
  }
  await clock.tick(0.6);

  /* ---------- interior de las masas (para el moteado) y blancos grandes (restos) ---------- */
  const inter = Float32Array.from(ink);
  {
    const tmp = new Float32Array(N);
    const rb = Math.max(2, Math.round(P * 1.2));
    C.boxBlurH(inter, tmp, W, H, rb); C.boxBlurV(tmp, inter, W, H, rb);
  }

  /* ---------- estampación: transmitancia por canal ---------- */
  const Tr = new Float32Array(N).fill(1), Tg = new Float32Array(N).fill(1), Tb = new Float32Array(N).fill(1);
  if (color) {
    const dx = Math.round((2 + 3 * rand()) * s), dy = Math.round((1 + 3 * rand()) * s);
    for (let k = 0; k < inks.length; k++) {
      const ik = inks[k];
      const ox = k === 0 ? dx : -dy, oy = k === 0 ? dy : dx;
      for (let y = 0; y < H; y++) {
        const sy = C.clamp(y - oy, 0, H - 1);
        for (let x = 0; x < W; x++) {
          // filo mellado de la plancha de color (la gubia no sigue la forma al píxel)
          const jx = (C.bilinear(wob, gw, gh, x / 24 + 20 * k, y / 24) - 0.5) * 3 * s + (C.hash2(x >> 1, y >> 1, 41 + k) - 0.5) * 1.5;
          const jy = (C.bilinear(wob, gw, gh, x / 24, y / 24 + 20 * k) - 0.5) * 3 * s;
          const sx = C.clamp((x - ox + jx) | 0, 0, W - 1), sy2 = C.clamp((sy + jy) | 0, 0, H - 1);
          const r = Lfull[sy2 * W + sx];
          if (regInk[r] !== k) continue;
          const i = y * W + x;
          // presión desigual (zonas más pálidas) y veta de la madera en la tinta de color
          let a = 0.95 * inkStr * (0.86 + 0.28 * (C.bilinear(press, gw, gh, x / 24 + k * 13, y / 24) - 0.5));
          if (mad) a *= 1 - 0.35 * C.smoothstep(0.55, 0.9, mad(x * 0.9 + 77 * k, y * 0.9));
          if (mad) { const gv = mad(x, y); a *= 1 - madM * 0.8 * C.smoothstep(0.7, 0.95, gv); }
          if (imp) a *= 1 - gran * 0.4 * C.smoothstep(0.25, 0.05, imp(x * 1.3, y * 1.3));
          a *= 1 - gran * 0.25 * C.smoothstep(0.8, 1, C.hash2(x, y, 31 + k));
          Tr[i] *= 1 - a * (1 - ik.r); Tg[i] *= 1 - a * (1 - ik.g); Tb[i] *= 1 - a * (1 - ik.b);
        }
        if ((y & 63) === 0) await clock.tick(0.6 + 0.1 * (k + y / H) / inks.length);
      }
    }
  }
  const kr = 0.07, kg = 0.065, kb = 0.07;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let a = ink[i];
      const it = inter[i];
      // presión desigual: negros algo grisáceos en zonas
      let pr = Math.min(1, inkStr * (0.95 + 0.18 * (C.bilinear(press, gw, gh, x / 24, y / 24) - 0.5)));
      if (a > 0.01) {
        // moteado: poros sin tinta, más en el centro de las masas grandes
        const deep = C.smoothstep(0.75, 0.98, it);
        let speck = C.smoothstep(0.975 - 0.02 * gran, 0.995, C.hash2(x >> 1, y >> 1, 17));
        if (imp) speck = Math.max(speck, C.smoothstep(0.18, 0.04, imp(x, y)) * 0.8);
        // la tinta no llega a los valles del papel (más con poca presión)
        if (papS) speck = Math.max(speck, C.smoothstep(0.03 + 0.06 * gran, 0.0, papS.eqN(x, y)) * (0.5 + 0.6 * (1 - pr)));
        pr *= 1 - gran * deep * speck * 0.9;
        // veta de la madera en las masas
        if (mad) pr *= 1 - (madM * 0.9 + 0.04) * (0.4 + gran) * deep * C.smoothstep(0.8, 0.97, mad(x, y));
        a *= pr;
      } else if (it < 0.04) {
        // restos de madera en los vaciados grandes, alineados con el corte
        if (mad) {
          const gv = mad(x * 0.7 + 40, y * 0.7);
          const chat = C.smoothstep(0.86, 0.95, gv) * C.smoothstep(0.04, 0.0, it) * 0.85 * (0.4 + 0.6 * p.granulado);
          if (chat > 0.02 && C.hash2(x >> 3, y >> 3, 23) > (color ? 0.85 : 0.65)) a = Math.min(1, chat * 1.1);
        }
      }
      if (a <= 0.003) continue;
      Tr[i] *= 1 - a * (1 - kr); Tg[i] *= 1 - a * (1 - kg); Tb[i] *= 1 - a * (1 - kb);
    }
    if ((y & 31) === 0) await clock.tick(0.72 + 0.26 * y / H);
  }
  const out = K.transToRGBA(Tr, Tg, Tb);
  if (ctx.selFull) for (let i = 0; i < N; i++) out[i * 4 + 3] = out[i * 4 + 3] * ctx.selFull[i] / 255;
  return out;
}

module.exports = { paint };
