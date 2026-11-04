"use strict";
/*
 * Trazo · utilidades compartidas por las técnicas
 *  - texturas repetibles (gris o color) con giro, escala física y desplazamiento
 *  - texturas 9:16 no repetibles (se estiran para cubrir el lienzo)
 *  - manchas reales como sellos (densidad + relieve), giradas y escaladas
 *  - composición de capas: normal (opaco) y multiplicar (medios transparentes)
 *  - grano del papel en las zonas veladas (con o sin papel visible)
 */
const C = require("./core.js");
const Lib = require("./library.js");

/* ---------------- texturas repetibles ---------------- */
function tilePrep(item) {
  if (item._prep) return item._prep;
  const P = item.planes[0], n = P.w * P.h;
  let m = 0, m2 = 0;
  for (let i = 0; i < n; i++) { const v = P.data[i] / 255; m += v; m2 += v * v; }
  m /= n; const sd = Math.sqrt(Math.max(1e-6, m2 / n - m * m));
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = (P.data[i] / 255 - m) / sd; L[i] = v < -3 ? -3 : v > 3 ? 3 : v; }
  const prep = { w: P.w, h: P.h, L, mean: m, sd, cr: null, cb: null, cw: 0, ch: 0 };
  if (item.planes.length >= 3) {
    const a = item.planes[1], b = item.planes[2];
    prep.cw = a.w; prep.ch = a.h;
    prep.cr = new Float32Array(a.w * a.h); prep.cb = new Float32Array(a.w * a.h);
    for (let i = 0; i < a.w * a.h; i++) { prep.cr[i] = (a.data[i] - 128) / 400; prep.cb[i] = (b.data[i] - 128) / 400; }
  }
  item._prep = prep;
  return prep;
}

function bilWrap(arr, w, h, u, v) {
  u %= w; if (u < 0) u += w;
  v %= h; if (v < 0) v += h;
  const x0 = u | 0, y0 = v | 0;
  const x1 = x0 + 1 >= w ? 0 : x0 + 1, y1 = y0 + 1 >= h ? 0 : y0 + 1;
  const fx = u - x0, fy = v - y0;
  const a = arr[y0 * w + x0] + (arr[y0 * w + x1] - arr[y0 * w + x0]) * fx;
  const b = arr[y1 * w + x0] + (arr[y1 * w + x1] - arr[y1 * w + x0]) * fx;
  return a + (b - a) * fy;
}

/** Píxeles de textura por píxel de salida (la textura original de 2048 px ≈ 20 cm; cuadro ≈ 30 cm). */
function tileScale(item, longSide, mul) {
  const N = item.planes[0].w;
  return (1.5 * N / Math.max(64, longSide)) * (mul || 1);
}

/**
 * Muestreador de una textura repetible. l(x,y) = luminancia normalizada (media 0, desv. 1);
 * c(x,y,out) = desviación de color [cr, cb] (solo texturas en color).
 */
function tileSampler(item, k, angle, ox, oy) {
  const P = tilePrep(item);
  const ca = Math.cos(angle || 0) * k, sa = Math.sin(angle || 0) * k;
  ox = ox || 0; oy = oy || 0;
  const cf = P.cw / P.w;
  return {
    item, prep: P,
    l(x, y) { return bilWrap(P.L, P.w, P.h, x * ca + y * sa + ox, -x * sa + y * ca + oy); },
    c(x, y, out) {
      if (!P.cr) { out[0] = 0; out[1] = 0; return out; }
      const u = (x * ca + y * sa + ox) * cf, v = (-x * sa + y * ca + oy) * cf;
      out[0] = bilWrap(P.cr, P.cw, P.ch, u, v); out[1] = bilWrap(P.cb, P.cw, P.ch, u, v);
      return out;
    },
  };
}

/** Elige textura por etiquetas y temperatura (cálida/fría) con la calidad como peso. */
function pickTile(lib, rand, tags, warmth) {
  if (!lib || !lib.items) return null;
  let cands = lib.items.filter((it) => !tags || tags.some((t) => it.tags.indexOf(t) >= 0));
  if (!cands.length) cands = lib.items;
  return Lib.pick(cands, rand, (it) => {
    let w = it.q || 1;
    if (warmth !== undefined && it.tags) {
      if (it.tags.indexOf("calida") >= 0) w *= warmth > 0.02 ? 3 : 0.4;
      if (it.tags.indexOf("fria") >= 0) w *= warmth < -0.02 ? 3 : 0.4;
    }
    return w;
  });
}

/* ---------------- texturas 9:16 (no repetibles) ---------------- */
function overlaySampler(item, W, H, opts) {
  opts = opts || {};
  const P = item.planes[0];
  const rot = (W > H) !== (P.w > P.h);
  const ow = rot ? P.h : P.w, oh = rot ? P.w : P.h;
  const s = Math.max(W / ow, H / oh) * (opts.zoom || 1);
  const ox = opts.ox || 0, oy = opts.oy || 0;
  const d = P.data, w = P.w, h = P.h;
  return function (x, y) {
    let u = x / s + ox, v = y / s + oy;
    if (rot) { const t = u; u = v; v = ow - 1 - t; }
    // espejo en los bordes (no repetible: nunca se ve una costura recta)
    u = Math.abs(u) % (2 * w); if (u >= w) u = 2 * w - 1 - u;
    v = Math.abs(v) % (2 * h); if (v >= h) v = 2 * h - 1 - v;
    const x0 = u | 0, y0 = v | 0, x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
    const fx = u - x0, fy = v - y0;
    const a = d[y0 * w + x0] + (d[y0 * w + x1] - d[y0 * w + x0]) * fx;
    const b = d[y1 * w + x0] + (d[y1 * w + x1] - d[y1 * w + x0]) * fx;
    return (a + (b - a) * fy) / 255;
  };
}

/* ---------------- manchas (sellos) ---------------- */
/**
 * Estampa una mancha real centrada en (cx,cy): size = lado largo en px, angle = giro.
 * cb(i, a, s) recibe índice de píxel, densidad 0..1 y relieve −1..1.
 */
function drawStamp(item, cx, cy, size, angle, W, H, cb) {
  const A = item.planes[0], S = item.planes[1] || null;
  const w = A.w, h = A.h;
  const k = Math.max(w, h) / Math.max(1, size); // px de sello por px de salida
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const hw = w / k / 2, hh = h / k / 2;
  const ext = Math.abs(hw * ca) + Math.abs(hh * sa), eyt = Math.abs(hw * sa) + Math.abs(hh * ca);
  const x0 = Math.max(0, Math.floor(cx - ext)), x1 = Math.min(W - 1, Math.ceil(cx + ext));
  const y0 = Math.max(0, Math.floor(cy - eyt)), y1 = Math.min(H - 1, Math.ceil(cy + eyt));
  const ad = A.data, sd = S ? S.data : null;
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const u = (dx * ca + dy * sa) * k + w / 2, v = (-dx * sa + dy * ca) * k + h / 2;
      if (u < 0 || v < 0 || u > w - 1.001 || v > h - 1.001) continue;
      const ux = u | 0, vy = v | 0, fx = u - ux, fy = v - vy, o = vy * w + ux;
      const a0 = ad[o] + (ad[o + 1] - ad[o]) * fx, a1 = ad[o + w] + (ad[o + w + 1] - ad[o + w]) * fx;
      const a = (a0 + (a1 - a0) * fy) / 255;
      if (a < 0.01) continue;
      let sv = 0;
      if (sd) {
        const s0 = sd[o] + (sd[o + 1] - sd[o]) * fx, s1 = sd[o + w] + (sd[o + w + 1] - sd[o + w]) * fx;
        sv = (s0 + (s1 - s0) * fy - 128) / 127;
      }
      cb(y * W + x, a, sv);
    }
  }
}

/* ---------------- composición ---------------- */
/** dst := src sobre dst (alfa normal). Ambos RGBA uint8. */
function overU8(dst, src, alphaMul) {
  const m = alphaMul === undefined ? 1 : alphaMul;
  for (let i = 0; i < dst.length; i += 4) {
    const sa = src[i + 3] / 255 * m;
    if (sa <= 0) continue;
    const da = dst[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let c = 0; c < 3; c++) dst[i + c] = (src[i + c] * sa + dst[i + c] * da * (1 - sa)) / oa + 0.5;
    dst[i + 3] = oa * 255 + 0.5;
  }
  return dst;
}

/** Medios transparentes (acuarela, rotulador, grafito): se multiplican como sobre papel blanco. */
function multU8(dst, src, alphaMul) {
  const m = alphaMul === undefined ? 1 : alphaMul;
  for (let i = 0; i < dst.length; i += 4) {
    const sa = src[i + 3] / 255 * m;
    if (sa <= 0) continue;
    const da = dst[i + 3] / 255;
    let r = (1 - da * (1 - dst[i] / 255)) * (1 - sa * (1 - src[i] / 255));
    let g = (1 - da * (1 - dst[i + 1] / 255)) * (1 - sa * (1 - src[i + 1] / 255));
    let b = (1 - da * (1 - dst[i + 2] / 255)) * (1 - sa * (1 - src[i + 2] / 255));
    const a = Math.max(1 - r, 1 - g, 1 - b);
    if (a < 0.003) { dst[i + 3] = 0; continue; }
    dst[i] = (1 - (1 - r) / a) * 255 + 0.5; dst[i + 1] = (1 - (1 - g) / a) * 255 + 0.5; dst[i + 2] = (1 - (1 - b) / a) * 255 + 0.5;
    dst[i + 3] = a * 255 + 0.5;
  }
  return dst;
}

/** Planos de transmitancia (multiplicativos sobre blanco) → RGBA con el blanco transparente. */
function transToRGBA(Tr, Tg, Tb, out, mask) {
  const n = Tr.length;
  out = out || new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let a = Math.max(1 - Tr[i], 1 - Tg[i], 1 - Tb[i]);
    if (mask) a *= mask[i];
    if (a < 0.003) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 0; continue; }
    const ia = 1 / Math.max(a, 1 - Math.min(Tr[i], Tg[i], Tb[i]));
    out[o] = C.clamp(1 - (1 - Tr[i]) * ia, 0, 1) * 255 + 0.5;
    out[o + 1] = C.clamp(1 - (1 - Tg[i]) * ia, 0, 1) * 255 + 0.5;
    out[o + 2] = C.clamp(1 - (1 - Tb[i]) * ia, 0, 1) * 255 + 0.5;
    out[o + 3] = C.clamp(a, 0, 1) * 255 + 0.5;
  }
  return out;
}

/* ---------------- grano del papel en lo velado ---------------- */
/**
 * La textura del papel se marca siempre en las zonas poco cubiertas:
 *  mode "picos"  → medios secos (grafito, cera, rotulador seco, tinta de grabado): se quedan en los picos
 *  mode "valles" → medios húmedos (acuarela): el pigmento se asienta en los valles
 *  mode "lienzo" → pintura fina sobre tela/papel: la trama asoma y matiza el color
 */
async function paperTooth(out, ctx, mode, amount, clock) {
  if (!ctx.paperPrep || amount <= 0) return out;
  const { W, H } = ctx;
  const pap = Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H)));
  const sign = mode === "valles" ? -1 : 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const a = out[o + 3] / 255;
      if (a <= 0.004 || a >= 0.997) continue;
      const r = pap.raw(x, y);
      const thin = 1 - a;
      let na = a * (1 + amount * sign * thin * r * 1.6);
      na = na < 0 ? 0 : na > 1 ? 1 : na;
      out[o + 3] = na * 255 + 0.5;
      if (mode === "lienzo") {
        const k = 1 + 0.12 * amount * r * thin;
        out[o] = C.clamp(out[o] * k, 0, 255); out[o + 1] = C.clamp(out[o + 1] * k, 0, 255); out[o + 2] = C.clamp(out[o + 2] * k, 0, 255);
      }
    }
    if (clock && (y & 63) === 0) await clock.tick(y / H);
  }
  return out;
}

/* ---------------- paleta (k-medias sobre la imagen de análisis) ---------------- */
function palette(ctx, K, seed, opts) {
  opts = opts || {};
  const { ar, ag, ab } = ctx;
  const n = ar.length;
  const rand = C.mulberry32(seed + 55);
  const S = Math.min(n, 8000);
  const sr = [], sg = [], sb = [];
  for (let i = 0; i < S; i++) {
    const j = Math.floor(rand() * n);
    const r = ar[j], g = ag[j], b = ab[j];
    if (opts.skip && opts.skip(r, g, b)) continue;
    sr.push(r); sg.push(g); sb.push(b);
  }
  const m = sr.length || 1;
  const cr = new Float32Array(K), cg = new Float32Array(K), cb = new Float32Array(K);
  for (let k = 0; k < K; k++) { const j = Math.floor(((k + 0.5) / K) * m) % m; cr[k] = sr[j] || 0.5; cg[k] = sg[j] || 0.5; cb[k] = sb[j] || 0.5; }
  // inicialización por luminancia ordenada (estable entre ejecuciones)
  const idx = Array.from({ length: m }, (_, i) => i).sort((a, b) => (sr[a] * 0.3 + sg[a] * 0.59 + sb[a] * 0.11) - (sr[b] * 0.3 + sg[b] * 0.59 + sb[b] * 0.11));
  for (let k = 0; k < K; k++) { const j = idx[Math.floor(((k + 0.5) / K) * m)]; cr[k] = sr[j]; cg[k] = sg[j]; cb[k] = sb[j]; }
  for (let it = 0; it < 10; it++) {
    const nr = new Float32Array(K), ng = new Float32Array(K), nb = new Float32Array(K), c = new Float32Array(K);
    for (let i = 0; i < m; i++) {
      let best = 0, bd = 1e9;
      for (let k = 0; k < K; k++) { const d0 = sr[i] - cr[k], d1 = sg[i] - cg[k], d2 = sb[i] - cb[k]; const d = d0 * d0 * 0.9 + d1 * d1 * 1.2 + d2 * d2 * 0.7; if (d < bd) { bd = d; best = k; } }
      nr[best] += sr[i]; ng[best] += sg[i]; nb[best] += sb[i]; c[best]++;
    }
    for (let k = 0; k < K; k++) if (c[k]) { cr[k] = nr[k] / c[k]; cg[k] = ng[k] / c[k]; cb[k] = nb[k] / c[k]; }
  }
  return { r: cr, g: cg, b: cb, K };
}

function nearest(pal, r, g, b) {
  let best = 0, bd = 1e9;
  for (let k = 0; k < pal.K; k++) { const d0 = r - pal.r[k], d1 = g - pal.g[k], d2 = b - pal.b[k]; const d = d0 * d0 * 0.9 + d1 * d1 * 1.2 + d2 * d2 * 0.7; if (d < bd) { bd = d; best = k; } }
  return best;
}

/** Calidez de un color: >0 cálido (rojo/naranja), <0 frío (azul/verde). */
function warmth(r, g, b) { return (r - b) * 0.8 + (g - b) * 0.2 - 0.05; }

module.exports = { tilePrep, tileScale, tileSampler, pickTile, overlaySampler, drawStamp, overU8, multU8, transToRGBA, paperTooth, palette, nearest, warmth };
