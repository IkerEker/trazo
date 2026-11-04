"use strict";
/*
 * Trazo · Rotuladores
 *
 * El rotulador no pinta manchas: pinta BANDAS de ancho fijo (la punta no cambia).
 * Cada zona se rellena con pasadas paralelas en la dirección de la mano; cada
 * pasada se multiplica sobre la anterior, así que donde se solapan aparecen las
 * vetas oscuras. Las zonas oscuras reciben una 2.ª y 3.ª pasada (a veces
 * cruzada). Mucho blanco del papel. Encima, la línea de fineliner.
 * Variantes: moda (alcohol + línea negra), vetas de alcohol, acuarelables
 * (borde con charco de tinta, agua que funde) y línea con relleno parcial.
 * Exporta las herramientas de banda y de línea para la técnica mixta.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");
const Seg = require("./segment.js");
const K = require("./kit.js");

const VK = 0.9;

function setPath(path, xs, ys, n) {
  path.n = n;
  let sl = 0; path.ss[0] = 0;
  for (let i = 0; i < n; i++) {
    path.xs[i] = xs[i]; path.ys[i] = ys[i];
    if (i) { const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1]; sl += Math.sqrt(dx * dx + dy * dy); path.ss[i] = sl; }
  }
  path.len = sl;
  return sl;
}

/**
 * Segmentos de banda que recorren la mancha r con ángulo th y separación sp (px de salida).
 * keep(ax, ay) opcional: el punto de análisis entra en esta pasada.
 * Devuelve [[x0,y0,x1,y1], ...] en px de salida.
 */
function scanBands(ctx, seg, r, th, sp, minLen, keep, rand) {
  const { aw, ah, labels } = seg;
  const fa = 1 / ctx.ax;
  const tx = Math.cos(th), ty = Math.sin(th), nx = -ty, ny = tx;
  const a = seg.pixOff[r], b = seg.pixOff[r + 1];
  let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9;
  for (let k = a; k < b; k++) {
    const pi = seg.pix[k], x = pi % aw + 0.5, y = ((pi / aw) | 0) + 0.5;
    const u = x * tx + y * ty, v = x * nx + y * ny;
    if (u < umin) umin = u; if (u > umax) umax = u; if (v < vmin) vmin = v; if (v > vmax) vmax = v;
  }
  const spa = Math.max(0.6, sp / fa), du = 0.7;
  const out = [];
  for (let v = vmin + spa * (0.3 + 0.4 * rand()); v <= vmax; v += spa) {
    let start = null, last = null;
    for (let u = umin - 1; u <= umax + 1; u += du) {
      const x = u * tx + v * nx, y = u * ty + v * ny;
      const ax = x | 0, ay = y | 0;
      const inside = ax >= 0 && ay >= 0 && ax < aw && ay < ah && labels[ay * aw + ax] === r && (!keep || keep(ax, ay));
      if (inside) { if (start === null) start = u; last = u; }
      else if (start !== null) {
        if ((last - start) * fa >= minLen) out.push(seg2(start, last, v, tx, ty, nx, ny, fa));
        start = null;
      }
    }
    if (start !== null && (last - start) * fa >= minLen) out.push(seg2(start, last, v, tx, ty, nx, ny, fa));
  }
  return out;
}
function seg2(u0, u1, v, tx, ty, nx, ny, fa) {
  return [(u0 * tx + v * nx) * fa, (u0 * ty + v * ny) * fa, (u1 * tx + v * nx) * fa, (u1 * ty + v * ny) * fa];
}

/**
 * Pinta una banda recta (con un leve temblor) usando una muestra real.
 * apply(g, a, u, v) recibe píxel, densidad, posición a lo largo (0..1) y a lo ancho (−1..1).
 */
function drawBand(ctx, raster, path, lib, rand, x0, y0, x1, y1, width, wobble, apply) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.sqrt(dx * dx + dy * dy);
  if (L < 1) return;
  const n = Math.max(2, Math.min(S.MAXPTS - 2, Math.ceil(L / Math.max(2, width * 0.8)) + 1));
  const ux = dx / L, uy = dy / L, px = -uy, py = ux;
  const ph = rand() * 6.28, fq = (1 + rand() * 2) * Math.PI / L;
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const w = Math.sin(t * L * fq + ph) * wobble;
    xs.push(x0 + dx * t + px * w); ys.push(y0 + dy * t + py * w);
  }
  setPath(path, xs, ys, n);
  const Rr = width / 2 / 0.7;
  for (let i = 0; i < path.n; i++) path.rs[i] = Rr * VK;
  const nt = raster.rasterize(path, 0.03);
  if (!nt) return;
  const st = Lib.prepare(Lib.pick(lib, rand), path.len, Rr, rand, VK);
  const ts = new Float32Array(2);
  const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
  for (let t = 0; t < nt; t++) {
    const li = tl[t];
    Lib.sampleAt(st, U[li], V[li], ts);
    const a = ts[0] * A[li];
    if (a > 0.004) apply(tg[t], a, U[li], V[li]);
  }
  raster.clear();
}

/**
 * Líneas de contorno (fineliner / pluma): cadenas de borde entre manchas con contraste,
 * cortadas en tramos con las puntas pasadas, como a mano.
 */
async function drawContours(ctx, seg, Lfull, opts, clock) {
  const { W, H } = ctx;
  const reg = seg.reg;
  const rand = C.mulberry32(ctx.seed * 23 + (opts.seed || 0));
  const fa = 1 / ctx.ax;
  const lib = opts.lib && opts.lib.length ? opts.lib : Lib.synthetic("lapiz");
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const chains = Seg.boundaryChains(seg, 4);
  const lab = reg.lab;
  const xs = [], ys = [];
  for (let ci = 0; ci < chains.length; ci++) {
    const ch = chains[ci];
    const r = ch.r, q = ch.q;
    const d0 = lab[r * 3] - lab[q * 3], d1 = lab[r * 3 + 1] - lab[q * 3 + 1], d2 = lab[r * 3 + 2] - lab[q * 3 + 2];
    const contrast = Math.min(1, Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2) / 40);
    // solo bordes con contraste y con recorrido: pocas líneas, decididas
    const want = C.clamp((contrast - opts.thr) * 2.2 + (reg.imp[r] - 0.5) * opts.impK, 0, 1) * C.smoothstep(6, 30, ch.n);
    if (rand() > want) continue;
    // suavizado fuerte de la cadena (sin escalones ni ondas de la segmentación)
    { const m = ch.n, w = 5, sx = new Float32Array(m), sy = new Float32Array(m);
      for (let k = 0; k < m; k++) { let ax2 = 0, ay2 = 0, c = 0; for (let q2 = -w; q2 <= w; q2++) { const j2 = Math.min(m - 1, Math.max(0, k + q2)); ax2 += ch.xs[j2]; ay2 += ch.ys[j2]; c++; } sx[k] = ax2 / c; sy[k] = ay2 / c; }
      ch.xs = sx; ch.ys = sy; }
    // tramos de longitud variable, con las puntas pasadas y huecos
    let i = 0;
    while (i < ch.n - 2) {
      const segLen = (opts.segLen || 60) * (0.6 + 0.9 * rand());
      xs.length = 0; ys.length = 0;
      let acc = 0, j = i;
      for (; j < ch.n && acc < segLen; j++) {
        xs.push(ch.xs[j] * fa); ys.push(ch.ys[j] * fa);
        const m = xs.length;
        if (m > 1) acc += Math.hypot(xs[m - 1] - xs[m - 2], ys[m - 1] - ys[m - 2]);
      }
      i = j + ((rand() * (opts.gap || 2)) | 0);
      if (xs.length < 2 || acc < 3) continue;
      // remuestreo y prolongación de las puntas
      const step = Math.max(1.5, opts.width * 1.5);
      const rx = [xs[0]], ry = [ys[0]];
      for (let k = 1; k < xs.length; k++) {
        const ddx = xs[k] - rx[rx.length - 1], ddy = ys[k] - ry[ry.length - 1];
        if (ddx * ddx + ddy * ddy >= step * step || k === xs.length - 1) { rx.push(xs[k]); ry.push(ys[k]); }
      }
      if (rx.length < 2) continue;
      const over = (opts.overshoot || 0) * acc;
      if (over > 0) {
        const m = rx.length;
        let ex = rx[m - 1] - rx[m - 2], ey = ry[m - 1] - ry[m - 2], el = Math.hypot(ex, ey) || 1;
        rx.push(rx[m - 1] + ex / el * over * rand()); ry.push(ry[m - 1] + ey / el * over * rand());
        let bx = rx[0] - rx[1], by = ry[0] - ry[1], bl2 = Math.hypot(bx, by) || 1;
        rx.unshift(rx[0] + bx / bl2 * over * rand()); ry.unshift(ry[0] + by / bl2 * over * rand());
      }
      const n = Math.min(rx.length, S.MAXPTS - 2);
      setPath(path, rx, ry, n);
      const wv = opts.width * (0.75 + 0.5 * rand()) * (0.7 + 0.6 * contrast);
      const Rr = wv / 2 / 0.7;
      for (let k = 0; k < n; k++) path.rs[k] = Rr * VK;
      const nt = raster.rasterize(path, 0.03);
      if (!nt) continue;
      const st = Lib.prepare(Lib.pick(lib, rand), path.len, Rr, rand, VK);
      const ts = new Float32Array(2);
      const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
      const mx = rx[(n / 2) | 0], my = ry[(n / 2) | 0];
      for (let t = 0; t < nt; t++) {
        const li = tl[t];
        Lib.sampleAt(st, U[li], V[li], ts);
        const a = ts[0] * A[li] * opts.opacity;
        if (a > 0.004) opts.apply(tg[t], a, r, q, mx, my);
      }
      raster.clear();
    }
    if (clock && (ci & 31) === 0) await clock.tick(ci / chains.length);
  }
}

/** Color de rotulador: más puro y luminoso que la foto (tintas de alcohol). */
function markerColor(r, g, b, satK, out) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  out[0] = C.clamp(y + (r - y) * satK, 0, 1); out[1] = C.clamp(y + (g - y) * satK, 0, 1); out[2] = C.clamp(y + (b - y) * satK, 0, 1);
  return out;
}

async function paint(ctx, p, seg, Lfull, clock) {
  const { W, H, N, s } = ctx;
  const reg = seg.reg;
  const mode = p.modo;
  const rand = C.mulberry32(ctx.seed * 29 + 3);
  const mk = (ctx.strokesOf(["pin_rotulador"]) || { samples: Lib.synthetic("rotulador") }).samples;
  const ln = (ctx.strokesOf(["pin_linea"]) || { samples: Lib.synthetic("lapiz") }).samples;
  const pc = (ctx.strokesOf(["pin_lapiz"]) || { samples: Lib.synthetic("lapiz") }).samples;
  const Tr = new Float32Array(N).fill(1), Tg = new Float32Array(N).fill(1), Tb = new Float32Array(N).fill(1);
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const col = new Float32Array(3), lay = new Float32Array(3);

  const Wn = Math.max(2, (3 + 13 * p.grosor) * s * (mode === "acuarelable" ? 1.15 : mode === "linea" ? 0.8 : 1));
  const spacing = mode === "vetas" ? 0.92 : mode === "acuarelable" ? 0.78 : 0.85;
  const handAng = mode === "vetas" ? -Math.PI / 2 + 0.12 : -Math.PI / 3;
  const op = 0.55 + 0.4 * p.intensidad;
  const sat = 1.25 + 0.5 * p.varSat;

  // qué zonas se rellenan
  const fillP = { moda: 0.15 + 0.7 * p.cobertura, vetas: 0.3 + 0.7 * p.cobertura, acuarelable: 0.2 + 0.7 * p.cobertura, linea: 0.05 + 0.55 * p.cobertura }[mode];
  const order = Array.from({ length: reg.n }, (_, i) => i).sort((a, b) => reg.lum[b] - reg.lum[a]); // de claro a oscuro
  const ax = ctx.ax;
  for (let oi = 0; oi < order.length; oi++) {
    const r = order[oi];
    const lum = reg.lum[r], dark = 1 - lum;
    if (lum > 0.86 - 0.08 * p.cobertura) continue;                       // blanco del papel
    const want = fillP * (0.55 + 0.6 * reg.imp[r]) * (0.6 + 0.6 * dark);
    if (rand() > want) continue;
    markerColor(reg.mean[r * 3], reg.mean[r * 3 + 1], reg.mean[r * 3 + 2], sat, col);
    C.varyColor(col[0], col[1], col[2], (rand() - 0.5) * p.varTono * 0.5, 0, 0, col);
    if (mode === "moda" && lum < 0.2) { col[0] = col[1] = col[2] = 0.06; }  // negros de rotulador
    // dirección: la de la forma si es clara; si no, la de la mano
    let th = reg.coh[r] > 0.5 ? 0.5 * Math.atan2(reg.os[r], reg.oc[r]) : handAng;
    th += (rand() - 0.5) * 0.15;
    const layers = 1 + (dark > 0.42 ? 1 : 0) + (dark > 0.68 ? 1 : 0);
    // primera pasada: color claro; las siguientes oscurecen (misma tinta)
    const k1 = 0.5 + 0.12 * (1 - p.intensidad);
    for (let L = 0; L < layers; L++) {
      const thL = th + (L > 0 ? (L % 2 ? 1 : -1) * p.cruzado * 0.9 : 0);
      const thr = L === 0 ? 2 : [0, 0.5, 0.32][L];
      const keep = L === 0 ? null : (gx, gy) => ctx.lum[gy * seg.aw + gx] < thr + 0.1 * (rand() - 0.5);
      const bands = scanBands(ctx, seg, r, thL, Wn * spacing, Wn * 1.2, keep, rand);
      for (let c = 0; c < 3; c++) lay[c] = 1 - (1 - col[c]) * (L === 0 ? 1 - k1 : 0.7);
      for (const bd of bands) {
        // las pasadas se pasan un poco del borde o se quedan cortas, como a mano
        const ex = bd[2] - bd[0], ey = bd[3] - bd[1], el = Math.hypot(ex, ey) || 1;
        const o0 = (rand() - 0.6) * Wn * 0.6, o1 = (rand() - 0.6) * Wn * 0.6;
        const x0 = bd[0] - ex / el * o0, y0 = bd[1] - ey / el * o0, x1 = bd[2] + ex / el * o1, y1 = bd[3] + ey / el * o1;
        const lr = lay[0], lg = lay[1], lb = lay[2];
        drawBand(ctx, raster, path, mk, rand, x0, y0, x1, y1, Wn, Wn * 0.08, (g, a, u, v) => {
          let aa = a * op;
          if (u < 0.03 || u > 0.97) aa = Math.min(1, aa * 1.25);                // charco al apoyar y levantar
          if (mode === "acuarelable") { const av = v < 0 ? -v : v; aa *= 0.75 + 0.55 * C.smoothstep(0.55, 1, av); }
          Tr[g] *= 1 - aa * (1 - lr); Tg[g] *= 1 - aa * (1 - lg); Tb[g] *= 1 - aa * (1 - lb);
        });
      }
    }
    if ((oi & 7) === 0) await clock.tick(0.65 * oi / order.length);
  }

  // acuarelables: el agua funde parte de cada zona (desenfoque dentro de la mancha)
  if (mode === "acuarelable") {
    const tmp = new Float32Array(N);
    const rb = Math.max(1, Math.round(Wn * 0.5));
    const wet = new Float32Array(reg.n);
    for (let r = 0; r < reg.n; r++) wet[r] = rand() < 0.55 ? 0.35 + 0.5 * rand() : 0;
    for (const T of [Tr, Tg, Tb]) {
      const b = Float32Array.from(T);
      C.boxBlurH(b, tmp, W, H, rb); C.boxBlurV(tmp, b, W, H, rb);
      C.boxBlurH(b, tmp, W, H, rb); C.boxBlurV(tmp, b, W, H, rb);
      for (let i = 0; i < N; i++) { const w = wet[Lfull[i]]; if (w > 0) T[i] += (b[i] - T[i]) * w; }
    }
  }
  await clock.tick(0.7);

  // lápiz de color en las sombras (línea y relleno)
  if (mode === "linea") {
    for (let r = 0; r < reg.n; r++) {
      const dark = 1 - reg.lum[r];
      if (dark < 0.45 || reg.imp[r] < 0.45 || rand() > 0.6) continue;
      markerColor(reg.mean[r * 3], reg.mean[r * 3 + 1], reg.mean[r * 3 + 2], 1.4, col);
      const bands = scanBands(ctx, seg, r, -Math.PI / 4 + (rand() - 0.5) * 0.3, Wn * 0.55, Wn * 1.5, (gx, gy) => ctx.lum[gy * seg.aw + gx] < 0.55, rand);
      for (const bd of bands) {
        drawBand(ctx, raster, path, pc, rand, bd[0], bd[1], bd[2], bd[3], Math.max(1.2, Wn * 0.28), Wn * 0.05, (g, a) => {
          const aa = a * 0.6 * (0.5 + 0.5 * dark);
          Tr[g] *= 1 - aa * (1 - col[0] * 0.8); Tg[g] *= 1 - aa * (1 - col[1] * 0.8); Tb[g] *= 1 - aa * (1 - col[2] * 0.8);
        });
      }
    }
  }

  // línea: negra de fineliner (moda), de color (línea y relleno) o suave (vetas, acuarelables)
  const lineCol = new Float32Array(3);
  const lw = Math.max(0.9, (0.7 + 2.2 * p.grosor) * s * (mode === "moda" ? 1 : 0.8));
  await drawContours(ctx, seg, Lfull, {
    lib: ln, width: lw, opacity: mode === "acuarelable" ? 0.6 : 0.9,
    thr: (mode === "moda" ? 0.3 : mode === "linea" ? 0.22 : 0.5) - 0.15 * p.detalle, impK: 0.8,
    segLen: (40 + 140 * p.longitud) * s, gap: 3, overshoot: mode === "moda" ? 0.25 : 0.12,
    apply: (g, a, r) => {
      if (mode === "moda") { lineCol[0] = 0.05; lineCol[1] = 0.05; lineCol[2] = 0.06; }
      else { markerColor(reg.mean[r * 3], reg.mean[r * 3 + 1], reg.mean[r * 3 + 2], 1.5, lineCol); lineCol[0] *= 0.45; lineCol[1] *= 0.45; lineCol[2] *= 0.45; }
      Tr[g] *= 1 - a * (1 - lineCol[0]); Tg[g] *= 1 - a * (1 - lineCol[1]); Tb[g] *= 1 - a * (1 - lineCol[2]);
    },
  }, { tick: async (f) => clock.tick(0.72 + 0.25 * f) });

  const out = K.transToRGBA(Tr, Tg, Tb);
  if (ctx.selFull) for (let i = 0; i < N; i++) out[i * 4 + 3] = out[i * 4 + 3] * ctx.selFull[i] / 255;
  return out;
}

module.exports = { paint, scanBands, drawBand, drawContours, markerColor, setPath };
