// Rasteriza los iconos PNG del manifest con Chromium (fondo transparente).
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const jobs = [
    ["tools/icons-src/glyph-dark.svg", "plugin/icons/panel-dark.png", 23],
    ["tools/icons-src/glyph-dark.svg", "plugin/icons/panel-dark@2x.png", 46],
    ["tools/icons-src/glyph-light.svg", "plugin/icons/panel-light.png", 23],
    ["tools/icons-src/glyph-light.svg", "plugin/icons/panel-light@2x.png", 46],
    ["plugin/icons/mark.svg", "plugin/icons/plugin.png", 48],
    ["plugin/icons/mark.svg", "plugin/icons/plugin@2x.png", 96],
  ];
  for (const [src, dst, size] of jobs) {
    const svg = fs.readFileSync(path.join(root, src), "utf8").replace(/width="24" height="24"/, `width="${size}" height="${size}"`);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: path.join(root, dst), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();
  console.log("PNG listos");
})();
