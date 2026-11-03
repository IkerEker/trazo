/*
 * Trazo · puente con Photoshop (UXP)
 * Lectura de píxeles y selección, creación de capas, historial y exportación.
 * Expone window.TrazoPS.
 */
(function (root) {
  "use strict";
  const ps = require("photoshop");
  const { app, core, action, imaging, constants } = ps;
  const uxp = require("uxp");

  const SRGB = "sRGB IEC61966-2.1";

  function activeDoc() {
    try { return app.activeDocument || null; } catch (e) { return null; }
  }

  function findDoc(id) {
    try {
      const docs = app.documents;
      for (let i = 0; i < docs.length; i++) if (docs[i].id === id) return docs[i];
    } catch (e) { /* sin documentos */ }
    return null;
  }

  function findLayer(layers, id) {
    if (!layers) return null;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (l.id === id) return l;
      if (l.layers && l.layers.length) {
        const f = findLayer(l.layers, id);
        if (f) return f;
      }
    }
    return null;
  }

  function isRGB(doc) {
    const m = String(doc.mode || "").toLowerCase();
    return m.indexOf("rgb") >= 0;
  }

  function isPixelLayer(layer) {
    if (!layer) return false;
    const k = String(layer.kind || "").toLowerCase();
    return k === "pixel" || k === "normal" || layer.isBackgroundLayer === true || (constants.LayerKind && layer.kind === constants.LayerKind.NORMAL);
  }

  function boundsOf(b) {
    const left = Math.round(+b.left), top = Math.round(+b.top);
    const right = Math.round(+b.right), bottom = Math.round(+b.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  /**
   * Describe qué se va a pintar: la capa de píxeles activa o, si no lo es,
   * la imagen combinada del documento.
   */
  function describeTarget() {
    const doc = activeDoc();
    if (!doc) return { error: "Abre una imagen en Photoshop" };
    if (!isRGB(doc)) return { error: "El documento debe estar en modo RGB (Imagen › Modo › Color RGB)", doc };
    const bits = String(doc.bitsPerChannel || "").toLowerCase();
    if (bits.indexOf("32") >= 0 || bits.indexOf("thirtytwo") >= 0) return { error: "Documentos de 32 bits no admitidos: pásalo a 8 o 16 bits", doc };
    let layer = null;
    try { const a = doc.activeLayers; if (a && a.length) layer = a[0]; } catch (e) { layer = null; }
    let bounds, useLayer = false, label;
    if (layer && isPixelLayer(layer)) {
      let b = null;
      try { b = layer.boundsNoEffects || layer.bounds; } catch (e) { b = null; }
      if (b) {
        bounds = boundsOf(b);
        if (bounds.width > 0 && bounds.height > 0) useLayer = true;
      }
    }
    if (useLayer) {
      label = "Capa: " + layer.name;
    } else {
      bounds = { left: 0, top: 0, right: Math.round(doc.width), bottom: Math.round(doc.height), width: Math.round(doc.width), height: Math.round(doc.height) };
      label = layer ? "Imagen combinada (la capa activa no es de píxeles)" : "Imagen combinada";
    }
    // Intersección con el lienzo
    const dw = Math.round(doc.width), dh = Math.round(doc.height);
    const cl = Math.max(0, bounds.left), ct = Math.max(0, bounds.top);
    const cr = Math.min(dw, bounds.right), cb = Math.min(dh, bounds.bottom);
    if (cr - cl < 4 || cb - ct < 4) return { error: "La capa está vacía o fuera del lienzo", doc };
    bounds = { left: cl, top: ct, right: cr, bottom: cb, width: cr - cl, height: cb - ct };
    return {
      doc, docId: doc.id, layer: useLayer ? layer : null, layerId: useLayer ? layer.id : null,
      bounds, label, docName: doc.title || doc.name || "Documento", is16: bits.indexOf("16") >= 0 || bits.indexOf("sixteen") >= 0,
    };
  }

  /** Lee los píxeles del objetivo, escalados para que el lado largo sea ≤ maxLong. */
  async function readSource(target, maxLong) {
    const b = target.bounds;
    const opts = {
      documentID: target.docId,
      sourceBounds: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
      colorSpace: "RGB",
      componentSize: 8,
    };
    if (target.layerId != null) opts.layerID = target.layerId;
    const long = Math.max(b.width, b.height);
    let scaled = false;
    if (maxLong && long > maxLong) {
      scaled = true;
      if (b.width >= b.height) opts.targetSize = { width: Math.round(maxLong) };
      else opts.targetSize = { height: Math.round(maxLong) };
    }
    const res = await imaging.getPixels(opts);
    const id = res.imageData;
    try {
      const data = await id.getData({ chunky: true });
      const out = {
        data: data, width: id.width, height: id.height, components: id.components,
        profile: id.colorProfile || "", bounds: b, scaled,
      };
      if (!scaled && res.sourceBounds) {
        const rb = boundsOf(res.sourceBounds);
        if (rb.width === id.width && rb.height === id.height) out.bounds = rb;
      }
      return out;
    } finally {
      id.dispose();
    }
  }

  /** Máscara de selección (0..255) del tamaño pedido, o null si no hay selección. */
  async function readSelection(target, w, h) {
    const doc = findDoc(target.docId);
    if (!doc) return null;
    try {
      const sb = doc.selection && doc.selection.bounds;
      if (!sb) return null;
    } catch (e) { /* API antigua: lo intentamos igualmente */ }
    const b = target.bounds;
    let res;
    try {
      res = await imaging.getSelection({
        documentID: target.docId,
        sourceBounds: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
        targetSize: { width: w, height: h },
      });
    } catch (e) { return null; }
    const id = res.imageData;
    try {
      const data = await id.getData({ chunky: true });
      let mask = data;
      if (id.width !== w || id.height !== h || id.components !== 1) {
        mask = new Uint8Array(w * h);
        const c = id.components;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const sx = Math.min(id.width - 1, Math.floor(x * id.width / w));
          const sy = Math.min(id.height - 1, Math.floor(y * id.height / h));
          mask[y * w + x] = data[(sy * id.width + sx) * c];
        }
      }
      let any = false;
      for (let i = 0; i < mask.length; i += 7) if (mask[i] > 0) { any = true; break; }
      return any ? (mask instanceof Uint8Array ? mask : Uint8Array.from(mask)) : null;
    } finally {
      id.dispose();
    }
  }

  /** RGB (3 canales) → URL data:image/jpeg para un <img>. */
  async function encodePreview(rgb, w, h) {
    const id = await imaging.createImageDataFromBuffer(rgb, {
      width: w, height: h, components: 3, chunky: true, colorSpace: "RGB", colorProfile: SRGB,
    });
    try {
      const b64 = await imaging.encodeImageData({ imageData: id, base64: true });
      return "data:image/jpeg;base64," + b64;
    } finally {
      id.dispose();
    }
  }

  async function makeImageData(rgba, w, h, profile, is16) {
    let buf = rgba;
    if (is16) {
      buf = new Uint16Array(rgba.length);
      for (let i = 0; i < rgba.length; i++) buf[i] = Math.round(rgba[i] * 32768 / 255);
    }
    const opt = { width: w, height: h, components: 4, chunky: true, colorSpace: "RGB" };
    if (profile) opt.colorProfile = profile;
    return imaging.createImageDataFromBuffer(buf, opt);
  }

  async function newPixelLayer(doc, name) {
    if (typeof doc.createPixelLayer === "function") return doc.createPixelLayer({ name });
    return doc.createLayer({ name });
  }

  /**
   * Crea el grupo con la pintura (y el papel) encima de la capa original.
   * Todo en un único paso del historial.
   */
  async function applyResult(job, ctx) {
    const doc = findDoc(job.docId);
    if (!doc) throw new Error("El documento ya no está abierto");
    const hc = ctx && ctx.hostControl;
    let susp = null;
    if (hc && hc.suspendHistory) susp = await hc.suspendHistory({ documentID: doc.id, name: "Trazo · " + job.name });
    let ok = false;
    try {
      const b = job.bounds;
      const src = job.layerId != null ? findLayer(doc.layers, job.layerId) : null;
      const created = [];
      let paperLayer = null;
      if (job.paper) {
        paperLayer = await newPixelLayer(doc, job.paperName);
        const pd = await makeImageData(job.paper, job.width, job.height, job.profile, job.is16);
        try {
          await imaging.putPixels({ documentID: doc.id, layerID: paperLayer.id, imageData: pd, replace: true, targetBounds: { left: b.left, top: b.top } });
        } finally { pd.dispose(); }
        created.push(paperLayer);
      }
      const paintLayer = await newPixelLayer(doc, job.name);
      const id = await makeImageData(job.paint, job.width, job.height, job.profile, job.is16);
      try {
        await imaging.putPixels({ documentID: doc.id, layerID: paintLayer.id, imageData: id, replace: true, targetBounds: { left: b.left, top: b.top } });
      } finally { id.dispose(); }
      created.unshift(paintLayer);

      // ordenar: pintura encima del papel
      if (paperLayer) {
        try { await paintLayer.move(paperLayer, constants.ElementPlacement.PLACEBEFORE); } catch (e) { /* ya está encima */ }
      }
      let group = null;
      try {
        group = await doc.createLayerGroup({ name: "Trazo · " + job.name, fromLayers: created });
      } catch (e) { group = null; }
      const top = group || paintLayer;
      if (src) {
        try { await top.move(src, constants.ElementPlacement.PLACEBEFORE); } catch (e) { /* mantener posición */ }
        if (job.hideOriginal) { try { src.visible = false; } catch (e) { /* capa bloqueada */ } }
        // volver a seleccionar la original: así se puede ajustar y regenerar
        try {
          await action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: src.id }], makeVisible: false }], {});
        } catch (e) { /* no es imprescindible */ }
      }
      ok = true;
      return { paintLayerId: paintLayer.id, docId: doc.id };
    } finally {
      if (susp) await hc.resumeHistory(susp, ok);
    }
  }

  function modal(fn, name) {
    return core.executeAsModal(fn, { commandName: name || "Trazo" });
  }

  /** Exporta una capa (con transparencia) a PNG. */
  async function exportLayerPNG(docId, layerId, suggested) {
    const fs = uxp.storage.localFileSystem;
    const file = await fs.getFileForSaving(suggested || "trazo.png", { types: ["png"] });
    if (!file) return { cancelled: true };
    await modal(async () => {
      const doc = findDoc(docId);
      if (!doc) throw new Error("El documento ya no está abierto");
      const layer = findLayer(doc.layers, layerId);
      if (!layer) throw new Error("No encuentro la capa de pintura (¿se ha borrado?)");
      const res = await imaging.getPixels({ documentID: docId, layerID: layerId, colorSpace: "RGB", componentSize: 8 });
      const src = res.imageData;
      let data, w, h, comps;
      try {
        data = await src.getData({ chunky: true });
        w = src.width; h = src.height; comps = src.components;
      } finally { src.dispose(); }
      let rgba = data;
      if (comps === 3) {
        rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) { rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
      }
      const nd = await app.createDocument({ width: w, height: h, resolution: doc.resolution || 300, mode: "RGBColorMode", fill: "transparent", name: "Trazo export" });
      try {
        const target = nd.layers[0];
        const id = await imaging.createImageDataFromBuffer(rgba, { width: w, height: h, components: 4, chunky: true, colorSpace: "RGB" });
        try {
          await imaging.putPixels({ documentID: nd.id, layerID: target.id, imageData: id, replace: true, targetBounds: { left: 0, top: 0 } });
        } finally { id.dispose(); }
        await nd.saveAs.png(file, { compression: 6 }, true);
      } finally {
        await nd.closeWithoutSaving();
      }
    }, "Trazo · Exportar PNG");
    return { file: file.name || "PNG" };
  }

  function onDocumentChange(handler) {
    try {
      action.addNotificationListener(["select", "open", "close", "make", "delete", "historyStateChanged"], handler);
    } catch (e) { /* sin notificaciones */ }
  }

  function alert(msg) {
    try { core.showAlert(msg); } catch (e) { /* nada */ }
  }

  root.TrazoPS = { describeTarget, readSource, readSelection, encodePreview, applyResult, modal, exportLayerPNG, onDocumentChange, alert, findDoc };
})(typeof window !== "undefined" ? window : globalThis);
