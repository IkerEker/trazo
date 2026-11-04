"use strict";
/*
 * Trazo · pintor de pinceladas (Óleo, Gouache, Ceras)
 *
 * Método: capas de pincel de grueso a fino. En cada capa se proponen puntos
 * en una rejilla; un trazo solo se pinta si en ese punto falta pintura o el
 * color del lienzo difiere de la referencia (Hertzmann). Cada trazo sigue el
 * campo de direcciones de la imagen y se detiene en los cambios de color.
 * El lienzo es premultiplicado: lo no pintado queda transparente.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");

const BODY = 0.7; // fracción del ancho de la textura que ocupa el cuerpo del trazo
const VK = 0.9;   // se rasteriza el 90 % central del ancho (el borde exterior está vacío)

const NB = 32; // cerdas por pincel

function kindConfig(kind, p, s) {
  // radios y longitudes en px a resolución de trabajo (s = lado largo / 1000)
  if (kind === "oleo") {
    const R0 = (1.8 + p.grosor * 20) * s;
    return {
      R0, layers: 1 + Math.round(p.detalle * 3), ratio: 0.5, minR: 0.8,
      Lk: 2 * (0.7 + p.longitud * 6.5), spacing: 1.05, soft: 0.22,
      opacity: 0.55 + 0.45 * p.intensidad, streak: 0.2, wet: 0.22,
      dry: 0.55 + 0.4 * p.intensidad, thick: p.empaste, sat: 1.1,
      tol: 0.42 - 0.22 * p.detalle, refineT: 0.14 - 0.09 * p.detalle,
      needCov: 0.7, gloss: 0.3, shade: 1.0, canvasTex: 0.5, under: 0.9,
      sK: 0.75 + 0.9 * p.empaste, paperDep: 0, dual: 0.6,
    };
  }
  if (kind === "gouache") {
    const R0 = (1.8 + p.grosor * 17) * s;
    return {
      R0, layers: 1 + Math.round(p.detalle * 3), ratio: 0.5, minR: 0.8,
      Lk: 2 * (1.6 + p.longitud * 6.5), spacing: 1.0, soft: 0.1,
      opacity: 0.8 + 0.2 * p.intensidad, streak: 0.12, wet: 0.06,
      dry: 0.6 + 0.3 * p.intensidad, thick: p.empaste * 0.45, sat: 1.04,
      tol: 0.36 - 0.2 * p.detalle, refineT: 0.12 - 0.08 * p.detalle,
      needCov: 0.85, gloss: 0.0, shade: 0.7, palette: 0.5, canvasTex: 0.35, under: 1.0,
      sK: 0.7 + 0.6 * p.empaste, paperDep: 0, dual: 0.45,
    };
  }
  // ceras
  const R0 = (2.4 + p.grosor * 12) * s;
  return {
    R0, layers: 2 + Math.round(p.detalle * 1.4), ratio: 0.72, minR: 0.6,
    Lk: 2 * (2.5 + p.longitud * 12), spacing: 1.9, soft: 0.35,
    opacity: 0.92, pressure: 0.3 + 0.62 * p.intensidad, streak: 0.12, wet: 0.0,
    dry: 0.7, thick: p.empaste * 0.6, sat: 1.22,
    tol: 0.5 - 0.22 * p.detalle, refineT: 0.18 - 0.1 * p.detalle,
    needCov: 0.8, gloss: 0.12, shade: 0.6, canvasTex: 0.0, under: 0,
    sK: 0.85 + 0.6 * p.empaste, paperDep: 0.5, dual: 0.5,
  };
}

/* ---------- paleta para gouache (k-means simple) ---------- */
function buildPalette(ctx, K, seed) {
  const { ar, ag, ab } = ctx;
  const n = ar.length;
  const rand = C.mulberry32(seed + 55);
  const samples = Math.min(n, 6000);
  const sr = new Float32Array(samples), sg = new Float32Array(samples), sb = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const j = Math.floor(rand() * n);
    sr[i] = ar[j]; sg[i] = ag[j]; sb[i] = ab[j];
  }
  const cr = new Float32Array(K), cg = new Float32Array(K), cb = new Float32Array(K);
  // inicialización k-means++ simplificada
  let j0 = Math.floor(rand() * samples);
  cr[0] = sr[j0]; cg[0] = sg[j0]; cb[0] = sb[j0];
  const dist = new Float32Array(samples).fill(1e9);
  for (let k = 1; k < K; k++) {
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      const dr = sr[i] - cr[k - 1], dg = sg[i] - cg[k - 1], db = sb[i] - cb[k - 1];
      const d = dr * dr + dg * dg + db * db;
      if (d < dist[i]) dist[i] = d;
      sum += dist[i];
    }
    let t = rand() * sum, pick = 0;
    for (let i = 0; i < samples; i++) { t -= dist[i]; if (t <= 0) { pick = i; break; } }
    cr[k] = sr[pick]; cg[k] = sg[pick]; cb[k] = sb[pick];
  }
  const asg = new Int32Array(samples);
  for (let it = 0; it < 8; it++) {
    for (let i = 0; i < samples; i++) {
      let best = 0, bd = 1e9;
      for (let k = 0; k < K; k++) {
        const dr = sr[i] - cr[k], dg = sg[i] - cg[k], db = sb[i] - cb[k];
        const d = dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.7;
        if (d < bd) { bd = d; best = k; }
      }
      asg[i] = best;
    }
    const nr = new Float32Array(K), ng = new Float32Array(K), nb = new Float32Array(K), cnt = new Float32Array(K);
    for (let i = 0; i < samples; i++) { const k = asg[i]; nr[k] += sr[i]; ng[k] += sg[i]; nb[k] += sb[i]; cnt[k]++; }
    for (let k = 0; k < K; k++) if (cnt[k] > 0) { cr[k] = nr[k] / cnt[k]; cg[k] = ng[k] / cnt[k]; cb[k] = nb[k] / cnt[k]; }
  }
  return { r: cr, g: cg, b: cb, K };
}

function snapPalette(pal, c, amt) {
  let best = 0, bd = 1e9;
  for (let k = 0; k < pal.K; k++) {
    const dr = c[0] - pal.r[k], dg = c[1] - pal.g[k], db = c[2] - pal.b[k];
    const d = dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.7;
    if (d < bd) { bd = d; best = k; }
  }
  c[0] += (pal.r[best] - c[0]) * amt;
  c[1] += (pal.g[best] - c[1]) * amt;
  c[2] += (pal.b[best] - c[2]) * amt;
}

function saturate(c, k) {
  const y = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  for (let i = 0; i < 3; i++) { const v = y + (c[i] - y) * k; c[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
}

/**
 * Pinta con pinceladas. Devuelve {Pr,Pg,Pb,Cv,Hh} (planos premultiplicados).
 */
async function paint(ctx, kind, p, clock) {
  const { W, H, N, s } = ctx;
  const cfg = kindConfig(kind, p, s);
  const rand = C.mulberry32(ctx.seed * 31 + 7);
  const Pr = new Float32Array(N), Pg = new Float32Array(N), Pb = new Float32Array(N);
  const Cv = new Float32Array(N);
  const Hh = cfg.thick > 0.001 || cfg.canvasTex > 0 ? new Float32Array(N) : null;
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const grain = C.makeGrainTile(ctx.seed + 5, kind === "ceras" ? "tooth" : "paper");
  const gsInv = 1 / Math.max(1, Math.sqrt(s) * (kind === "ceras" ? 0.9 : 1.6));
  const pal = cfg.palette ? buildPalette(ctx, 10 + Math.round(p.detalle * 14), ctx.seed) : null;
  const cover = ctx.cover;
  const sel = ctx.sel, selDetail = ctx.selMode === "detalle";
  const col = new Float32Array(3);
  const tmpc = new Float32Array(3);
  const bris = new Float32Array(NB);
  // trazos reales (si hay biblioteca) y soporte real a escala física
  const lib = ctx.lib && ctx.lib.samples && ctx.lib.samples.length ? ctx.lib.samples : null;
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H))) : null;
  const ts = new Float32Array(2);
  const col2 = new Float32Array(3);
  const stripes = new Float32Array(64);

  const varH = p.varTono * 0.42, varS = p.varSat * 0.55, varL = p.varLuz * 0.26;

  // radios de cada capa
  const radii = [];
  let R = cfg.R0;
  for (let k = 0; k < cfg.layers; k++) {
    radii.push(Math.max(cfg.minR, R));
    R *= cfg.ratio;
    if (R < cfg.minR * 0.9 && k >= 1) break;
  }
  const nL = radii.length;

  for (let k = 0; k < nL; k++) {
    const Rk = radii[k];
    const level = ctx.levelFor(Rk * (kind === "ceras" ? 1.6 : 1.0));
    const sp = Math.max(0.8, Rk * cfg.spacing * (kind === "ceras" ? 1 : 1));
    const cols = Math.ceil(W / sp), rows = Math.ceil(H / sp);
    const base = k === 0;
    // umbral estático de detalle para capas finas (evita millones de candidatos)
    const edgeGate = base ? -1 : (kind === "ceras" ? 0.02 : 0.04) + 0.1 * (k - 1);
    const angle = kind === "ceras" ? (k % 2 === 0 ? 0 : (k % 4 === 1 ? 0.42 : -0.42)) : 0;

    // candidatos
    let cnt = 0;
    let cap = 1 << 16;
    let cx = new Float32Array(cap), cy = new Float32Array(cap);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const x = (gx + rand()) * sp, y = (gy + rand()) * sp;
        if (x >= W || y >= H) continue;
        const m = ctx.at(cover, x, y);
        if (m < 0.999 && rand() > m) continue;
        if (!base) {
          let e = ctx.at(ctx.edge, x, y);
          if (selDetail && sel) e += ctx.at(sel, x, y) * 0.5;
          if (e < edgeGate) continue;
        }
        if (cnt >= cap) {
          cap *= 2;
          const nx = new Float32Array(cap); nx.set(cx); cx = nx;
          const ny = new Float32Array(cap); ny.set(cy); cy = ny;
        }
        cx[cnt] = x; cy[cnt] = y; cnt++;
      }
      if ((gy & 31) === 0) await clock.tick((k + gy / rows * 0.1) / nL);
    }
    const order = new Int32Array(cnt);
    for (let i = 0; i < cnt; i++) order[i] = i;
    S.shuffle(order, cnt, rand);

    const tolK = cfg.tol * (1 + 0.35 * (nL - 1 - k));
    const L = Rk * cfg.Lk * (base ? 1 : 0.8);
    const step = Math.max(0.8, kind === "ceras" ? Rk * 1.2 + 0.5 * s : Rk * 0.9);

    for (let oi = 0; oi < cnt; oi++) {
      const ci = order[oi];
      const x = cx[ci], y = cy[ci];
      const xi = x | 0, yi = y | 0;
      const g0 = yi * W + xi;
      const cov0 = Cv[g0];

      ctx.colorAt(level, x, y, col);
      // ¿hace falta pintar aquí?
      let need = cov0 < cfg.needCov;
      if (!need && !base) {
        const inv = 1 / cov0;
        const err = Math.abs(Pr[g0] * inv - col[0]) + Math.abs(Pg[g0] * inv - col[1]) + Math.abs(Pb[g0] * inv - col[2]);
        let T = cfg.refineT * 3 * (1.25 - ctx.at(ctx.edge, x, y) * 0.9);
        if (selDetail && sel) T *= 1 - 0.6 * ctx.at(sel, x, y);
        need = err > T;
      } else if (!need && base && kind === "ceras") {
        need = rand() < 0.18; // las ceras se superponen un poco más
      }
      if (!need) continue;

      // color del trazo
      if (pal) snapPalette(pal, col, cfg.palette);
      if (cfg.sat !== 1) saturate(col, cfg.sat);
      tmpc[0] = col[0]; tmpc[1] = col[1]; tmpc[2] = col[2];
      C.varyColor(tmpc[0], tmpc[1], tmpc[2],
        (rand() - 0.5) * 2 * varH, (rand() - 0.5) * 2 * varS, (rand() - 0.5) * 2 * varL, col);

      // trayectoria
      S.traceStroke(ctx, path, x, y, {
        R: Rk, Lmax: L * (0.6 + rand() * 0.8), step, curv: 0.08 + 0.9 * p.curvatura,
        colorTol: tolK, color: tmpc, level, angle: angle + (rand() - 0.5) * (kind === "ceras" ? 0.25 : lib ? 0.3 : 0),
        minLen: Rk * (kind === "ceras" ? 3 : 1.2), fine: k >= 2 && Rk < 6 * s,
      });
      if (kind === "ceras") S.wobblePath(path, Rk * (0.3 + 0.9 * p.curvatura), Rk * (10 + rand() * 12), rand() * 6.28);

      // perfil de anchura
      const n = path.n, len = path.len || 1;
      const rs = path.rs;
      if (lib) {
        // con trazos reales la forma la da la muestra: área rasterizada constante
        const Rr = Rk / BODY, Rq = Rr * VK;
        for (let i = 0; i < n; i++) rs[i] = Rq;
        const ntl = raster.rasterize(path, 0.04);
        if (ntl === 0) continue;
        const smp = lib[(rand() * lib.length) | 0];
        const st = Lib.prepare(smp, len, Rr, rand, VK);
        const op = cfg.opacity * (kind === "ceras" ? 1 : (0.88 + rand() * 0.12));
        const thick = cfg.thick * (0.7 + rand() * 0.6);
        const cr = col[0], cg = col[1], cb = col[2];
        const sK = cfg.sK, wet = cfg.wet, pdep = cfg.paperDep;
        // pincel cargado con dos tonos: vetas finas a lo largo de las cerdas
        const vlum = 0.4 + p.varLuz + p.varTono * 0.6;
        const mixAmt = Math.min(0.9, cfg.dual * vlum * (0.4 + 0.6 * rand()));
        C.varyColor(cr, cg, cb, (rand() - 0.5) * 0.5 * (0.3 + p.varTono), (rand() - 0.5) * 0.5,
          (rand() < 0.5 ? -1 : 1) * (0.07 + 0.12 * rand()), col2);
        const c2r = col2[0], c2g = col2[1], c2b = col2[2];
        let ph = rand() * 6.28, fr1 = 5 + rand() * 9, fr2 = 13 + rand() * 17;
        for (let q = 0; q < 64; q++) {
          const z = q / 63;
          const w = 0.55 * Math.sin(z * fr1 + ph) + 0.45 * Math.sin(z * fr2 + ph * 1.7) + (rand() - 0.5) * 0.5;
          stripes[q] = C.smoothstep(0.05, 0.7, w);
        }
        const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
        for (let t = 0; t < ntl; t++) {
          const li = tl[t], g = tg[t];
          const u = U[li];
          Lib.sampleAt(st, u, V[li], ts);
          let a = ts[0] * op * A[li];
          if (pdep > 0 && pap && a > 0.004) {
            // las ceras se quedan en los picos del papel (siempre el mismo grano)
            const x = g % W, y = (g / W) | 0;
            a *= 1 - pdep + pdep * C.smoothstep(0.2, 0.7, pap.eqN(x, y));
          }
          if (a < 0.004) continue;
          // detalle de la muestra: menos en los bordes (cobertura parcial) y sombras suaves
          let sv = ts[1] * sK * C.smoothstep(0.3, 0.9, ts[0]);
          if (sv < 0) sv *= 0.7;
          const vv = V[li];
          const mz = stripes[((vv + 1) * 31.5) | 0] * mixAmt;
          const br = cr + (c2r - cr) * mz, bgc = cg + (c2g - cg) * mz, bbc = cb + (c2b - cb) * mz;
          let r, gg, bb;
          if (sv < 0) { const f = 1 + (sv < -0.9 ? -0.9 : sv); r = br * f; gg = bgc * f; bb = bbc * f; }
          else { const f = sv > 1 ? 0.85 : sv * 0.85; r = br + (1 - br) * f; gg = bgc + (1 - bgc) * f; bb = bbc + (1 - bbc) * f; }
          const cv = Cv[g];
          if (wet > 0 && cv > 0.05) {
            const m = wet * (0.2 + 0.8 * (u < 0 ? 0 : u > 1 ? 1 : u)) * cv, inv = 1 / cv;
            r += (Pr[g] * inv - r) * m; gg += (Pg[g] * inv - gg) * m; bb += (Pb[g] * inv - bb) * m;
          }
          const ia = 1 - a;
          Pr[g] = Pr[g] * ia + r * a; Pg[g] = Pg[g] * ia + gg * a; Pb[g] = Pb[g] * ia + bb * a;
          Cv[g] = cv * ia + a;
          if (Hh) Hh[g] = Hh[g] * (1 - a * 0.85) + a * thick * (0.45 + 0.55 * ts[0] + 0.5 * ts[1]);
        }
        raster.clear();
        if ((oi & 15) === 0) await clock.tick((k + 0.1 + 0.9 * oi / cnt) / nL);
        continue;
      }
      for (let i = 0; i < n; i++) {
        const u = path.ss[i] / len;
        let prof;
        if (kind === "oleo") prof = 0.82 + 0.18 * Math.sin(Math.min(1, u * 1.15) * Math.PI) - 0.1 * C.smoothstep(0.75, 1, u);
        else if (kind === "gouache") prof = 0.9 + 0.1 * Math.sin(u * Math.PI);
        else prof = 0.55 + 0.45 * Math.sin(u * Math.PI);
        rs[i] = Rk * prof;
      }
      const nt = raster.rasterize(path, cfg.soft);
      if (nt === 0) continue;

      // cerdas de este pincel
      let prev = rand();
      for (let b = 0; b < NB; b++) { const v = rand(); prev = prev * 0.45 + v * 0.55; bris[b] = prev; }
      const nbm = Math.max(3, Math.min(NB, Math.round(Rk * 1.3))) - 1; // cerdas visibles según el tamaño
      const dryStart = cfg.dry * (0.75 + rand() * 0.25);
      const op = cfg.opacity * (kind === "ceras" ? 1 : (0.85 + rand() * 0.15));
      const thick = cfg.thick * (0.7 + rand() * 0.6);
      const cr = col[0], cg = col[1], cb = col[2];
      const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;

      if (kind === "oleo") {
        const streak = cfg.streak, wet = cfg.wet;
        const capK = 1.6 * (path.len || 1) / Math.max(1, Rk);
        for (let t = 0; t < nt; t++) {
          const li = tl[t], g = tg[t];
          const u = U[li], v = V[li];
          const b = bris[((v + 1) * 0.5 * nbm + 0.5) | 0];
          let a = A[li] * op;
          if (u > dryStart) {
            const nd = u > 1 ? 1 : (u - dryStart) / (1 - dryStart);
            a *= C.smoothstep(nd - 0.3, nd + 0.02, b);
          }
          if (u < 0) a *= C.smoothstep(-u * capK - 0.2, -u * capK + 0.05, b);
          if (a < 0.004) continue;
          const sk = 1 + (b - 0.5) * streak;
          let r = cr * sk, gg = cg * sk, bb = cb * sk;
          const cv = Cv[g];
          if (cv > 0.05) {
            const m = wet * (0.25 + 0.75 * u) * cv;
            const inv = 1 / cv;
            r += (Pr[g] * inv - r) * m; gg += (Pg[g] * inv - gg) * m; bb += (Pb[g] * inv - bb) * m;
          }
          const ia = 1 - a;
          Pr[g] = Pr[g] * ia + r * a; Pg[g] = Pg[g] * ia + gg * a; Pb[g] = Pb[g] * ia + bb * a;
          Cv[g] = cv * ia + a;
          if (Hh) {
            const av = v < 0 ? -v : v;
            const hs = thick * (0.45 + 0.55 * b + 0.22 * C.smoothstep(0.4, 1, av)) * (1 + 0.7 * (1 - u) * (1 - u) * (1 - u));
            Hh[g] = Hh[g] * (1 - a * 0.85) + hs * a;
          }
        }
      } else if (kind === "gouache") {
        const streak = cfg.streak, wet = cfg.wet;
        const capK = 2.5 * (path.len || 1) / Math.max(1, Rk); // remate seco en ~0.4 radios
        for (let t = 0; t < nt; t++) {
          const li = tl[t], g = tg[t];
          const u = U[li], v = V[li];
          const av = v < 0 ? -v : v;
          let a = A[li] * op;
          let ez = C.smoothstep(0.45, 1, av) * 0.6 + (u > dryStart ? (u - dryStart) / (1 - dryStart) * 0.85 : 0);
          if (u < 0) ez += -u * capK; else if (u > 1) ez += (u - 1) * capK;
          if (ez > 0.02) {
            const x = g % W, y = (g / W) | 0;
            const gr = C.tileAt(grain, x * gsInv, y * gsInv);
            a *= C.smoothstep(ez - 0.18, ez + 0.08, gr);
          }
          if (a < 0.004) continue;
          const b = bris[((v + 1) * 0.5 * nbm + 0.5) | 0];
          const sk = 1 + (b - 0.5) * streak;
          let r = cr * sk, gg = cg * sk, bb = cb * sk;
          const cv = Cv[g];
          if (cv > 0.05 && wet > 0) {
            const m = wet * u * cv, inv = 1 / cv;
            r += (Pr[g] * inv - r) * m; gg += (Pg[g] * inv - gg) * m; bb += (Pb[g] * inv - bb) * m;
          }
          const ia = 1 - a;
          Pr[g] = Pr[g] * ia + r * a; Pg[g] = Pg[g] * ia + gg * a; Pb[g] = Pb[g] * ia + bb * a;
          Cv[g] = cv * ia + a;
          if (Hh) Hh[g] = Hh[g] * (1 - a * 0.9) + thick * (0.6 + 0.4 * b) * a;
        }
      } else {
        // ceras: el pigmento se queda en los picos del grano del papel
        const pressure = cfg.pressure;
        const lumc = 0.299 * cr + 0.587 * cg + 0.114 * cb;
        const spr = (0.8 + rand() * 0.4) * (1 + 0.45 * (1 - lumc)); // presión: más en colores oscuros
        const floor = 0.25 + 0.45 * (1 - lumc);
        for (let t = 0; t < nt; t++) {
          const li = tl[t], g = tg[t];
          const v = V[li], u = U[li];
          const b = bris[((v + 1) * 0.5 * nbm + 0.5) | 0];
          const x = g % W, y = (g / W) | 0;
          const gr = C.tileAt(grain, x * gsInv, y * gsInv);
          const pr = pressure * spr * (0.72 + 0.28 * b) * (0.8 + 0.2 * Math.sin(u * Math.PI));
          const dep = floor + (1 - floor) * C.smoothstep(1 - pr - 0.2, 1 - pr + 0.1, gr);
          let a = A[li] * dep * op;
          if (a < 0.004) continue;
          const sk = 1 + (b - 0.5) * cfg.streak;
          const ia = 1 - a;
          Pr[g] = Pr[g] * ia + cr * sk * a; Pg[g] = Pg[g] * ia + cg * sk * a; Pb[g] = Pb[g] * ia + cb * sk * a;
          Cv[g] = Cv[g] * ia + a;
          if (Hh) Hh[g] += a * thick * 0.35 * (1 - Hh[g] * 0.5);
        }
      }
      raster.clear();
      if ((oi & 15) === 0) await clock.tick((k + 0.1 + 0.9 * oi / cnt) / nL);
    }
  }
  return { Pr, Pg, Pb, Cv, Hh, cfg, grain, gsInv, real: !!lib, pap };
}

/**
 * Sombreado final (relieve del empaste, brillo, textura de soporte) y salida RGBA.
 */
async function finish(ctx, kind, p, planes, clock) {
  const { W, H, N, s } = ctx;
  const { Pr, Pg, Pb, Cv, Hh, cfg, grain, pap } = planes;
  const out = new Uint8Array(N * 4);
  let weave = null, wInv = 1;
  if (Hh && cfg.canvasTex > 0 && pap) {
    // lienzo / papel real: la trama asoma donde la pintura es fina
    const tmp0 = new Float32Array(N);
    const rb0 = Math.max(1, Math.round(0.9 * Math.sqrt(s)));
    C.boxBlurH(Hh, tmp0, W, H, rb0); C.boxBlurV(tmp0, Hh, W, H, rb0);
    C.boxBlurH(Hh, tmp0, W, H, 1); C.boxBlurV(tmp0, Hh, W, H, 1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const thin = 1 - Math.min(1, Hh[i] * 1.2);
        Hh[i] += (0.5 + pap.raw(x, y) * 1.6) * cfg.canvasTex * (0.12 + 0.4 * thin);
      }
      if ((y & 63) === 0) await clock.tick(y / H * 0.3);
    }
  } else if (Hh && cfg.canvasTex > 0) {
    weave = C.makeGrainTile(ctx.seed + 9, kind === "oleo" ? "canvas" : "paper");
    wInv = 1 / Math.max(1, Math.sqrt(s) * (kind === "oleo" ? 1.0 : 1.6));
  }
  if (Hh && !(cfg.canvasTex > 0 && pap)) {
    // suavizado ligero del relieve
    const tmp = new Float32Array(N);
    const rb = Math.max(1, Math.round(0.6 * Math.sqrt(s)));
    C.boxBlurH(Hh, tmp, W, H, rb); C.boxBlurV(tmp, Hh, W, H, rb);
    C.boxBlurH(Hh, tmp, W, H, 1); C.boxBlurV(tmp, Hh, W, H, 1);
    if (weave) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const thin = 1 - Math.min(1, Hh[i] * 1.2);
          Hh[i] += C.tileAt(weave, x * wInv, y * wInv) * cfg.canvasTex * (0.15 + 0.35 * thin);
        }
        if ((y & 63) === 0) await clock.tick(y / H * 0.3);
      }
    }
  }
  // dirección de la luz (arriba-izquierda)
  let lx = -0.55, ly = -0.65, lz = 0.52;
  const lm = Math.sqrt(lx * lx + ly * ly + lz * lz);
  lx /= lm; ly /= lm; lz /= lm;
  const relief = (0.12 + 0.95 * p.empaste) * cfg.shade * Math.max(0.6, Math.sqrt(s)) * (planes.real ? 0.55 : 1);
  const gloss = cfg.gloss * (0.3 + p.empaste);
  const selFull = ctx.selFull;
  const data = ctx.data, comp = ctx.comp, srcA = ctx.srcAlpha;
  const chalk = kind === "gouache";
  const under = cfg.under || 0;
  const uLevel = ctx.levelFor(cfg.R0 * 1.5);
  const ucol = new Float32Array(3);
  const fullCover = p.cobertura >= 0.995;

  for (let y = 0; y < H; y++) {
    const row = y * W;
    const ym = y > 0 ? -W : 0, yp = y < H - 1 ? W : 0;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      let cv = Cv[i];
      const o = i * 4;
      let pr = Pr[i], pg = Pg[i], pb = Pb[i];
      if (under > 0 && cv < 0.999) {
        // imprimación: capa fina de color base bajo los huecos entre pinceladas
        let m = fullCover ? 1 : ctx.at(ctx.cover, x, y);
        m = m * m * under;
        if (m > 0.002) {
          ctx.colorAt(uLevel, x, y, ucol);
          const k = m * (1 - cv);
          pr += (ucol[0] * 0.9 + 0.08) * k; pg += (ucol[1] * 0.9 + 0.08) * k; pb += (ucol[2] * 0.9 + 0.08) * k;
          cv += k;
        }
      }
      if (cv <= 0.002) { out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = 0; continue; }
      const inv = 1 / cv;
      let r = pr * inv, g = pg * inv, b = pb * inv;
      if (Hh) {
        const hx = (x < W - 1 ? Hh[i + 1] : Hh[i]) - (x > 0 ? Hh[i - 1] : Hh[i]);
        const hy = Hh[i + yp] - Hh[i + ym];
        let nx = -hx * relief, ny = -hy * relief, nz = 1;
        const nm = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        nx *= nm; ny *= nm; nz *= nm;
        const ndl = nx * lx + ny * ly + nz * lz;
        const dif = (ndl - lz) * 1.15;
        const k = 1 + dif;
        r *= k; g *= k; b *= k;
        if (gloss > 0 && (!cfg.glossByHeight || Hh[i] > 0.08)) {
          const rv = 2 * ndl * nz - lz;
          if (rv > 0.6) {
            let sp = (rv - 0.6) / 0.4; sp = sp * sp; sp = sp * sp; sp = sp * sp;
            const add = sp * gloss * (cfg.glossByHeight ? C.smoothstep(0.08, 0.6, Hh[i]) : 1);
            r += add; g += add; b += add;
          }
        }
      }
      if (chalk) { r = r * 0.95 + 0.035; g = g * 0.95 + 0.035; b = b * 0.95 + 0.035; }
      let a = cv > 1 ? 1 : cv;
      if (selFull) a *= selFull[i] / 255;
      if (srcA) a *= data[i * comp + 3] / 255;
      out[o] = r <= 0 ? 0 : r >= 1 ? 255 : (r * 255 + 0.5) | 0;
      out[o + 1] = g <= 0 ? 0 : g >= 1 ? 255 : (g * 255 + 0.5) | 0;
      out[o + 2] = b <= 0 ? 0 : b >= 1 ? 255 : (b * 255 + 0.5) | 0;
      out[o + 3] = (a * 255 + 0.5) | 0;
    }
    if ((y & 31) === 0) await clock.tick(0.3 + 0.7 * y / H);
  }
  return out;
}

module.exports = { paint, finish, kindConfig };
