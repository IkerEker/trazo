// Simulador de Photoshop + sistema de archivos para probar Trazo · Captura en un navegador.
(function () {
  const q = new URLSearchParams(location.search);
  const log = (window.__psLog = []);
  const res = +(q.get("ppi") || 600);
  const doc = {
    id: 3, title: q.get("title") || "escaneo.tif", resolution: res, mode: q.get("mode") || "RGBColorMode",
    bitsPerChannel: q.get("bits") === "16" ? "bitDepth16" : "bitDepth8",
    width: Math.round(20 / 2.54 * res), height: Math.round(20 / 2.54 * res),
    saveAs: { async png(file, opts, asCopy) { log.push(["saveAs.png", file.name, asCopy]); folder._files.add(file.name); } },
    guides: { add(dir, c) { log.push(["guide", dir, c]); } },
  };
  let canvas = null;
  const ready = new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      canvas = document.createElement("canvas");
      canvas.width = 800; canvas.height = 800;
      const g = canvas.getContext("2d");
      g.fillStyle = q.has("burn") ? "#ffffff" : "#ebe8e1"; g.fillRect(0, 0, 800, 800);
      g.globalAlpha = q.has("burn") ? 0.25 : 0.9;
      g.drawImage(im, 100, 250, 600, 340);
      resolve();
    };
    im.src = "/tools/img/faro.png";
  });
  function imageData(data, w, h, comps) {
    return { width: w, height: h, components: comps, componentSize: 8, async getData() { return data; }, dispose() {} };
  }
  const imaging = {
    async getPixels(o) {
      await ready;
      const W = doc.width, H = doc.height;
      const b = o.sourceBounds || { left: 0, top: 0, right: W, bottom: H };
      const sw = b.right - b.left, sh = b.bottom - b.top;
      let w = sw, h = sh;
      if (o.targetSize && o.targetSize.width) { w = o.targetSize.width; h = Math.round(sh * w / sw); }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d");
      g.drawImage(canvas, b.left * 800 / W, b.top * 800 / H, sw * 800 / W, sh * 800 / H, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      const rgb = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; }
      log.push(["getPixels", w, h]);
      return { imageData: imageData(rgb, w, h, 3), sourceBounds: b };
    },
    async createImageDataFromBuffer(buf, o) { return imageData(buf, o.width, o.height, o.components); },
    async putPixels(o) { log.push(["putPixels", o.imageData.width, o.targetBounds.left, o.targetBounds.top, o.replace]); },
  };
  const folder = {
    name: "Trazo-escaneos", nativePath: "/Users/artista/Documentos/Trazo-escaneos", isFolder: true,
    _files: new Set((q.get("files") || "GOUACHE_H01_R000.png,GOUACHE_H01_R090.png,LAPIZ_H01_R000.png").split(",").filter(Boolean)),
    async getEntries() { return [...this._files].map((n) => ({ name: n, isFolder: false })); },
    async getEntry(n) { if (!this._files.has(n)) throw new Error("no existe"); return { name: n }; },
    async createFile(n) { return { name: n }; },
  };
  const ps = {
    app: {
      get activeDocument() { return q.has("nodoc") ? null : doc; },
      async createDocument(o) {
        log.push(["createDocument", o.width, o.height, o.resolution, o.fill]);
        return { id: 9, guides: doc.guides, async createPixelLayer(l) { log.push(["layer", l.name]); return { id: 21 }; } };
      },
    },
    core: { async executeAsModal(fn, o) { log.push(["modal", o.commandName]); return fn({}); } },
    imaging,
    action: { addNotificationListener() {} },
    constants: { DocumentFill: { WHITE: "white" }, Direction: { HORIZONTAL: "horizontal", VERTICAL: "vertical" } },
  };
  const uxp = { storage: { localFileSystem: {
    async getFolder() { log.push(["getFolder"]); return folder; },
    async createPersistentToken() { return "tok-1"; },
    async getEntryForPersistentToken() { return folder; },
  } } };
  window.require = (n) => (n === "photoshop" ? ps : n === "uxp" ? uxp : null);
})();
