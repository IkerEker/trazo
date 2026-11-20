// Prueba de Trazo · Captura con el simulador. Requiere tools/serve.js en marcha.
const { chromium } = require("playwright");
const out = process.argv[2] || ".";
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (c, m) => { if (!c) errors.push("FALLO: " + m); else console.log("OK  " + m); };
  const open = async (w, h, qs) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("pageerror", (e) => errors.push(`${w}x${h}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${w}x${h}: ${m.text()}`); });
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto("http://localhost:8765/captura/index.html?" + (qs || ""));
    await page.waitForSelector(".gcard");
    return page;
  };
  const overflow = (page) => page.evaluate(() => {
    const W = document.documentElement.clientWidth, bad = [];
    for (const e of document.querySelectorAll("body *")) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && e.offsetParent !== null && (r.right > W + 0.5 || r.left < -0.5)) bad.push(e.id || e.className);
    }
    return bad.slice(0, 5);
  });

  let page = await open(300, 720);
  ok((await page.$$(".gcard")).length === 8, "guía con 8 pasos");
  ok(await page.$eval(".gcard", (e) => e.classList.contains("open")), "paso 0 (piloto) abierto");
  await page.screenshot({ path: out + "/cap_guia.png" });
  await page.click(".gcard:nth-child(2) .gcard-head");
  ok(await page.$eval(".gcard:nth-child(2)", (e) => e.classList.contains("open")), "abrir/cerrar pasos");

  // Lista
  await page.click("#tab-lista");
  ok(/acuarela 300 g/.test(await page.$eval("#listMaterial", (e) => e.textContent)), "material de gouache por defecto");
  const items = await page.$$(".citem");
  await items[0].click(); await items[1].click();
  ok(/^2 \/ /.test(await page.$eval("#listCount", (e) => e.textContent)), "marcar trazos actualiza el contador");
  await page.click("#listTechs .tech:nth-child(2)");
  ok((await page.$$(".citem")).length === 22, "lista de óleo: 4 pinceles × 5 + 2 extra = 22");
  await page.screenshot({ path: out + "/cap_lista.png" });
  await page.waitForTimeout(300);
  ok((await page.evaluate(() => localStorage.getItem("trazo.captura.v1"))).includes("gouache|0|0"), "marcas guardadas");

  // Escanear
  await page.click("#tab-escanear");
  await page.click("#btnCheck");
  await page.waitForSelector(".rrow");
  await page.waitForFunction(() => /perfecto|aviso|problema/.test(document.getElementById("status").textContent));
  const rows = await page.$$eval(".rrow .rlabel", (els) => els.map((e) => e.textContent));
  console.log("    comprobación:", rows.join(" | "));
  ok(rows.some((r) => /600 ppp/.test(r)) && rows.some((r) => /sin quemar/.test(r)), "comprobación de escaneo correcto");
  ok((await page.$eval("#fileName", (e) => e.textContent)) === "GOUACHE_H01_R000.png", "nombre inicial");
  ok((await page.$$eval("#progressGrid .pdot.on", (e) => e.length)) === 3, "progreso leído de la carpeta (3 archivos)");
  await page.screenshot({ path: out + "/cap_escanear.png", fullPage: false });

  // Guardar: R000 existe → pide confirmación
  await page.click("#btnSave");
  await page.waitForFunction(() => /ya existe/.test(document.getElementById("status").textContent));
  ok(await page.$eval("#btnSave", (e) => e.classList.contains("armed")), "aviso de reemplazo");
  await page.click("#btnSave");
  await page.waitForFunction(() => /Guardado/.test(document.getElementById("status").textContent));
  ok((await page.$eval("#fileName", (e) => e.textContent)) === "GOUACHE_H01_R090.png", "avanza a R090 tras guardar");
  // R090 también existe → confirmar; luego R180 y R270 nuevos
  for (let i = 0; i < 3; i++) {
    await page.click("#btnSave");
    await page.waitForTimeout(150);
    if (await page.$eval("#btnSave", (e) => e.classList.contains("armed"))) await page.click("#btnSave");
    await page.waitForTimeout(150);
  }
  ok((await page.$eval("#fileName", (e) => e.textContent)) === "GOUACHE_H02_R000.png", "tras R270 pasa a la hoja H02");
  const saves = await page.evaluate(() => window.__psLog.filter((l) => l[0] === "saveAs.png").map((l) => l[1]));
  ok(saves.join(",") === "GOUACHE_H01_R000.png,GOUACHE_H01_R090.png,GOUACHE_H01_R180.png,GOUACHE_H01_R270.png", "guardados: " + saves.join(","));

  // Lápiz: sin rotaciones
  await page.click("#saveTechs .tech:nth-child(1)");
  ok(await page.$eval("#rotRow", (e) => e.classList.contains("hidden")), "lápiz oculta las rotaciones");
  ok((await page.$eval("#fileName", (e) => e.textContent)) === "LAPIZ_H01_R000.png", "nombre lápiz");
  // Soportes
  await page.click("#saveTechs .tech:nth-child(6)");
  await page.click("#segSupport .seg-item:nth-child(2)");
  ok((await page.$eval("#fileName", (e) => e.textContent)) === "PAPELACUARELA_H01_R000.png", "nombre de soporte");

  // Plantilla
  await page.click("#btnTemplate");
  await page.waitForFunction(() => /Plantilla creada|No se pudo/.test(document.getElementById("status").textContent));
  const tl = await page.evaluate(() => window.__psLog.filter((l) => ["createDocument", "putPixels", "guide"].includes(l[0])));
  ok(tl.length === 9 && tl[0][1] === 4724, "plantilla: documento 4724 px, 4 cruces y 4 guías");
  await page.screenshot({ path: out + "/cap_escanear2.png" });
  const ov = await overflow(page); ok(!ov.length, "sin desbordes a 300 px " + ov.join(","));
  await page.close();

  // Escaneo con blanco quemado + 300 ppp + jpg
  page = await open(260, 640, "burn=1&ppi=300&title=hoja.jpg");
  await page.click("#tab-escanear");
  await page.click("#btnCheck");
  await page.waitForFunction(() => /problema/.test(document.getElementById("status").textContent));
  const bad = await page.$$eval(".rrow.bad .rlabel", (els) => els.map((e) => e.textContent));
  console.log("    errores detectados:", bad.join(" | "));
  ok(bad.length >= 3, "detecta JPG, 300 ppp y blanco quemado");
  await page.screenshot({ path: out + "/cap_errores.png" });
  const ov2 = await overflow(page); ok(!ov2.length, "sin desbordes a 260 px " + ov2.join(","));
  await page.close();

  // Ancho
  page = await open(720, 520);
  await page.click("#tab-lista");
  await page.screenshot({ path: out + "/cap_ancho.png" });
  const ov3 = await overflow(page); ok(!ov3.length, "sin desbordes a 720 px");
  await page.close();

  await browser.close();
  console.log(errors.length ? "PROBLEMAS:\n" + errors.join("\n") : "TODO OK");
})();
