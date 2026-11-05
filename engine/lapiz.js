"use strict";
/*
 * Trazo · Lápiz (dibujo a mano: garabatos que siguen el volumen)
 *
 * Cómo dibuja una persona con lápiz (ver el dibujo de la esfera de referencia):
 *  · El tono se construye SOLO con trazos superpuestos: no hay un gris de fondo.
 *    Donde la foto es clara, papel; donde es oscura, más pasadas y más presión.
 *  · Los trazos van en grupos de líneas casi paralelas (garabatos de ida y vuelta,
 *    a veces con la vuelta en bucle) y SIGUEN EL VOLUMEN: su dirección sale de la
 *    estructura de la foto y se propaga a las zonas lisas, así rodean las formas.
 *  · Cada línea es una lente: entra fina y suave, aprieta en el centro y sale fina.
 *    La presión también sigue al tono de debajo (se aligera al pasar por una luz).
 *  · En las sombras más hondas se cruzan capas con ángulos algo distintos.
 *  · El grafito se queda en el diente del papel: el grano es el REAL de los
 *    escaneos (TEXTURES/TRAZOS/LAPIZ, a su escala física) junto con el del papel.
 *  · Contornos: muy pocos, finísimos y rotos, solo en los bordes más marcados.
 * Variantes: línea suelta, rayado, carboncillo y negros expresivos.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");
const Seg = require("./segment.js");

/* ---------- filtro que conserva bordes (un canal) ---------- */
function dtFilter1(I0, w, h, sigmaS, sigmaR, iters) {
  const n = w * h, I = Float32Array.from(I0), ratio = sigmaS / sigmaR;
  const dH = new Uint16Array(n), dV = new Uint16Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x > 0) dH[i] = Math.min(769, (Math.abs(I0[i] - I0[i - 1]) * 768 + 0.5) | 0);
    if (y > 0) dV[i] = Math.min(769, (Math.abs(I0[i] - I0[i - w]) * 768 + 0.5) | 0);
  }
  const tab = new Float32Array(770);
  for (let it = 0; it < iters; it++) {
    const sH = sigmaS * Math.sqrt(3) * Math.pow(2, iters - (it + 1)) / Math.sqrt(Math.pow(4, iters) - 1);
    const la = -Math.SQRT2 / Math.max(0.05, sH);
    for (let j = 0; j < 770; j++) tab[j] = Math.exp(la * (1 + ratio * j / 256));
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 1; x < w; x++) { const i = row + x; I[i] += tab[dH[i]] * (I[i - 1] - I[i]); }
      for (let x = w - 2; x >= 0; x--) { const i = row + x; I[i] += tab[dH[i + 1]] * (I[i + 1] - I[i]); }
    }
    for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; I[i] += tab[dV[i]] * (I[i - w] - I[i]); }
    for (let y = h - 2; y >= 0; y--) for (let x = 0; x < w; x++) { const i = y * w + x; I[i] += tab[dV[i + w]] * (I[i + w] - I[i]); }
  }
  return I;
}

/* ---------- variantes ---------- */
function config(p) {
  const m = p.modo;
  const c = {
    lwK: 0.0024 + 0.0032 * p.grosor,       // ancho de la línea (fracción del lado largo)
    lenK: 0.045 + 0.1 * p.longitud,        // largo de cada garabato (fracción del lado largo)
    kappa: 0.5 + 0.18 * p.intensidad,      // oscuridad de una pasada firme
    // capas: desde qué tono empiezan, hasta qué oscuridad llegan y cuánto giran
    levels: [
      { t: 0.04, cap: 0.24, rot: 0 },
      { t: 0.22, cap: 0.42, rot: 0.1 },
      { t: 0.4, cap: 0.57, rot: -0.2 },
      { t: 0.56, cap: 0.7, rot: 0.32 },
      { t: 0.7, cap: 0.82, rot: -0.5 },
    ],
    crossK: 0.35 + 0.9 * p.cruzado, curvK: 0.12 + 0.4 * p.curvatura, hook: 0.45,
    edgeP: 0.12 + 0.25 * p.detalle, edgeThr: 0.5, focusK: 0.38, edgeLW: 0.22, edgePr: 0.42,
    base: 0.26, lc: 0.6, lcFine: 1.1, comp: 0.84, adapt: 0.38, fineK: 1, gamma: 0.92, dMax: 0.9, charcoal: false, smudge: 0, white: 0.03, detailK: 0.6,
  };
  if (m === "linea") Object.assign(c, { base: 0.16, fineK: 0.7, levels: c.levels.slice(0, 3).map((l, i) => Object.assign({}, l, { cap: [0.22, 0.36, 0.48][i] })), edgeP: 0.55 + 0.4 * p.detalle, edgeThr: 0.3, edgePr: 0.55, lenK: c.lenK * 1.15, hook: 0.25 });
  if (m === "carbon") Object.assign(c, { base: 0.36, fineK: 0.8, lwK: c.lwK * 2.2, lenK: c.lenK * 1.1, kappa: 0.66 + 0.15 * p.intensidad, charcoal: true, smudge: 0.5, dMax: 0.97, edgeLW: 0.35, edgePr: 0.5, gamma: 0.9, hook: 0.3 });
  if (m === "negros") Object.assign(c, { adapt: 0.25, kappa: c.kappa + 0.08, gamma: 0.85, lc: 0.8, crossK: c.crossK * 1.25, levels: c.levels.map((l) => Object.assign({}, l, { cap: Math.min(0.95, l.cap + 0.06) })).concat([{ t: 0.82, cap: 0.93, rot: 1.05 }]) });
  // realismo: alto = más capas finas, trazos más cortos y más contornos; bajo = garabato grande y suelto
  const d = (p.realismo === undefined ? 0.5 : p.realismo) - 0.5;
  c.lenK *= 1 - d * 0.7;
  c.lwK *= 1 - d * 0.35;
  c.simp = C.clamp(0.3 - d * 0.8, 0, 0.8);
  c.detailK *= 1 + d;
  c.fine = d > -0.2;                 // pasada final de detalle
  c.fineK *= C.clamp(1 + d * 1.2, 0.3, 1.6);
  c.edgeP *= 1 + d * 0.8;
  c.focusK *= 1 - d * 0.8;
  return c;
}

async function paint(ctx, p, clock, seg, Lfull) {
  const { W, H, N, s, data, comp } = ctx;
  const cfg = config(p);
  const rand = C.mulberry32(ctx.seed * 13 + 3);
  const gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += rand(); return (u - 2) * 1.732; };
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H), ctx.physMM)) : null;

  /* --- 1) TONO objetivo (oscuridad 0..1) a resolución completa --- */
  const I = new Float32Array(N);
  for (let i = 0; i < N; i++) { const o = i * comp; I[i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255; }
  const lw0 = Math.min(1, 1400 / Math.max(W, H));
  const ww = Math.max(8, Math.round(W * lw0)), wh = Math.max(8, Math.round(H * lw0));
  const Iw = ww === W && wh === H ? Float32Array.from(I) : C.resample(I, W, H, ww, wh);
  if (cfg.simp > 0.02) {
    const Is = dtFilter1(Iw, ww, wh, 12 * Math.max(ww, wh) / 1000, 0.12, 2);
    for (let i = 0; i < Iw.length; i++) Iw[i] += (Is[i] - Iw[i]) * cfg.simp;
  }
  await clock.tick(0.05);
  // como un dibujante: la escala de valores se adapta al motivo. Se estira el rango de la
  // foto y se comprime el tono a gran escala (una cara oscura no se dibuja negra: se dibuja
  // en medios tonos y se reservan los negros para lo más hondo), sin tocar el detalle local
  {
    const lo = C.percentile(Iw, 0.01), hi = C.percentile(Iw, 0.995);
    const k = 1 / Math.max(0.15, hi - lo);
    for (let i = 0; i < Iw.length; i++) Iw[i] = C.clamp((Iw[i] - lo) * k, 0, 1);
    const BL = Float32Array.from(Iw), tmp = new Float32Array(BL.length);
    C.gaussBlur(BL, ww, wh, Math.max(4, 0.045 * Math.max(ww, wh)), tmp);
    for (let i = 0; i < Iw.length; i++) Iw[i] = C.clamp(Iw[i] + (0.6 - BL[i]) * cfg.adapt, 0, 1);
  }
  // contraste local (los volúmenes se leen mejor) y curva de un dibujo a lápiz
  const B = Float32Array.from(Iw);
  { const tmp = new Float32Array(B.length); C.gaussBlur(B, ww, wh, Math.max(2, 9 * Math.max(ww, wh) / 1000), tmp); }
  const Bs = Float32Array.from(Iw);
  { const tmp = new Float32Array(Bs.length); C.gaussBlur(Bs, ww, wh, Math.max(1, 2.2 * Math.max(ww, wh) / 1000), tmp); }
  const lift = (1 - p.cobertura) * 0.35;
  const Tw = new Float32Array(ww * wh), Tdw = new Float32Array(ww * wh);
  const toneOf = (v) => {
    let d = 1 - (v < 0 ? 0 : v > 1 ? 1 : v);
    d = C.smoothstep(cfg.white, 0.97, d);
    d = Math.pow(d, cfg.gamma) * cfg.comp;              // los oscuros no se cierran del todo
    return Math.max(0, (d - lift) / (1 - lift));
  };
  for (let i = 0; i < Tw.length; i++) {
    // tono principal: volúmenes (contraste local medio), sin el detalle fino
    Tw[i] = toneOf(Bs[i] + (Bs[i] - B[i]) * cfg.lc);
    // tono de detalle: rasgos y bordes finos realzados (ojos, labios, nariz, mechones)
    Tdw[i] = toneOf(Iw[i] + (Iw[i] - B[i]) * cfg.lc + (Iw[i] - Bs[i]) * cfg.lcFine);
  }
  if (seg && cfg.focusK > 0) {
    // el fondo (lo poco importante) se deja más claro y suelto; el tono fuerte va al motivo
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const im = ctx.at(seg.imp, (x + 0.5) * W / ww - 0.5, (y + 0.5) * H / wh - 0.5);
      const k = cfg.focusK * Math.pow(1 - C.clamp(im, 0, 1), 1.4);
      Tw[y * ww + x] *= 1 - k; Tdw[y * ww + x] *= 1 - k;
    }
  }
  // a resolución completa (se consulta en cada píxel de cada trazo)
  const Tf = new Uint8Array(N), Td = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const ay = (y + 0.5) * wh / H - 0.5;
    for (let x = 0; x < W; x++) {
      const axx = (x + 0.5) * ww / W - 0.5;
      Tf[y * W + x] = (C.bilinear(Tw, ww, wh, axx, ay) * 255 + 0.5) | 0;
      Td[y * W + x] = (C.clamp(C.bilinear(Tdw, ww, wh, axx, ay), 0, 1) * 255 + 0.5) | 0;
    }
    if ((y & 63) === 0) await clock.tick(0.05 + 0.05 * y / H);
  }

  /* --- 2) grano real (escaneos) y diente del papel --- */
  const gl = ctx.assets && ctx.assets.grano_grafito && ctx.assets.grano_grafito.items;
  let strips = gl ? gl.filter((it) => it.tags[0] === (cfg.charcoal ? "carbon" : "lapiz")) : [];
  if (!strips.length && gl) strips = gl;
  strips = strips.map((it) => {
    const P = it.planes[0];
    const y0 = Math.round(P.h * 0.1), y1 = Math.round(P.h * 0.92);
    return { d: P.data, w: P.w, h: P.h, y0, hh: y1 - y0 };
  });
  const tooth = new Uint8Array(N);
  {
    const gt = pap ? null : C.makeGrainTile(ctx.seed + 3, "tooth"), gInv = 1 / Math.max(1, Math.sqrt(s) * 0.9);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) tooth[y * W + x] = ((pap ? pap.eqN(x, y) : C.tileAt(gt, x * gInv, y * gInv)) * 255 + 0.5) | 0;
      if ((y & 63) === 0) await clock.tick(0.1 + 0.04 * y / H);
    }
  }

  /* --- 3) una línea de lápiz --- */
  const Tr = new Float32Array(N).fill(1);
  if (cfg.base > 0) {
    // tono de base: grafito difuminado con el difumino (se queda algo más en los picos del papel)
    for (let i = 0; i < N; i++) {
      const t = Tf[i] / 255;
      if (t < 0.03) continue;
      Tr[i] = 1 - cfg.base * Math.pow(t, 1.15) * (0.7 + 0.3 * tooth[i] / 255);
    }
  }
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const kap = cfg.kappa;
  let TT = Tf, flowFine = false;     // tono que siguen los trazos y campo de direcciones (fino o suave)
  function drawLine(xs, ys, n, lw, pBase, tk, tcap) {
    if (n < 2) return;
    path.n = n;
    let sl = 0; path.ss[0] = 0;
    for (let i = 0; i < n; i++) {
      path.xs[i] = xs[i]; path.ys[i] = ys[i];
      if (i) { const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1]; sl += Math.sqrt(dx * dx + dy * dy); path.ss[i] = sl; }
    }
    path.len = sl;
    if (sl < 1) return;
    // lente: fina en las puntas, llena en el centro
    for (let i = 0; i < n; i++) { const u = path.ss[i] / sl; path.rs[i] = lw * 0.5 * (0.42 + 0.58 * Math.pow(Math.sin(Math.PI * u), 0.55)); }
    const nt = raster.rasterize(path, 0.3);
    if (!nt) return;
    const st = strips.length ? strips[(rand() * strips.length) | 0] : null;
    const sx0 = st ? rand() * st.w : 0, sy0 = st ? rand() * st.hh : 0;
    const half = lw * 0.5;
    const ktg = C.clamp(17 / lw, 0.45, 4);      // grano ≈ 1/5 del ancho de la línea
    const pv0 = 0.85 + 0.3 * rand();
    const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
    const tkLo = tk - 0.04, tInv = 1 / Math.max(0.05, (tcap === undefined ? tk + 0.2 : tcap) - tkLo);
    for (let t = 0; t < nt; t++) {
      const li = tl[t], g = tg[t];
      const u = U[li], v = V[li];
      const uc = u < 0 ? 0 : u > 1 ? 1 : u;
      // la presión: entra suave, aprieta en el centro, sale suave; menos en los bordes de la línea
      let pr = pBase * (0.22 + 0.78 * Math.pow(Math.sin(Math.PI * uc), 0.7)) * (1 - 0.45 * v * v) * pv0 * A[li];
      // y sigue al tono de debajo: más presión donde la foto es más oscura (dentro de esta capa)
      const tv = TT[g] / 255;
      if (tv <= tkLo) continue;
      const fT = (tv - tkLo) * tInv;
      pr *= fT >= 1 ? 1 : Math.pow(fT, 0.85);
      if (pr < 0.015) continue;
      // grano: el del escaneo (a lo largo del trazo) y el diente del papel
      let gs = 0.5;
      if (st) {
        let ax = sx0 + v * half * ktg, ay = sy0 + uc * sl * ktg * 0.7;
        ax = ax % (2 * st.w); if (ax < 0) ax += 2 * st.w; if (ax >= st.w) ax = 2 * st.w - 1 - ax;
        ay = ay % (2 * st.hh); if (ay >= st.hh) ay = 2 * st.hh - 1 - ay;
        gs = st.d[(st.y0 + (ay | 0)) * st.w + (ax | 0)] / 255;
      }
      const gg = 0.6 * gs + 0.4 * (tooth[g] / 255);
      // grano: con poca presión el grafito solo agarra en los picos (moteado);
      // con mucha, la línea es casi llena y el grano apenas se nota
      const pc = pr > 1 ? 1 : pr;
      const gAmt = 0.78 - 0.42 * pc;
      const cov = 1 - gAmt * C.smoothstep(0.62, 0.05, gg);
      const a = Math.pow(pc, 0.75) * cov * kap;
      if (a > 0.002) Tr[g] *= 1 - a;
    }
    raster.clear();
  }

  /* --- 4) dirección: la de la forma (estructura de la foto, propagada) --- */
  const f = new Float32Array(2);
  const clx = new Float32Array(4200), cly = new Float32Array(4200), cnx = new Float32Array(4200), cny = new Float32Array(4200);
  const bx = new Float32Array(2100), by = new Float32Array(2100);
  const px = new Float32Array(4200), py = new Float32Array(4200);
  /** línea central del garabato: sigue el campo de direcciones en los dos sentidos */
  function centerLine(x0, y0, L, step, rot) {
    const ca = Math.cos(rot), sa = Math.sin(rot);
    let nf = 0, nb = 0;
    for (const sign of [1, -1]) {
      ctx.flowAt(x0, y0, f, flowFine);
      let dx = f[0] * ca - f[1] * sa, dy = f[0] * sa + f[1] * ca;
      if (sign < 0) { dx = -dx; dy = -dy; }
      let x = x0, y = y0, len = 0, k = 0;
      const ox = sign > 0 ? clx : bx, oy = sign > 0 ? cly : by;
      const budget = L * 0.5;
      while (len < budget && k < 2000) {
        ctx.flowAt(x, y, f, flowFine);
        let fx = f[0] * ca - f[1] * sa, fy = f[0] * sa + f[1] * ca;
        if (fx * dx + fy * dy < 0) { fx = -fx; fy = -fy; }
        let nx = dx + (fx - dx) * cfg.curvK, ny = dy + (fy - dy) * cfg.curvK;
        const m = Math.sqrt(nx * nx + ny * ny) || 1; nx /= m; ny /= m;
        x += nx * step; y += ny * step; len += step; dx = nx; dy = ny;
        if (x < -L || y < -L || x > W + L || y > H + L) break;
        ox[k] = x; oy[k] = y; k++;
      }
      if (sign > 0) nf = k; else nb = k;
    }
    // ensamblar: atrás invertido + inicio + adelante, y normales
    let n = 0;
    for (let i = nb - 1; i >= 0; i--) { px[n] = bx[i]; py[n] = by[i]; n++; }
    px[n] = x0; py[n] = y0; n++;
    for (let i = 0; i < nf; i++) { px[n] = clx[i]; py[n] = cly[i]; n++; }
    for (let i = 0; i < n; i++) {
      clx[i] = px[i]; cly[i] = py[i];
      const a = i > 0 ? i - 1 : 0, b = i < n - 1 ? i + 1 : n - 1;
      const ddx = px[b] - px[a], ddy = py[b] - py[a];
      const m = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      cnx[i] = -ddy / m; cny[i] = ddx / m;
    }
    return n;
  }
  const lx = new Float32Array(4300), ly = new Float32Array(4300);
  /** un garabato: m pasadas casi paralelas a lo largo de la línea central */
  function scribble(x0, y0, L, lw, gap, m, pBase, tk, rot, hooks, tcap) {
    const step = Math.max(1.2, lw * 1.2);
    const n = centerLine(x0, y0, L, step, rot);
    if (n < 3) return false;
    if (tcap !== undefined) {
      // ¿falta tono a lo largo del garabato? (si ya está, no se repasa)
      let def = 0, cnt = 0;
      for (let i = 0; i < n; i += Math.max(1, (n / 9) | 0)) {
        const xi = C.clamp(clx[i] | 0, 0, W - 1), yi = C.clamp(cly[i] | 0, 0, H - 1), g = yi * W + xi;
        const tv = TT[g] / 255;
        def += Math.min(tv, tcap) - (1 - Tr[g]); cnt++;
      }
      if (def / cnt < 0.06) return false;
    }
    const sag = (rand() - 0.5) * 0.12 * L;          // arco de la muñeca
    for (let j = 0; j < m; j++) {
      const off = (j - (m - 1) / 2) * gap + gauss() * gap * 0.18;
      // las pasadas no empiezan ni acaban a la vez
      const i0 = Math.floor(rand() * 0.22 * n), i1 = n - 1 - Math.floor(rand() * 0.22 * n);
      if (i1 - i0 < 3) continue;
      let k = 0;
      for (let i = i0; i <= i1; i++) {
        const uu = (i - i0) / (i1 - i0);
        const o = off + sag * 4 * uu * (1 - uu) + (rand() - 0.5) * lw * 0.15;
        lx[k] = clx[i] + cnx[i] * o; ly[k] = cly[i] + cny[i] * o; k++;
      }
      if (hooks && j < m - 1) {
        // vuelta en bucle hacia la siguiente pasada
        const e = i1, dirx = clx[e] - clx[e - 1], diry = cly[e] - cly[e - 1];
        const dm = Math.sqrt(dirx * dirx + diry * diry) || 1, tx = dirx / dm, ty = diry / dm;
        const r = gap * 0.5, ex = lx[k - 1], ey = ly[k - 1];
        for (let q = 1; q <= 5; q++) {
          const ph = q / 5 * Math.PI * 0.75;
          lx[k] = ex + tx * r * Math.sin(ph) + cnx[e] * r * (1 - Math.cos(ph)); ly[k] = ey + ty * r * Math.sin(ph) + cny[e] * r * (1 - Math.cos(ph)); k++;
        }
      }
      // de ida o de vuelta (el trazo alterna)
      if (j & 1) { for (let a = 0, b = k - 1; a < b; a++, b--) { let t = lx[a]; lx[a] = lx[b]; lx[b] = t; t = ly[a]; ly[a] = ly[b]; ly[b] = t; } }
      drawLine(lx, ly, k, lw * (0.85 + 0.3 * rand()), pBase * (0.8 + 0.4 * rand()), tk, tcap);
    }
    return true;
  }

  /* --- 5) capas de garabatos, de claro a oscuro --- */
  const longS = Math.max(W, H);
  const lw0p = Math.max(1.2, cfg.lwK * longS);
  const L0 = cfg.lenK * longS;
  const levels = cfg.levels;
  const dAt = (x, y) => { const xi = C.clamp(x | 0, 0, W - 1), yi = C.clamp(y | 0, 0, H - 1); return 1 - Tr[yi * W + xi]; };
  for (let k = 0; k < levels.length; k++) {
    const lv = levels[k];
    const rot = lv.rot * cfg.crossK;
    const gapK = 1.0 - 0.08 * k;
    const sp = Math.max(lw0p * 3, L0 * 0.32);
    const cols = Math.ceil(W / sp), rows = Math.ceil(H / sp);
    const cand = [];
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) cand.push((gx + rand()) * sp, (gy + rand()) * sp);
    const nc = cand.length / 2, order = new Int32Array(nc);
    for (let i = 0; i < nc; i++) order[i] = i;
    S.shuffle(order, nc, rand);
    for (let oi = 0; oi < nc; oi++) {
      const x = Math.min(W - 1, cand[order[oi] * 2]), y = Math.min(H - 1, cand[order[oi] * 2 + 1]);
      const Tc = Tf[(y | 0) * W + (x | 0)] / 255;
      if (Tc < lv.t + 0.03) continue;
      const need = Math.min(Tc, lv.cap);
      const cur = dAt(x, y);
      if (cur >= need - 0.04) continue;
      // detalle: trazos más cortos y finos en los bordes y en lo importante
      const ed = ctx.at(ctx.edge, x, y), im = seg ? ctx.at(seg.imp, x, y) : 0.5;
      const det = C.clamp(cfg.detailK * (0.6 * ed + 0.6 * im), 0, 0.82);
      const L = L0 * (1 - det) * Math.exp(0.32 * gauss()) * (1 - 0.06 * k);
      const lw = lw0p * (1 - 0.4 * det) * (0.85 + 0.3 * rand());
      const gap = lw * (1.05 + 0.9 * rand()) * gapK;
      const m = 3 + ((rand() * 7) | 0);
      const pBase = 0.85 + 0.3 * rand();
      scribble(x, y, L, lw, gap, m, pBase, lv.t, rot + gauss() * 0.06, rand() < cfg.hook, lv.cap);
      if ((oi & 31) === 0) await clock.tick(0.14 + 0.66 * (k + oi / nc) / levels.length);
    }
  }

  /* --- 6) detalle fino ENCIMA: líneas finas y cortas que dibujan los rasgos ---
   * Sigue el tono de detalle (rasgos realzados) y el campo de direcciones fino; se
   * concentra donde la foto tiene detalle y en lo importante. Donde el dibujo quedó
   * más oscuro que la foto (luces dentro de lo oscuro), una goma saca el grafito. */
  if (cfg.fine) {
    TT = Td; flowFine = true;
    const lwF = Math.max(1, lw0p * 0.45), LF = L0 * 0.32;
    const sp = Math.max(lwF * 3.2, LF * 0.34);
    const cols = Math.ceil(W / sp), rows = Math.ceil(H / sp);
    const erase = [];
    for (let pass = 0; pass < 2; pass++) {
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const x = Math.min(W - 1, (gx + rand()) * sp), y = Math.min(H - 1, (gy + rand()) * sp);
          const ed = ctx.at(ctx.edgeRaw, x, y), im = seg ? ctx.at(seg.imp, x, y) : 0.5;
          // el detalle fino va a lo importante; en el fondo apenas (sin rizos en el follaje)
          const want = cfg.fineK * (0.06 + 0.9 * ed * C.smoothstep(0.25, 0.7, im) + 0.4 * im);
          if (rand() > want) continue;
          const g = (y | 0) * W + (x | 0);
          const tD = Td[g] / 255, cur = 1 - Tr[g];
          if (tD - cur > 0.07) {
            scribble(x, y, LF * (0.6 + 0.8 * rand()), lwF * (0.8 + 0.4 * rand()), lwF * (1.3 + 0.8 * rand()), 2 + ((rand() * 4) | 0),
              0.95, Math.max(0, tD - 0.4), gauss() * 0.12, false, tD);
          } else if (pass === 0 && cur - tD > 0.16) erase.push(x, y, cur - tD);
        }
        if ((gy & 15) === 0) await clock.tick(0.8 + 0.03 * (pass + gy / rows));
      }
    }
    // goma: trazos cortos que levantan grafito hacia el tono de la foto (con grano: el papel retiene algo)
    for (let e = 0; e < erase.length; e += 3) {
      const x0 = erase[e], y0 = erase[e + 1];
      const n = centerLine(x0, y0, LF * (0.4 + 0.5 * rand()), Math.max(1.2, lwF), gauss() * 0.1);
      if (n < 2) continue;
      for (let i = 0; i < n; i++) { path.xs[i] = clx[i]; path.ys[i] = cly[i]; path.rs[i] = lwF * (0.6 + 0.5 * rand()); }
      path.n = n;
      let sl = 0; path.ss[0] = 0;
      for (let i = 1; i < n; i++) { sl += Math.hypot(path.xs[i] - path.xs[i - 1], path.ys[i] - path.ys[i - 1]); path.ss[i] = sl; }
      path.len = sl;
      const nt = raster.rasterize(path, 0.4);
      const A = raster.A, U = raster.U, tl = raster.tl, tg = raster.tg;
      for (let t = 0; t < nt; t++) {
        const g = tg[t];
        const uc = Math.min(1, Math.max(0, U[tl[t]]));
        const cur = 1 - Tr[g], tD = Td[g] / 255;
        if (cur <= tD) continue;
        const k = A[tl[t]] * (0.35 + 0.65 * Math.sin(Math.PI * uc)) * (0.45 + 0.55 * tooth[g] / 255) * 0.85;
        Tr[g] = 1 - (cur - (cur - tD) * k);
      }
      raster.clear();
    }
    TT = Tf; flowFine = false;
  }

  /* --- 7) contornos: muy pocos, finísimos y rotos --- */
  if (seg && cfg.edgeP > 0.01) {
    const reg = seg.reg, lab = reg.lab, fa = 1 / ctx.ax;
    const chains = Seg.boundaryChains(seg, 8);
    const elw = Math.max(0.9, cfg.edgeLW * lw0p / 0.55);
    for (let ci = 0; ci < chains.length; ci++) {
      const ch = chains[ci];
      const r = ch.r, q = ch.q;
      const d0 = lab[r * 3] - lab[q * 3], d1 = lab[r * 3 + 1] - lab[q * 3 + 1], d2 = lab[r * 3 + 2] - lab[q * 3 + 2];
      const contrast = Math.min(1, Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2) / 45);
      let es = 0;
      for (let k = 0; k < ch.n; k += 2) es += ctx.edgeRaw[Math.min(seg.ah - 1, ch.ys[k] | 0) * seg.aw + Math.min(seg.aw - 1, ch.xs[k] | 0)];
      es /= Math.max(1, Math.ceil(ch.n / 2));
      const score = contrast * 0.6 + es * 0.6 + 0.25 * (reg.imp[r] - 0.5);
      if (score < cfg.edgeThr || rand() > cfg.edgeP * C.smoothstep(cfg.edgeThr, cfg.edgeThr + 0.3, score)) continue;
      // suavizar la cadena (sin escalones)
      const m = ch.n, sx = new Float32Array(m), sy = new Float32Array(m), wN = 4;
      for (let k = 0; k < m; k++) {
        let ax = 0, ay = 0, c = 0;
        for (let q2 = -wN; q2 <= wN; q2++) { const j2 = Math.min(m - 1, Math.max(0, k + q2)); ax += ch.xs[j2]; ay += ch.ys[j2]; c++; }
        sx[k] = ax / c * fa; sy[k] = ay / c * fa;
      }
      // tramos sueltos con huecos y alguna punta que se pasa
      let i = (rand() * 3) | 0;
      while (i < m - 2) {
        const segL = longS * (0.02 + 0.07 * rand());
        let acc = 0, k = 0, j = i;
        for (; j < m && acc < segL && k < 4000; j++) {
          lx[k] = sx[j] + (rand() - 0.5) * 0.3; ly[k] = sy[j] + (rand() - 0.5) * 0.3;
          if (k) acc += Math.hypot(lx[k] - lx[k - 1], ly[k] - ly[k - 1]);
          k++;
        }
        if (k > 2 && acc > longS * 0.006) {
          const ex = lx[k - 1] - lx[k - 2], ey = ly[k - 1] - ly[k - 2], el = Math.hypot(ex, ey) || 1, ov = longS * 0.006 * rand();
          lx[k] = lx[k - 1] + ex / el * ov; ly[k] = ly[k - 1] + ey / el * ov; k++;
          drawLine(lx, ly, k, elw * (0.8 + 0.4 * rand()), cfg.edgePr * (0.6 + 0.6 * score), -1, 0);
        }
        i = j + 1 + ((rand() * longS * 0.012 / Math.max(1, fa)) | 0);
      }
      if ((ci & 31) === 0) await clock.tick(0.86 + 0.06 * ci / chains.length);
    }
  }

  /* --- 8) carboncillo: difuminado con el dedo en zonas --- */
  if (cfg.smudge > 0) {
    const b = Float32Array.from(Tr), tmp = new Float32Array(N);
    C.gaussBlur(b, W, H, Math.max(1.5, lw0p * 0.5), tmp);
    const gw = Math.max(4, Math.ceil(W / 40)), gh = Math.max(4, Math.ceil(H / 40));
    const nz = C.fbmGrid(gw, gh, Math.max(2, gw / 6), 3, ctx.seed + 91, 0.55);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = cfg.smudge * C.smoothstep(0.4, 0.62, C.bilinear(nz, gw, gh, x / 40, y / 40));
      if (k > 0.01) Tr[i] += (b[i] - Tr[i]) * k;
    }
  }
  await clock.tick(0.94);

  /* --- 9) salida: grafito (nunca negro, brilla donde está cargado) o carbón mate --- */
  const out = new Uint8Array(N * 4);
  const selFull = ctx.selFull, srcA = ctx.srcAlpha;
  const charcoal = cfg.charcoal;
  const gr0 = charcoal ? 0.07 : 0.16, gg0 = charcoal ? 0.065 : 0.165, gb0 = charcoal ? 0.06 : 0.19;
  for (let i = 0; i < N; i++) {
    const o = 1 - Tr[i];
    const q = i * 4;
    if (o < 0.004) { out[q] = out[q + 1] = out[q + 2] = 255; out[q + 3] = 0; continue; }
    let a = o > cfg.dMax ? cfg.dMax + (o - cfg.dMax) * 0.15 : o;
    let r = gr0, g = gg0, b = gb0;
    if (!charcoal && o > 0.62) {
      const sh = C.smoothstep(0.62, 0.98, o) * 0.3;
      r += (0.3 - r) * sh; g += (0.31 - g) * sh; b += (0.35 - b) * sh;
    }
    if (selFull) a *= selFull[i] / 255;
    if (srcA) a *= data[i * comp + 3] / 255;
    out[q] = (r * 255 + 0.5) | 0; out[q + 1] = (g * 255 + 0.5) | 0; out[q + 2] = (b * 255 + 0.5) | 0;
    out[q + 3] = a <= 0 ? 0 : a >= 1 ? 255 : (a * 255 + 0.5) | 0;
  }
  return out;
}

module.exports = { paint };
