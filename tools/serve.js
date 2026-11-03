// Servidor estático para probar el panel con el simulador de Photoshop.
// http://localhost:8765/plugin/index.html?img=faro
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("404"); }
  let body = fs.readFileSync(file);
  if (url.pathname.endsWith("/plugin/index.html")) {
    // el simulador carga la imagen de prueba antes de arrancar los scripts del plugin
    body = body.toString()
      .replace(/<script src="js\/(engine|ps|ui)\.js"><\/script>\s*/g, "")
      .replace("</body>", `<script src="/tools/mock-photoshop.js"></script>
  <script>__psReady.then(async () => { for (const f of ["js/engine.js","js/ps.js","js/ui.js"]) await new Promise((r) => { const s = document.createElement("script"); s.src = f; s.onload = r; document.body.appendChild(s); }); window.__loaded = true; });</script>
</body>`);
  }
  if (url.pathname.endsWith("/captura/index.html")) {
    body = body.toString().replace('<script src="js/data.js"></script>', '<script src="/tools/mock-captura.js"></script>\n  <script src="js/data.js"></script>');
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  res.end(body);
}).listen(8765, () => console.log("http://localhost:8765/plugin/index.html"));
