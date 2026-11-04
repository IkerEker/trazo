"use strict";
/*
 * Trazo · segmentación en manchas
 *
 * Un pintor no copia píxeles: ve zonas de color ("manchas") con su degradado.
 * 1) Superpíxeles SLIC sobre una versión suavizada (Kuwahara) en Lab.
 * 2) Fusión jerárquica: se unen zonas vecinas mientras su color siga siendo
 *    coherente con UN degradado lineal (ajuste por mínimos cuadrados con
 *    estadísticos acumulados). En zonas poco importantes se simplifica más.
 * 3) Estadísticas por mancha: modelo de color (degradado RGB), luz, actividad
 *    (textura), orientación dominante, importancia y grosor máximo.
 * 4) Etiquetas a resolución completa ajustadas al borde real de la foto.
 * 5) Contornos: cadenas de borde entre pares de manchas.
 */
const C = require("./core.js");

/* ---------- color ---------- */
function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function labF(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
function rgbToLab(r, g, b, out) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = labF(X), fy = labF(Y), fz = labF(Z);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
  return out;
}

/* ---------- montículo binario para la fusión ---------- */
class Heap {
  constructor() { this.k = []; this.a = []; this.b = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, a, b, ver) {
    const K = this.k, A = this.a, B = this.b, V = this.v;
    let i = K.length; K.push(key); A.push(a); B.push(b); V.push(ver);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= K[i]) break;
      [K[p], K[i]] = [K[i], K[p]]; [A[p], A[i]] = [A[i], A[p]]; [B[p], B[i]] = [B[i], B[p]]; [V[p], V[i]] = [V[i], V[p]];
      i = p;
    }
  }
  pop(out) {
    const K = this.k, A = this.a, B = this.b, V = this.v;
    out[0] = K[0]; out[1] = A[0]; out[2] = B[0]; out[3] = V[0];
    const lk = K.pop(), la = A.pop(), lb = B.pop(), lv = V.pop();
    if (K.length) {
      K[0] = lk; A[0] = la; B[0] = lb; V[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < K.length && K[l] < K[m]) m = l;
        if (r < K.length && K[r] < K[m]) m = r;
        if (m === i) break;
        [K[m], K[i]] = [K[i], K[m]]; [A[m], A[i]] = [A[i], A[m]]; [B[m], B[i]] = [B[i], B[m]]; [V[m], V[i]] = [V[i], V[m]];
        i = m;
      }
    }
    return out;
  }
}

// estadísticos por nodo (Float64): n, Sx, Sy, Sxx, Sxy, Syy, luego por canal (L,a,b,R,G,B): S, Sx, Sy, Scc
const NS = 6 + 6 * 4;
const CH = 6;

function fitSSE(st, o, ch, beta) {
  // resuelve el modelo lineal c = b0 + b1 x + b2 y para el canal ch; devuelve SSE
  const n = st[o], Sx = st[o + 1], Sy = st[o + 2], Sxx = st[o + 3], Sxy = st[o + 4], Syy = st[o + 5];
  const lam = 1e-4 * n + 1e-9;
  const m00 = n, m01 = Sx, m02 = Sy, m11 = Sxx + lam, m12 = Sxy, m22 = Syy + lam;
  const c0 = m11 * m22 - m12 * m12, c1 = m02 * m12 - m01 * m22, c2 = m01 * m12 - m02 * m11;
  const det = m00 * c0 + m01 * c1 + m02 * c2;
  const q = o + 6 + ch * 4;
  const b0v = st[q], b1v = st[q + 1], b2v = st[q + 2], scc = st[q + 3];
  if (Math.abs(det) < 1e-18) {
    const mean = b0v / n;
    if (beta) { beta[0] = mean; beta[1] = 0; beta[2] = 0; }
    return Math.max(0, scc - mean * b0v);
  }
  const i00 = c0 / det, i01 = c1 / det, i02 = c2 / det;
  const i11 = (m00 * m22 - m02 * m02) / det, i12 = (m02 * m01 - m00 * m12) / det, i22 = (m00 * m11 - m01 * m01) / det;
  const B0 = i00 * b0v + i01 * b1v + i02 * b2v;
  const B1 = i01 * b0v + i11 * b1v + i12 * b2v;
  const B2 = i02 * b0v + i12 * b1v + i22 * b2v;
  if (beta) { beta[0] = B0; beta[1] = B1; beta[2] = B2; }
  return Math.max(0, scc - (B0 * b0v + B1 * b1v + B2 * b2v));
}

/**
 * @param ctx Context (planos de análisis listos y campo de direcciones)
 * @param o {detail 0..1, simplify 0..1}
 */
async function segment(ctx, o, clock) {
  const { aw, ah } = ctx;
  const n = aw * ah;
  const detail = o.detail;

  /* --- 1) imagen suavizada y Lab --- */
  const Water = require("./watercolor.js");
  let [sr, sg, sb] = Water.kuwahara(ctx.ar, ctx.ag, ctx.ab, aw, ah, Math.max(1, Math.round(aw / 700)));
  const La = new Float32Array(n), Aa = new Float32Array(n), Ba = new Float32Array(n);
  const lab = new Float32Array(3);
  for (let i = 0; i < n; i++) {
    rgbToLab(sr[i], sg[i], sb[i], lab);
    La[i] = lab[0]; Aa[i] = lab[1]; Ba[i] = lab[2];
  }
  await clock.tick(0.05);

  /* --- importancia (centro, contraste local, selección) --- */
  const imp = new Float32Array(n);
  {
    const ed = Float32Array.from(ctx.edgeRaw);
    C.gaussBlur(ed, aw, ah, Math.max(2, 0.03 * Math.min(aw, ah)));
    const e95 = C.percentile(ed, 0.95) || 1;
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      const i = y * aw + x;
      const dx = (x / aw - 0.5) / 0.42, dy = (y / ah - 0.47) / 0.48;
      const center = Math.exp(-(dx * dx + dy * dy));
      let v = 0.45 * center + 0.55 * Math.min(1, ed[i] / e95);
      if (ctx.sel && ctx.selMode === "detalle") v = Math.max(v, ctx.sel[i]);
      imp[i] = v;
    }
  }

  /* --- 2) SLIC --- */
  const S = Math.max(3, Math.round((14 - 9.5 * detail) * Math.max(0.45, aw / 1000)));
  const gx = Math.max(1, Math.round(aw / S)), gy = Math.max(1, Math.round(ah / S));
  const K = gx * gy;
  const cL = new Float32Array(K), cA = new Float32Array(K), cB = new Float32Array(K), cX = new Float32Array(K), cY = new Float32Array(K);
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const k = j * gx + i;
    let x = Math.min(aw - 1, Math.round((i + 0.5) * aw / gx)), y = Math.min(ah - 1, Math.round((j + 0.5) * ah / gy));
    const p = y * aw + x;
    cL[k] = La[p]; cA[k] = Aa[p]; cB[k] = Ba[p]; cX[k] = x; cY[k] = y;
  }
  const lbl = new Int32Array(n).fill(-1);
  const dist = new Float32Array(n);
  const m = 11; // compacidad
  const wS = (m * m) / (S * S);
  const sumL = new Float64Array(K), sumA = new Float64Array(K), sumB = new Float64Array(K), sumX = new Float64Array(K), sumY = new Float64Array(K), cnt = new Float64Array(K);
  for (let it = 0; it < 6; it++) {
    dist.fill(1e30);
    for (let k = 0; k < K; k++) {
      const x0 = Math.max(0, Math.floor(cX[k] - S)), x1 = Math.min(aw - 1, Math.ceil(cX[k] + S));
      const y0 = Math.max(0, Math.floor(cY[k] - S)), y1 = Math.min(ah - 1, Math.ceil(cY[k] + S));
      const l = cL[k], a = cA[k], b = cB[k], kx = cX[k], ky = cY[k];
      for (let y = y0; y <= y1; y++) {
        const row = y * aw, dy = y - ky;
        for (let x = x0; x <= x1; x++) {
          const p = row + x;
          const d1 = La[p] - l, d2 = Aa[p] - a, d3 = Ba[p] - b, dx = x - kx;
          const D = d1 * d1 + d2 * d2 + d3 * d3 + (dx * dx + dy * dy) * wS;
          if (D < dist[p]) { dist[p] = D; lbl[p] = k; }
        }
      }
    }
    sumL.fill(0); sumA.fill(0); sumB.fill(0); sumX.fill(0); sumY.fill(0); cnt.fill(0);
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      const p = y * aw + x, k = lbl[p];
      if (k < 0) continue;
      sumL[k] += La[p]; sumA[k] += Aa[p]; sumB[k] += Ba[p]; sumX[k] += x; sumY[k] += y; cnt[k]++;
    }
    for (let k = 0; k < K; k++) if (cnt[k] > 0) {
      cL[k] = sumL[k] / cnt[k]; cA[k] = sumA[k] / cnt[k]; cB[k] = sumB[k] / cnt[k]; cX[k] = sumX[k] / cnt[k]; cY[k] = sumY[k] / cnt[k];
    }
    await clock.tick(0.05 + 0.25 * (it + 1) / 6);
  }
  for (let p = 0; p < n; p++) if (lbl[p] < 0) lbl[p] = p > 0 ? lbl[p - 1] : 0;
  // conectividad: componentes conexas como superpíxeles independientes
  const comp = new Int32Array(n).fill(-1);
  let nc = 0;
  const stack = new Int32Array(n);
  for (let p0 = 0; p0 < n; p0++) {
    if (comp[p0] >= 0) continue;
    const k = lbl[p0];
    let sp = 0; stack[sp++] = p0; comp[p0] = nc;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % aw, y = (p / aw) | 0;
      if (x > 0 && comp[p - 1] < 0 && lbl[p - 1] === k) { comp[p - 1] = nc; stack[sp++] = p - 1; }
      if (x < aw - 1 && comp[p + 1] < 0 && lbl[p + 1] === k) { comp[p + 1] = nc; stack[sp++] = p + 1; }
      if (y > 0 && comp[p - aw] < 0 && lbl[p - aw] === k) { comp[p - aw] = nc; stack[sp++] = p - aw; }
      if (y < ah - 1 && comp[p + aw] < 0 && lbl[p + aw] === k) { comp[p + aw] = nc; stack[sp++] = p + aw; }
    }
    nc++;
  }
  await clock.tick(0.35);

  /* --- 3) estadísticos por superpíxel --- */
  const st = new Float64Array(nc * NS);
  const impSum = new Float64Array(nc);
  for (let y = 0; y < ah; y++) {
    const yn = (y + 0.5) / ah;
    for (let x = 0; x < aw; x++) {
      const p = y * aw + x, k = comp[p], o = k * NS;
      const xn = (x + 0.5) / aw;
      st[o] += 1; st[o + 1] += xn; st[o + 2] += yn; st[o + 3] += xn * xn; st[o + 4] += xn * yn; st[o + 5] += yn * yn;
      const vals = [La[p], Aa[p], Ba[p], ctx.ar[p], ctx.ag[p], ctx.ab[p]];
      for (let c = 0; c < CH; c++) {
        const q = o + 6 + c * 4, v = vals[c];
        st[q] += v; st[q + 1] += v * xn; st[q + 2] += v * yn; st[q + 3] += v * v;
      }
      impSum[k] += imp[p];
    }
  }
  // vecinos
  const adj = new Array(nc);
  for (let k = 0; k < nc; k++) adj[k] = new Set();
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const p = y * aw + x, k = comp[p];
    if (x < aw - 1) { const q = comp[p + 1]; if (q !== k) { adj[k].add(q); adj[q].add(k); } }
    if (y < ah - 1) { const q = comp[p + aw]; if (q !== k) { adj[k].add(q); adj[q].add(k); } }
  }
  await clock.tick(0.45);

  /* --- 4) fusión jerárquica --- */
  const parent = new Int32Array(nc);
  for (let k = 0; k < nc; k++) parent[k] = k;
  const ver = new Int32Array(nc);
  const alive = new Uint8Array(nc).fill(1);
  const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const meanLab = (k, out) => { const o = k * NS, nn = st[o]; out[0] = st[o + 6] / nn; out[1] = st[o + 10] / nn; out[2] = st[o + 14] / nn; return out; };
  const mA = new Float64Array(3), mB = new Float64Array(3);
  const dE = (a, b) => { meanLab(a, mA); meanLab(b, mB); const d0 = mA[0] - mB[0], d1 = mA[1] - mB[1], d2 = mA[2] - mB[2]; return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2); };
  const heap = new Heap();
  for (let k = 0; k < nc; k++) for (const q of adj[k]) if (q > k) heap.push(dE(k, q), k, q, 0);
  // reevaluación perezosa: cada entrada guarda ver[a]+ver[b]; si cambió, se recalcula al salir
  const totalPx = n;
  const minArea = Math.max(4, S * S * 0.5);
  const dEmax = 7 + 20 * (1 - detail);
  const resMax = 2.6 + 6 * (1 - detail);
  const tmpSt = new Float64Array(NS);
  const out4 = [0, 0, 0, 0];
  let merges = 0;
  const mergeInto = (a, b) => { // b → a
    const oa = a * NS, ob = b * NS;
    for (let t = 0; t < NS; t++) st[oa + t] += st[ob + t];
    impSum[a] += impSum[b];
    parent[b] = a; alive[b] = 0;
    ver[a]++;
    for (const q of adj[b]) {
      if (q === a) continue;
      adj[q].delete(b); adj[q].add(a); adj[a].add(q);
      // la vecina heredada entra en la cola con la mancha unida
      heap.push(dE(a, q), a < q ? a : q, a < q ? q : a, ver[a] + ver[q]);
    }
    adj[a].delete(b); adj[b] = null;
    merges++;
  };
  let guard = 0;
  while (heap.size > 0) {
    heap.pop(out4);
    const a = out4[1], b = out4[2];
    if (!alive[a] || !alive[b]) continue;
    if (out4[3] !== ver[a] + ver[b]) {
      if (adj[a] && adj[a].has(b)) heap.push(dE(a, b), a, b, ver[a] + ver[b]);
      continue;
    }
    const d = out4[0];
    const oa = a * NS, ob = b * NS;
    const na = st[oa], nb = st[ob];
    const small = na < minArea || nb < minArea;
    const impR = (impSum[a] + impSum[b]) / (na + nb);
    const thr = dEmax * (1 + 1.2 * (1 - impR) * (o.simplify === undefined ? 1 : o.simplify));
    if (d > thr && !small) continue;
    // residuo del degradado lineal de la mancha unida (Lab)
    for (let t = 0; t < NS; t++) tmpSt[t] = st[oa + t] + st[ob + t];
    const nn = tmpSt[0];
    const sse = fitSSE(tmpSt, 0, 0, null) + fitSSE(tmpSt, 0, 1, null) + fitSSE(tmpSt, 0, 2, null);
    const res = Math.sqrt(sse / nn);
    if (!small && res > resMax * (1 + 0.6 * (1 - impR))) continue;
    if (na >= nb) mergeInto(a, b); else mergeInto(b, a);
    if ((++guard & 1023) === 0) await clock.tick(0.45 + 0.3 * Math.min(1, merges / nc));
  }
  // restos diminutos → al vecino más parecido
  for (let k = 0; k < nc; k++) {
    if (!alive[k] || st[k * NS] >= minArea * 0.6 || !adj[k] || adj[k].size === 0) continue;
    let best = -1, bd = 1e9;
    for (const q of adj[k]) { const d = dE(k, q); if (d < bd) { bd = d; best = q; } }
    if (best >= 0) mergeInto(best, k);
  }

  /* --- 5) etiquetas finales y estadísticas --- */
  const remap = new Int32Array(nc).fill(-1);
  let R = 0;
  for (let k = 0; k < nc; k++) if (alive[k]) remap[k] = R++;
  const labels = new Int32Array(n);
  for (let p = 0; p < n; p++) labels[p] = remap[find(comp[p])];
  const reg = {
    n: R,
    cnt: new Float32Array(R), lum: new Float32Array(R), imp: new Float32Array(R),
    beta: new Float32Array(R * 9), // RGB: b0,b1,b2 por canal (coordenadas normalizadas 0..1)
    mean: new Float32Array(R * 3), lab: new Float32Array(R * 3),
    act: new Float32Array(R), oc: new Float32Array(R), os: new Float32Array(R), coh: new Float32Array(R),
    cx: new Float32Array(R), cy: new Float32Array(R), maxDist: new Float32Array(R),
    x0: new Int32Array(R).fill(1e9), y0: new Int32Array(R).fill(1e9), x1: new Int32Array(R).fill(-1), y1: new Int32Array(R).fill(-1),
  };
  const beta = [0, 0, 0];
  for (let k = 0; k < nc; k++) {
    if (!alive[k]) continue;
    const r = remap[k], o = k * NS, nn = st[o];
    reg.cnt[r] = nn;
    reg.imp[r] = impSum[k] / nn;
    reg.cx[r] = st[o + 1] / nn; reg.cy[r] = st[o + 2] / nn;
    for (let c = 0; c < 3; c++) {
      reg.lab[r * 3 + c] = st[o + 6 + c * 4] / nn;
      const mean = st[o + 6 + (3 + c) * 4] / nn;
      reg.mean[r * 3 + c] = mean;
      if (nn > 40) {
        fitSSE(st, o, 3 + c, beta);
        // limitar el degradado para que no se dispare fuera de la mancha
        reg.beta[r * 9 + c * 3] = beta[0]; reg.beta[r * 9 + c * 3 + 1] = beta[1]; reg.beta[r * 9 + c * 3 + 2] = beta[2];
      } else {
        reg.beta[r * 9 + c * 3] = mean;
      }
    }
    const mr = reg.mean[r * 3], mg = reg.mean[r * 3 + 1], mb = reg.mean[r * 3 + 2];
    reg.lum[r] = 0.299 * mr + 0.587 * mg + 0.114 * mb;
  }
  // actividad, orientación y caja por mancha
  const sAct = new Float64Array(R), sC = new Float64Array(R), sS = new Float64Array(R), sCoh = new Float64Array(R);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const p = y * aw + x, r = labels[p];
    sAct[r] += ctx.edgeRaw[p];
    const w = ctx.coh[p];
    sC[r] += ctx.c2[p] * w; sS[r] += ctx.s2[p] * w; sCoh[r] += w;
    if (x < reg.x0[r]) reg.x0[r] = x; if (x > reg.x1[r]) reg.x1[r] = x;
    if (y < reg.y0[r]) reg.y0[r] = y; if (y > reg.y1[r]) reg.y1[r] = y;
  }
  for (let r = 0; r < R; r++) {
    reg.act[r] = sAct[r] / reg.cnt[r];
    const mag = Math.sqrt(sC[r] * sC[r] + sS[r] * sS[r]);
    reg.oc[r] = mag > 0 ? sC[r] / mag : 1; reg.os[r] = mag > 0 ? sS[r] / mag : 0;
    reg.coh[r] = sCoh[r] > 0 ? mag / sCoh[r] : 0;
    // limitar el degradado: variación máxima ±0.25 dentro de la caja
    const bw = (reg.x1[r] - reg.x0[r] + 1) / aw, bh = (reg.y1[r] - reg.y0[r] + 1) / ah;
    for (let c = 0; c < 3; c++) {
      const q = r * 9 + c * 3;
      let b1 = reg.beta[q + 1], b2 = reg.beta[q + 2];
      const span = Math.abs(b1 * bw) + Math.abs(b2 * bh);
      if (span > 0.35) { const k = 0.35 / span; b1 *= k; b2 *= k; }
      // recentrar para que la media se conserve
      reg.beta[q] = reg.mean[r * 3 + c] - b1 * reg.cx[r] - b2 * reg.cy[r];
      reg.beta[q + 1] = b1; reg.beta[q + 2] = b2;
    }
  }
  const a95 = C.percentile(reg.act, 0.9) || 1;
  for (let r = 0; r < R; r++) reg.act[r] = Math.min(1, reg.act[r] / a95);

  /* --- 6) distancia al borde (chamfer 3-4), en px de análisis --- */
  const dt = new Float32Array(n);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const p = y * aw + x, l = labels[p];
    const edge = (x > 0 && labels[p - 1] !== l) || (x < aw - 1 && labels[p + 1] !== l) || (y > 0 && labels[p - aw] !== l) || (y < ah - 1 && labels[p + aw] !== l);
    dt[p] = edge ? 0 : 1e9;
  }
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const p = y * aw + x;
    let d = dt[p];
    if (x > 0) d = Math.min(d, dt[p - 1] + 1);
    if (y > 0) { d = Math.min(d, dt[p - aw] + 1); if (x > 0) d = Math.min(d, dt[p - aw - 1] + 1.414); if (x < aw - 1) d = Math.min(d, dt[p - aw + 1] + 1.414); }
    dt[p] = d;
  }
  for (let y = ah - 1; y >= 0; y--) for (let x = aw - 1; x >= 0; x--) {
    const p = y * aw + x;
    let d = dt[p];
    if (x < aw - 1) d = Math.min(d, dt[p + 1] + 1);
    if (y < ah - 1) { d = Math.min(d, dt[p + aw] + 1); if (x < aw - 1) d = Math.min(d, dt[p + aw + 1] + 1.414); if (x > 0) d = Math.min(d, dt[p + aw - 1] + 1.414); }
    dt[p] = d;
  }
  for (let p = 0; p < n; p++) { const r = labels[p]; if (dt[p] > reg.maxDist[r]) reg.maxDist[r] = dt[p]; }

  // lista de píxeles por mancha (para sembrar trazos)
  const off = new Int32Array(R + 1);
  for (let p = 0; p < n; p++) off[labels[p] + 1]++;
  for (let r = 0; r < R; r++) off[r + 1] += off[r];
  const fill = Int32Array.from(off.subarray(0, R));
  const pix = new Int32Array(n);
  for (let p = 0; p < n; p++) pix[fill[labels[p]]++] = p;

  await clock.tick(1);
  return { labels, reg, dt, imp, pixOff: off, pix, aw, ah, S };
}

/** Color del modelo de la mancha r en coordenadas normalizadas (u,v ∈ 0..1). */
function modelColor(seg, r, u, v, out) {
  const b = seg.reg.beta, q = r * 9;
  for (let c = 0; c < 3; c++) {
    const val = b[q + c * 3] + b[q + c * 3 + 1] * u + b[q + c * 3 + 2] * v;
    out[c] = val < 0 ? 0 : val > 1 ? 1 : val;
  }
  return out;
}

/**
 * Etiquetas a resolución completa: en los bordes elige, entre las manchas
 * vecinas, la que mejor explica el color real del píxel.
 */
async function fullLabels(ctx, seg, clock) {
  const { W, H, data, comp } = ctx;
  const { aw, ah, labels } = seg;
  const L = seg.reg.n < 65535 ? new Uint16Array(W * H) : new Int32Array(W * H);
  const col = new Float32Array(3);
  const cand = new Int32Array(9);
  for (let y = 0; y < H; y++) {
    const ay = Math.min(ah - 1, Math.floor((y + 0.5) * ah / H));
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const ax = Math.min(aw - 1, Math.floor((x + 0.5) * aw / W));
      const p = ay * aw + ax;
      const l0 = labels[p];
      let mixed = false;
      let nc = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = ay + dy;
        if (yy < 0 || yy >= ah) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = ax + dx;
          if (xx < 0 || xx >= aw) continue;
          const l = labels[yy * aw + xx];
          if (l !== l0) mixed = true;
          let seen = false;
          for (let t = 0; t < nc; t++) if (cand[t] === l) { seen = true; break; }
          if (!seen) cand[nc++] = l;
        }
      }
      const i = y * W + x;
      if (!mixed) { L[i] = l0; continue; }
      const di = i * comp;
      const pr = data[di] / 255, pg = data[di + 1] / 255, pb = data[di + 2] / 255;
      const u = (x + 0.5) / W;
      let best = l0, bd = 1e9;
      for (let t = 0; t < nc; t++) {
        modelColor(seg, cand[t], u, v, col);
        const d0 = col[0] - pr, d1 = col[1] - pg, d2 = col[2] - pb;
        const d = d0 * d0 + d1 * d1 + d2 * d2 + (cand[t] === l0 ? -0.002 : 0);
        if (d < bd) { bd = d; best = cand[t]; }
      }
      L[i] = best;
    }
    if ((y & 63) === 0) await clock.tick(y / H);
  }
  return L;
}

/**
 * Cadenas de borde entre manchas (en px de análisis). Cada cadena separa la
 * mancha `r` (lado interior) de la mancha `q`.
 * Devuelve [{r, q, xs:Float32Array, ys:Float32Array, n}]
 */
function boundaryChains(seg, minLen) {
  const { aw, ah, labels } = seg;
  const n = aw * ah;
  // propietario del borde: píxel de r con un vecino 4-conexo de otra mancha q (la de mayor contraste)
  const nb = new Int32Array(n).fill(-1);
  const lab = seg.reg.lab;
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const p = y * aw + x, r = labels[p];
    let best = -1, bd = -1;
    const test = (q) => {
      if (q === r) return;
      const d0 = lab[r * 3] - lab[q * 3], d1 = lab[r * 3 + 1] - lab[q * 3 + 1], d2 = lab[r * 3 + 2] - lab[q * 3 + 2];
      const d = d0 * d0 + d1 * d1 + d2 * d2;
      if (d > bd) { bd = d; best = q; }
    };
    if (x > 0) test(labels[p - 1]);
    if (x < aw - 1) test(labels[p + 1]);
    if (y > 0) test(labels[p - aw]);
    if (y < ah - 1) test(labels[p + aw]);
    nb[p] = best;
  }
  const used = new Uint8Array(n);
  const chains = [];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const xsB = [], ysB = [];
  for (let p0 = 0; p0 < n; p0++) {
    if (nb[p0] < 0 || used[p0]) continue;
    const r = labels[p0], q = nb[p0];
    // recorrer en ambos sentidos
    const walk = (start, sign) => {
      const xs = [], ys = [];
      let p = start, lastDir = -1;
      for (let guard = 0; guard < 100000; guard++) {
        const x = p % aw, y = (p / aw) | 0;
        let next = -1, nd = -1;
        for (let t = 0; t < 8; t++) {
          const di = lastDir < 0 ? t : (lastDir + (t % 2 === 0 ? t / 2 : -(t + 1) / 2) + 8) % 8;
          const xx = x + dirs[di][0] * sign, yy = y + dirs[di][1] * sign;
          if (xx < 0 || yy < 0 || xx >= aw || yy >= ah) continue;
          const pp = yy * aw + xx;
          if (used[pp] || nb[pp] !== q || labels[pp] !== r) continue;
          next = pp; nd = di; break;
        }
        if (next < 0) break;
        used[next] = 1;
        xs.push(next % aw); ys.push((next / aw) | 0);
        p = next; lastDir = nd;
      }
      return [xs, ys];
    };
    used[p0] = 1;
    const [fx, fy] = walk(p0, 1);
    const [bx, by] = walk(p0, -1);
    xsB.length = 0; ysB.length = 0;
    for (let i = bx.length - 1; i >= 0; i--) { xsB.push(bx[i]); ysB.push(by[i]); }
    xsB.push(p0 % aw); ysB.push((p0 / aw) | 0);
    for (let i = 0; i < fx.length; i++) { xsB.push(fx[i]); ysB.push(fy[i]); }
    if (xsB.length < minLen) continue;
    // suavizado (media móvil) para quitar la escalera de píxeles
    const m = xsB.length;
    const xs = new Float32Array(m), ys = new Float32Array(m);
    const w = 3;
    for (let i = 0; i < m; i++) {
      let sx = 0, sy = 0, c = 0;
      for (let k = -w; k <= w; k++) { const j = Math.min(m - 1, Math.max(0, i + k)); sx += xsB[j]; sy += ysB[j]; c++; }
      xs[i] = sx / c + 0.5; ys[i] = sy / c + 0.5;
    }
    chains.push({ r, q, xs, ys, n: m });
  }
  return chains;
}

module.exports = { segment, fullLabels, boundaryChains, modelColor, rgbToLab };
