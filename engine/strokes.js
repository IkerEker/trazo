"use strict";
/*
 * Trazo · trazos
 * - traceStroke: sigue el campo de direcciones desde un punto (en ambos
 *   sentidos), se detiene al cruzar un cambio fuerte de color.
 * - StrokeRaster: rasteriza la pincelada como cápsulas encadenadas en un
 *   búfer local con combinación "máximo" (sin doble mezcla en las uniones)
 *   y guarda, por píxel, la coordenada a lo largo (u) y a lo ancho (v).
 */
const MAXPTS = 4096;

class StrokePath {
  constructor() {
    this.xs = new Float32Array(MAXPTS);
    this.ys = new Float32Array(MAXPTS);
    this.rs = new Float32Array(MAXPTS);
    this.ss = new Float32Array(MAXPTS);
    this.n = 0;
    this.len = 0;
    this._fx = new Float32Array(MAXPTS);
    this._fy = new Float32Array(MAXPTS);
    this._bx = new Float32Array(MAXPTS);
    this._by = new Float32Array(MAXPTS);
  }
}

const _f = new Float32Array(2);
const _c = new Float32Array(3);

/**
 * @param ctx  Context
 * @param path StrokePath (salida)
 * @param x0,y0 punto inicial
 * @param o {R, Lmax, step, curv, colorTol, color:[r,g,b], level, angle, minLen, straight}
 */
function traceStroke(ctx, path, x0, y0, o) {
  const W = ctx.W, H = ctx.H;
  const step = Math.max(0.75, o.step);
  const curv = o.curv;
  const ca = Math.cos(o.angle || 0), sa = Math.sin(o.angle || 0);
  const tol = o.colorTol;
  const col = o.color;
  const minLen = o.minLen === undefined ? o.R : o.minLen;
  const level = o.level;

  const fine = !!o.fine;
  ctx.flowAt(x0, y0, _f, fine);
  let d0x = _f[0] * ca - _f[1] * sa, d0y = _f[0] * sa + _f[1] * ca;

  const half = o.Lmax * 0.5;
  // sentido +
  let nf = runDir(ctx, path._fx, path._fy, x0, y0, d0x, d0y, half, step, curv, ca, sa, tol, col, minLen * 0.5, level, W, H, fine);
  let lenF = (nf) * step;
  // sentido −, con el presupuesto restante
  let nb = runDir(ctx, path._bx, path._by, x0, y0, -d0x, -d0y, o.Lmax - lenF, step, curv, ca, sa, tol, col, minLen * 0.5, level, W, H, fine);

  // ensamblar: atrás invertido + inicio + adelante
  let n = 0;
  const xs = path.xs, ys = path.ys;
  for (let i = nb - 1; i >= 0; i--) { xs[n] = path._bx[i]; ys[n] = path._by[i]; n++; }
  xs[n] = x0; ys[n] = y0; n++;
  for (let i = 0; i < nf; i++) { xs[n] = path._fx[i]; ys[n] = path._fy[i]; n++; }
  if (n === 1) {
    // trazo mínimo: un pequeño segmento en la dirección del flujo
    xs[1] = x0 + d0x * step * 0.5; ys[1] = y0 + d0y * step * 0.5;
    xs[0] = x0 - d0x * step * 0.5; ys[0] = y0 - d0y * step * 0.5;
    n = 2;
  }
  path.n = n;
  let s = 0;
  path.ss[0] = 0;
  for (let i = 1; i < n; i++) {
    const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1];
    s += Math.sqrt(dx * dx + dy * dy);
    path.ss[i] = s;
  }
  path.len = s;
  return path;
}

function runDir(ctx, ox, oy, x, y, dx, dy, budget, step, curv, ca, sa, tol, col, minLen, level, W, H, fine) {
  let n = 0;
  let len = 0;
  const max = Math.min(MAXPTS / 2 - 2, Math.ceil(budget / step));
  for (let k = 0; k < max; k++) {
    ctx.flowAt(x, y, _f, fine);
    let fx = _f[0] * ca - _f[1] * sa, fy = _f[0] * sa + _f[1] * ca;
    if (fx * dx + fy * dy < 0) { fx = -fx; fy = -fy; }
    let nx = dx + (fx - dx) * curv, ny = dy + (fy - dy) * curv;
    const m = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= m; ny /= m;
    const px = x + nx * step, py = y + ny * step;
    if (px < -2 || py < -2 || px > W + 1 || py > H + 1) break;
    if (len >= minLen && tol < 3) {
      ctx.colorAt(level, px, py, _c);
      const diff = Math.abs(_c[0] - col[0]) + Math.abs(_c[1] - col[1]) + Math.abs(_c[2] - col[2]);
      if (diff > tol) break;
    }
    x = px; y = py; dx = nx; dy = ny;
    ox[n] = x; oy[n] = y; n++;
    len += step;
  }
  return n;
}

/** Desplaza los puntos perpendicularmente (temblor de la mano / ondulación). */
function wobblePath(path, amp, wavelength, phase) {
  if (amp <= 0 || path.n < 3) return;
  const { xs, ys, ss, n } = path;
  const k = (Math.PI * 2) / Math.max(1, wavelength);
  // normales por diferencias centrales
  const nxs = path._fx, nys = path._fy;
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : 0, b = i < n - 1 ? i + 1 : n - 1;
    let tx = xs[b] - xs[a], ty = ys[b] - ys[a];
    const m = Math.sqrt(tx * tx + ty * ty) || 1;
    nxs[i] = -ty / m; nys[i] = tx / m;
  }
  for (let i = 0; i < n; i++) {
    const off = amp * Math.sin(ss[i] * k + phase);
    xs[i] += nxs[i] * off; ys[i] += nys[i] * off;
  }
}

class StrokeRaster {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.cap = 0;
    this.A = null; this.U = null; this.V = null;
    this.tl = new Int32Array(1 << 16); // índices locales tocados
    this.tg = new Int32Array(1 << 16); // índices globales
    this.nt = 0;
    this.bx = 0; this.by = 0; this.bw = 0; this.bh = 0;
  }

  _ensure(size) {
    if (size > this.cap) {
      let c = Math.max(1 << 14, this.cap);
      while (c < size) c *= 2;
      this.cap = c;
      this.A = new Float32Array(c);
      this.U = new Float32Array(c);
      this.V = new Float32Array(c);
    }
  }

  _push(local, global) {
    if (this.nt >= this.tl.length) {
      const nl = new Int32Array(this.tl.length * 2); nl.set(this.tl); this.tl = nl;
      const ng = new Int32Array(this.tg.length * 2); ng.set(this.tg); this.tg = ng;
    }
    this.tl[this.nt] = local; this.tg[this.nt] = global; this.nt++;
  }

  /**
   * Rasteriza la trayectoria. rs: radio por punto. soft: fracción del radio
   * usada como borde suave (antialias mínimo de 0.7 px).
   */
  rasterize(path, soft) {
    const { xs, ys, rs, ss, n } = path;
    const W = this.W, H = this.H;
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, rmax = 0;
    for (let i = 0; i < n; i++) {
      if (xs[i] < minx) minx = xs[i]; if (xs[i] > maxx) maxx = xs[i];
      if (ys[i] < miny) miny = ys[i]; if (ys[i] > maxy) maxy = ys[i];
      if (rs[i] > rmax) rmax = rs[i];
    }
    const pad = rmax + 2;
    const bx = Math.max(0, Math.floor(minx - pad)), by = Math.max(0, Math.floor(miny - pad));
    const ex = Math.min(W - 1, Math.ceil(maxx + pad)), ey = Math.min(H - 1, Math.ceil(maxy + pad));
    this.nt = 0;
    if (ex < bx || ey < by) { this.bw = 0; return 0; }
    const bw = ex - bx + 1, bh = ey - by + 1;
    this.bx = bx; this.by = by; this.bw = bw; this.bh = bh;
    this._ensure(bw * bh);
    const A = this.A, U = this.U, V = this.V;
    const total = path.len > 0 ? path.len : 1;
    const invTotal = 1 / total;

    for (let i = 0; i < n - 1; i++) {
      const x0 = xs[i], y0 = ys[i], x1 = xs[i + 1], y1 = ys[i + 1];
      const r0 = rs[i], r1 = rs[i + 1];
      const ex_ = x1 - x0, ey_ = y1 - y0;
      let len2 = ex_ * ex_ + ey_ * ey_;
      const len = Math.sqrt(len2);
      if (len2 < 1e-8) len2 = 1e-8;
      const nx = len > 1e-6 ? -ey_ / len : 0, ny = len > 1e-6 ? ex_ / len : 1;
      const rM = (r0 > r1 ? r0 : r1);
      const aaMax = Math.max(0.7, rM * soft);
      const reach = rM + aaMax * 0.5 + 1;
      const sx0 = Math.max(bx, Math.floor(Math.min(x0, x1) - reach));
      const sx1 = Math.min(ex, Math.ceil(Math.max(x0, x1) + reach));
      const sy0 = Math.max(by, Math.floor(Math.min(y0, y1) - reach));
      const sy1 = Math.min(ey, Math.ceil(Math.max(y0, y1) + reach));
      const s0 = ss[i];
      const inv2 = 1 / len2;
      const dr = r1 - r0;
      const capA = i === 0, capB = i === n - 2;
      const ady = ey_ < 0 ? -ey_ : ey_;
      for (let py = sy0; py <= sy1; py++) {
        const qy = py + 0.5 - y0;
        // recorte de la fila: solo las x que pueden estar a distancia ≤ reach
        let xa = sx0, xb = sx1;
        if (ady > 1e-6) {
          let ta = (qy - reach) / ey_, tb = (qy + reach) / ey_;
          if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
          if (ta < 0) ta = 0; if (tb > 1) tb = 1;
          if (ta > tb) continue;
          const xA = x0 + ex_ * ta, xB = x0 + ex_ * tb;
          const lo = Math.floor((xA < xB ? xA : xB) - reach), hi = Math.ceil((xA > xB ? xA : xB) + reach);
          if (lo > xa) xa = lo; if (hi < xb) xb = hi;
        }
        const lrow = (py - by) * bw - bx;
        const grow = py * W;
        for (let px = xa; px <= xb; px++) {
          const qx = px + 0.5 - x0;
          const tu = (qx * ex_ + qy * ey_) * inv2;
          let t = tu < 0 ? 0 : tu > 1 ? 1 : tu;
          const dx = qx - ex_ * t, dy = qy - ey_ * t;
          const r = r0 + dr * t;
          const aa = r * soft > 0.7 ? r * soft : 0.7;
          const d2 = dx * dx + dy * dy;
          const lim = r + aa * 0.5;
          if (d2 >= lim * lim) continue;
          let a;
          const inner = r - aa * 0.5;
          if (inner > 0 && d2 <= inner * inner) a = 1;
          else {
            a = (r - Math.sqrt(d2)) / aa + 0.5;
            if (a > 1) a = 1;
            if (a <= 0) continue;
          }
          if (r < 0.5) a *= r * 2; // líneas finísimas: menos cobertura
          const li = lrow + px;
          const prev = A[li];
          if (a > prev) {
            if (prev === 0) this._push(li, grow + px);
            A[li] = a;
            // en los extremos u sale de [0,1]: permite remates irregulares
            U[li] = (s0 + ((capA && tu < 0) || (capB && tu > 1) ? tu : t) * len) * invTotal;
            const v = (dx * nx + dy * ny) / (r > 0.3 ? r : 0.3);
            V[li] = v < -1 ? -1 : v > 1 ? 1 : v;
          }
        }
      }
    }
    return this.nt;
  }

  clear() {
    const A = this.A, tl = this.tl;
    for (let k = 0; k < this.nt; k++) A[tl[k]] = 0;
    this.nt = 0;
  }
}

/** Mezcla Fisher–Yates de un Int32Array (in-place). */
function shuffle(arr, n, rand) {
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}

module.exports = { StrokePath, StrokeRaster, traceStroke, wobblePath, shuffle, MAXPTS };
