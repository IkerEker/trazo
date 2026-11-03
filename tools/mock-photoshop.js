// Simulador mínimo de la API UXP de Photoshop para probar el panel en un navegador.
(function () {
  const params = new URLSearchParams(location.search);
  const imgName = params.get("img") || "faro";
  const noDoc = params.has("nodoc");
  const log = (window.__psLog = []);
  const doc = {
    id: 7, title: imgName + ".jpg", mode: "RGBColorMode", bitsPerChannel: "bitDepth8", resolution: 300,
    width: 0, height: 0, _rgba: null, _layers: [], selection: { bounds: params.has("sel") ? { left: 100, top: 40, right: 400, bottom: 300 } : null },
  };
  const bg = { id: 1, name: "Fondo", kind: "pixel", isBackgroundLayer: true, visible: true };
  doc._layers.push(bg);
  doc.layers = doc._layers;
  doc.activeLayers = [bg];
  let nextId = 10;
  function mkLayer(name, kind) {
    const l = { id: nextId++, name, kind: kind || "pixel", visible: true, layers: kind === "group" ? [] : undefined,
      move(rel, where) { log.push(["move", this.name, rel.name, where]); } };
    return l;
  }
  doc.createPixelLayer = async ({ name }) => { const l = mkLayer(name); doc._layers.unshift(l); doc.activeLayers = [l]; log.push(["createPixelLayer", name]); return l; };
  doc.createLayerGroup = async ({ name, fromLayers }) => { const g = mkLayer(name, "group"); g.layers = fromLayers; doc._layers = doc._layers.filter((l) => !fromLayers.includes(l)); doc._layers.unshift(g); doc.layers = doc._layers; doc.activeLayers = [g]; log.push(["group", name, fromLayers.map((l) => l.name)]); return g; };
  Object.defineProperty(bg, "boundsNoEffects", { get: () => ({ left: 0, top: 0, right: doc.width, bottom: doc.height }) });
  Object.defineProperty(bg, "bounds", { get: () => ({ left: 0, top: 0, right: doc.width, bottom: doc.height }) });

  const ready = new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const scale = +(params.get("scale") || 1);
      const c = document.createElement("canvas");
      c.width = Math.round(im.width * scale); c.height = Math.round(im.height * scale);
      const g = c.getContext("2d"); g.drawImage(im, 0, 0, c.width, c.height);
      doc.width = c.width; doc.height = c.height;
      doc._canvas = c;
      doc._rgba = g.getImageData(0, 0, c.width, c.height).data;
      resolve();
    };
    im.src = "/tools/img/" + imgName + ".png";
  });
  window.__psReady = ready;

  function imageData(data, w, h, comps, profile) {
    return { width: w, height: h, components: comps, colorProfile: profile || "sRGB IEC61966-2.1", componentSize: 8,
      async getData() { return data; }, dispose() {} };
  }
  const imaging = {
    async getPixels(o) {
      await ready;
      const b = o.sourceBounds || { left: 0, top: 0, right: doc.width, bottom: doc.height };
      const sw = b.right - b.left, sh = b.bottom - b.top;
      let w = sw, h = sh;
      if (o.targetSize) {
        if (o.targetSize.width && o.targetSize.height) { w = o.targetSize.width; h = o.targetSize.height; }
        else if (o.targetSize.width) { w = o.targetSize.width; h = Math.round(sh * w / sw); }
        else { h = o.targetSize.height; w = Math.round(sw * h / sh); }
      }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); g.drawImage(doc._canvas, b.left, b.top, sw, sh, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      const rgb = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; }
      log.push(["getPixels", w, h, o.layerID]);
      return { imageData: imageData(rgb, w, h, 3), sourceBounds: b, level: 0 };
    },
    async getSelection(o) {
      if (!doc.selection.bounds) throw new Error("sin selección");
      const w = o.targetSize.width, h = o.targetSize.height, m = new Uint8Array(w * h);
      const sb = doc.selection.bounds, fx = doc.width / w, fy = doc.height / h;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const X = x * fx, Y = y * fy;
        m[y * w + x] = X >= sb.left && X < sb.right && Y >= sb.top && Y < sb.bottom ? 255 : 0;
      }
      return { imageData: imageData(m, w, h, 1), sourceBounds: o.sourceBounds };
    },
    async createImageDataFromBuffer(buf, o) { return imageData(buf, o.width, o.height, o.components, o.colorProfile); },
    async encodeImageData({ imageData: id }) {
      const c = document.createElement("canvas"); c.width = id.width; c.height = id.height;
      const g = c.getContext("2d"); const out = g.createImageData(id.width, id.height); const d = await id.getData();
      for (let i = 0; i < id.width * id.height; i++) { out.data[i * 4] = d[i * 3]; out.data[i * 4 + 1] = d[i * 3 + 1]; out.data[i * 4 + 2] = d[i * 3 + 2]; out.data[i * 4 + 3] = 255; }
      g.putImageData(out, 0, 0);
      return c.toDataURL("image/jpeg", 0.9).split(",")[1];
    },
    async putPixels(o) {
      const id = o.imageData; const d = await id.getData();
      log.push(["putPixels", o.layerID, id.width, id.height, id.components, o.targetBounds]);
      const c = document.createElement("canvas"); c.width = id.width; c.height = id.height;
      const g = c.getContext("2d"); const out = g.createImageData(id.width, id.height);
      out.data.set(d); g.putImageData(out, 0, 0);
      (window.__putImages = window.__putImages || []).push(c.toDataURL("image/png"));
    },
  };
  const ctx = {
    isCancelled: false, reportProgress(p) { window.__lastProgress = p; },
    hostControl: { async suspendHistory(o) { log.push(["suspendHistory", o.name]); return { id: 1 }; }, async resumeHistory(s, ok) { log.push(["resumeHistory", ok]); } },
  };
  const ps = {
    app: { get activeDocument() { return noDoc ? null : doc; }, get documents() { return noDoc ? [] : [doc]; }, async createDocument() { throw new Error("no simulado"); } },
    core: { async executeAsModal(fn, o) { log.push(["modal", o.commandName]); return fn(ctx); }, showAlert(m) { log.push(["alert", m]); } },
    action: { addNotificationListener(ev, fn) { window.__notify = fn; }, async batchPlay(cmds) { log.push(["batchPlay", JSON.stringify(cmds)]); return []; } },
    imaging,
    constants: { ElementPlacement: { PLACEBEFORE: "placeBefore", PLACEAFTER: "placeAfter" }, LayerKind: { NORMAL: "pixel", GROUP: "group" } },
  };
  const uxp = { storage: { localFileSystem: { async getFileForSaving() { return null; } } } };
  window.require = (n) => (n === "photoshop" ? ps : n === "uxp" ? uxp : null);
})();
