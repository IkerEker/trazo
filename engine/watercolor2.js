"use strict";
/*
 * Trazo · Acuarela por aguadas superpuestas
 *
 * Un acuarelista pinta de claro a oscuro con veladuras transparentes:
 *  · Cada mancha recibe tantas aguadas como oscura es; el color final es el
 *    producto (absorción) de todas ellas.
 *  · Las primeras aguadas, húmedas: bordes suaves, ondulados, colores que se
 *    funden entre manchas vecinas. Las últimas, en seco: bordes nítidos.
 *  · Al secarse, el pigmento se acumula en el borde de cada aguada (anillo
 *    oscuro) y se asienta en los valles del papel (granulado), sobre todo ahí.
 *  · Donde dos aguadas se pisan se mezclan por superposición.
 *  · El papel se reserva en las luces y, a veces, queda una línea blanca entre
 *    manchas de colores muy distintos.
 *  · Pinceladas reales (biblioteca) aportan la textura en zonas con detalle.
 */
const C = require("./core.js");
const S = require("./strokes.js");
const Lib = require("./library.js");
const Seg = require("./segment.js");
const Kit = require("./kit.js");

const LAYER_W = [1.15, 1.0, 0.9, 0.8, 0.75];

function blur(plane, w, h, sigma, tmp) {
  if (sigma >= 0.35) C.gaussBlur(plane, w, h, sigma, tmp);
  return plane;
}

async function paint(ctx, p, seg, Lfull, clock) {
  const { W, H, N, s } = ctx;
  const reg = seg.reg;
  const rand = C.mulberry32(ctx.seed * 17 + 11);
  const lib = ctx.lib && ctx.lib.samples && ctx.lib.samples.length ? ctx.lib.samples : Lib.synthetic("acuarela");
  const pap = ctx.paperPrep ? Lib.paperSampler(ctx.paperPrep, Lib.paperScale(Math.max(W, H))) : null;

  /* ---------- rejilla de trabajo para las aguadas ---------- */
  const q = Math.max(1, Math.max(W, H) / 1400);
  const ww = Math.max(8, Math.round(W / q)), wh = Math.max(8, Math.round(H / q));
  const qx = W / ww, qy = H / wh;
  const wn = ww * wh;
  const ss = s / q; // escala relativa en px de trabajo

  // etiqueta y color del modelo en la rejilla
  const wl = new Int32Array(wn);
  const absR = new Float32Array(wn), absG = new Float32Array(wn), absB = new Float32Array(wn);
  const col = new Float32Array(3);
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const fx = Math.min(W - 1, ((x + 0.5) * qx) | 0), fy = Math.min(H - 1, ((y + 0.5) * qy) | 0);
    const r = Lfull[fy * W + fx];
    wl[y * ww + x] = r;
  }

  /* ---------- niveles de aguada ---------- */
  const dark = new Float32Array(reg.n);
  let dmax = 0;
  for (let r = 0; r < reg.n; r++) { dark[r] = 1 - reg.lum[r]; if (dark[r] > dmax) dmax = dark[r]; }
  const tWhite = 0.035 + (1 - p.cobertura) * 0.22; // luces reservadas
  // variantes: número de aguadas, humedad efectiva e intensidad
  const mode = p.modo || "capas";
  const K = mode === "densa" ? 5 : mode === "humeda" || mode === "dibujo" || mode === "gotas" ? 3 : 4;
  const humX = mode === "humeda" ? 0.25 : mode === "gotas" ? 0.15 : mode === "densa" ? -0.05 : 0;
  const FR = K === 5 ? [0, 0.2, 0.4, 0.6, 0.78] : K === 3 ? [0, 0.35, 0.65] : [0, 0.26, 0.5, 0.72];
  const th = [];
  for (let k = 0; k < K; k++) th.push(tWhite + (Math.max(tWhite + 0.1, dmax) - tWhite) * FR[k]);
  const nCover = new Int8Array(reg.n);
  for (let r = 0; r < reg.n; r++) { let c = 0; for (let k = 0; k < K; k++) if (dark[r] >= th[k]) c++; nCover[r] = c; }
  const wsum = new Float32Array(K + 1);
  for (let k = 1; k <= K; k++) wsum[k] = wsum[k - 1] + LAYER_W[k - 1];

  // absorbancia objetivo (−ln color) en la rejilla
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const i = y * ww + x, r = wl[i];
    Seg.modelColor(seg, r, (x + 0.5) / ww, (y + 0.5) / wh, col);
    // la acuarela no llega al negro absoluto ni a colores de pantalla
    const pig = (mode === "densa" ? 0.9 : 0.82) + 0.18 * p.intensidad;
    absR[i] = -Math.log(Math.max(0.035, 1 - (1 - col[0]) * pig));
    absG[i] = -Math.log(Math.max(0.035, 1 - (1 - col[1]) * pig));
    absB[i] = -Math.log(Math.max(0.035, 1 - (1 - col[2]) * pig));
  }
  await clock.tick(0.05);

  // ruidos: ondulación de bordes, turbulencia de pigmento, floraciones
  const gw = Math.max(4, Math.ceil(ww / 6)), gh = Math.max(4, Math.ceil(wh / 6));
  const nzX = C.fbmGrid(gw, gh, Math.max(2, gw / 10), 4, ctx.seed + 801, 0.55);
  const nzY = C.fbmGrid(gw, gh, Math.max(2, gw / 10), 4, ctx.seed + 802, 0.55);
  const nzT = C.fbmGrid(gw, gh, Math.max(2, gw / 7), 5, ctx.seed + 803, 0.55);
  const nzB = C.fbmGrid(gw, gh, Math.max(2, gw / 4), 3, ctx.seed + 804, 0.5);
  // ruido fino del filo (bordes rotos, no redondeados)
  const fgw = Math.max(4, Math.ceil(ww / 2)), fgh = Math.max(4, Math.ceil(wh / 2));
  const nfX = C.fbmGrid(fgw, fgh, Math.max(2, 3 * ss), 3, ctx.seed + 806, 0.6);
  const nfY = C.fbmGrid(fgw, fgh, Math.max(2, 3 * ss), 3, ctx.seed + 807, 0.6);

  const tmp = new Float32Array(wn);
  const layers = [];
  const bgw = Math.max(4, Math.ceil(ww / 2)), bgh = Math.max(4, Math.ceil(wh / 2));
  const bloomF = C.fbmGrid(bgw, bgh, Math.max(4, 40 * ss), 6, ctx.seed + 805, 0.6);
  // distancia (px de trabajo) de cada punto al borde de su mancha y límite de sangrado
  const dInW = new Float32Array(wn), thinW = new Float32Array(wn);
  {
    const fa = 1 / ctx.ax;
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const i = y * ww + x;
      const ax = Math.min(seg.aw - 1, ((x + 0.5) * qx * ctx.ax) | 0), ay = Math.min(seg.ah - 1, ((y + 0.5) * qy * ctx.ax) | 0);
      dInW[i] = seg.dt[ay * seg.aw + ax] * fa / q;
      thinW[i] = reg.maxDist[wl[i]] * fa / q;
    }
  }
  for (let k = 0; k < K; k++) {
    const wet = k === 0 ? 1 : k === 1 ? 0.65 : k === 2 ? 0.3 : 0.12; // humedad de cada pasada
    const hum = Math.min(1, p.humedad + humX);
    const amp = (0.8 + 4.5 * hum * wet) * ss * 1.6; // ondulación del borde (px de trabajo)
    // máscara con borde ondulado
    const m = new Float32Array(wn);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const gx = x / 6, gy = y / 6;
      const famp = (1.2 + 1.4 * wet) * ss;
      const ox = (C.bilinear(nzX, gw, gh, gx, gy) - 0.5) * 2 * amp + (C.bilinear(nfX, fgw, fgh, x / 2, y / 2) - 0.5) * 2 * famp;
      const oy = (C.bilinear(nzY, gw, gh, gx, gy) - 0.5) * 2 * amp + (C.bilinear(nfY, fgw, fgh, x / 2, y / 2) - 0.5) * 2 * famp;
      const sx = C.clamp(Math.round(x + ox), 0, ww - 1), sy = C.clamp(Math.round(y + oy), 0, wh - 1);
      const r = wl[sy * ww + sx];
      m[y * ww + x] = nCover[r] > k ? 1 : 0;
    }
    // borde: húmedo = suave y con flecos; seco = nítido
    // campo suave del borde (poco desenfoque: las esquinas no se redondean);
    // el umbral se decide a resolución completa contra el grano del papel
    const soft = Float32Array.from(m);
    blur(soft, ww, wh, (0.55 + 1.1 * hum * wet) * ss, tmp);
    const cov = new Float32Array(wn);
    for (let i = 0; i < wn; i++) {
      const x = i % ww, y = (i / ww) | 0;
      const fr = (C.bilinear(nzB, gw, gh, x / 6, y / 6) - 0.5) * 0.4 * wet * hum; // flecos de floración
      cov[i] = C.clamp(soft[i] + fr, 0, 1);
    }
    // proteger las formas claras: una aguada solo invade una mancha más clara
    // cerca del borde, y menos cuanto más estrecha es (se "pinta alrededor")
    {
      const fa = 1 / ctx.ax;
      for (let i = 0; i < wn; i++) {
        const r = wl[i];
        if (nCover[r] > k || cov[i] < 0.002) continue;
        const allowed = Math.min(0.45 * amp + 0.6, 0.12 * thinW[i] + 0.3);
        cov[i] *= C.clamp(1 - dInW[i] / allowed, 0, 1);
      }
    }
    // floraciones (coliflores): en aguadas húmedas y grandes, el agua empuja el
    // pigmento hacia fuera: interior más claro y borde oscuro y fractal
    const bloom = new Float32Array(wn).fill(1);
    if (wet > 0.5 && hum > 0.2) {
      // floraciones: contorno de un ruido fractal umbralizado (borde de coliflor natural)
      const t = 0.66 - 0.06 * hum;
      for (let i = 0; i < wn; i++) {
        const r = wl[i];
        if (thinW[i] < 30 * ss) continue; // solo en manchas grandes
        const x = i % ww, y = (i / ww) | 0;
        const f = C.bilinear(bloomF, bgw, bgh, x / 2, y / 2);
        const d = f - t;
        const inside = C.smoothstep(0, 0.02, d);
        const edge = Math.exp(-(d * d) / 0.00012);
        const fade = C.smoothstep(4 * ss, 18 * ss, dInW[i]) * hum;
        bloom[i] = 1 + fade * (-0.24 * inside + 0.7 * edge);
      }
    }
    // anillo de pigmento: banda interior junto al borde seco
    const hardM = new Float32Array(wn);
    for (let i = 0; i < wn; i++) hardM[i] = cov[i] > 0.5 ? 1 : cov[i] * 2 * 0.5;
    const bl = Float32Array.from(hardM);
    blur(bl, ww, wh, (0.9 + 1.6 * p.detalle) * ss * 1.4 * (1 + wet), tmp);
    const rim = new Float32Array(wn);
    for (let i = 0; i < wn; i++) rim[i] = C.clamp((hardM[i] - bl[i]) * 2.6, 0, 1);
    // color de la aguada: convolución normalizada dentro de la máscara (mezcla húmeda)
    const share = new Float32Array(wn);
    for (let i = 0; i < wn; i++) {
      const r = wl[i];
      share[i] = nCover[r] > k ? LAYER_W[k] / wsum[nCover[r]] : 0;
    }
    const aR = new Float32Array(wn), aG = new Float32Array(wn), aB = new Float32Array(wn), mw = new Float32Array(wn);
    for (let i = 0; i < wn; i++) {
      const w = share[i] > 0 ? 1 : 0;
      aR[i] = absR[i] * share[i]; aG[i] = absG[i] * share[i]; aB[i] = absB[i] * share[i]; mw[i] = w;
    }
    const sR = Float32Array.from(aR), sG = Float32Array.from(aG), sB = Float32Array.from(aB); // sin mezclar
    const sm = (0.6 + 5.5 * hum * wet) * ss * 1.4;
    blur(aR, ww, wh, sm, tmp); blur(aG, ww, wh, sm, tmp); blur(aB, ww, wh, sm, tmp); blur(mw, ww, wh, sm, tmp);
    // fuera de la máscara se extiende el color de la aguada vecina (para el fleco del borde)
    const ext = Math.max(2, 3 * amp);
    const eR = Float32Array.from(aR), eG = Float32Array.from(aG), eB = Float32Array.from(aB), eW = Float32Array.from(mw);
    blur(eR, ww, wh, ext, tmp); blur(eG, ww, wh, ext, tmp); blur(eB, ww, wh, ext, tmp); blur(eW, ww, wh, ext, tmp);
    for (let i = 0; i < wn; i++) {
      if (mw[i] > 0.02 && share[i] > 0) {
        // dentro de su mancha: color propio; cerca del borde, se funde con la vecina
        const iw = 1 / mw[i];
        const bleed = Math.min(sm * 1.6, 0.35 * thinW[i] + 0.5);
        const kb = Math.exp(-dInW[i] / Math.max(0.3, bleed));
        aR[i] = sR[i] + (aR[i] * iw - sR[i]) * kb; aG[i] = sG[i] + (aG[i] * iw - sG[i]) * kb; aB[i] = sB[i] + (aB[i] * iw - sB[i]) * kb;
      } else if (mw[i] > 0.02) { const iw = 1 / mw[i]; aR[i] *= iw; aG[i] *= iw; aB[i] *= iw; }
      else if (eW[i] > 1e-4) { const iw = 1 / eW[i]; aR[i] = eR[i] * iw; aG[i] = eG[i] * iw; aB[i] = eB[i] * iw; }
      else { aR[i] = 0; aG[i] = 0; aB[i] = 0; }
    }
    layers.push({ cov, rim, aR, aG, aB, wet, bloom, ws: 0.04 + 0.16 * wet * hum });
    await clock.tick(0.08 + 0.4 * (k + 1) / K);
  }

  // líneas de papel blanco entre manchas de colores muy distintos (primera aguada)
  const gap = new Float32Array(wn);
  {
    const lab = reg.lab;
    for (let y = 1; y < wh - 1; y++) for (let x = 1; x < ww - 1; x++) {
      const i = y * ww + x, r = wl[i];
      const test = (j) => {
        const q2 = wl[j];
        if (q2 === r) return 0;
        const da = lab[r * 3 + 1] - lab[q2 * 3 + 1], db = lab[r * 3 + 2] - lab[q2 * 3 + 2], dl = lab[r * 3] - lab[q2 * 3];
        return Math.sqrt(da * da + db * db) > 28 && Math.abs(dl) < 45 ? 1 : 0;
      };
      gap[i] = Math.max(test(i - 1), test(i + 1), test(i - ww), test(i + ww));
    }
    blur(gap, ww, wh, 0.7 * ss * 1.4, tmp);
    for (let i = 0; i < wn; i++) {
      const x = i % ww, y = (i / ww) | 0;
      const g = C.bilinear(nzT, gw, gh, x / 6 + 37, y / 6 + 11);
      gap[i] = C.clamp(gap[i] * 1.6, 0, 1) * C.smoothstep(0.5, 0.62, g) * (1 - p.humedad * 0.7);
    }
  }

  /* ---------- pinceladas reales en zonas con textura (pincel seco, matices) ---------- */
  const Dn = new Float32Array(N);
  await brushMarks(ctx, p, seg, Lfull, lib, Dn, rand, clock);
  // texturas de aguada reales: una por capa, a escala física (las REALISTAS primero)
  const tl = ctx.assets && ctx.assets.tiles_acuarela;
  const ltiles = [];
  for (let k = 0; k < layers.length; k++) {
    if (!tl) { ltiles.push(null); continue; }
    const tags = mode === "humeda" && k < 2 ? ["manchas", "aguada"] : k === layers.length - 1 ? ["grano", "aguada"] : ["aguada"];
    const it = Kit.pickTile(tl, rand, tags);
    ltiles.push(Kit.tileSampler(it, Kit.tileScale(it, Math.max(W, H), 0.8 + 0.6 * rand()), rand() * 6.28, rand() * 999, rand() * 999));
  }
  const tileK = 0.12 + 0.18 * p.granulado + (mode === "humeda" ? 0.08 : 0);

  const edgeTile = C.makeGrainTile(ctx.seed + 808, "paper");
  const etInv = 1 / Math.max(1, Math.sqrt(s) * 1.4);
  /* ---------- gotas de agua sobre la aguada húmeda ---------- */
  // Cada gota empuja el pigmento hacia fuera: centro lavado, anillo oscuro de coliflor,
  // gotitas satélite y, en las grandes, un corrimiento hacia abajo.
  let dropMul = null;
  if (mode === "gotas") {
    dropMul = new Float32Array(N).fill(1);
    const rnd = C.mulberry32(ctx.seed * 97 + 5);
    const ang = new Float32Array(64);
    const nDrops = Math.round((10 + 26 * p.humedad) * Math.sqrt(W * H) / 1400);
    const rMin = 5 * s, rMax = (24 + 40 * p.grosor) * s;
    const drop = (cx, cy, r, strength) => {
      // borde irregular: radio que cambia con el ángulo (lóbulos de coliflor)
      let a0 = rnd(), a1 = rnd(), a2 = rnd();
      for (let q = 0; q < 64; q++) { a0 = a0 * 0.8 + rnd() * 0.2; a1 = a1 * 0.5 + rnd() * 0.5; a2 = a2 * 0.2 + rnd() * 0.8; ang[q] = 1 + (a0 - 0.5) * 0.55 + (a1 - 0.5) * 0.22 + (a2 - 0.5) * 0.08; }
      for (let q = 56; q < 64; q++) ang[q] += (ang[0] - ang[q]) * (q - 55) / 9; // cerrar el contorno
      const R = r * 1.45;
      const x0 = Math.max(0, (cx - R) | 0), x1 = Math.min(W - 1, (cx + R) | 0), y0 = Math.max(0, (cy - R) | 0), y1 = Math.min(H - 1, (cy + R) | 0);
      const rimW = 0.22 + 0.12 * rnd(), sc = 1 / Math.max(2, r * 0.18);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        const th = Math.atan2(dy, dx), qf = (th / 6.2832 + 0.5) * 63.999, q0 = qf | 0;
        const rr = r * (ang[q0] + (ang[(q0 + 1) & 63] - ang[q0]) * (qf - q0));
        // filo de coliflor: ruido a la escala de la gota y grano del papel
        const nb = C.bilinear(bloomF, bgw, bgh, (x * sc) % (bgw - 1), (y * sc) % (bgh - 1)) - 0.5;
        const g = C.tileAt(edgeTile, x * etInv * 0.7, y * etInv * 0.7) - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) / rr + nb * 0.35 + g * 0.05;
        if (d > 1.12) continue;
        let m;
        if (d < 1 - rimW) m = 1 - strength * (0.5 - 0.2 * Math.pow(Math.max(0, d) / (1 - rimW), 2));     // centro lavado
        else if (d < 1) m = 1 - strength * 0.3 + strength * 1.05 * C.smoothstep(1 - rimW, 1, d);       // el pigmento se acumula hacia el filo
        else m = 1 + strength * 0.75 * (1 - C.smoothstep(1, 1.12, d));                                   // fleco que se abre
        dropMul[y * W + x] *= m;
      }
    };
    for (let k = 0; k < nDrops; k++) {
      // las gotas caen donde hay color
      let cx = 0, cy = 0;
      for (let t = 0; t < 6; t++) {
        cx = rnd() * W; cy = rnd() * H;
        const r = wl[Math.min(wh - 1, (cy / qy) | 0) * ww + Math.min(ww - 1, (cx / qx) | 0)];
        if (nCover[r] > 0) break;
      }
      const r = rMin + (rMax - rMin) * Math.pow(rnd(), 2.2);
      const st = 0.75 + 0.25 * rnd();
      drop(cx, cy, r, st);
      // gotitas satélite al salpicar
      const ns = (rnd() * 3) | 0;
      for (let j = 0; j < ns; j++) {
        const a = rnd() * 6.28, dd = r * (1.4 + 1.2 * rnd());
        drop(cx + Math.cos(a) * dd, cy + Math.sin(a) * dd, Math.max(rMin, r * (0.15 + 0.2 * rnd())), st * 0.7);
      }
      // corrimiento: el agua de las gotas grandes baja arrastrando pigmento
      if (r > rMin + (rMax - rMin) * 0.35 && rnd() < 0.35) {
        const L = r * (2 + 4 * rnd()), w0 = r * (0.18 + 0.12 * rnd());
        let x = cx + (rnd() - 0.5) * r * 0.5;
        for (let t = 0; t < L; t += 1) {
          x += (rnd() - 0.5) * 0.6;
          const y = (cy + r * 0.8 + t) | 0;
          if (y >= H) break;
          const w = w0 * (1 - 0.6 * t / L);
          for (let xx = Math.max(0, (x - w - 1) | 0); xx <= Math.min(W - 1, (x + w + 1) | 0); xx++) {
            const e = Math.abs(xx - x) / w;
            if (e > 1) continue;
            dropMul[y * W + xx] *= 0.7 + 0.55 * C.smoothstep(0.45, 1, e);
          }
        }
        drop(x, cy + r * 0.8 + L, w0 * 1.3, 0.9); // gota al final del corrimiento
      }
      if ((k & 7) === 0) await clock.tick(0.7);
    }
  }

  /* ---------- composición a resolución completa ---------- */
  const out = new Uint8Array(N * 4);
  const selFull = ctx.selFull, data = ctx.data, comp = ctx.comp, srcA = ctx.srcAlpha;
  const granK = 0.06 + 0.75 * p.granulado;
  const rimK = 0.45 + 0.9 * p.detalle;
  const turbK = 0.2 + 0.25 * p.humedad;
  const dnK = 0.55 + 0.4 * p.intensidad;
  const cover = ctx.cover, fullCover = p.cobertura >= 0.995;
  const L0 = layers.length;
  const edgeG = 0.3 + 0.25 * p.granulado, edgeF = 0.22, dryK = 0.35 + 0.5 * p.granulado;
  for (let y = 0; y < H; y++) {
    let wy = (y + 0.5) / qy - 0.5; if (wy < 0) wy = 0; if (wy > wh - 1) wy = wh - 1;
    const y0 = wy | 0, y1 = y0 < wh - 1 ? y0 + 1 : y0, fy = wy - y0;
    for (let x = 0; x < W; x++) {
      let wx = (x + 0.5) / qx - 0.5; if (wx < 0) wx = 0; if (wx > ww - 1) wx = ww - 1;
      const x0 = wx | 0, x1 = x0 < ww - 1 ? x0 + 1 : x0, fx = wx - x0;
      const i00 = y0 * ww + x0, i10 = y0 * ww + x1, i01 = y1 * ww + x0, i11 = y1 * ww + x1;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const i = y * W + x;
      const gr = pap ? 0.5 + (pap.eq(x, y) - 0.5) * 0.6 + (pap.eq(x * 0.5 + 97, y * 0.5 + 31) - 0.5) * 0.7 : 0.5;
      const tu = C.bilinear(nzT, gw, gh, (x / qx) / 6, (y / qy) / 6);
      let AR = 0, AG = 0, AB = 0;
      for (let k = 0; k < L0; k++) {
        const Lk = layers[k];
        const cf = Lk.cov[i00] * w00 + Lk.cov[i10] * w10 + Lk.cov[i01] * w01 + Lk.cov[i11] * w11;
        if (cf < 0.02) continue;
        // filo roto: el agua se detiene en las fibras del papel
        const fn = C.tileAt(edgeTile, x * etInv, y * etInv);
        const ws = Lk.ws;
        let cv = cf >= 0.98 ? 1 : C.smoothstep(0.5 - ws, 0.5 + ws, cf + (gr - 0.5) * edgeG + (fn - 0.5) * edgeF);
        // pincel seco en el filo de las aguadas más secas: el papel asoma en los picos
        if (Lk.wet < 0.5 && cf < 0.95 && cv > 0) {
          const band = C.smoothstep(0.45, 0.6, cf) * (1 - C.smoothstep(0.7, 0.92, cf));
          cv *= 1 - dryK * (1 - Lk.wet) * band * C.smoothstep(0.5, 0.75, gr * 0.7 + fn * 0.3);
        }
        if (k === 0) cv *= 1 - (gap[i00] * w00 + gap[i10] * w10 + gap[i01] * w01 + gap[i11] * w11);
        if (cv < 0.002) continue;
        const rm = Lk.rim[i00] * w00 + Lk.rim[i10] * w10 + Lk.rim[i01] * w01 + Lk.rim[i11] * w11;
        // densidad: anillo de borde, turbulencia y granulado (más en el anillo y en lo oscuro)
        const bl = Lk.bloom[i00] * w00 + Lk.bloom[i10] * w10 + Lk.bloom[i01] * w01 + Lk.bloom[i11] * w11;
        const dens = (1 + rimK * rm) * (1 + turbK * (tu - 0.5) * 2 * (0.6 + Lk.wet)) *
                     (1 + granK * (0.5 - gr) * (0.25 + 1.9 * rm + 0.6 * Lk.wet)) * bl *
                     (ltiles[k] ? 1 + tileK * Math.max(-2, Math.min(2, ltiles[k].l(x, y))) : 1);
        const dm = dropMul && Lk.wet > 0.5 ? dropMul[i] : 1;
        const f = cv * (dens < 0.1 ? 0.1 : dens) * dm;
        AR += f * (Lk.aR[i00] * w00 + Lk.aR[i10] * w10 + Lk.aR[i01] * w01 + Lk.aR[i11] * w11);
        AG += f * (Lk.aG[i00] * w00 + Lk.aG[i10] * w10 + Lk.aG[i01] * w01 + Lk.aG[i11] * w11);
        AB += f * (Lk.aB[i00] * w00 + Lk.aB[i10] * w10 + Lk.aB[i01] * w01 + Lk.aB[i11] * w11);
      }
      // pinceladas: aportan más pigmento del mismo color local
      const dn = Dn[i];
      if (dn > 0.002) {
        const r = Lfull[i];
        const k2 = dn * dnK * (1 + granK * 0.6 * (0.5 - gr));
        const lm = (AR + AG + AB) / 3 + 0.15;
        AR += k2 * (AR / lm * 0.35 + 0.08) * (1 - reg.mean[r * 3] * 0.6);
        AG += k2 * (AG / lm * 0.35 + 0.08) * (1 - reg.mean[r * 3 + 1] * 0.6);
        AB += k2 * (AB / lm * 0.35 + 0.08) * (1 - reg.mean[r * 3 + 2] * 0.6);
      }
      let m = fullCover ? 1 : ctx.at(cover, x, y);
      let rr = Math.exp(-AR * m), gg = Math.exp(-AG * m), bb = Math.exp(-AB * m);
      // papel blanco → transparente
      let a = Math.max(1 - rr, 1 - gg, 1 - bb);
      const o = i * 4;
      if (a < 0.004) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 0; continue; }
      const ia = 1 / a;
      rr = 1 - (1 - rr) * ia; gg = 1 - (1 - gg) * ia; bb = 1 - (1 - bb) * ia;
      if (selFull) a *= selFull[i] / 255;
      if (srcA) a *= data[i * comp + 3] / 255;
      out[o] = C.clamp(rr, 0, 1) * 255 + 0.5 | 0; out[o + 1] = C.clamp(gg, 0, 1) * 255 + 0.5 | 0; out[o + 2] = C.clamp(bb, 0, 1) * 255 + 0.5 | 0;
      out[o + 3] = C.clamp(a, 0, 1) * 255 + 0.5 | 0;
    }
    if ((y & 15) === 0) await clock.tick(0.72 + 0.28 * y / H);
  }
  return out;
}

/** Pinceladas reales solo donde hay textura (follaje, rocas, pelo...). */
async function brushMarks(ctx, p, seg, Lfull, lib, Dn, rand, clock) {
  const { W, H, s } = ctx;
  const reg = seg.reg;
  const raster = new S.StrokeRaster(W, H);
  const path = new S.StrokePath();
  const ts = new Float32Array(2), col = new Float32Array(3);
  const fa = 1 / ctx.ax;
  const R0 = (3 + p.grosor * 18) * s;
  for (let r = 0; r < reg.n; r++) {
    const act = reg.act[r];
    if (act < 0.25 || reg.lum[r] > 0.9) continue;
    const area = reg.cnt[r] * fa * fa;
    const R = Math.min(R0 * (0.8 + 0.4 * (1 - reg.imp[r])), Math.max(1, reg.maxDist[r] * fa));
    if (R < 1.2) continue;
    const L = R * 2 * (1.4 + p.longitud * 5);
    const count = Math.min(60, (act - 0.2) * 1.4 * area / (2 * R * L));
    for (let k = 0; k < count; k++) {
      const a = seg.pixOff[r], b = seg.pixOff[r + 1];
      const pidx = seg.pix[a + ((rand() * (b - a)) | 0)];
      const x = Math.min(W - 1, (pidx % seg.aw + rand()) * fa), y = Math.min(H - 1, (((pidx / seg.aw) | 0) + rand()) * fa);
      ctx.colorAt(ctx.levelFor(R), x, y, col);
      S.traceStroke(ctx, path, x, y, {
        R, Lmax: L * (0.6 + 0.8 * rand()), step: Math.max(1, R * 0.8), curv: 0.1 + 0.85 * p.curvatura,
        colorTol: 0.4, color: col, level: ctx.levelFor(R), angle: (rand() - 0.5) * 0.3, minLen: R * 3,
      });
      if (path.len < R * 3) continue;
      const Rr = R / 0.7;
      for (let i = 0; i < path.n; i++) path.rs[i] = Rr * 0.9;
      const nt = raster.rasterize(path, 0.04);
      if (nt === 0) continue;
      const st = Lib.prepare(lib[(rand() * lib.length) | 0], path.len, Rr, rand, 0.9);
      const str = 0.45 + 0.4 * rand();
      const A = raster.A, U = raster.U, V = raster.V, tl = raster.tl, tg = raster.tg;
      for (let t = 0; t < nt; t++) {
        const li = tl[t], g = tg[t];
        if (Lfull[g] !== r && rand() < 0.7) continue; // las marcas se quedan casi siempre en su mancha
        Lib.sampleAt(st, U[li], V[li], ts);
        const add = ts[0] * A[li] * str;
        if (add > 0.003) Dn[g] += add * (1 - Dn[g] * 0.4);
      }
      raster.clear();
    }
    if ((r & 15) === 0) await clock.tick(0.5 + 0.2 * r / reg.n);
  }
}

module.exports = { paint };
