// Banco de pruebas del motor en Node.
// uso: node run.js <img> <tecnica> [json params] [salida.png] [--scale N] [--paper]
const { execFileSync } = require("child_process");
const path = require("path");
const Engine = require("../engine/index.js");

function load(file, scale) {
  const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]).toString().trim().split(",");
  let w = +probe[0], h = +probe[1];
  const args = ["-v", "error", "-i", file];
  if (scale && scale !== 1) { w = Math.round(w * scale); h = Math.round(h * scale); args.push("-vf", `scale=${w}:${h}:flags=lanczos`); }
  args.push("-f", "rawvideo", "-pix_fmt", "rgba", "-");
  const buf = execFileSync("ffmpeg", args, { maxBuffer: 1 << 30 });
  return { width: w, height: h, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.length), components: 4 };
}

function save(file, data, w, h, fmt) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", fmt, "-s", `${w}x${h}`, "-i", "-", file], { input: Buffer.from(data.buffer, data.byteOffset, data.length) });
}

(async () => {
  const a = process.argv.slice(2);
  const img = a[0], tech = a[1];
  const params = a[2] && a[2].startsWith("{") ? JSON.parse(a[2]) : {};
  const out = a.find((x) => x.endsWith(".png") && x !== img) || `out/${path.basename(img, ".png")}_${tech}.png`;
  const si = a.indexOf("--scale");
  const scale = si >= 0 ? +a[si + 1] : 1;
  const paper = a.includes("--paper");
  const seedI = a.indexOf("--seed");
  const input = load(img, scale);
  // material real de la técnica (desactivar con --procedural)
  let support = null; const assets = {};
  if (!a.includes("--procedural")) {
    const fs = require("fs");
    const tdir = path.join(__dirname, "..", "plugin", "textures");
    for (const nm of Engine.ASSETS_FOR[tech] || []) { const f = path.join(tdir, nm + ".bin"); if (fs.existsSync(f)) assets[nm] = Engine.parseTexture(fs.readFileSync(f)); }
    const sf = path.join(tdir, "soporte-" + Engine.SUPPORT_FOR[tech] + ".bin");
    if (fs.existsSync(sf)) support = Engine.parseTexture(fs.readFileSync(sf));
  }
  const library = null;
  if (a.includes("--twice")) await Engine.render(input, { technique: tech, params, seed: 2, assets, support }, { yieldFn: () => Promise.resolve(), sliceMs: 1000 });
  const t0 = Date.now();
  let lastLabel = "", lastT = t0;
  const res = await Engine.render(input, { technique: tech, params, seed: seedI >= 0 ? +a[seedI + 1] : 1, paper, assets, support }, {
    onProgress: (f, label) => {
      if (label !== lastLabel) { const now = Date.now(); if (lastLabel) process.stderr.write(`  ${lastLabel}: ${now - lastT} ms\n`); lastLabel = label; lastT = now; }
    },
    yieldFn: () => Promise.resolve(),
    sliceMs: 1000,
  });
  const ms = Date.now() - t0;
  const flat = Engine.flatten(res.paint, res.paper, res.width, res.height);
  save(out, flat, res.width, res.height, "rgb24");
  save(out.replace(/\.png$/, "_rgba.png"), res.paint, res.width, res.height, "rgba");
  console.log(`${tech} ${res.width}x${res.height} ${ms} ms → ${out}  (pico RAM ${(process.resourceUsage().maxRSS/1024).toFixed(0)} MB)`);
})().catch((e) => { console.error(e); process.exit(1); });
