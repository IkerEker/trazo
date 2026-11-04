"use strict";
/*
 * Trazo · biblioteca de trazos y soportes reales.
 *
 * Contenedor TRZ1 (generado por tools/extract_strokes.py y extract_papers.py):
 *   "TRZ1" · uint32 LE longitud de cabecera · cabecera JSON ASCII · datos uint8
 *
 * Trazos: cada muestra está enderezada en vertical (empieza arriba). Canales:
 *   A = cobertura o densidad de pigmento, S = relieve/brillo relativo (128 neutro).
 * Marcas por fila: top (empieza la pintura), head (fin de la carga inicial),
 * tail (empieza el final seco), bottom (acaba la pintura).
 */

function readU32(u8, o) {
  return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
}

function parse(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (u8.length < 8 || u8[0] !== 84 || u8[1] !== 82 || u8[2] !== 90 || u8[3] !== 49) throw new Error("Formato de textura no válido");
  const hl = readU32(u8, 4);
  let json = "";
  for (let i = 0; i < hl; i++) json += String.fromCharCode(u8[8 + i]);
  const header = JSON.parse(json);
  const base = 8 + hl;
  if (header.samples) {
    const samples = header.samples.map((m) => {
      const size = m.w * m.h;
      const A = u8.subarray(base + m.offset, base + m.offset + size);
      const S = m.channels === 2 ? u8.subarray(base + m.offset + size, base + m.offset + 2 * size) : null;
      return {
        w: m.w, h: m.h, top: m.top, head: m.head, tail: m.tail, bottom: m.bottom,
        fill: m.fill, aspect: m.aspect, q: m.q || 1, A, S, mips: null,
      };
    });
    return { kind: "strokes", technique: header.technique, samples };
  }
  if (header.items) {
    // texturas repetibles, sellos (manchas) y texturas 9:16: varios planos uint8 por elemento
    const items = header.items.map((m) => {
      const it = Object.assign({}, m);
      it.planes = m.planes.map((pl) => ({ w: pl.w, h: pl.h, data: u8.subarray(base + pl.offset, base + pl.offset + pl.w * pl.h) }));
      return it;
    });
    return { kind: header.kind, items };
  }
  return { kind: "paper", paperKind: header.kind, w: header.w, h: header.h, data: u8.subarray(base, base + header.w * header.h) };
}

/* ---------- mipmaps de una muestra (reducción 2×2) ---------- */
function halveU8(src, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const r0 = Math.min(h - 1, y * 2) * w, r1 = Math.min(h - 1, y * 2 + 1) * w;
    for (let x = 0; x < nw; x++) {
      const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1);
      out[y * nw + x] = (src[r0 + x0] + src[r0 + x1] + src[r1 + x0] + src[r1 + x1] + 2) >> 2;
    }
  }
  return out;
}

function mip(sample, level) {
  if (!sample.mips) {
    sample.mips = [{ w: sample.w, h: sample.h, A: sample.A, S: sample.S, top: sample.top, head: sample.head, tail: sample.tail, bottom: sample.bottom }];
  }
  while (sample.mips.length <= level) {
    const p = sample.mips[sample.mips.length - 1];
    if (p.w <= 4 || p.h <= 8) { break; }
    sample.mips.push({
      w: Math.max(1, p.w >> 1), h: Math.max(1, p.h >> 1),
      A: halveU8(p.A, p.w, p.h), S: p.S ? halveU8(p.S, p.w, p.h) : null,
      top: p.top / 2, head: p.head / 2, tail: p.tail / 2, bottom: p.bottom / 2,
    });
  }
  return sample.mips[Math.min(level, sample.mips.length - 1)];
}

/**
 * Prepara el mapeo de una muestra sobre una trayectoria.
 * pathLen: longitud del recorrido (px de salida). Rr: radio del área rasterizada,
 * que corresponde al ancho completo de la textura (v = ±1).
 */
function prepare(sample, pathLen, Rr, rand, vk) {
  const k0 = sample.w / (2 * Rr); // px de textura por px de salida
  let level = 0;
  while (k0 / (1 << level) > 2.2 && level < 6) level++;
  const m = mip(sample, level);
  const kk = m.w / (2 * Rr); // px de textura (del nivel elegido) por px de salida
  const Ltex = Math.max(1, pathLen * kk);
  const H = Math.max(1, m.head - m.top), T = Math.max(1, m.bottom - m.tail), B = Math.max(1, m.tail - m.head);
  const Lb = Ltex - H - T;
  const off = Lb >= 0 && Lb <= B ? rand() * (B - Lb) : 0;
  return { m, kk, Ltex, H, T, B, Lb, off, flip: rand() < 0.5, pathLen, vk: vk || 1 };
}

/** Fila de textura para una distancia d (px de salida) a lo largo del trazo. */
function rowAt(st, d) {
  const dt = d * st.kk;
  const m = st.m;
  if (dt < 0) return m.top + dt;
  if (st.Lb >= 0) {
    if (dt < st.H) return m.top + dt;
    const x = dt - st.H;
    if (x < st.Lb) {
      if (st.Lb <= st.B) return m.head + st.off + x;
      const period = 2 * st.B;
      const q = x % period;
      return m.head + (q < st.B ? q : period - q);
    }
    if (dt <= st.Ltex) return m.tail + (x - st.Lb);
    return m.bottom + (dt - st.Ltex);
  }
  if (dt > st.Ltex) return m.bottom + (dt - st.Ltex);
  const x = dt * (st.H + st.T) / st.Ltex;
  return x < st.H ? m.top + x : m.tail + (x - st.H);
}

/** Muestreo bilineal de un canal uint8 (0..255) → 0..1 */
function bilinearU8(arr, w, h, x, y) { // (se conserva para usos puntuales)
  if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
  if (y < 0) return 0; else if (y > h - 1) return 0;
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;
  const a = arr[y0 * w + x0] + (arr[y0 * w + x1] - arr[y0 * w + x0]) * fx;
  const b = arr[y1 * w + x0] + (arr[y1 * w + x1] - arr[y1 * w + x0]) * fx;
  return (a + (b - a) * fy) * (1 / 255);
}

/**
 * Muestra el trazo en (u normalizado a lo largo, v en -1..1 a lo ancho).
 * out[0] = cobertura 0..1, out[1] = relieve/brillo −1..1 (0 si no hay canal S).
 * Bilineal compartido para ambos canales (es el bucle más caliente del motor).
 */
function sampleAt(st, u, v, out) {
  const m = st.m;
  const w = m.w, h = m.h;
  const row = rowAt(st, u * st.pathLen);
  if (!(row >= 0 && row <= h - 1)) { out[0] = 0; out[1] = 0; return out; }
  let col = ((st.flip ? -v : v) * st.vk * 0.5 + 0.5) * (w - 1);
  if (col < 0) col = 0; else if (col > w - 1) col = w - 1;
  const x0 = col | 0, y0 = row | 0;
  const x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
  const fx = col - x0, fy = row - y0;
  const r0 = y0 * w, r1 = y1 * w;
  const A = m.A;
  const a0 = A[r0 + x0] + (A[r0 + x1] - A[r0 + x0]) * fx;
  const a1 = A[r1 + x0] + (A[r1 + x1] - A[r1 + x0]) * fx;
  const a = (a0 + (a1 - a0) * fy) * (1 / 255);
  out[0] = a;
  const S = m.S;
  if (S !== null && a > 0.004) {
    const s0 = S[r0 + x0] + (S[r0 + x1] - S[r0 + x0]) * fx;
    const s1 = S[r1 + x0] + (S[r1 + x1] - S[r1 + x0]) * fx;
    out[1] = (s0 + (s1 - s0) * fy - 128) * (1 / 127.5);
  } else out[1] = 0;
  return out;
}

/* ---------- soporte real (papel / lienzo) ---------- */
/**
 * Ecualiza la textura (distribución uniforme 0..1, como el grano procedural) y
 * crea mipmaps. scale = px de textura por px de salida (escala física).
 */
function preparePaper(paper) {
  if (!paper || paper.kind !== "paper") return null;
  if (paper._prepared) return paper._prepared;
  const n = paper.w * paper.h;
  const hist = new Float64Array(256);
  for (let i = 0; i < n; i++) hist[paper.data[i]]++;
  const cdf = new Float32Array(256);
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; cdf[v] = (acc - hist[v] * 0.5) / n; }
  const raw = new Float32Array(n), eq = new Float32Array(n);
  for (let i = 0; i < n; i++) { raw[i] = (paper.data[i] - 128) / 127; eq[i] = cdf[paper.data[i]]; }
  const levels = [{ size: paper.w, eq, raw }];
  let cur = levels[0];
  while (cur.size > 8) {
    const s = cur.size, ns = s >> 1;
    const e2 = new Float32Array(ns * ns), r2 = new Float32Array(ns * ns);
    for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) {
      const i0 = (2 * y) * s + 2 * x, i1 = i0 + 1, i2 = i0 + s, i3 = i2 + 1;
      e2[y * ns + x] = (cur.eq[i0] + cur.eq[i1] + cur.eq[i2] + cur.eq[i3]) * 0.25;
      r2[y * ns + x] = (cur.raw[i0] + cur.raw[i1] + cur.raw[i2] + cur.raw[i3]) * 0.25;
    }
    cur = { size: ns, eq: e2, raw: r2 };
    levels.push(cur);
  }
  paper._prepared = { levels, kind: paper.paperKind };
  return paper._prepared;
}

/**
 * Muestreador de soporte a una escala dada. Devuelve {eq(x,y), raw(x,y)}:
 * eq = grano ecualizado 0..1 (al reducir, tiende a 0.5); raw = relieve −1..1 aprox.
 */
function paperSampler(prep, texPerPx) {
  let level = 0, k = texPerPx;
  while (k > 1.5 && level < prep.levels.length - 1) { k /= 2; level++; }
  const L = prep.levels[level];
  const size = L.size, mask = size - 1;
  function bil(arr, x, y) {
    x *= k; y *= k;
    const xf = Math.floor(x), yf = Math.floor(y);
    const fx = x - xf, fy = y - yf;
    const x0 = xf & mask, y0 = yf & mask, x1 = (xf + 1) & mask, y1 = (yf + 1) & mask;
    const a = arr[y0 * size + x0] + (arr[y0 * size + x1] - arr[y0 * size + x0]) * fx;
    const b = arr[y1 * size + x0] + (arr[y1 * size + x1] - arr[y1 * size + x0]) * fx;
    return a + (b - a) * fy;
  }
  const eqArr = L.eq;
  return {
    k, level,
    eqN: (x, y) => eqArr[(((y * k) | 0) & mask) * size + (((x * k) | 0) & mask)],
    eq: (x, y) => bil(L.eq, x, y),
    raw: (x, y) => bil(L.raw, x, y),
  };
}

/**
 * Tamaño físico supuesto del original (lado largo, mm) por técnica: un óleo de caballete es más
 * grande que un dibujo o un gouache de cuaderno, así que su trama y su grano se ven más finos.
 */
const PHYS_MM = { oleo: 600, gouache: 320, acuarela: 380, lapiz: 300, ceras: 420, mixtalg: 300, xilografia: 340 };
function physMM(tech) { return PHYS_MM[tech] || 300; }
/** px de textura por px de salida, con escaneos a ~10 px/mm y el tamaño físico supuesto. */
function paperScale(longSide, mm) {
  const pxPerMm = longSide / (mm || 300);
  return 10 / Math.max(0.05, pxPerMm);
}

/** Pinceladas sintéticas (respaldo si faltan las texturas reales). */
const _synth = {};
function synthetic(kind) {
  if (_synth[kind]) return _synth[kind];
  const out = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let k = 0; k < 6; k++) {
    const w = 64, h = 384, A = new Uint8Array(w * h), Sx = new Uint8Array(w * h);
    const br = new Float32Array(w);
    let prev = rnd();
    for (let x = 0; x < w; x++) { prev = prev * 0.5 + rnd() * 0.5; br[x] = prev; }
    const top = 18, bottom = h - 20, tail = Math.round(h * (0.6 + 0.2 * rnd()));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = (x - (w - 1) / 2) / ((w - 1) / 2);
      const edge = 0.7 + 0.06 * Math.sin(y * 0.11 + k) + 0.04 * (rnd() - 0.5);
      let a = Math.abs(v) < edge ? 1 : Math.max(0, 1 - (Math.abs(v) - edge) * 12);
      if (y < top) a *= Math.max(0, 1 - (top - y) / 8);
      if (y > tail) { const t = (y - tail) / Math.max(1, bottom - tail); a *= br[x] > t ? 1 : Math.max(0, 1 - (t - br[x]) * 6); }
      if (y > bottom) a = 0;
      A[y * w + x] = Math.round(a * 255);
      Sx[y * w + x] = Math.round(128 + (br[x] - 0.5) * 40 * a);
    }
    out.push({ w, h, top, head: top + 24, tail, bottom, fill: 0.8, aspect: h / w, A, S: kind === "lapiz" || kind === "acuarela" ? null : Sx, mips: null });
  }
  _synth[kind] = out;
  return out;
}

/** Elige un elemento al azar con peso (por defecto, la calidad q). */
function pick(arr, rand, wfn) {
  if (!arr || !arr.length) return null;
  let tot = 0;
  for (let i = 0; i < arr.length; i++) tot += wfn ? wfn(arr[i]) : (arr[i].q || 1);
  let t = rand() * tot;
  for (let i = 0; i < arr.length; i++) { t -= wfn ? wfn(arr[i]) : (arr[i].q || 1); if (t <= 0) return arr[i]; }
  return arr[arr.length - 1];
}

module.exports = { physMM, pick, synthetic, parse, prepare, sampleAt, rowAt, mip, preparePaper, paperSampler, paperScale };
