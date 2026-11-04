// Visualiza la segmentación en manchas: color del modelo + bordes.
// uso: node tools/seg_debug.js img.png salida.png [detalle 0..1]
const { execFileSync } = require("child_process");
const C = require("../engine/core.js");
const { Context } = require("../engine/analysis.js");
const Seg = require("../engine/segment.js");
function load(file) {
  const pr = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]).toString().trim().split(",");
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 30 });
  return { width: +pr[0], height: +pr[1], data: new Uint8Array(buf.buffer, buf.byteOffset, buf.length), components: 4 };
}
(async () => {
  const [img, out, det] = process.argv.slice(2);
  const input = load(img);
  const clock = C.makeClock({ yieldFn: () => Promise.resolve(), sliceMs: 1e9 });
  const ctx = new Context(input, { seed: 1 });
  const t0 = Date.now();
  await ctx.buildBase(clock);
  await ctx.buildFlow({ flowSigma: 8 }, clock);
  const t1 = Date.now();
  const seg = await Seg.segment(ctx, { detail: det === undefined ? 0.55 : +det }, clock);
  const t2 = Date.now();
  const L = await Seg.fullLabels(ctx, seg, clock);
  const t3 = Date.now();
  const { W, H } = ctx;
  const o = new Uint8Array(W * H * 3), col = new Float32Array(3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, r = L[i];
    Seg.modelColor(seg, r, (x + 0.5) / W, (y + 0.5) / H, col);
    const edge = (x > 0 && L[i - 1] !== r) || (y > 0 && L[i - W] !== r);
    for (let c = 0; c < 3; c++) o[i * 3 + c] = edge ? 30 : col[c] * 255;
  }
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-i", "-", out], { input: Buffer.from(o.buffer) });
  console.log(`${img}: ${seg.reg.n} manchas (S=${seg.S}) · análisis ${t1 - t0} ms · segmentación ${t2 - t1} ms · etiquetas ${t3 - t2} ms`);
})().catch((e) => { console.error(e); process.exit(1); });
