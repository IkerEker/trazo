// Prueba de interacción: técnica, slider, preset, GENERAR, cancelar.
// Requiere tools/serve.js en marcha. uso: node tools/flow_test.js <carpeta-salida>
const { chromium } = require("playwright");
const fs = require("fs");
const out = process.argv[2] || ".";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 320, height: 760 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto("http://localhost:8765/plugin/index.html?img=retrato&scale=3");
  await page.waitForFunction(() => window.__loaded === true);
  const waitPreview = () => page.waitForFunction(() => /vista previa en/.test(document.getElementById("pvStatus").textContent), null, { timeout: 30000 });
  await waitPreview();
  const ok = (c, m) => { if (!c) errors.push("FALLO: " + m); else console.log("OK  " + m); };

  // 1) cambiar a Acuarela
  await page.click("#techs .tech:nth-child(4)");
  await page.waitForFunction(() => /Acuarela · vista previa/.test(document.getElementById("pvStatus").textContent), null, { timeout: 30000 });
  ok(await page.$eval("#techs .tech:nth-child(4)", (e) => e.classList.contains("on")), "cambio de técnica a Acuarela y vista previa");
  ok((await page.$$("#techs .tech")).length === 8, "8 técnicas");

  // 2) arrastrar el slider de grosor
  await page.click("#tab-ajustes");
  const track = await page.$$(".sl-track");
  const box = await track[1].boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const vals = await page.$$eval(".sl-val", (els) => els.map((e) => e.textContent));
  ok(vals[1] === "80", "arrastre del slider de grosor = 80 (" + vals.join(",") + ")");
  await page.waitForTimeout(500);
  await waitPreview();

  // 3) doble clic = valor por defecto
  await page.mouse.click(box.x + 5, box.y + box.height / 2);
  await page.mouse.click(box.x + 5, box.y + box.height / 2);
  const vals2 = await page.$$eval(".sl-val", (els) => els.map((e) => e.textContent));
  ok(vals2[1] === "55", "doble clic restablece grosor a 55 (" + vals2[1] + ")");

  // 4) guardar preset
  await page.click("#tab-tecnica");
  await page.fill("#presetName", "Mi acuarela");
  await page.click("#btnSavePreset");
  ok(await page.$$eval(".chip.user", (els) => els.map((e) => e.textContent).includes("Mi acuarela")), "preset de usuario guardado");
  await page.waitForTimeout(400);
  const stored = await page.evaluate(() => localStorage.getItem("trazo.state.v2"));
  ok(stored && stored.includes("Mi acuarela"), "estado persistido en localStorage");

  // 5) variantes: preset en Técnica y modo en Ajustes
  await page.click("#techs .tech:nth-child(2)");
  ok((await page.$$eval("#presets .chip", (els) => els.map((e) => e.textContent))).slice(0, 4).join("|") === "Línea suelta|Rayado|Carboncillo|Negros expresivos", "4 variantes de lápiz");
  await page.click("#presets .chip:nth-child(3)");
  await page.click("#tab-ajustes");
  ok(await page.$eval("#sliders .chips .chip:nth-child(3)", (e) => e.classList.contains("on")), "la variante Carboncillo queda marcada en Ajustes");
  await page.click("#sliders .chips .chip:nth-child(4)");
  ok(await page.$eval("#sliders .chips .chip:nth-child(4)", (e) => e.classList.contains("on")), "cambiar de variante en Ajustes");
  await page.waitForTimeout(500);
  await waitPreview();
  await page.screenshot({ path: out + "/flow_lapiz_color.png" });

  // 6) GENERAR
  await page.click("#tab-salida");
  await page.click("#q-borrador");
  await page.click("#btnGenerate");
  await page.waitForFunction(() => /generado|Error/.test(document.getElementById("status").textContent), null, { timeout: 60000 });
  const status = await page.$eval("#status", (e) => e.textContent);
  ok(/generado/.test(status), "GENERAR completo: " + status);
  const log = await page.evaluate(() => window.__psLog.filter((l) => l[0] !== "getPixels"));
  console.log("    registro PS:", JSON.stringify(log));
  const puts = await page.evaluate(() => (window.__putImages || []).length);
  ok(puts === 2, "dos putPixels (papel + pintura): " + puts);
  await page.screenshot({ path: out + "/flow_after_generate.png" });
  const imgs = await page.evaluate(() => window.__putImages);
  fs.writeFileSync(out + "/put_paper.png", Buffer.from(imgs[0].split(",")[1], "base64"));
  fs.writeFileSync(out + "/put_paint.png", Buffer.from(imgs[1].split(",")[1], "base64"));

  // 7) cancelar a mitad
  await page.click("#q-maxima");
  await page.click("#btnGenerate");
  await page.waitForTimeout(400);
  await page.click("#btnGenerate");
  await page.waitForFunction(() => /Cancelado|generado/.test(document.getElementById("status").textContent), null, { timeout: 60000 });
  ok(/Cancelado/.test(await page.$eval("#status", (e) => e.textContent)), "cancelación");
  const puts2 = await page.evaluate(() => (window.__putImages || []).length);
  ok(puts2 === 2, "cancelar no crea capas");

  await browser.close();
  console.log(errors.length ? "PROBLEMAS:\n" + errors.join("\n") : "TODO OK");
})();
