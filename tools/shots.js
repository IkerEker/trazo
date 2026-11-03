// Capturas del panel a varios tamaños con el simulador de Photoshop.
const { chromium } = require("playwright");
const out = process.argv[2] || "/tmp/shots";
const sizes = (process.argv[3] || "300x680,240x520,360x760,700x480,1000x640").split(",").map((s) => s.split("x").map(Number));
const tab = process.argv[4] || "";
const query = process.argv[5] || "img=faro";
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${w}x${h}: ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`${w}x${h}: ${e.message}`));
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto(`http://localhost:8765/plugin/index.html?${query}`);
    await page.waitForFunction(() => window.__loaded === true, null, { timeout: 15000 });
    if (tab) await page.click("#tab-" + tab);
    await page.waitForFunction(() => /vista previa en/.test(document.getElementById("pvStatus").textContent) || /oculta/.test(document.getElementById("pvStatus").textContent), null, { timeout: 30000 }).catch(() => errors.push(`${w}x${h}: la vista previa no terminó`));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/panel_${w}x${h}${tab ? "_" + tab : ""}.png` });
    // ¿algún elemento se sale horizontalmente?
    const overflow = await page.evaluate(() => {
      const W = document.documentElement.clientWidth, bad = [];
      for (const e of document.querySelectorAll("body *")) {
        const r = e.getBoundingClientRect();
        if (r.width > 0 && e.offsetParent !== null && (r.right > W + 0.5 || r.left < -0.5)) bad.push((e.id || e.className || e.tagName) + " " + Math.round(r.left) + ".." + Math.round(r.right));
      }
      return bad.slice(0, 8);
    });
    if (overflow.length) errors.push(`${w}x${h} desborde: ${overflow.join(", ")}`);
    await page.close();
  }
  await browser.close();
  console.log(errors.length ? "PROBLEMAS:\n" + errors.join("\n") : "sin errores");
})();
