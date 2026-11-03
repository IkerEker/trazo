# Trazo · Pintura tradicional para Photoshop

Plugin UXP para Photoshop que convierte fotografías en **Lápiz, Óleo, Gouache, Ceras o Acuarela**.
Analiza la imagen para decidir la dirección de cada trazo (siguen bordes y formas, no son
aleatorios) y crea la pintura en una **capa nueva con transparencia**: lo que no se pinta
queda transparente, y el papel o el lienzo va en una capa aparte.

**Novedad en 1.1: pinta con trazos reales.** Cada pincelada es una muestra real (87 trazos
separados de las imágenes de `TEXTURES/`) que se dobla a lo largo del recorrido. Conserva su
forma, la carga inicial, las vetas de las cerdas, el final seco y el relieve. El papel y el
lienzo también son reales: se sacan del fondo de esas imágenes.

- Sin dependencias externas. Las texturas de cada técnica se cargan solo al usarla.
- Vista previa en vivo que se cancela sola al mover un control.
- Interfaz en negro, blanco y verde que se adapta a cualquier tamaño de panel o grupo de pestañas.

---

## Instalación

**Requisitos:** Photoshop 2024 (v25.0) o posterior y un documento en modo **RGB** de 8 o 16 bits.

### Opción A · Doble clic (recomendada para usar)
1. Haz doble clic en `dist/Trazo-1.1.0.ccx`. Creative Cloud lo instala.
2. En Photoshop: **Plugins › Trazo · Pintura tradicional**.

> El `.ccx` no está firmado por Adobe Marketplace, así que Creative Cloud puede avisar de que
> el plugin no está verificado. Si no deja instalarlo, usa la opción B.

### Opción B · UXP Developer Tool (recomendada para desarrollar)
1. Instala **UXP Developer Tool** desde Creative Cloud.
2. Pulsa **Add Plugin** y elige `plugin/manifest.json`.
3. Pulsa **Load**. El panel aparece en Photoshop.
4. Con **Package** generas un `.ccx` oficial para distribuirlo.

---

## Uso

1. Selecciona la capa que quieres pintar. Si la capa activa no es de píxeles (texto, grupo…),
   se usa la imagen combinada.
2. Pestaña **1 · Técnica**: elige Lápiz, Óleo, Gouache, Ceras o Acuarela y, si quieres, un preset.
3. Pestaña **2 · Ajustes**: ajusta los controles. Solo aparecen los que tienen sentido para
   esa técnica. Con doble clic sobre un control vuelve a su valor por defecto.
4. Pestaña **3 · Salida**: calidad, uso de la selección, capas, semilla y exportación.
5. Pulsa **GENERAR**.

### Qué crea en Photoshop
```
▾ Trazo · Óleo          ← grupo nuevo, justo encima de tu capa
    Óleo                ← la pintura (PNG con transparencia)
    Lienzo / Papel      ← soporte opcional, se puede ocultar o borrar
  Tu capa original      ← intacta (oculta, si así lo eliges)
```
- Todo queda en **un único paso de deshacer** (`Ctrl/Cmd + Z`).
- Tras generar, la capa original vuelve a quedar seleccionada: puedes cambiar ajustes y
  generar otra versión para compararlas.
- **Exportar última pintura como PNG** guarda la capa de pintura con su transparencia.

### Controles
| Control | Qué hace | Técnicas |
|---|---|---|
| Intensidad del trazo | Presión y opacidad de cada trazo | Todas |
| Grosor del trazo | Ancho del pincel o de la punta | Todas |
| Longitud del trazo | Lo largo que es cada pincelada | Todas |
| Curvatura del trazo | 0 = trazos rectos · 100 = siguen las formas | Todas |
| Cobertura del blanco | Cuánto lienzo se cubre; lo no cubierto queda transparente | Todas |
| Empaste | Relieve y brillo de la pintura gruesa | Óleo, Gouache, Ceras |
| Humedad · Granulado | El color se corre / el pigmento se asienta en el grano | Acuarela |
| Sombreado cruzado | Ángulo entre las capas de rayado | Lápiz |
| Lápiz de color | Colores de la foto en lugar de grafito | Lápiz |
| Variación de tono / saturación / luz | Diferencias de color entre pinceladas | Todas (lápiz: solo en color) |
| Detalle | Trazos finos en bordes y zonas importantes | Todas |

### Opciones de salida
- **Calidad**
  - Borrador: hasta 1,5 MP.
  - Alta: hasta 6 MP.
  - Máxima: hasta 16 MP.
  - Las imágenes mayores se pintan a ese tamaño y se escalan al original.
- **Selección activa**
  - Ignorar.
  - Solo dentro: fuera de la selección queda transparente.
  - Más detalle: trazos más finos dentro de la selección.
- **Semilla**: con la misma semilla y los mismos ajustes sale el mismo resultado. "Otra variación" cambia la semilla.

### Tiempos orientativos
Medidos en un procesador de servidor de 4 núcleos con el mismo motor JavaScript (V8) que usa UXP:

| Técnica | Borrador (1,5 MP) | Alta (6 MP) |
|---|---|---|
| Lápiz | 3,0 s | 7,9 s |
| Óleo | 3,3 s | 9,6 s |
| Gouache | 2,9 s | 8,1 s |
| Ceras | 3,9 s | 12,0 s |
| Acuarela | 3,1 s | 7,7 s |

Pintar con trazos reales tarda aproximadamente el doble que el modelo procedural de la 1.0.
La vista previa del panel tarda alrededor de 1 s. Durante GENERAR, Photoshop muestra su barra
de progreso y se puede cancelar desde ahí o desde el propio botón.

---

## Cómo funciona

1. **Análisis**: se calcula el *tensor de estructura* de la imagen y, con él, dos campos de
   direcciones. Uno es suave, para el relleno; el otro es fino, para contornos y detalle. En
   zonas sin dirección clara (cielo, follaje) los trazos adoptan una dirección regular, como
   haría un pintor.
2. **Pintura por capas de pincel** (Óleo, Gouache, Ceras): primero pinceles grandes y luego
   más finos solo donde falta detalle. Cada trazo sigue el campo de direcciones y se detiene
   al cruzar un cambio de color.
   - Cada pincelada es un **trazo real**. Cabeza, cuerpo y cola se mapean sobre el recorrido:
     el cuerpo se recorta o se repite según la longitud, y la carga inicial y el final seco
     se conservan.
   - El pincel va **cargado con dos tonos**, que forman vetas siguiendo las cerdas.
   - La pintura recoge el color que hay debajo (mezcla húmeda).
   - El relieve de la muestra da el brillo del empaste.
3. **Lápiz**: el sombreado se hace con trazos reales de grafito y carbón (los más ligeros en
   las primeras pasadas) y se acumula hasta igualar el tono de la foto. Encima van contornos
   finos sobre el diente del papel real.
4. **Acuarela**: una aguada base hecha por abstracción (Kuwahara, sangrado húmedo, bordes de
   pigmento, granulado). Encima van **veladuras con aguadas reales**, más en las zonas oscuras,
   que oscurecen de forma limitada al superponerse. El papel blanco se convierte en
   transparencia.
5. **Soporte real a escala física**: se supone un cuadro de unos 30 cm, así que el grano y la
   trama se ven como en un original. Si faltan las texturas, el motor usa su modelo procedural
   de la 1.0.

---

## Estructura del proyecto

```
plugin/              ← el plugin UXP (esto es lo que se instala)
  manifest.json
  index.html
  css/styles.css
  js/engine.js       ← motor empaquetado (generado, no editar)
  js/ps.js           ← puente con Photoshop: píxeles, capas, historial, exportar
  js/ui.js           ← interfaz: pestañas, sliders, presets, vista previa
  icons/
  textures/          ← trazos reales por técnica (*.bin) y soportes (soporte-*.bin), generados
engine/              ← código fuente del motor (módulos)
  core.js            ← desenfoques, ruido, muestreo, textura de papel
  analysis.js        ← campo de direcciones, bordes, cobertura, pirámide de color
  strokes.js         ← trazado y rasterizado de pinceladas
  painter.js         ← Óleo, Gouache, Ceras
  pencil.js          ← Lápiz
  watercolor.js      ← Acuarela
  paper.js           ← papel y lienzo
  library.js         ← carga de trazos y soportes reales, mapeo sobre recorridos, mipmaps
  techniques.js      ← técnicas, parámetros por defecto y presets
tools/
  bundle.js          ← engine/*.js → plugin/js/engine.js
  extract_strokes.py ← TEXTURES/*  → plugin/textures/<técnica>.bin (+ hojas de contacto)
  extract_papers.py  ← fondos de TEXTURES → plugin/textures/soporte-*.bin
  package.sh         ← genera dist/*.ccx y dist/*.zip
  run.js             ← prueba el motor en Node con una imagen
  serve.js + mock-photoshop.js ← el panel en el navegador con Photoshop simulado
  shots.js, flow_test.js       ← capturas a varios tamaños y prueba de interacción
TEXTURES/            ← imágenes de trazos, una carpeta por técnica
  AGUADAS/ GUACHE/ LAPIZ/ OLEO/ CERAS/
dist/                ← paquete .ccx listo para instalar
```

### Desarrollo
Para regenerar los trazos tras añadir imágenes a `TEXTURES/` (requiere Python 3 con numpy,
scipy y Pillow):
```bash
python3 tools/extract_strokes.py
```
```bash
python3 tools/extract_papers.py
```
Para regenerar el motor empaquetado:
```bash
node tools/bundle.js
```
```bash
node tools/run.js ruta/a/una/foto.png oleo --paper
```
```bash
node tools/serve.js
```
Con el servidor en marcha, abre `http://localhost:8765/plugin/index.html?img=faro`. El simulador lee la foto de prueba de `tools/img/faro.png`; esa carpeta no se publica, así que pon ahí tu propia imagen.
```bash
./tools/package.sh
```

Los presets de fábrica y los valores por defecto están en `engine/techniques.js`. Los presets
que guarda cada usuario se almacenan en el propio panel.

---

## Estado de las pruebas

Probado en este entorno:
- El motor en Node, con las 5 técnicas, con y sin trazos reales, imágenes de hasta 9 MP y
  medición de tiempos y memoria.
- La extracción de los 87 trazos (31 imágenes, 2 duplicadas descartadas), revisada con hojas
  de contacto.
- El panel completo en Chromium con una simulación de la API de Photoshop, que comprueba:
  - técnicas, sliders, doble clic y presets;
  - persistencia de los ajustes;
  - GENERAR, con el grupo, las capas y el historial;
  - cancelar;
  - sin documento abierto;
  - tamaños de panel de 240 a 1000 px.

**No se ha probado todavía dentro de Photoshop real.** La API se usó siguiendo la
documentación oficial de Adobe (Imaging API, `executeAsModal`, `suspendHistory`, DOM de
capas), pero UXP difiere en detalles de un navegador. Al cargarlo por primera vez con UXP
Developer Tool, revisa la consola por si aparece algún aviso.
