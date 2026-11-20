// Trazo · banco de pruebas fijo (velocidad) y prueba exacta (resultado idéntico).
//
// Usa el motor que va dentro del plugin (plugin/js/engine.js) y las texturas de plugin/textures.
// No necesita ffmpeg, Photoshop ni internet: las imágenes de prueba se generan aquí, siempre iguales.
//
//   node tools/bench.js                 mide las 29 variantes y escribe tools/bench_out/bench_<fecha>.json
//   node tools/bench.js --check         además compara con tools/ref/ (md5 de los .bin y huellas de los renders)
//   node tools/bench.js --ref           guarda las huellas actuales como referencia en tools/ref/
//   opciones: --solo oleo,lapiz   --tam 1000 (lado largo)   --rep 2 (1.ª en frío; las demás reutilizan el análisis)   --sin-procedural
//
// Fases medidas por variante: cargar texturas (leer + parsear, como el panel: una vez por técnica),
// cada fase del motor (las etiquetas de progreso), aplanar. El intercambio de píxeles con Photoshop
// solo se puede medir dentro de Photoshop (ver «tiempos» en el panel).
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const TEX = process.argv.includes("--tex") ? path.resolve(process.argv[process.argv.indexOf("--tex") + 1]) : path.join(ROOT, "plugin", "textures");
const REF = path.join(__dirname, "ref");
const OUT = path.join(__dirname, "bench_out");
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };

const Engine = require(a.includes("--motor") ? path.resolve(opt("--motor")) : path.join(ROOT, "plugin", "js", "engine.js"));
const T = Engine.Techniques;

// ------------------------------------------------------------ imagen de prueba (determinista, solo + * / sqrt)
function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a0 = hash(xi, yi, s), a1 = hash(xi + 1, yi, s), b0 = hash(xi, yi + 1, s), b1 = hash(xi + 1, yi + 1, s);
  return (a0 + (a1 - a0) * sx) + ((b0 + (b1 - b0) * sx) - (a0 + (a1 - a0) * sx)) * sy;
}
function escena(W, H) {
  const d = new Uint8Array(W * H * 4);
  const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const n = vnoise(x / 40, y / 40, 1) * 0.6 + vnoise(x / 9, y / 9, 2) * 0.4;
      // cielo
      let r = 90 + 120 * v, g = 140 + 90 * v, b = 220 - 20 * v;
      // sol
      const ds = Math.sqrt((u - 0.78) * (u - 0.78) + (v - 0.2) * (v - 0.2) * 0.5);
      if (ds < 0.08) { const k = ds < 0.06 ? 1 : (0.08 - ds) / 0.02; r += (255 - r) * k; g += (215 - g) * k; b += (90 - b) * k; }
      // colinas (onda triangular suavizada)
      const t = (u * 3.3) % 1, tri = t < 0.5 ? t * 2 : 2 - t * 2;
      const hill = 0.58 + 0.08 * tri * tri * (3 - 2 * tri) + 0.03 * vnoise(x / 60, 0, 3);
      if (v > hill) { const k = (v - hill) * 2; r = 60 + 50 * n - 20 * k; g = 120 + 60 * n - 30 * k; b = 50 + 20 * n; }
      // casa
      if (u > 0.12 && u < 0.36 && v > 0.42 && v < 0.72) {
        r = 205 + 20 * n; g = 190 + 15 * n; b = 170;
        if (u > 0.17 && u < 0.23 && v > 0.5 && v < 0.6) { r = 40; g = 50; b = 70; }
        if (u > 0.27 && u < 0.32 && v > 0.58) { r = 110; g = 60; b = 35; }
      }
      const roof = 0.42 - (0.12 - Math.abs(u - 0.24)) * 0.9;
      if (u > 0.1 && u < 0.38 && v > roof && v <= 0.42) { r = 170 + 30 * n; g = 50; b = 40; }
      // cara (piel, ojos, boca)
      const ex = (u - 0.6) / 0.11, ey = (v - 0.55) / 0.17, e = ex * ex + ey * ey;
      if (e < 1) {
        const sh = 0.75 + 0.25 * (1 - ex) * 0.5;
        r = (225 + 15 * n) * sh; g = (175 + 10 * n) * sh; b = 145 * sh;
        for (const ox of [-0.35, 0.35]) { const q = (ex - ox) * (ex - ox) * 9 + (ey + 0.2) * (ey + 0.2) * 25; if (q < 1) { r = 35; g = 30; b = 30; } }
        if (Math.abs(ey - 0.45) < 0.05 && Math.abs(ex) < 0.35) { r = 150; g = 50; b = 55; }
      }
      if (ex * ex + (ey + 0.55) * (ey + 0.55) * 1.6 < 1.1 && ey < -0.6) { r = 50 + 30 * n; g = 35 + 20 * n; b = 25; } // pelo
      const o = (y * W + x) * 4;
      d[o] = cl(r); d[o + 1] = cl(g); d[o + 2] = cl(b); d[o + 3] = 255;
    }
  }
  return { width: W, height: H, data: d, components: 4 };
}

// ------------------------------------------------------------ utilidades
const md5f = (f) => crypto.createHash("md5").update(fs.readFileSync(f)).digest("hex");
const sha = (...arrs) => { const h = crypto.createHash("sha256"); for (const x of arrs) if (x) h.update(Buffer.from(x.buffer, x.byteOffset, x.byteLength)); return h.digest("hex").slice(0, 16); };
const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e5) / 10;

async function main() {
  const L = +opt("--tam", 1000);
  const W = L, H = Math.round(L * 0.75);
  const reps = +opt("--rep", 2);
  const solo = opt("--solo", null);
  const techs = T.TECHNIQUES.map((t) => t.id).filter((id) => !solo || solo.split(",").includes(id));
  const img = escena(W, H);
  const r = {
    fecha: new Date().toISOString(), version: (Engine.VERSION || require(path.join(ROOT, "plugin", "manifest.json")).version),
    maquina: { so: `${os.type()} ${os.release()}`, cpu: os.cpus()[0].model, nucleos: os.cpus().length, ram_gb: Math.round(os.totalmem() / 2 ** 30), node: process.version },
    imagen: `escena sintética ${W}x${H}`, semilla: 7, papel: true,
    texturas_md5: {}, variantes: [], procedural: [],
  };
  for (const f of fs.readdirSync(TEX).filter((f) => f.endsWith(".bin")).sort()) r.texturas_md5[f] = md5f(path.join(TEX, f));

  const cache = {};
  const load = (nm) => {
    if (nm in cache) return { tex: cache[nm], t: 0 };
    const t0 = process.hrtime.bigint();
    const f = path.join(TEX, nm + ".bin");
    cache[nm] = fs.existsSync(f) ? Engine.parseTexture(fs.readFileSync(f)) : null;
    return { tex: cache[nm], t: ms(t0) };
  };
  const quiet = { yieldFn: () => Promise.resolve(), sliceMs: 1e9 };

  for (const tech of techs) {
    const def = T.TECHNIQUES.find((t) => t.id === tech);
    for (const v of def.variants) {
      let tcarga = 0;
      const assets = {};
      for (const nm of Engine.ASSETS_FOR[tech] || []) { const x = load(nm); tcarga += x.t; if (x.tex) assets[nm] = x.tex; }
      const s = load("soporte-" + Engine.SUPPORT_FOR[tech]); tcarga += s.t;
      const params = Object.assign({}, def.defaults, v.values, { modo: v.id });
      let best = null, huella = null, frio = null;
      if (Engine.clearMemo) Engine.clearMemo(); // la 1.ª pasada siempre en frío (sin análisis guardado)
      for (let k = 0; k < reps; k++) {
        const fases = {}; let last = null, lt = process.hrtime.bigint();
        const t0 = process.hrtime.bigint();
        const res = await Engine.render(img, { technique: tech, params, seed: 7, paper: true, assets, support: s.tex }, Object.assign({
          onProgress: (f, label) => { if (label !== last) { const now = process.hrtime.bigint(); if (last) fases[last] = (fases[last] || 0) + ms(lt); last = label; lt = now; } },
        }, quiet));
        if (last) fases[last] = (fases[last] || 0) + ms(lt);
        const tm = ms(t0);
        const ta = process.hrtime.bigint();
        Engine.flatten(res.paint, res.paper, res.width, res.height);
        const tflat = ms(ta);
        const h = sha(res.paint, res.paper);
        if (huella && h !== huella) throw new Error(`${tech}/${v.id}: dos pasadas dan distinto (no determinista)`);
        huella = h;
        if (k === 0) { frio = { motor_ms: tm, fases, aplanar_ms: tflat }; continue; }
        if (!best || tm < best.motor_ms) best = { motor_ms: tm, fases, aplanar_ms: tflat };
      }
      const mem = process.memoryUsage();
      const row = { tecnica: tech, variante: v.id, carga_texturas_ms: tcarga, ...frio, repetir_ms: best ? best.motor_ms : null, repetir_fases: best ? best.fases : null, huella, heap_mb: Math.round(mem.heapUsed / 2 ** 20), rss_mb: Math.round(mem.rss / 2 ** 20) };
      r.variantes.push(row);
      console.log(`${(tech + "/" + v.id).padEnd(24)} ${String(frio.motor_ms).padStart(8)} ms${best ? "  repetir " + String(best.motor_ms).padStart(8) + " ms" : ""}  texturas ${String(tcarga).padStart(6)} ms  ${huella}`);
    }
    if (!a.includes("--sin-procedural")) {
      // sin material: el camino de reserva también tiene que seguir igual
      const small = escena(480, 360);
      const res = await Engine.render(small, { technique: tech, params: Object.assign({}, def.defaults), seed: 7, paper: true, assets: {}, support: null }, quiet);
      r.procedural.push({ tecnica: tech, huella: sha(res.paint, res.paper) });
    }
  }
  r.total_motor_ms = Math.round(r.variantes.reduce((s, x) => s + x.motor_ms, 0));
  if (reps > 1) r.total_repetir_ms = Math.round(r.variantes.reduce((s, x) => s + x.repetir_ms, 0));
  r.rss_pico_mb = Math.round(process.resourceUsage().maxRSS / 1024);
  console.log(`total motor ${r.total_motor_ms} ms${r.total_repetir_ms ? " · al repetir " + r.total_repetir_ms + " ms" : ""} · pico RAM ${r.rss_pico_mb} MB`);

  fs.mkdirSync(OUT, { recursive: true });
  const outf = path.join(OUT, `bench_${r.fecha.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outf, JSON.stringify(r, null, 1));
  console.log("→ " + outf);

  const huellas = { imagen: r.imagen, semilla: 7, variantes: Object.fromEntries(r.variantes.map((x) => [x.tecnica + "/" + x.variante, x.huella])), procedural: Object.fromEntries(r.procedural.map((x) => [x.tecnica, x.huella])) };
  if (a.includes("--ref")) {
    fs.mkdirSync(REF, { recursive: true });
    fs.writeFileSync(path.join(REF, "textures.md5.json"), JSON.stringify(r.texturas_md5, null, 1));
    fs.writeFileSync(path.join(REF, `renders_${L}.json`), JSON.stringify(huellas, null, 1));
    console.log("referencia guardada en tools/ref/");
  }
  if (a.includes("--check")) {
    const bad = [];
    const rt = JSON.parse(fs.readFileSync(path.join(REF, "textures.md5.json")));
    for (const k of new Set([...Object.keys(rt), ...Object.keys(r.texturas_md5)])) if (rt[k] !== r.texturas_md5[k]) bad.push(`textura ${k}: ${rt[k]} → ${r.texturas_md5[k]}`);
    const rf = path.join(REF, `renders_${L}.json`);
    if (!fs.existsSync(rf)) bad.push(`no hay referencia de renders a ${L} px`);
    else {
      const rr = JSON.parse(fs.readFileSync(rf));
      for (const [k, h] of Object.entries(huellas.variantes)) if (rr.variantes[k] !== h) bad.push(`render ${k}: ${rr.variantes[k]} → ${h}`);
      for (const [k, h] of Object.entries(huellas.procedural)) if (rr.procedural[k] && rr.procedural[k] !== h) bad.push(`procedural ${k}: ${rr.procedural[k]} → ${h}`);
    }
    console.log(bad.length ? "DISTINTO:\n  " + bad.join("\n  ") : "IDÉNTICO (" + Object.keys(rt).length + " .bin y " + Object.keys(huellas.variantes).length + " renders)");
    process.exitCode = bad.length ? 1 : 0;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
