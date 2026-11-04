"use strict";
/*
 * Trazo · Lápiz (grafito o lápiz de color)
 * Rayado que sigue el campo de direcciones. Los trazos se colocan hasta que
 * la oscuridad acumulada alcanza el tono de la foto; en las sombras se
 * añaden capas cruzadas. Al final, contornos sobre los bordes fuertes.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");
const K = require("./kit.js");

async function paint(ctx, p, clock, seg, Lfull, opts) {
  opts = opts || {};
  const { W, H, N, s, aw, ah } = ctx;
  const colorMode = !!p.color;
  const mode = p.modo || "rayado";
  const onlyLines = opts.only === "contornos" || mode === "boceto";
  const noLines = opts.only === "tono";
  const rand = C.mulberry32(ctx.seed * 13 + 3);

  let libSrc = opts.lib || ctx.lib;
  if (mode === "carbon" && ctx.strokesOf) libSrc = ctx.strokesOf(["pin_cera"]) || libSrc;
  const lib = libSrc && libSrc.samples && libSrc.samples.length ? libSrc.samples : null;
  /* ----- tono objetivo (oscuridad 0..1) a resolución de análisis ----- */
  const n = aw * ah;
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = 1 - ctx.lum[i];
  const blur = Float32Array.from(tone);
  C.gaussBlur(blur, aw, ah, Math.max(2, 18 * s / ctx.fa));
  const lift = (1 - p.cobertura) * 0.32;
  for (let i = 0; i < n; i++) {
    let t = tone[i] + (tone[i] - blur[i]) * 0.7; // contraste local
    t = C.smoothstep(0.04, 0.97, t);
    t = Math.pow(t, 1.45) * (lib ? 0.8 : 0.85);
    t = Math.max(0, (t - lift) / (1 - lift));
    tone[i] = t * ctx.cover[i];
  }
  ctx.tone = tone;

  const D = new Float32Array(N); // oscuridad acumulada
  /* ----- difumino: tono base suave en las zonas lisas (piel, cielo, paredes) ----- */
  const regAng = seg ? new Float32Array(seg.reg.n) : null;
  if (seg && Lfull && !onlyLines) {
    const reg = seg.reg;
    const papS = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H))) : null;
    const smK = new Float32Array(reg.n);
    const rA = C.mulberry32(ctx.seed * 5 + 1);
    for (let r = 0; r < reg.n; r++) {
      smK[r] = Math.pow(1 - reg.act[r], 1.4) * (0.45 + 0.35 * (1 - reg.imp[r] * 0.5)) * (mode === "carbon" ? 1.6 : mode === "linea" ? 0.25 : mode === "mixta" ? 0.5 : 1);
      // negros expresivos: masas plenas de grafito/carbón en las zonas oscuras
      if (mode === "negros") smK[r] = 1 - reg.lum[r] > 0.5 ? 1.6 : smK[r] * 0.4;
      // dirección del rayado de la zona: sigue la forma si es clara; si no, diagonal de mano
      const th = 0.5 * Math.atan2(reg.os[r], reg.oc[r]);
      regAng[r] = reg.coh[r] > 0.45 ? th : -Math.PI / 4 + (rA() - 0.5) * 0.5;
    }
    // tono suavizado a resolución de análisis
    const tb = Float32Array.from(tone);
    C.gaussBlur(tb, aw, ah, Math.max(1, (mode === "carbon" ? 4 : 1.5) * s / ctx.fa));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const k = smK[Lfull[i]];
        if (k < 0.02) continue;
        const t = ctx.at(tb, x, y);
        const g = papS ? papS.eq(x, y) : 0.5;
        const cap = mode === "negros" && k > 1.5 ? 0.93 : mode === "carbon" ? 0.75 : 0.6;
        D[i] = Math.min(cap, t * k) * (0.72 + 0.45 * (g - 0.5) + 0.28);
      }
      if ((y & 63) === 0) await clock.tick(0);
    }
  }
  let Tr = null, Tg = null, Tb = null;
  if (colorMode) { Tr = new Float32Array(N).fill(1); Tg = new Float32Array(N).fill(1); Tb = new Float32Array(N).fill(1); }

  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const grain = C.makeGrainTile(ctx.seed + 3, "fine");
  const gsInv = 1 / Math.max(1, Math.sqrt(s) * 0.8);
  const col = new Float32Array(3), tmpc = new Float32Array(3);

  // trazos reales de grafito/carbón: los más ligeros para las primeras pasadas
  const libLight = lib ? lib.filter((m) => m.fill < 0.62) : null;
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H))) : null;
  const ts = new Float32Array(2);
  const R = lib ? (2.4 + p.grosor * 13) * s : (0.35 + p.grosor * 2.4) * s;
  const L = lib ? (14 + p.longitud * 95) * s : (10 + p.longitud * 80) * s;
  const press = 0.22 + 0.62 * p.intensidad;
  // 4 pasadas de rayado: cada una oscurece hasta un tope; "cruzado" abre el ángulo entre ellas
  const nPass = 4;
  const cz = p.cruzado;
  const angles = [0, 0.1 + 0.85 * cz, -(0.08 + 0.8 * cz), 0.05 + 0.4 * cz];
  const caps = [0.38, 0.58, 0.78, 1];
  const ths = [0, 0.3, 0.5, 0.68];
  const varH = p.varTono * 0.5, varS = p.varSat * 0.6;
  const sel = ctx.sel, selDetail = ctx.selMode === "detalle";
  const toneFloor = mode === "mixta" ? 0 : mode === "carbon" ? 0.6 : 0.35;

  const totalStages = nPass + 1;

  // ángulo para que el rayado vaya en la dirección de la zona (relativo al flujo local)
  const _fl = new Float32Array(2);
  function hatchAngle(x, y, j) {
    if (!regAng) return angles[j];
    const r = Lfull[(y | 0) * W + (x | 0)];
    ctx.flowAt(x, y, _fl);
    const phi = Math.atan2(_fl[1], _fl[0]);
    return regAng[r] - phi + angles[j];
  }

  async function hatchPass(j, isContour, alt) {
    const Rj = isContour ? (lib ? Math.max(0.45, (0.32 + p.grosor * 1.4) * s) : R * 0.85) : R * (j === 0 ? 1 : 0.92);
    const useLib = lib && !isContour;
    const pool = useLib ? (j < 2 && libLight.length ? libLight : lib) : null;
    const Rc = lib ? Math.max(0.45, (0.32 + p.grosor * 1.4) * s) : R; // contornos: línea fina
    const sketch = isContour && (mode === "boceto" || mode === "mixta");
    const sp = isContour ? Math.max(1, Rc * 3.2, sketch ? 9 * s : 0) : lib ? Math.max(1.0, R * 1.3, L * 0.16) : Math.max(1.0, R * 2.6 + 0.4 * s, L * 0.12);
    const cols = Math.ceil(W / sp), rows = Math.ceil(H / sp);
    const edgeThr = (0.42 - 0.3 * p.detalle) * (mode === "linea" || mode === "mixta" ? 0.75 : mode === "boceto" ? 0.9 : 1) * (alt ? 1.25 : 1);
    let cnt = 0, cap = 1 << 16;
    let cx = new Float32Array(cap), cy = new Float32Array(cap);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const x = (gx + rand()) * sp, y = (gy + rand()) * sp;
        if (x >= W || y >= H) continue;
        if (isContour) {
          let e = ctx.at(ctx.edgeRaw, x, y);
          if (selDetail && sel) e += ctx.at(sel, x, y) * 0.25;
          if (e < edgeThr || rand() > ctx.at(ctx.cover, x, y)) continue;
        } else {
          const t = ctx.at(tone, x, y);
          if (t <= ths[j] + 0.02) continue;
        }
        if (cnt >= cap) {
          cap *= 2;
          const nx = new Float32Array(cap); nx.set(cx); cx = nx;
          const ny = new Float32Array(cap); ny.set(cy); cy = ny;
        }
        cx[cnt] = x; cy[cnt] = y; cnt++;
      }
      if ((gy & 31) === 0) await clock.tick((j + 0.1 * gy / rows) / totalStages);
    }
    const order = new Int32Array(cnt);
    for (let i = 0; i < cnt; i++) order[i] = i;
    S.shuffle(order, cnt, rand);
    const level = ctx.levelFor(Math.max(1, R * 3));

    for (let oi = 0; oi < cnt; oi++) {
      const ci = order[oi];
      const x = cx[ci], y = cy[ci];
      const g0 = (y | 0) * W + (x | 0);
      const t = ctx.at(tone, x, y);
      let target;
      if (sketch) target = mode === "mixta" ? Math.min(0.8, t * 0.35 + 0.42) : Math.min(0.55, t * 0.25 + 0.3);
      else if (isContour) target = Math.min(1, t * 0.6 + 0.5);
      else target = Math.min(t, caps[j]);
      if (D[g0] >= target - 0.04) continue;

      ctx.colorAt(level, x, y, col);
      tmpc[0] = col[0]; tmpc[1] = col[1]; tmpc[2] = col[2];
      let lenMul = sketch ? 0.9 : isContour ? 0.45 : 1;
      if (selDetail && sel) lenMul *= 1 - 0.4 * ctx.at(sel, x, y);
      // boceto: la línea no calca el borde, va un poco al lado
      const jx = sketch ? (rand() - 0.5) * 3 * s : 0, jy = sketch ? (rand() - 0.5) * 3 * s : 0;
      S.traceStroke(ctx, path, C.clamp(x + jx, 0, W - 1), C.clamp(y + jy, 0, H - 1), {
        R: Rj, Lmax: L * lenMul * (0.55 + rand() * 0.9), step: Math.max(0.8, Rj * 2 + 1.5 * s),
        curv: isContour ? 0.95 : regAng ? 0.02 + 0.25 * p.curvatura : (j === 0 ? 0.05 + 0.9 * p.curvatura : 0.05 + 0.45 * p.curvatura),
        colorTol: isContour ? 0.45 : 0.55 - 0.25 * p.detalle, color: tmpc, level,
        angle: isContour ? 0 : hatchAngle(x, y, j) + (rand() - 0.5) * 0.1,
        minLen: Rj * 6, fine: isContour,
      });
      if (!isContour) S.wobblePath(path, useLib ? Rj * 0.12 : Rj * 0.6, Rj * (useLib ? 12 : 40), rand() * 6.28);
      else if (sketch) S.wobblePath(path, 0.8 * s, 60 * s, rand() * 6.28);
      const nP = path.n, len = path.len || 1;
      let st = null;
      if (useLib) {
        const Rr = Rj / 0.7;
        for (let i = 0; i < nP; i++) path.rs[i] = Rr * 0.9;
        st = Lib.prepare(pool[(rand() * pool.length) | 0], len, Rr, rand, 0.9);
      } else {
        for (let i = 0; i < nP; i++) {
          const u = path.ss[i] / len;
          path.rs[i] = Rj * (0.35 + 0.65 * Math.sqrt(Math.sin(Math.max(0.0001, u) * Math.PI)));
        }
      }
      const nt = raster.rasterize(path, useLib ? 0.04 : 0.4);
      if (nt === 0) continue;

      const pr = press * (isContour ? 0.75 + 0.4 * ctx.at(ctx.edgeRaw, x, y) : 0.45 + 0.4 * t) * (0.8 + rand() * 0.4);
      const lo = 1 - pr - 0.28, hi = 1 - pr + 0.12;
      let cr = 0, cg = 0, cb = 0;
      if (colorMode) {
        // lápiz de color: color de la foto, algo más saturado; los contornos más oscuros
        const y0 = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2];
        for (let c = 0; c < 3; c++) col[c] = C.clamp(y0 + (col[c] - y0) * 1.35, 0, 1);
        C.varyColor(col[0], col[1], col[2], (rand() - 0.5) * 2 * varH, (rand() - 0.5) * 2 * varS, 0, col);
        const dk = isContour ? 0.45 : 0.85;
        cr = col[0] * dk; cg = col[1] * dk; cb = col[2] * dk;
      }
      const A = raster.A, tl = raster.tl, tg = raster.tg, U = raster.U, V = raster.V;
      const prL = useLib ? pr * 0.85 : pr;
      let prC = lib && isContour ? 0.62 : 1; // contornos más ligeros sobre grafito real
      if (isContour) prC *= (mode === "linea" || mode === "mixta" ? 1.35 : mode === "negros" ? 1.5 : mode === "boceto" ? 0.5 : 1) * (alt ? 0.55 : 1) * (opts.contourMul || 1);
      for (let tt = 0; tt < nt; tt++) {
        const li = tl[tt], g = tg[tt];
        const xx = g % W, yy = (g / W) | 0;
        let a;
        if (useLib) {
          // grafito real de la muestra + el diente del papel (siempre el mismo)
          Lib.sampleAt(st, U[li], V[li], ts);
          const tooth = pap ? 0.55 + 0.45 * C.smoothstep(0.15, 0.75, pap.eqN(xx, yy)) : 1;
          a = ts[0] * A[li] * prL * tooth;
          // el rayado no ensucia el blanco: se aclara donde la foto es clara
          if (a > 0.003) { const tl0 = ctx.at(tone, xx, yy); a *= toneFloor + (1 - toneFloor) * C.smoothstep(0.02, 0.14, tl0); }
        } else {
          const gr = pap ? pap.eq(xx, yy) : C.tileAt(grain, xx * gsInv, yy * gsInv);
          const dep = 0.22 + 0.78 * C.smoothstep(lo, hi, gr);
          a = A[li] * dep * pr * prC;
        }
        if (a < 0.003) continue;
        if (colorMode) {
          const tr = 1 - a * (1 - cr), tgv = 1 - a * (1 - cg), tb = 1 - a * (1 - cb);
          Tr[g] *= tr; Tg[g] *= tgv; Tb[g] *= tb;
          D[g] = 1 - (0.299 * Tr[g] + 0.587 * Tg[g] + 0.114 * Tb[g]);
        } else {
          D[g] += a * (1 - D[g]) * 0.7;
        }
      }
      raster.clear();
      if ((oi & 31) === 0) await clock.tick((j + 0.1 + 0.9 * oi / cnt) / totalStages);
    }
  }

  // qué pasadas de rayado lleva cada variante
  const passes = onlyLines ? [] : mode === "linea" ? [2, 3] : mode === "negros" ? [0, 1] : mode === "mixta" ? [0, 1] : [0, 1, 2, 3];
  for (const j of passes) await hatchPass(j, false);
  if (mode === "carbon" && !onlyLines) {
    // difuminado con el dedo o el trapo y luces sacadas con goma
    const tmp = new Float32Array(N), bD = Float32Array.from(D);
    const rb = Math.max(1, Math.round(3 * s));
    C.boxBlurH(bD, tmp, W, H, rb); C.boxBlurV(tmp, bD, W, H, rb);
    for (let i = 0; i < N; i++) D[i] = D[i] * 0.45 + bD[i] * 0.55;
    const ovc = ctx.assets && ctx.assets.ov_carbon && ctx.assets.ov_carbon.items.length ? K.overlaySampler(ctx.assets.ov_carbon.items[0], W, H) : null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const l = ctx.at(ctx.lum, x, y);
      D[i] *= 1 - 0.75 * C.smoothstep(0.68, 0.9, l);
      if (ovc) D[i] *= 0.85 + 0.3 * (ovc(x, y) < 0.5 ? 0.5 + (0.5 - ovc(x, y)) : 0.5);
    }
  }
  if (!noLines && p.detalle > 0.02) {
    await hatchPass(nPass, true);
    // líneas de búsqueda: una segunda pasada de contorno más ligera y desplazada
    if (mode === "linea" || mode === "boceto" || mode === "mixta") await hatchPass(nPass, true, 1);
  }

  /* ----- salida ----- */
  const out = new Uint8Array(N * 4);
  const selFull = ctx.selFull, data = ctx.data, comp = ctx.comp, srcA = ctx.srcAlpha;
  const gr0 = 0.12, gg0 = 0.12, gb0 = 0.14; // grafito
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    let a, r, g, b;
    if (colorMode) {
      const tr = Tr[i], tgv = Tg[i], tb = Tb[i];
      a = Math.max(1 - tr, 1 - tgv, 1 - tb);
      if (a < 0.004) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 0; continue; }
      r = 1 - (1 - tr) / a; g = 1 - (1 - tgv) / a; b = 1 - (1 - tb) / a;
    } else {
      a = D[i];
      if (a < 0.004) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 0; continue; }
      r = gr0; g = gg0; b = gb0;
    }
    if (selFull) a *= selFull[i] / 255;
    if (srcA) a *= data[i * comp + 3] / 255;
    out[o] = C.clamp(r, 0, 1) * 255 + 0.5 | 0;
    out[o + 1] = C.clamp(g, 0, 1) * 255 + 0.5 | 0;
    out[o + 2] = C.clamp(b, 0, 1) * 255 + 0.5 | 0;
    out[o + 3] = C.clamp(a, 0, 1) * 255 + 0.5 | 0;
    if ((i & 0x3ffff) === 0) await clock.tick(nPass / totalStages);
  }
  return out;
}

module.exports = { paint };
