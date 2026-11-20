/*
 * Trazo · Captura — panel de ayuda para pintar y escanear trazos reales.
 */
(function () {
  "use strict";
  const D = window.CapturaData;
  const ps = require("photoshop");
  const { app, core, imaging, constants, action } = ps;
  const lfs = require("uxp").storage.localFileSystem;
  const $ = (id) => document.getElementById(id);
  const KEY = "trazo.captura.v1";
  const ROTS = ["000", "090", "180", "270"];
  const NAME_RE = /^([A-Z]+)_H(\d{2})_R(000|090|180|270)\.(png|tif|tiff)$/i;

  /* ------------------------------------------------------------------ */
  /* estado                                                              */
  /* ------------------------------------------------------------------ */
  const state = {
    tab: "guia", open: { 0: true }, listTech: "gouache", checks: {},
    saveTech: "gouache", support: "lienzo", sheet: {}, rot: "000", folderToken: null,
  };
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (s && typeof s === "object") Object.assign(state, s);
    } catch (e) { /* sin almacenamiento */ }
  }
  let saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* nada */ } }, 200);
  }

  /* ------------------------------------------------------------------ */
  /* utilidades                                                          */
  /* ------------------------------------------------------------------ */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function img(src) { const i = el("img"); i.src = src; i.alt = ""; return i; }
  const onTap = (n, f) => n.addEventListener("click", f);
  function setOn(n, on) { if (n) { if (on) n.classList.add("on"); else n.classList.remove("on"); } }
  function setStatus(t, kind) { const s = $("status"); s.textContent = t; s.className = "status" + (kind ? " " + kind : ""); }
  const pad2 = (n) => (n < 10 ? "0" : "") + n;
  const techById = (id) => D.TECHS.find((t) => t.id === id);
  const errMsg = (e) => String(e && e.message ? e.message : e);

  function activeDoc() { try { return app.activeDocument || null; } catch (e) { return null; } }

  /* ------------------------------------------------------------------ */
  /* pestañas                                                            */
  /* ------------------------------------------------------------------ */
  const TABS = ["guia", "lista", "escanear"];
  function showTab(id) {
    state.tab = id;
    for (const t of TABS) {
      setOn($("tab-" + t), t === id);
      if (t === id) $("page-" + t).classList.remove("hidden"); else $("page-" + t).classList.add("hidden");
    }
    try { $("content").scrollTop = 0; } catch (e) { /* nada */ }
    if (id === "escanear") refreshProgress();
    save();
  }

  /* ------------------------------------------------------------------ */
  /* 1 · guía                                                            */
  /* ------------------------------------------------------------------ */
  function buildGuide() {
    const box = $("guide");
    box.innerHTML = "";
    D.GUIDE.forEach((step, i) => {
      const card = el("div", "gcard" + (state.open[i] ? " open" : ""));
      const head = el("div", "gcard-head");
      head.appendChild(el("div", "gcard-num", String(i)));
      head.appendChild(el("div", "gcard-title", step.title));
      const chev = img(state.open[i] ? "icons/chevron-up.svg" : "icons/chevron-down.svg");
      chev.className = "gcard-chev";
      head.appendChild(chev);
      const body = el("div", "gcard-body");
      for (const b of step.body) {
        if (b.p) body.appendChild(el("div", "gp", b.p));
        if (b.ul) for (const li of b.ul) {
          const row = el("div", "gli");
          row.appendChild(el("div", "gdot"));
          row.appendChild(el("div", "gtext", li));
          body.appendChild(row);
        }
      }
      onTap(head, () => {
        state.open[i] = !state.open[i];
        if (state.open[i]) card.classList.add("open"); else card.classList.remove("open");
        chev.src = state.open[i] ? "icons/chevron-up.svg" : "icons/chevron-down.svg";
        save();
      });
      card.appendChild(head); card.appendChild(body);
      box.appendChild(card);
    });
  }

  /* ------------------------------------------------------------------ */
  /* tiras de técnicas (lista y guardado)                                */
  /* ------------------------------------------------------------------ */
  function buildTechStrip(boxId, getSel, onSel) {
    const box = $(boxId);
    box.innerHTML = "";
    const nodes = {};
    for (const t of D.TECHS) {
      const n = el("div", "tech");
      const i = img("icons/" + t.icon + ".svg");
      n.appendChild(i);
      n.appendChild(el("div", "tech-name", t.name));
      onTap(n, () => { onSel(t.id); refresh(); });
      box.appendChild(n);
      nodes[t.id] = { n, i, t };
    }
    function refresh() {
      for (const id of Object.keys(nodes)) {
        const on = id === getSel();
        setOn(nodes[id].n, on);
        nodes[id].i.src = "icons/" + nodes[id].t.icon + (on ? "-on" : "") + ".svg";
      }
    }
    refresh();
    return refresh;
  }

  /* ------------------------------------------------------------------ */
  /* 2 · lista                                                           */
  /* ------------------------------------------------------------------ */
  function buildList() {
    const t = techById(state.listTech);
    $("listMaterial").textContent = t.material;
    const box = $("checklist");
    box.innerHTML = "";
    let total = 0, done = 0;
    const counters = [];
    t.groups.forEach((g, gi) => {
      box.appendChild(el("div", "cgroup-title", g.title.toUpperCase()));
      g.items.forEach((it, ii) => {
        const key = t.id + "|" + gi + "|" + ii;
        const row = el("div", "citem" + (state.checks[key] ? " done" : ""));
        const cb = el("div", "cbox");
        cb.appendChild(img("icons/check-dark.svg"));
        row.appendChild(cb);
        row.appendChild(el("div", "ctext", it.t));
        row.appendChild(el("div", "cbadge", "×" + it.n));
        total++;
        if (state.checks[key]) done++;
        onTap(row, () => {
          state.checks[key] = !state.checks[key];
          if (state.checks[key]) row.classList.add("done"); else row.classList.remove("done");
          save();
          updateCount();
        });
        counters.push(key);
      });
    });
    function updateCount() {
      const d = counters.filter((k) => state.checks[k]).length;
      $("listCount").textContent = d + " / " + counters.length;
      $("listBar").style.width = (counters.length ? Math.round(d * 100 / counters.length) : 0) + "%";
      if (d === counters.length && counters.length) setStatus("Lista de " + t.name + " completa. ¡A escanear!", "ok");
    }
    updateCount();
  }
  function resetList() {
    const t = techById(state.listTech);
    for (const k of Object.keys(state.checks)) if (k.indexOf(t.id + "|") === 0) delete state.checks[k];
    save();
    buildList();
    setStatus("Lista de " + t.name + " desmarcada");
  }

  /* ------------------------------------------------------------------ */
  /* 3 · escanear: nombre de archivo                                     */
  /* ------------------------------------------------------------------ */
  function currentCode() {
    if (state.saveTech === "soporte") return (D.SUPPORTS.find((s) => s.id === state.support) || D.SUPPORTS[0]).code;
    return techById(state.saveTech).code;
  }
  function needsRotations() { return techById(state.saveTech).rotations; }
  function currentSheet() { const c = currentCode(); return state.sheet[c] || 1; }
  function fileName() {
    const rot = needsRotations() ? state.rot : "000";
    return currentCode() + "_H" + pad2(currentSheet()) + "_R" + rot + ".png";
  }

  function buildSupportSeg() {
    const seg = $("segSupport");
    seg.innerHTML = "";
    for (const s of D.SUPPORTS) {
      const it = el("div", "seg-item" + (s.id === state.support ? " on" : ""), s.name);
      onTap(it, () => { state.support = s.id; save(); buildSupportSeg(); refreshName(); });
      seg.appendChild(it);
    }
  }

  function refreshName() {
    const rot = needsRotations();
    if (state.saveTech === "soporte") $("segSupport").classList.remove("hidden"); else $("segSupport").classList.add("hidden");
    if (rot) $("rotRow").classList.remove("hidden"); else $("rotRow").classList.add("hidden");
    for (const r of ROTS) setOn($("rot-" + r), r === state.rot);
    $("rotHint").textContent = rot
      ? "Gira la hoja 90° en sentido horario entre escaneos. Tras guardar se pasa sola a la siguiente rotación."
      : "Esta técnica solo necesita un escaneo por hoja (R000).";
    $("sheetVal").textContent = "H" + pad2(currentSheet());
    $("fileName").textContent = fileName();
    disarm();
  }

  function changeSheet(d) {
    const c = currentCode();
    state.sheet[c] = Math.max(1, Math.min(99, currentSheet() + d));
    state.rot = "000";
    save(); refreshName();
  }

  /* ------------------------------------------------------------------ */
  /* carpeta                                                             */
  /* ------------------------------------------------------------------ */
  let folder = null;
  async function getFolder(ask) {
    if (folder) return folder;
    if (state.folderToken) {
      try {
        const f = await lfs.getEntryForPersistentToken(state.folderToken);
        await f.getEntries(); // comprueba que sigue accesible
        folder = f;
        showFolder();
        return folder;
      } catch (e) { state.folderToken = null; save(); }
    }
    if (!ask) return null;
    return chooseFolder();
  }
  async function chooseFolder() {
    const f = await lfs.getFolder();
    if (!f) return null;
    folder = f;
    try { state.folderToken = await lfs.createPersistentToken(f); } catch (e) { state.folderToken = null; }
    save();
    showFolder();
    refreshProgress();
    return folder;
  }
  function showFolder() {
    $("folderPath").textContent = folder ? (folder.nativePath || folder.name) : "Sin elegir: se pedirá al guardar";
  }

  /* ------------------------------------------------------------------ */
  /* progreso (lee la carpeta)                                           */
  /* ------------------------------------------------------------------ */
  const saved = {}; // code -> sheet -> Set(rot)
  function markSaved(name) {
    const m = NAME_RE.exec(name);
    if (!m) return;
    const code = m[1].toUpperCase(), sh = +m[2];
    saved[code] = saved[code] || {};
    saved[code][sh] = saved[code][sh] || {};
    saved[code][sh][m[3]] = true;
  }
  async function refreshProgress() {
    const f = await getFolder(false).catch(() => null);
    if (f) {
      try {
        const entries = await f.getEntries();
        for (const e of entries) if (!e.isFolder) markSaved(e.name);
      } catch (e) { /* nada */ }
    }
    renderProgress();
  }
  function renderProgress() {
    const box = $("progressGrid");
    box.innerHTML = "";
    const rows = [];
    for (const t of D.TECHS) if (t.code) rows.push({ code: t.code, name: t.name, rot: t.rotations });
    for (const s of D.SUPPORTS) rows.push({ code: s.code, name: s.name, rot: true });
    for (const r of rows) {
      const row = el("div", "prow");
      row.appendChild(el("div", "prow-name", r.name));
      const sheets = el("div", "prow-sheets");
      const map = saved[r.code] || {};
      const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
      if (!keys.length) sheets.appendChild(el("div", "pempty", "—"));
      for (const k of keys) {
        const s = el("div", "psheet");
        s.appendChild(el("div", "psheet-name", "H" + pad2(k)));
        const rots = r.rot ? ROTS : ["000"];
        for (const ro of rots) s.appendChild(el("div", "pdot" + (map[k][ro] ? " on" : "")));
        sheets.appendChild(s);
      }
      row.appendChild(sheets);
      box.appendChild(row);
    }
  }

  /* ------------------------------------------------------------------ */
  /* guardar                                                             */
  /* ------------------------------------------------------------------ */
  let armedName = null, armTimer = null;
  function arm(name) {
    armedName = name;
    $("btnSave").classList.add("armed");
    $("saveLabel").textContent = "REEMPLAZAR " + name;
    clearTimeout(armTimer);
    armTimer = setTimeout(disarm, 5000);
  }
  function disarm() {
    armedName = null;
    clearTimeout(armTimer);
    $("btnSave").classList.remove("armed");
    $("saveLabel").textContent = "GUARDAR PNG";
  }

  let busy = false;
  async function saveScan() {
    if (busy) return;
    const doc = activeDoc();
    if (!doc) { setStatus("Abre primero el escaneo en Photoshop", "error"); return; }
    busy = true;
    try {
      const f = await getFolder(true);
      if (!f) { setStatus("Elige una carpeta para guardar los escaneos", "error"); return; }
      const name = fileName();
      let exists = false;
      try { await f.getEntry(name); exists = true; } catch (e) { exists = false; }
      if (exists && armedName !== name) {
        arm(name);
        setStatus(name + " ya existe. Pulsa otra vez para reemplazarlo.", "error");
        return;
      }
      disarm();
      setStatus("Guardando " + name + "…");
      $("progress").style.width = "40%";
      const file = await f.createFile(name, { overwrite: true });
      await core.executeAsModal(async () => {
        await doc.saveAs.png(file, { compression: 6 }, true);
      }, { commandName: "Trazo · Captura: guardar " + name });
      $("progress").style.width = "100%";
      markSaved(name);
      renderProgress();
      // avanzar a la siguiente rotación / hoja
      let next;
      if (needsRotations()) {
        const i = ROTS.indexOf(state.rot);
        if (i < ROTS.length - 1) { state.rot = ROTS[i + 1]; next = "gira la hoja 90° y escanea " + fileName(); }
        else { state.rot = "000"; state.sheet[currentCode()] = currentSheet() + 1; next = "hoja completa; siguiente: " + fileName(); }
      } else {
        state.sheet[currentCode()] = currentSheet() + 1;
        next = "siguiente: " + fileName();
      }
      save();
      refreshName();
      setStatus("Guardado " + name + " · " + next, "ok");
    } catch (e) {
      setStatus("No se pudo guardar: " + errMsg(e), "error");
    } finally {
      busy = false;
      setTimeout(() => { $("progress").style.width = "0"; }, 600);
    }
  }

  /* ------------------------------------------------------------------ */
  /* comprobar el escaneo                                                */
  /* ------------------------------------------------------------------ */
  function addResult(box, kind, label, detail) {
    const r = el("div", "rrow" + (kind === "bad" ? " bad" : kind === "warn" ? " warn" : ""));
    r.appendChild(img("icons/" + kind + ".svg"));
    const t = el("div", "rtext");
    t.appendChild(el("div", "rlabel", label));
    if (detail) t.appendChild(el("div", "rdetail", detail));
    r.appendChild(t);
    box.appendChild(r);
  }

  async function checkScan() {
    const box = $("checkResults");
    box.innerHTML = "";
    const doc = activeDoc();
    if (!doc) { addResult(box, "bad", "No hay ningún documento abierto", "Abre el escaneo en Photoshop y vuelve a pulsar."); return; }
    setStatus("Comprobando " + (doc.title || "documento") + "…");
    let bad = 0, warn = 0;
    const add = (k, l, d) => { if (k === "bad") bad++; if (k === "warn") warn++; addResult(box, k, l, d); };

    const title = String(doc.title || doc.name || "");
    if (/\.jpe?g$/i.test(title)) add("bad", "Formato JPG", "El JPG borra detalle fino. Escanea de nuevo guardando en PNG o TIFF.");

    const res = Math.round(+doc.resolution || 0);
    if (Math.abs(res - 600) <= 2) add("ok", "Resolución: 600 ppp");
    else if (res > 600) add("warn", "Resolución: " + res + " ppp", "Vale, aunque pesa más de lo necesario. 600 ppp es suficiente.");
    else add("bad", "Resolución: " + res + " ppp", "Escanea a 600 ppp: con menos se pierde la textura de las cerdas y del papel.");

    const mode = String(doc.mode || "").toLowerCase();
    if (mode.indexOf("rgb") >= 0) add("ok", "Modo de color: RGB");
    else add("bad", "Modo de color: " + (doc.mode || "desconocido"), "Escanea en color RGB, aunque el trazo sea negro.");

    const bits = String(doc.bitsPerChannel || "");
    if (/16/.test(bits)) add("ok", "Profundidad: 16 bits");
    else if (/32/.test(bits)) add("warn", "Profundidad: 32 bits", "Funciona, pero pásalo a 16 bits para que pese menos.");
    else add("warn", "Profundidad: 8 bits", "Sirve. Si tu escáner permite 16 bits (48 bits de color), el relieve sale mejor.");

    const W = Math.round(+doc.width), H = Math.round(+doc.height);
    if (res > 0) {
      const wc = W / res * 2.54, hc = H / res * 2.54;
      const txt = wc.toFixed(1).replace(".", ",") + " × " + hc.toFixed(1).replace(".", ",") + " cm";
      if (wc <= 22.5 && hc <= 22.5) add("ok", "Tamaño: " + txt);
      else add("warn", "Tamaño: " + txt, "Más grande que la hoja de 20×20: no pasa nada, pero puedes recortar a la zona útil para que pese menos.");
    }

    // análisis de píxeles: blanco quemado, negros y huecos en el histograma
    try {
      const small = await imaging.getPixels({
        documentID: doc.id, targetSize: { width: Math.min(800, W) },
        componentSize: 8, colorSpace: "RGB", applyAlpha: true,
      });
      const id = small.imageData;
      let data, n, c;
      try { data = await id.getData({ chunky: true }); n = id.width * id.height; c = id.components; } finally { id.dispose(); }
      let white = 0, black = 0;
      const lum = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const r = data[i * c], g = data[i * c + 1], b = data[i * c + 2];
        if (r >= 254 && g >= 254 && b >= 254) white++;
        if (r <= 1 && g <= 1 && b <= 1) black++;
        lum[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
      }
      const sorted = Array.from(lum).sort((a, b) => a - b);
      const paper = sorted[Math.floor(n * 0.9)];
      const wp = white / n * 100, bp = black / n * 100;
      if (wp > 12) add("bad", "Blanco quemado (" + wp.toFixed(0) + " % de píxeles a 255)", "El papel sale blanco puro: hay exposición o corrección automática activa. Desactívala y vuelve a escanear.");
      else if (paper > 251) add("warn", "Papel muy claro (" + paper + ")", "Casi en el límite. Si puedes, baja un poco el brillo del escáner.");
      else add("ok", "Blanco del papel sin quemar (" + paper + " de 255)");
      if (bp > 4) add("warn", "Negros recortados (" + bp.toFixed(1).replace(".", ",") + " %)", "Hay zonas negro puro: baja el contraste del escáner.");

      // huecos en el histograma (señal de niveles automáticos): recorte central sin escalar
      const cw = Math.min(600, W), ch = Math.min(600, H);
      const crop = await imaging.getPixels({
        documentID: doc.id, componentSize: 8, colorSpace: "RGB", applyAlpha: true,
        sourceBounds: { left: Math.floor((W - cw) / 2), top: Math.floor((H - ch) / 2), right: Math.floor((W - cw) / 2) + cw, bottom: Math.floor((H - ch) / 2) + ch },
      });
      const cid = crop.imageData;
      let cd, cn, cc;
      try { cd = await cid.getData({ chunky: true }); cn = cid.width * cid.height; cc = cid.components; } finally { cid.dispose(); }
      if (/8/.test(bits) || !/16|32/.test(bits)) {
        const hist = new Uint32Array(256);
        for (let i = 0; i < cn; i++) hist[cd[i * cc + 1]]++;
        let lo = 0, hi = 255, acc = 0;
        for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cn * 0.02) { lo = v; break; } }
        acc = 0;
        for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cn * 0.02) { hi = v; break; } }
        let gaps = 0;
        for (let v = lo; v <= hi; v++) if (hist[v] === 0) gaps++;
        const span = Math.max(1, hi - lo + 1);
        if (span > 30 && gaps / span > 0.15) add("warn", "Histograma con huecos", "Parece que el escáner ha estirado los niveles automáticamente. Revisa que las correcciones automáticas estén apagadas.");
        else add("ok", "Histograma continuo (sin niveles automáticos)");
      }
    } catch (e) {
      add("warn", "No pude analizar los píxeles", errMsg(e));
    }

    if (bad) setStatus(bad + " problema(s) que conviene corregir antes de guardar", "error");
    else if (warn) setStatus("Se puede usar · " + warn + " aviso(s)", "ok");
    else setStatus("Escaneo perfecto. Pulsa GUARDAR PNG.", "ok");
  }

  /* ------------------------------------------------------------------ */
  /* plantilla 20×20 cm                                                  */
  /* ------------------------------------------------------------------ */
  async function makeTemplate() {
    if (busy) return;
    busy = true;
    setStatus("Creando plantilla…");
    try {
      await core.executeAsModal(async () => {
        const PPI = 600, CM = PPI / 2.54;
        const N = Math.round(20 * CM); // 4724 px
        const fill = constants.DocumentFill && constants.DocumentFill.WHITE ? constants.DocumentFill.WHITE : "white";
        const doc = await app.createDocument({ width: N, height: N, resolution: PPI, mode: "RGBColorMode", fill, name: "Trazo plantilla 20x20 cm" });
        const layer = typeof doc.createPixelLayer === "function"
          ? await doc.createPixelLayer({ name: "Marcas de registro" })
          : await doc.createLayer({ name: "Marcas de registro" });
        // cruz: 8 mm de brazo, 0,4 mm de grosor, centrada a 1 cm de cada borde
        const S = Math.round(0.8 * CM), T = Math.max(3, Math.round(0.04 * CM));
        const buf = new Uint8Array(S * S * 4);
        const mid = S >> 1, h0 = mid - (T >> 1);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          if ((x >= h0 && x < h0 + T) || (y >= h0 && y < h0 + T)) {
            const o = (y * S + x) * 4;
            buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 255;
          }
        }
        const c1 = Math.round(1 * CM), c2 = N - c1;
        for (const [cx, cy] of [[c1, c1], [c2, c1], [c1, c2], [c2, c2]]) {
          const id = await imaging.createImageDataFromBuffer(buf, { width: S, height: S, components: 4, chunky: true, colorSpace: "RGB" });
          try {
            await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: id, replace: false, targetBounds: { left: cx - mid, top: cy - mid } });
          } finally { id.dispose(); }
        }
        // guías del margen de seguridad (1,5 cm)
        const m = Math.round(1.5 * CM);
        try {
          const Dir = constants.Direction || { HORIZONTAL: "horizontal", VERTICAL: "vertical" };
          doc.guides.add(Dir.VERTICAL, m); doc.guides.add(Dir.VERTICAL, N - m);
          doc.guides.add(Dir.HORIZONTAL, m); doc.guides.add(Dir.HORIZONTAL, N - m);
        } catch (e) { /* las guías no son imprescindibles */ }
      }, { commandName: "Trazo · Captura: plantilla" });
      setStatus("Plantilla creada: imprímela al 100 % (Archivo › Imprimir, escala 100 %)", "ok");
    } catch (e) {
      setStatus("No se pudo crear la plantilla: " + errMsg(e), "error");
    } finally {
      busy = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* documento activo en la cabecera                                     */
  /* ------------------------------------------------------------------ */
  function refreshHead() {
    const d = activeDoc();
    $("headSub").textContent = d ? "Documento: " + (d.title || d.name || "sin título") : "Guía para escanear tus trazos";
  }

  /* ------------------------------------------------------------------ */
  /* arranque                                                            */
  /* ------------------------------------------------------------------ */
  function init() {
    load();
    if (!techById(state.listTech)) state.listTech = "gouache";
    if (!techById(state.saveTech)) state.saveTech = "gouache";
    if (ROTS.indexOf(state.rot) < 0) state.rot = "000";
    buildGuide();
    buildTechStrip("listTechs", () => state.listTech, (id) => { state.listTech = id; save(); buildList(); });
    buildList();
    buildTechStrip("saveTechs", () => state.saveTech, (id) => { state.saveTech = id; state.rot = "000"; save(); refreshName(); });
    buildSupportSeg();
    refreshName();
    showFolder();

    for (const t of TABS) onTap($("tab-" + t), () => showTab(t));
    onTap($("btnResetList"), resetList);
    onTap($("btnCheck"), checkScan);
    onTap($("sheetMinus"), () => changeSheet(-1));
    onTap($("sheetPlus"), () => changeSheet(1));
    for (const r of ROTS) onTap($("rot-" + r), () => { state.rot = r; save(); refreshName(); });
    onTap($("btnFolder"), async () => { try { await chooseFolder(); } catch (e) { setStatus(errMsg(e), "error"); } });
    onTap($("btnSave"), saveScan);
    onTap($("btnTemplate"), makeTemplate);
    try { action.addNotificationListener(["select", "open", "close"], () => setTimeout(refreshHead, 50)); } catch (e) { /* nada */ }
    refreshHead();
    showTab(state.tab);
    getFolder(false).then(() => refreshProgress()).catch(() => renderProgress());
    setStatus("Listo");
  }
  init();
})();
