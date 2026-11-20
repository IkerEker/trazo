// Trazo · diagnóstico del anfitrión (UXP de Photoshop): qué hay para acelerar y cuánto tarda cada cosa.
// Escribe diagnostico.json en la carpeta de datos del plugin y lo muestra en el panel para copiarlo.
const ps = require("photoshop");
const uxp = require("uxp");
const { app, core, imaging, action } = ps;
const $ = (id) => document.getElementById(id);
const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

function probe(name, fn) {
  try { const v = fn(); return v === undefined ? "sí" : v; } catch (e) { return "no (" + (e && e.message ? e.message : e) + ")"; }
}

async function run() {
  const r = { fecha: new Date().toISOString(), host: {}, apis: {}, tiempos_ms: {} };
  try { r.host = { photoshop: app.version, uxp: uxp.versions ? uxp.versions.uxp : "?", plugin: uxp.versions ? uxp.versions.plugin : "?", so: require("os").platform ? require("os").platform() + " " + require("os").release() : "?" }; } catch (e) { r.host.error = String(e); }
  try { const os = require("os"); r.host.cpus = os.cpus ? os.cpus().length : "?"; r.host.ram_gb = os.totalmem ? Math.round(os.totalmem() / 2 ** 30) : "?"; } catch (e) { /* nada */ }
  // GPU por WebGL (canvas)
  r.apis.canvas = probe("canvas", () => { const c = document.createElement("canvas"); return c && typeof c.getContext === "function" ? "sí" : "no"; });
  for (const kind of ["webgl2", "webgl", "experimental-webgl", "2d"]) {
    r.apis["contexto_" + kind] = probe(kind, () => {
      const c = document.createElement("canvas"); c.width = 16; c.height = 16;
      const g = c.getContext(kind);
      if (!g) return "no";
      if (kind.indexOf("webgl") >= 0) {
        const d = g.getExtension && g.getExtension("WEBGL_debug_renderer_info");
        return "sí · " + (d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) + " · float=" + !!(g.getExtension && g.getExtension("EXT_color_buffer_float"));
      }
      return "sí";
    });
  }
  r.apis.OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? "sí" : "no";
  r.apis.gpu_webgpu = typeof navigator !== "undefined" && navigator.gpu ? "sí" : "no";
  r.apis.Worker = typeof Worker !== "undefined" ? probe("worker", () => { const w = new Worker("data:,"); w.terminate(); return "sí"; }) : "no";
  r.apis.WebAssembly = typeof WebAssembly !== "undefined" ? probe("wasm", () => { new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); return "sí"; }) : "no";
  r.apis.SharedArrayBuffer = typeof SharedArrayBuffer !== "undefined" ? "sí" : "no";
  r.apis.SIMD_wasm = "sin probar";
  r.apis.imaging = imaging ? Object.keys(imaging).join(",") : "no";
  // velocidad del JS (mismo bucle que tools/bench.js --micro)
  let t = now(); let s = 0; const a = new Float32Array(1 << 22);
  for (let k = 0; k < 8; k++) for (let i = 0; i < a.length; i++) { a[i] = a[i] * 0.5 + i * 1e-6; s += a[i]; }
  r.tiempos_ms.js_bucle_32M = Math.round(now() - t);
  t = now(); await new Promise((res) => setTimeout(res, 0)); r.tiempos_ms.setTimeout0 = +(now() - t).toFixed(2);
  t = now(); for (let i = 0; i < 50; i++) await new Promise((res) => setTimeout(res, 0)); r.tiempos_ms.setTimeout0_x50 = Math.round(now() - t);
  // intercambio de píxeles con el documento activo
  const doc = app.activeDocument;
  if (doc) {
    await core.executeAsModal(async () => {
      const W = doc.width, H = doc.height;
      r.documento = { w: W, h: H, modo: String(doc.mode), bits: String(doc.bitsPerChannel) };
      let t0 = now();
      const g = await imaging.getPixels({ documentID: doc.id, colorSpace: "RGB", componentSize: 8 });
      r.tiempos_ms.getPixels = Math.round(now() - t0);
      t0 = now();
      const data = await g.imageData.getData({ chunky: true });
      r.tiempos_ms.getData = Math.round(now() - t0);
      const w = g.imageData.width, h = g.imageData.height, comps = g.imageData.components;
      g.imageData.dispose();
      const rgba = new Uint8Array(w * h * 4);
      for (let i = 0, j = 0; i < w * h; i++, j += comps) { rgba[i * 4] = data[j]; rgba[i * 4 + 1] = data[j + 1]; rgba[i * 4 + 2] = data[j + 2]; rgba[i * 4 + 3] = 255; }
      t0 = now();
      const id = await imaging.createImageDataFromBuffer(rgba, { width: w, height: h, components: 4, chunky: true, colorSpace: "RGB" });
      r.tiempos_ms.createImageData = Math.round(now() - t0);
      t0 = now();
      const layer = await doc.createLayer({ name: "trazo-diagnostico" });
      r.tiempos_ms.crearCapa = Math.round(now() - t0);
      t0 = now();
      await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: id, replace: true });
      r.tiempos_ms.putPixels = Math.round(now() - t0);
      id.dispose();
      t0 = now();
      await layer.delete();
      r.tiempos_ms.borrarCapa = Math.round(now() - t0);
    }, { commandName: "Trazo diagnóstico" });
  } else r.documento = "no hay documento abierto: abre uno para medir getPixels/putPixels";
  const txt = JSON.stringify(r, null, 1);
  $("out").value = txt;
  try {
    const f = await uxp.storage.localFileSystem.getDataFolder();
    const file = await f.createFile("diagnostico.json", { overwrite: true });
    await file.write(txt);
    $("st").textContent = "Guardado en " + file.nativePath + " · copia el texto y pégaselo a Claude.";
  } catch (e) { $("st").textContent = "Copia el texto y pégaselo a Claude."; }
}
$("go").addEventListener("click", () => { $("st").textContent = "Comprobando…"; run().catch((e) => { $("st").textContent = "Error: " + e.message; }); });
