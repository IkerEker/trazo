# Trazo · instrucciones permanentes para Claude

Plugin UXP de Photoshop (pintura tradicional). Motor en `engine/` (se empaqueta en `plugin/js/engine.js` con
`tools/bundle.js`), texturas en `plugin/textures/*.bin` (TRZ1). Cómo usa las texturas: `TEXTURAS_TRAZO.md`.

## Casa local (orden de Iker, 20-11-2026; texto: TEXTURAS/plugins/ORDEN_CARPETA_LOCAL.md)
- El plugin vive en C:\Users\ikerg\Biblioteca\plugins\trazo\ (git local, sin GitHub). Única carpeta conectada: Biblioteca.
- Copia de seguridad: git bundle --all en Biblioteca\plugins\_respaldos\ tras cada sesión (guardar 3).
- Material SOLO por id desde Biblioteca\TEXTURAS (buscar.py, método de la ORDEN 1); nada repetido dentro del plugin.
  Lo nuevo → «PEDIDO PARA LA BIBLIOTECA».
- No tocar otros plugins, TEXTURAS, ACIDBITE, originales ni _fuentes. Borrar solo con permiso de Iker.
- Prueba exacta antes y después de cada cambio. El plugin construido funciona solo, sin Claude ni internet.
- Paso a la casa y comprobación completa: `tools\casa_local.bat` (clona, bundle, compara con GitHub, construye desde la
  biblioteca, prueba exacta, repetidos) → `INFORME_CASA.txt`. Rama de trabajo: `sin-repetidos`.

## Biblioteca y velocidad (orden de Iker, 20-11-2026; texto completo: TEXTURAS/plugins/ORDEN_PLUGINS.md)
- Material SOLO de la biblioteca IkerEker/TEXTURAS (rama atlas) + Biblioteca/ local (TEXTURAS_ROOT). Nada de bancos propios.
- Buscar SIEMPRE con el método de 7 pasos de ORDEN_PLUGINS.md (varias palabras → --resumen → abrir familias → recorrer
  clases → filtrar con --donde/--min → --parecidos → ficha + mirar la `hoja`). Incluye ab:, collage, vídeo y sonido.
  No revisar bancos enteros: las fichas ya están hechas. Releer el índice en cada conversación.
- Construir leyendo por id (or:/tx:/ab:) vía indice/indice.json. El plugin lleva dentro lo que usa: funciona sin Claude ni internet.
- Si falta algo: «PEDIDO PARA LA BIBLIOTECA:» al final de la respuesta; nunca dibujarlo/descargarlo dentro del plugin.
- Prueba exacta antes y después de todo cambio; cualquier diferencia → Iker decide con antes/después.
- Velocidad: medir con el banco de pruebas en el PC de Iker; GPU donde se pueda, con camino CPU de respaldo;
  una versión GPU que no dé idéntico queda apagada hasta que Iker diga sí. Gráficas de Iker: 2 × RTX 4090 (24 GB c/u), 64 GB RAM.
- El código, las herramientas y las pruebas se quedan en este repo; solo se quitan carpetas de material ya migradas.

## Cómo se aplica en Trazo
- Fuentes: `tools/fuentes_ids.json` (nombre de siempre → `or:<md5>`) + `tools/biblioteca.py` (resuelve id → archivo con
  `$TEXTURAS_ROOT/TEXTURAS/indice/indice.json` y comprueba el md5). Construir:
  `TEXTURAS_ROOT=<Biblioteca> python3 tools/build_assets.py && TEXTURAS_ROOT=<Biblioteca> python3 tools/extract_papers.py`.
- Prueba exacta: `node tools/bench.js --check` (md5 de los 16 `.bin` contra `tools/ref/textures.md5.json` y huellas de
  las 29 variantes + 7 procedurales, semilla 7, escena sintética 1000×750, contra `tools/ref/renders_1000.json`).
  Tiene que decir «IDÉNTICO». Antes de reconstruir texturas: guardar md5 y comparar después.
- Banco de velocidad: el mismo `node tools/bench.js` (o `tools\bench.bat` en Windows) → `tools/bench_out/bench_<fecha>.json`
  (tiempo por variante y por fase del motor). Dentro de Photoshop, el panel guarda los tiempos por fase (leer, texturas,
  motor, escalar, crear capas) en `tiempos.json` de su carpeta de datos. Qué permite el anfitrión (WebGL, Workers,
  WebAssembly) y cuánto tarda getPixels/putPixels: plugin `tools/diagnostico_uxp` (`dist/TrazoDiagnostico-1.0.0.ccx`).
- Trabajar en una rama; no fusionar en `main` sin el OK de Iker. Sin `push`: git solo en local.
