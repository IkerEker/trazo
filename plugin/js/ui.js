/*
 * Trazo · interfaz del panel
 * Pestañas, técnicas, sliders, presets, vista previa en vivo y GENERAR.
 */
(function () {
  "use strict";
  const Engine = window.TrazoEngine;
  const PS = window.TrazoPS;
  const T = Engine.Techniques;
  const $ = (id) => document.getElementById(id);

  const STORE_KEY = "trazo.state.v2";
  const PREVIEW_MIN = 360, PREVIEW_MAX = 720;
  let previewLong = 440; // se adapta al tamaño del marco
  const QUALITY = {
    borrador: { mp: 1.5, label: "Borrador", hint: "Rápido para probar (hasta 1,5 MP)." },
    alta: { mp: 6, label: "Alta", hint: "Buen equilibrio (hasta 6 MP)." },
    maxima: { mp: 16, label: "Máxima", hint: "Resolución completa hasta 16 MP. Puede tardar." },
  };
  const SELECTION_HINT = {
    ignorar: "La selección de Photoshop no se tiene en cuenta.",
    solo: "Solo se pinta dentro de la selección; el resto queda transparente.",
    detalle: "Dentro de la selección se usan trazos más finos y más detalle.",
  };
  const GROUPS = [
    { title: "TRAZO", keys: ["intensidad", "grosor", "longitud", "curvatura"] },
    { title: "SUPERFICIE", keys: ["cobertura", "empaste", "humedad", "granulado", "cruzado"] },
    { title: "COLOR", keys: ["varTono", "varSat", "varLuz"], toggles: true },
    { title: "DETALLE", keys: ["detalle"] },
    { title: "REALISMO Y LUZ", keys: ["realismo", "luz"] },
  ];

  /* ------------------------------------------------------------------ */
  /* estado                                                              */
  /* ------------------------------------------------------------------ */
  const state = {
    tech: "oleo",
    params: {},
    quality: "alta",
    selMode: "ignorar",
    paper: true,
    hideOriginal: true,
    seed: 1,
    tab: "tecnica",
    previewCollapsed: false,
    userPresets: {},
    activePreset: {},
  };
  for (const t of T.TECHNIQUES) { state.params[t.id] = T.defaultsFor(t.id); state.userPresets[t.id] = []; }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && typeof s === "object") {
        if (T.BY_ID[s.tech]) state.tech = s.tech;
        for (const id of Object.keys(state.params)) {
          if (s.params && s.params[id]) Object.assign(state.params[id], s.params[id]);
          if (s.userPresets && Array.isArray(s.userPresets[id])) state.userPresets[id] = s.userPresets[id];
        }
        if (QUALITY[s.quality]) state.quality = s.quality;
        if (SELECTION_HINT[s.selMode]) state.selMode = s.selMode;
        if (typeof s.paper === "boolean") state.paper = s.paper;
        if (typeof s.hideOriginal === "boolean") state.hideOriginal = s.hideOriginal;
        if (s.seed > 0) state.seed = s.seed | 0;
        if (s.tab === "tecnica" || s.tab === "ajustes" || s.tab === "salida") state.tab = s.tab;
        state.previewCollapsed = !!s.previewCollapsed;
        if (s.activePreset) state.activePreset = s.activePreset;
      }
    } catch (e) { /* almacenamiento no disponible */ }
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* nada */ }
    }, 300);
  }

  /* ------------------------------------------------------------------ */
  /* trazos y soportes reales (plugin/textures/*.bin)                    */
  /* ------------------------------------------------------------------ */
  const texCache = {};
  async function readPluginBinary(rel) {
    try {
      const uxp = require("uxp");
      const st = uxp && uxp.storage;
      if (st && st.localFileSystem && st.localFileSystem.getPluginFolder) {
        const folder = await st.localFileSystem.getPluginFolder();
        const file = await folder.getEntry(rel);
        return await file.read({ format: st.formats.binary });
      }
    } catch (e) { /* probamos con fetch */ }
    try {
      const r = await fetch(rel);
      if (r.ok) return await r.arrayBuffer();
    } catch (e) { /* sin textura */ }
    return null;
  }
  function loadTexture(name) {
    if (!texCache[name]) {
      texCache[name] = readPluginBinary("textures/" + name + ".bin").then((buf) => {
        try { return buf ? Engine.parseTexture(buf) : null; } catch (e) { return null; }
      });
    }
    return texCache[name];
  }
  /** Biblioteca de trazos y soporte de la técnica. Si faltan, el motor usa su modelo procedural. */
  async function texturesFor(tech) {
    const names = Engine.ASSETS_FOR[tech] || [];
    const loaded = await Promise.all(names.map((nm) => loadTexture(nm)));
    const assets = {};
    names.forEach((nm, i) => { if (loaded[i]) assets[nm] = loaded[i]; });
    const support = await loadTexture("soporte-" + (Engine.SUPPORT_FOR[tech] || "dibujo"));
    return { assets, support };
  }
  async function showTexInfo() {
    const tech = state.tech;
    const t = await texturesFor(tech);
    if (tech !== state.tech) return;
    let n = 0, m = 0;
    for (const k of Object.keys(t.assets)) { const a = t.assets[k]; if (a.samples) n += a.samples.length; else if (a.items) m += a.items.length; }
    $("statusTech").textContent = techDef().name + (n || m ? " · " + (n + m) + " materiales reales" : "");
  }

  const cur = () => state.params[state.tech];
  const techDef = () => T.BY_ID[state.tech];

  /* ------------------------------------------------------------------ */
  /* utilidades de interfaz                                              */
  /* ------------------------------------------------------------------ */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function onTap(node, fn) { node.addEventListener("click", fn); }
  function setOn(node, on) {
    if (!node) return;
    if (on) node.classList.add("on"); else node.classList.remove("on");
  }

  function setStatus(text, kind) {
    const s = $("status");
    s.textContent = text;
    s.className = "status" + (kind ? " " + kind : "");
  }
  function setProgress(f) {
    $("progress").style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + "%";
  }
  function fmtMP(px) { return (px / 1e6).toFixed(1).replace(".", ",") + " MP"; }

  /* ------------------------------------------------------------------ */
  /* pestañas                                                            */
  /* ------------------------------------------------------------------ */
  const TABS = ["tecnica", "ajustes", "salida"];
  function showTab(id) {
    state.tab = id;
    for (const t of TABS) {
      setOn($("tab-" + t), t === id);
      const page = $("page-" + t);
      if (t === id) page.classList.remove("hidden"); else page.classList.add("hidden");
    }
    try { $("content").scrollTop = 0; } catch (e) { /* nada */ }
    save();
  }

  /* ------------------------------------------------------------------ */
  /* técnicas                                                            */
  /* ------------------------------------------------------------------ */
  const techNodes = {};
  function buildTechs() {
    const box = $("techs");
    box.innerHTML = "";
    for (const t of T.TECHNIQUES) {
      const n = el("div", "tech");
      n.title = t.desc;
      const img = el("img");
      img.src = "icons/t-" + t.id + ".svg";
      n.appendChild(img);
      n.appendChild(el("div", "tech-name", t.name));
      onTap(n, () => selectTech(t.id));
      box.appendChild(n);
      techNodes[t.id] = { node: n, img };
    }
  }
  function refreshTechs() {
    for (const id of Object.keys(techNodes)) {
      const on = id === state.tech;
      setOn(techNodes[id].node, on);
      techNodes[id].img.src = "icons/t-" + id + (on ? "-on" : "") + ".svg";
    }
    $("techDesc").textContent = techDef().desc + ".";
    $("statusTech").textContent = techDef().name;
    showTexInfo();
  }
  function selectTech(id) {
    if (!T.BY_ID[id] || id === state.tech) return;
    state.tech = id;
    refreshTechs();
    buildPresets();
    buildSliders();
    save();
    schedulePreview(60);
  }

  /* ------------------------------------------------------------------ */
  /* presets                                                             */
  /* ------------------------------------------------------------------ */
  function applyValues(values, presetName) {
    const p = T.defaultsFor(state.tech);
    // realismo y luz se mantienen al cambiar de variante (los presets propios sí los guardan)
    const keep = { realismo: cur().realismo, luz: cur().luz };
    Object.assign(p, keep, values || {});
    state.params[state.tech] = p;
    state.activePreset[state.tech] = presetName || null;
    buildPresets();
    buildSliders();
    save();
    schedulePreview(30);
  }
  function buildPresets() {
    const box = $("presets");
    box.innerHTML = "";
    const def = techDef();
    const active = state.activePreset[state.tech];
    const mk = (name, values, user) => {
      const c = el("div", "chip" + (user ? " user" : "") + (active === name ? " on" : ""), name);
      onTap(c, () => { if (!c.classList.contains("armed")) applyValues(values, name); });
      if (user) {
        let timer = null;
        const start = () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            c.classList.add("armed");
            const list = state.userPresets[state.tech];
            const idx = list.findIndex((p) => p.name === name);
            if (idx >= 0) list.splice(idx, 1);
            if (state.activePreset[state.tech] === name) state.activePreset[state.tech] = null;
            save();
            setStatus("Preset «" + name + "» borrado", "ok");
            setTimeout(buildPresets, 250);
          }, 900);
        };
        const stop = () => clearTimeout(timer);
        c.addEventListener("pointerdown", start);
        c.addEventListener("pointerup", stop);
        c.addEventListener("pointerleave", stop);
        c.addEventListener("mousedown", start);
        c.addEventListener("mouseup", stop);
      }
      box.appendChild(c);
    };
    for (const p of def.presets) mk(p.name, p.values, false);
    for (const p of state.userPresets[state.tech]) mk(p.name, p.values, true);
  }
  function savePreset() {
    const input = $("presetName");
    let name = String(input.value || "").trim().slice(0, 28);
    if (!name) { setStatus("Escribe un nombre para el preset", "error"); return; }
    const list = state.userPresets[state.tech];
    const values = Object.assign({}, cur());
    const idx = list.findIndex((p) => p.name === name);
    if (idx >= 0) list[idx].values = values; else list.push({ name, values });
    state.activePreset[state.tech] = name;
    input.value = "";
    save();
    buildPresets();
    setStatus("Preset «" + name + "» guardado", "ok");
  }

  /* ------------------------------------------------------------------ */
  /* sliders                                                             */
  /* ------------------------------------------------------------------ */
  const sliders = {};
  function buildSliders() {
    const box = $("sliders");
    box.innerHTML = "";
    for (const k of Object.keys(sliders)) delete sliders[k];
    const def = techDef();
    const visible = new Set(def.params.concat(def.colorParams || []));
    // variante: cambia el modo de pintar sin tocar los ajustes
    box.appendChild(el("div", "group-title", "VARIANTE"));
    const vrow = el("div", "chips");
    for (const v of def.variants || []) {
      const c = el("div", "chip" + (cur().modo === v.id ? " on" : ""), v.name);
      onTap(c, () => { cur().modo = v.id; state.activePreset[state.tech] = null; save(); buildSliders(); buildPresets(); schedulePreview(30); });
      vrow.appendChild(c);
    }
    box.appendChild(vrow);
    for (const g of GROUPS) {
      const keys = g.keys.filter((k) => visible.has(k));
      const toggles = g.toggles ? (def.toggles || []) : [];
      if (!keys.length && !toggles.length) continue;
      box.appendChild(el("div", "group-title", g.title));
      for (const tg of toggles) box.appendChild(buildToggle(tg));
      for (const k of keys) box.appendChild(buildSlider(k));
    }
    refreshSliderStates();
  }

  function buildToggle(tg) {
    const row = el("div", "toggle-row");
    const txt = el("div", "toggle-text");
    txt.appendChild(el("div", "toggle-label", tg.label));
    txt.appendChild(el("div", "toggle-sub", "Usa los colores de la foto en lugar de grafito"));
    const sw = el("div", "switch");
    sw.appendChild(el("div", "knob"));
    row.appendChild(txt); row.appendChild(sw);
    const sync = () => setOn(sw, !!cur()[tg.key]);
    onTap(row, () => {
      cur()[tg.key] = !cur()[tg.key];
      state.activePreset[state.tech] = null;
      sync(); refreshSliderStates(); buildPresets(); save(); schedulePreview(30);
    });
    sync();
    return row;
  }

  function buildSlider(key) {
    const meta = T.PARAMS[key];
    const wrap = el("div", "sl");
    wrap.title = meta.hint;
    const head = el("div", "sl-head");
    const label = el("div", "sl-label", meta.label);
    const val = el("div", "sl-val", "0");
    head.appendChild(label); head.appendChild(val);
    const track = el("div", "sl-track");
    const rail = el("div", "sl-rail"), fill = el("div", "sl-fill"), thumb = el("div", "sl-thumb");
    track.appendChild(rail); track.appendChild(fill); track.appendChild(thumb);
    wrap.appendChild(head); wrap.appendChild(track);
    const s = { key, wrap, val, fill, thumb, track, disabled: false };
    sliders[key] = s;
    renderSlider(s);

    let lastClick = 0;
    const valueAt = (clientX) => {
      const r = track.getBoundingClientRect();
      const f = r.width > 0 ? (clientX - r.left) / r.width : 0;
      return Math.round(Math.max(0, Math.min(1, f)) * 100);
    };
    const set = (v, commit) => {
      if (s.disabled) return;
      if (cur()[key] !== v) {
        cur()[key] = v;
        if (state.activePreset[state.tech]) { state.activePreset[state.tech] = null; buildPresets(); }
        renderSlider(s);
        schedulePreview(commit ? 40 : 260);
        save();
      } else if (commit) schedulePreview(40);
    };
    s.set = set; s.valueAt = valueAt;
    const down = (e) => {
      if (s.disabled) return;
      const now = Date.now();
      if (now - lastClick < 320) { // doble clic: valor por defecto
        lastClick = 0;
        set(T.defaultsFor(state.tech)[key], true);
        return;
      }
      lastClick = now;
      drag = { s, pointerId: e.pointerId };
      wrap.classList.add("drag");
      try { if (e.pointerId !== undefined && track.setPointerCapture) track.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
      set(valueAt(e.clientX), false);
      if (e.preventDefault) e.preventDefault();
    };
    track.addEventListener(window.PointerEvent ? "pointerdown" : "mousedown", down);
    head.addEventListener("dblclick", () => set(T.defaultsFor(state.tech)[key], true));
    return wrap;
  }

  // un único gestor de arrastre para todos los sliders
  let drag = null;
  function dragMove(e) { if (drag) drag.s.set(drag.s.valueAt(e.clientX), false); }
  function dragEnd(e) {
    if (!drag) return;
    const s = drag.s;
    drag = null;
    s.wrap.classList.remove("drag");
    try { if (e.pointerId !== undefined && s.track.releasePointerCapture) s.track.releasePointerCapture(e.pointerId); } catch (err) { /* nada */ }
    s.set(s.valueAt(e.clientX), true);
  }
  if (window.PointerEvent) {
    document.addEventListener("pointermove", dragMove);
    document.addEventListener("pointerup", dragEnd);
    document.addEventListener("pointercancel", dragEnd);
  } else {
    document.addEventListener("mousemove", dragMove);
    document.addEventListener("mouseup", dragEnd);
  }

  function renderSlider(s) {
    const v = cur()[s.key];
    const pct = Math.max(0, Math.min(100, +v || 0));
    s.val.textContent = String(Math.round(pct));
    s.thumb.style.left = pct + "%";
    // la barra cubre de -7px a la posición del pulgar
    s.fill.style.width = "calc(" + pct + "% + 7px)";
  }

  function refreshSliderStates() {
    const def = techDef();
    const colorParams = new Set(def.colorParams || []);
    for (const k of Object.keys(sliders)) {
      const s = sliders[k];
      s.disabled = colorParams.has(k) && !cur().color;
      if (s.disabled) s.wrap.classList.add("disabled"); else s.wrap.classList.remove("disabled");
      renderSlider(s);
    }
  }

  function resetAll() {
    applyValues({}, "Por defecto");
    setStatus("Valores por defecto de " + techDef().name, "ok");
  }

  /* ------------------------------------------------------------------ */
  /* salida                                                              */
  /* ------------------------------------------------------------------ */
  function refreshOutput() {
    for (const q of Object.keys(QUALITY)) setOn($("q-" + q), q === state.quality);
    for (const m of Object.keys(SELECTION_HINT)) setOn($("sel-" + m), m === state.selMode);
    $("selectionHint").textContent = SELECTION_HINT[state.selMode];
    setOn($("optPaper").querySelector(".switch"), state.paper);
    setOn($("optHide").querySelector(".switch"), state.hideOriginal);
    $("seedVal").textContent = String(state.seed);
    refreshQualityHint();
  }
  function refreshQualityHint() {
    const q = QUALITY[state.quality];
    let txt = q.hint;
    if (target && target.bounds) {
      const px = target.bounds.width * target.bounds.height;
      const max = q.mp * 1e6;
      txt += px > max
        ? " Tu imagen: " + fmtMP(px) + " → se pinta a " + fmtMP(max) + " y se escala."
        : " Tu imagen: " + fmtMP(px) + " → resolución completa.";
    }
    $("qualityHint").textContent = txt;
  }

  /* ------------------------------------------------------------------ */
  /* vista previa                                                        */
  /* ------------------------------------------------------------------ */
  let target = null;          // descripción del objetivo en Photoshop
  let src = null;             // píxeles reducidos para la vista previa
  let pvToken = 0, pvTimer = null;
  let pvAfterURL = null, pvBeforeURL = null, pvMode = "after";
  let busy = false;

  function setPvStatus(t) { $("pvStatus").textContent = t; }
  function setPvProgress(f) { $("pvProgress").style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + "%"; }

  function showEmpty(text) {
    $("pvEmpty").classList.remove("hidden");
    $("pvEmptyText").textContent = text;
    $("pvImg").classList.add("hidden");
  }
  function showImage(url) {
    if (!url) return;
    $("pvEmpty").classList.add("hidden");
    const img = $("pvImg");
    img.classList.remove("hidden");
    if (img.getAttribute("src") !== url) img.src = url;
    layoutPreview();
  }
  function showCurrent() {
    if (pvMode === "before" && pvBeforeURL) showImage(pvBeforeURL);
    else if (pvAfterURL) showImage(pvAfterURL);
    else if (pvBeforeURL) showImage(pvBeforeURL);
  }

  async function loadSource() {
    const t = PS.describeTarget();
    target = t.error ? null : t;
    $("srcLabel").textContent = t.error ? (t.doc ? (t.doc.title || "Documento") : "Sin documento abierto") : (t.docName + " · " + t.label);
    refreshQualityHint();
    if (t.error) {
      src = null; pvAfterURL = null; pvBeforeURL = null;
      showEmpty(t.error);
      setPvStatus("Vista previa");
      return false;
    }
    try {
      const s = await PS.readSource(t, previewLong);
      s.key = t.docId + ":" + t.layerId + ":" + t.bounds.left + ":" + t.bounds.top + ":" + t.bounds.width + "x" + t.bounds.height;
      src = s;
      // imagen "antes": RGB sobre blanco
      const n = s.width * s.height, c = s.components;
      const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = c === 4 ? s.data[i * 4 + 3] / 255 : 1;
        rgb[i * 3] = s.data[i * c] * a + 255 * (1 - a);
        rgb[i * 3 + 1] = s.data[i * c + 1] * a + 255 * (1 - a);
        rgb[i * 3 + 2] = s.data[i * c + 2] * a + 255 * (1 - a);
      }
      pvBeforeURL = await PS.encodePreview(rgb, s.width, s.height);
      if (!pvAfterURL) showCurrent();
      return true;
    } catch (e) {
      src = null;
      showEmpty("No se pudo leer la imagen: " + (e && e.message ? e.message : e));
      return false;
    }
  }

  function schedulePreview(delay) {
    pvToken++; // cancela la vista previa en curso
    clearTimeout(pvTimer);
    if (busy) return;
    pvTimer = setTimeout(runPreview, delay === undefined ? 200 : delay);
  }

  async function runPreview() {
    if (busy) return;
    const my = ++pvToken;
    if (!src) {
      const ok = await loadSource();
      if (!ok || my !== pvToken) return;
    }
    if (state.previewCollapsed) { setPvStatus("Vista previa oculta"); return; }
    const t0 = Date.now();
    setPvStatus("Pintando vista previa…");
    try {
      let selection = null;
      if (state.selMode !== "ignorar" && target) {
        const mask = await PS.readSelection(target, src.width, src.height).catch(() => null);
        if (mask) selection = { mask, mode: state.selMode };
      }
      if (my !== pvToken) return;
      const tex = await texturesFor(state.tech);
      if (my !== pvToken) return;
      const res = await Engine.render(
        { width: src.width, height: src.height, data: src.data, components: src.components },
        { technique: state.tech, params: cur(), seed: state.seed, selection, paper: state.paper, assets: tex.assets, support: tex.support },
        { onProgress: (f) => { if (my === pvToken) setPvProgress(f); }, shouldCancel: () => my !== pvToken, sliceMs: 24 }
      );
      if (my !== pvToken) return;
      const flat = Engine.flatten(res.paint, res.paper, res.width, res.height);
      const url = await PS.encodePreview(flat, res.width, res.height);
      if (my !== pvToken) return;
      pvAfterURL = url;
      if (pvMode === "after") showImage(url);
      setPvProgress(0);
      setPvStatus(techDef().name + " · vista previa en " + ((Date.now() - t0) / 1000).toFixed(1).replace(".", ",") + " s");
    } catch (e) {
      if (e && e.cancelled) return;
      setPvProgress(0);
      setPvStatus("Error en la vista previa");
      setStatus(String(e && e.message ? e.message : e), "error");
    }
  }

  /** Ajusta el marco y la imagen al espacio disponible. */
  function layoutPreview() {
    const frame = $("pvFrame");
    const img = $("pvImg");
    const W = document.body.clientWidth || window.innerWidth || 300;
    const H = document.body.clientHeight || window.innerHeight || 600;
    const wide = W >= 620;
    const aspect = src ? src.width / src.height : 1.5;
    if (!wide) {
      const fw = Math.max(80, frame.clientWidth || (W - 24));
      let h = Math.round(fw / aspect);
      const maxH = Math.max(110, Math.round(H * 0.36));
      h = Math.max(90, Math.min(h, maxH));
      frame.style.height = h + "px";
    } else {
      frame.style.height = "";
    }
    const fw = Math.max(10, (frame.clientWidth || 300) - 2);
    const fh = Math.max(10, (frame.clientHeight || 180) - 2);
    let w = fw, h = Math.round(fw / aspect);
    if (h > fh) { h = fh; w = Math.round(fh * aspect); }
    img.style.width = w + "px";
    img.style.height = h + "px";
    // resolución de la vista previa según el marco (en pasos de 80 px)
    const want = Math.max(PREVIEW_MIN, Math.min(PREVIEW_MAX, Math.ceil(Math.max(fw, fh) / 80) * 80));
    if (Math.abs(want - previewLong) >= 80) {
      previewLong = want;
      if (src) { src = null; schedulePreview(250); }
    }
  }

  let lastW = 0, lastH = 0;
  function watchSize() {
    const check = () => {
      const w = document.body.clientWidth, h = document.body.clientHeight;
      if (w !== lastW || h !== lastH) { lastW = w; lastH = h; layoutPreview(); }
    };
    try { window.addEventListener("resize", check); } catch (e) { /* nada */ }
    if (typeof ResizeObserver !== "undefined") {
      try { new ResizeObserver(check).observe(document.body); } catch (e) { /* nada */ }
    }
    setInterval(check, 400); // respaldo: algunos hosts no emiten "resize"
    check();
  }

  function togglePreview() {
    state.previewCollapsed = !state.previewCollapsed;
    applyPreviewCollapsed();
    save();
    if (!state.previewCollapsed) schedulePreview(20);
  }
  function applyPreviewCollapsed() {
    const p = $("preview");
    if (state.previewCollapsed) p.classList.add("collapsed"); else p.classList.remove("collapsed");
    $("pvToggleIcon").src = state.previewCollapsed ? "icons/chevron-down.svg" : "icons/chevron-up.svg";
    setTimeout(layoutPreview, 0);
  }

  /* ------------------------------------------------------------------ */
  /* GENERAR                                                             */
  /* ------------------------------------------------------------------ */
  let cancelFlag = false;
  let lastResult = null; // { docId, paintLayerId, tech }

  function setBusy(on, label) {
    busy = on;
    const b = $("btnGenerate");
    if (on) {
      b.classList.remove("primary"); b.classList.add("busy");
      $("genIcon").src = "icons/stop.svg";
      $("genLabel").textContent = label || "CANCELAR";
    } else {
      b.classList.add("primary"); b.classList.remove("busy");
      $("genIcon").src = "icons/brush-dark.svg";
      $("genLabel").textContent = "GENERAR";
      setProgress(0);
    }
  }

  function upscaleRGBA(srcBuf, sw, sh, dw, dh) {
    // bilineal con alfa premultiplicado (sin halos en los bordes transparentes)
    const out = new Uint8Array(dw * dh * 4);
    const fx = sw / dw, fy = sh / dh;
    for (let y = 0; y < dh; y++) {
      let sy = (y + 0.5) * fy - 0.5; if (sy < 0) sy = 0; if (sy > sh - 1) sy = sh - 1;
      const y0 = sy | 0, y1 = y0 < sh - 1 ? y0 + 1 : y0, ty = sy - y0;
      for (let x = 0; x < dw; x++) {
        let sx = (x + 0.5) * fx - 0.5; if (sx < 0) sx = 0; if (sx > sw - 1) sx = sw - 1;
        const x0 = sx | 0, x1 = x0 < sw - 1 ? x0 + 1 : x0, tx = sx - x0;
        const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const a00 = srcBuf[i00 + 3] * w00, a10 = srcBuf[i10 + 3] * w10, a01 = srcBuf[i01 + 3] * w01, a11 = srcBuf[i11 + 3] * w11;
        const a = a00 + a10 + a01 + a11;
        const o = (y * dw + x) * 4;
        if (a < 0.5) { out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = 0; continue; }
        for (let c = 0; c < 3; c++) {
          out[o + c] = (srcBuf[i00 + c] * a00 + srcBuf[i10 + c] * a10 + srcBuf[i01 + c] * a01 + srcBuf[i11 + c] * a11) / a + 0.5;
        }
        out[o + 3] = a + 0.5;
      }
    }
    return out;
  }

  async function generate() {
    if (busy) { cancelFlag = true; setStatus("Cancelando…"); return; }
    const t = PS.describeTarget();
    if (t.error) { setStatus(t.error, "error"); showEmpty(t.error); return; }
    target = t;
    pvToken++; clearTimeout(pvTimer);
    cancelFlag = false;
    const def = techDef();
    const params = Object.assign({}, cur());
    const seed = state.seed;
    const q = QUALITY[state.quality];
    const t0 = Date.now();
    setBusy(true, "CANCELAR");
    setStatus("Preparando…");
    setProgress(0.01);
    try {
      const result = await PS.modal(async (ctx) => {
        const report = (f, label) => {
          setProgress(f);
          if (label) setStatus(label + "…");
          $("genLabel").textContent = "CANCELAR · " + Math.round(f * 100) + "%";
          try { ctx.reportProgress({ value: Math.max(0, Math.min(1, f)), commandName: "Trazo · " + (label || def.name) }); } catch (e) { /* nada */ }
        };
        const cancelled = () => cancelFlag || (ctx && ctx.isCancelled);
        const b = t.bounds;
        const px = b.width * b.height;
        const maxPx = q.mp * 1e6;
        let maxLong = 0;
        if (px > maxPx) {
          const k = Math.sqrt(maxPx / px);
          maxLong = Math.floor(Math.max(b.width, b.height) * k);
        }
        report(0.02, "Leyendo la imagen");
        const s = await PS.readSource(t, maxLong);
        if (cancelled()) throw new Engine.CancelError();
        let selection = null;
        if (state.selMode !== "ignorar") {
          const mask = await PS.readSelection(t, s.width, s.height);
          if (mask) selection = { mask, mode: state.selMode };
        }
        const tex = await texturesFor(def.id);
        const res = await Engine.render(
          { width: s.width, height: s.height, data: s.data, components: s.components },
          { technique: def.id, params, seed, selection, paper: state.paper, assets: tex.assets, support: tex.support },
          { onProgress: (f, label) => report(0.04 + f * 0.86, label), shouldCancel: cancelled, sliceMs: 60 }
        );
        if (cancelled()) throw new Engine.CancelError();
        let paint = res.paint, paper = res.paper, w = res.width, h = res.height;
        const fb = s.bounds;
        if (w !== fb.width || h !== fb.height) {
          report(0.91, "Escalando al tamaño original");
          paint = upscaleRGBA(paint, w, h, fb.width, fb.height);
          if (paper) paper = upscaleRGBA(paper, w, h, fb.width, fb.height);
          w = fb.width; h = fb.height;
        }
        report(0.95, "Creando capas");
        const applied = await PS.applyResult({
          docId: t.docId, layerId: t.layerId, bounds: fb, width: w, height: h,
          paint, paper, name: def.name, paperName: def.id === "oleo" ? "Lienzo" : "Papel",
          hideOriginal: state.hideOriginal, profile: s.profile, is16: t.is16,
        }, ctx);
        report(1, "Listo");
        return applied;
      }, "Trazo · " + def.name);
      lastResult = { docId: result.docId, paintLayerId: result.paintLayerId, tech: def.id };
      setStatus(def.name + " generado en " + ((Date.now() - t0) / 1000).toFixed(1).replace(".", ",") + " s · capa nueva creada", "ok");
    } catch (e) {
      if ((e && e.cancelled) || cancelFlag) setStatus("Cancelado. No se ha modificado el documento.");
      else {
        const msg = String(e && e.message ? e.message : e);
        setStatus("Error: " + msg, "error");
        if (/modal/i.test(msg)) setStatus("Photoshop está ocupado con otra operación. Inténtalo de nuevo.", "error");
      }
    } finally {
      setBusy(false);
      src = null; // la capa activa puede haber cambiado
      setTimeout(() => schedulePreview(50), 300);
    }
  }

  async function exportPNG() {
    if (busy) return;
    if (!lastResult) { setStatus("Primero pulsa GENERAR para crear una pintura", "error"); return; }
    try {
      setStatus("Elige dónde guardar el PNG…");
      const r = await PS.exportLayerPNG(lastResult.docId, lastResult.paintLayerId, "trazo-" + lastResult.tech + ".png");
      if (r.cancelled) setStatus("Exportación cancelada");
      else setStatus("PNG exportado: " + r.file, "ok");
    } catch (e) {
      setStatus("Error al exportar: " + (e && e.message ? e.message : e), "error");
    }
  }

  /* ------------------------------------------------------------------ */
  /* arranque                                                            */
  /* ------------------------------------------------------------------ */
  function wire() {
    for (const id of TABS) onTap($("tab-" + id), () => showTab(id));
    onTap($("btnGenerate"), generate);
    onTap($("btnRefresh"), async () => { src = null; pvAfterURL = null; await loadSource(); schedulePreview(10); });
    onTap($("pvToggle"), togglePreview);
    onTap($("pvAfter"), () => { pvMode = "after"; setOn($("pvAfter"), true); setOn($("pvBefore"), false); showCurrent(); });
    onTap($("pvBefore"), () => { pvMode = "before"; setOn($("pvAfter"), false); setOn($("pvBefore"), true); showCurrent(); });
    onTap($("btnSavePreset"), savePreset);
    $("presetName").addEventListener("keydown", (e) => { if (e.key === "Enter") savePreset(); });
    onTap($("btnReset"), resetAll);
    for (const q of Object.keys(QUALITY)) onTap($("q-" + q), () => { state.quality = q; refreshOutput(); save(); });
    for (const m of Object.keys(SELECTION_HINT)) onTap($("sel-" + m), () => { state.selMode = m; refreshOutput(); save(); schedulePreview(30); });
    onTap($("optPaper"), () => { state.paper = !state.paper; refreshOutput(); save(); schedulePreview(30); });
    onTap($("optHide"), () => { state.hideOriginal = !state.hideOriginal; refreshOutput(); save(); });
    onTap($("btnSeed"), () => { state.seed = 1 + Math.floor(Math.random() * 9999); refreshOutput(); save(); schedulePreview(20); });
    onTap($("btnExport"), exportPNG);

    let docTimer = null, lastKey = "";
    PS.onDocumentChange(() => {
      if (busy) return;
      clearTimeout(docTimer);
      docTimer = setTimeout(async () => {
        if (busy) return;
        const t = PS.describeTarget();
        const key = t.error ? "err:" + t.error : t.docId + ":" + t.layerId + ":" + t.bounds.left + ":" + t.bounds.top + ":" + t.bounds.width + "x" + t.bounds.height;
        if (key !== lastKey) pvAfterURL = null; // otra imagen: no mostrar una vista previa ajena
        lastKey = key;
        src = null; // el contenido puede haber cambiado: releer
        await loadSource();
        schedulePreview(30);
      }, 600);
    });
  }

  function init() {
    load();
    buildTechs();
    refreshTechs();
    buildPresets();
    buildSliders();
    refreshOutput();
    applyPreviewCollapsed();
    showTab(state.tab);
    wire();
    watchSize();
    setStatus("Listo");
    schedulePreview(150);
  }

  init();
})();
