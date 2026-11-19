# TEXTURAS_TRAZO — Cómo usa las texturas el plugin Trazo

> Este documento solo describe el plugin; no se ha tocado código.
> Lo que no se ha comprobado lleva la marca **«sin verificar»**.
> Rutas relativas a la raíz del repo `trazo/`.

---

## 1. IDENTIDAD

| Campo | Valor |
|---|---|
| Nombre | **Trazo** (manifest `name: "Trazo"`) |
| ID | `com.trazo.pinturatradicional` |
| Versión | **1.13.0** |
| Tipo | Plugin UXP para Photoshop, manifest v5, `host PS minVersion 24.5.0`, `apiVersion 2` |
| Repo / rama | https://github.com/IkerEker/trazo · `main` |
| Commit | `d8867fec4d71bcdc826c73f5685ac443443b7c67`: «Trazo 1.13.0: lápiz con acentos oscuros e irregulares encima» |
| Permisos | `localFileSystem: "request"`. No hay red ni servicios externos. |

**Descripción.** Trazo convierte la imagen activa de Photoshop (o la selección) en una
pintura o dibujo tradicional con aspecto físico. Analiza la imagen: color, regiones, bordes
y dirección. Después la vuelve a pintar trazo a trazo con **muestras reales de pinceladas
escaneadas**: cada trazo de la librería se estira a lo largo de un recorrido, con cabeza,
cuerpo y cola, y conserva su relieve. A eso añade:

- texturas reales de pintura y acuarela en mosaico (*tiles*);
- manchas con forma (*stamps*);
- superposiciones de material (*overlays*): madera, impresión, carbón…;
- tiras de grano de grafito para el lápiz.

Por último aplica el soporte (papel o lienzo, sintetizado a partir de escaneos reales). Si
el Papel está activado, el resultado sale en dos capas: papel y pintura. Todo se ejecuta en
local, dentro de Photoshop, en JavaScript puro.

**Técnicas y variantes** (7 técnicas en el panel):

| Técnica (id) | Variantes / modos | Motor principal |
|---|---|---|
| Óleo (`oleo`) | presets de óleo: empaste, suelto… | `painter3.js` + `painter.finish` |
| Lápiz (`lapiz`) | Línea suelta, Rayado, Carboncillo, Negros expresivos | `lapiz.js` |
| Ceras (`ceras`) | barra / Manley (cera de colores) | `painter3.js` |
| Acuarela (`acuarela`) | húmeda, seca, con dibujo («dibujo» = acuarela + `sketch.js`) | `watercolor2.js` (+ `sketch.js`) |
| Gouache (`gouache`) | opaco, diluido (= capa `Water2` + `painter3`) | `painter3.js` (+ `watercolor2.js`) |
| Mixta / Técnica mixta (`mixtalg`) | lápiz + gouache + manchas | `mixta.js` (+ `sketch.js`, `painter3.js`) |
| Xilografía (`xilografia`) | 1–3 tintas | `xilografia.js` |

El orden exacto de las técnicas y los nombres visibles de los presets no se revisaron uno
por uno (**sin verificar**). `tools/flow_test.js` sí confirma 7 técnicas y 4 variantes de
lápiz.

---

## 2. ESTRUCTURA

```
trazo/
├── README.md
├── engine/              ← motor JS modular (fuente)
│   ├── index.js         ← orquestador: ASSETS_FOR, SUPPORT_FOR, TOOTH, flujo por técnica
│   ├── library.js       ← parser TRZ1, mipmaps, muestreo de trazos, papel, PHYS_MM, synthetic()
│   ├── kit.js           ← tiles, overlays, stamps, paperTooth, mezclas (overU8, multU8)
│   ├── core.js          ← utilidades, ruido fbm, makeGrainTile (grano procedural)
│   ├── painter3.js / painter.js  ← óleo, gouache y ceras; relieve e iluminación (finish)
│   ├── watercolor2.js   ← acuarela
│   ├── lapiz.js / sketch.js      ← lápiz; boceto (para mixta y acuarela-dibujo)
│   ├── mixta.js / xilografia.js
│   └── paper.js         ← capa de papel (realPaper / procedural)
├── plugin/              ← lo que se empaqueta en el .ccx (≈32 MB)
│   ├── manifest.json, index.html, css/, icons/
│   ├── js/ui.js         ← panel UXP, carga de texturas (readPluginBinary)
│   ├── js/engine.js     ← BUNDLE generado desde engine/ por tools/bundle.js
│   └── textures/*.bin   ← 20 binarios TRZ1 (ver §3)
├── tools/
│   ├── build_assets.py  ← CONSTRUYE pin_*, manchas, tiles_*, ov_*, grano_grafito
│   ├── extract_strokes.py ← utilidades de extracción de trazos y write_library (y un main() antiguo)
│   ├── extract_papers.py  ← CONSTRUYE soporte-*.bin
│   ├── bundle.js, package.sh, package.py
│   ├── run.js           ← renderizador Node (CLI) para pruebas
│   ├── serve.js, flow_test.js, shots.js ← simulador del panel + Playwright
│   └── out/, img/       ← (gitignored) hojas de contacto y previsualizaciones; imágenes de prueba
├── TEXTURES/            ← BIBLIOTECA FUENTE (~1,3 GB, ver §3.3)
├── REFERENCIAS/         ← 23 MB, solo referencia visual para análisis (no se procesa)
├── dist/                ← Trazo-1.13.0.ccx, Trazo-1.13.0-carpeta.zip, muestras_1.13.jpg, Trazo-1.0.0-fuente.zip
├── reports/, research_notes/
├── captura/             ← (gitignored) plugin auxiliar «Trazo Captura», aparcado
└── docs/                ← (gitignored)
```

**Lenguajes y dependencias**

- Plugin: JavaScript puro para UXP, sin dependencias npm en tiempo de ejecución. Las APIs que
  usa son `photoshop` (imaging, action, core) y `uxp` (storage).
- Herramientas de construcción: Python 3 con `numpy`, `scipy` (ndimage) y `Pillow`.
- Pruebas: Node.js, Playwright con Chromium (simulador `mock-photoshop` servido por
  `tools/serve.js`) y ffmpeg (opcional, para vídeos y capturas).

**Construcción y empaquetado**

1. Texturas (solo cuando cambian las fuentes):
   - `python3 tools/build_assets.py [--only pin|manchas|tiles|ov|grano] [--fam a,b]`
   - `python3 tools/extract_papers.py`
   - Ambos escriben en `plugin/textures/`.
2. Paquete: `bash tools/package.sh`.
   - Primero ejecuta `node tools/bundle.js`, que genera `plugin/js/engine.js`.
   - Después ejecuta `python3 tools/package.py`. Este valida el manifest y comprime en ZIP:
     `manifest.json` primero, sin entradas de directorio, deflate nivel 9.
   - Salida: `dist/Trazo-<v>.ccx` y `dist/Trazo-<v>-carpeta.zip`.

**Pesos**

| Elemento | Tamaño |
|---|---|
| `dist/Trazo-1.13.0.ccx` | 18 703 337 B (≈17,8 MiB, 56 archivos) |
| `dist/Trazo-1.13.0-carpeta.zip` | 18 704 009 B |
| `plugin/` (sin comprimir) | ≈32 MB, de los cuales `plugin/textures/` ≈ 31,3 MB |
| `TEXTURES/` (fuentes) | ≈1,3 GB |
| `REFERENCIAS/` | ≈23 MB (no se usa en la construcción) |

---

## 3. CÓMO USA LAS TEXTURAS

### 3.1 ¿En tiempo de ejecución o incrustadas?

**Las dos cosas.** Las texturas se **preprocesan en la construcción** (Python) a binarios
`TRZ1` que van **dentro del .ccx** (`plugin/textures/*.bin`). El plugin **los lee en tiempo
de ejecución** desde su propia carpeta:

```
ui.js  readPluginBinary("textures/" + name + ".bin")
  → uxp.storage.localFileSystem.getPluginFolder()
  → folder.getEntry(rel) → file.read({format: formats.binary})
  → Engine.parseTexture (library.js parse)  → caché texCache
texturesFor(tech) = ASSETS_FOR[tech] ∪ {"soporte-" + SUPPORT_FOR[tech]}
```

- El plugin no lee nunca `TEXTURES/` ni ninguna ruta fuera de su carpeta, y no hace peticiones
  de red.
- Si falta un `.bin`, hay alternativas sin texturas:
  - `Lib.synthetic(kind)` crea trazos sintéticos;
  - `C.makeGrainTile` crea grano procedural;
  - `paper.js` tiene un papel procedural.

  `tools/run.js --procedural` fuerza este modo.

### 3.2 Formato contenedor TRZ1 (común a todos los `.bin`)

```
"TRZ1" | uint32 LE longitud_cabecera | cabecera JSON ASCII (relleno a múltiplo de 4) | datos uint8
```

La cabecera tiene tres formas:

| Forma | Cabecera | Planos |
|---|---|---|
| **trazos** (`pin_*`) | `{version:1, technique, samples:[{w,h,head,tail,top,bottom,fill,paint,aspect,q,offset,channels}]}` | plano A (alfa/densidad); si `channels=2`, también plano S (relieve, 128 = neutro) |
| **items** (`tiles_*`, `manchas`, `ov_*`, `grano_grafito`) | `{version:2, kind:"tiles"\|"stamps"\|"overlays", items:[{name,tags,…meta, planes:[{w,h,offset}]}]}` | 1 a 3 planos según el tipo |
| **papel** (`soporte-*`) | `{version:1, kind, w:512, h:512, sd, offset:0}` | 1 canal de 8 bits, tileable |

### 3.3 Fuentes en `TEXTURES/`

Abreviaturas usadas en el documento:

| Abrev. | Ruta | Nº | Peso | Contenido |
|---|---|---|---|---|
| **MAT** | `TEXTURES/MATERIALE_TILEABLES/` | 55 | 417 MB | `Acuarela_Base_1–5`, `Acuarela_Grano_1–10`, `Acuarela_manchas_1,2,3,5`, `Guache_Pinceladas_Calidas_1–14`, `_Frias_1–12`, `_Grises_1–10` (todos `*_Basecolor.png`) |
| **RFORMA** | `TEXTURES/REALISTAS/MANCHA CON  FORMA CONCRETA/` (dos espacios) | 34 | 50 MB | `001–016.png`, 12 `Gemini_*.jpg`, 6 PNG «Pincelada/Mancha/Trazo de gouache gris…» |
| **RGRAND** | `TEXTURES/REALISTAS/MANCHAS GRANDES DE VARIOS TRAZOS_TEXTURA COMPLEJA/` | 10 | 42 MB | `Macnha_1–6`, `MACNHA_07/10/11`, `MANCHA_08` |
| **RTILE** | `TEXTURES/REALISTAS/TEXTURAS REALISTAS TILEABLES/` | 15 | 113 MB | `ACUARELAS_BASE_01,2,3,4,6,7`; `Bruchazos_Guache` (+`_2,3,5,6,7,8,9`, `_Puntos`) |
| **T916** | `TEXTURES/TEXTURAS EN 9-16 NO TILEABLES/` | 125 | 482 MB | JPG Gemini de 1536×2752 (madera, impresión, goteos, grafito, carbón, papel, etc.) |
| **TR** | `TEXTURES/TRAZOS/` (nivel superior) | 49 | 158 MB (con subcarpetas) | hojas de pruebas de trazos: tinta, rotulador, cera, pintura, grafito, carbón y 11 Gemini |
| TR/AGUADAS | | 7 | | aguadas de acuarela |
| TR/CERAS | | 5 | | barras de cera |
| TR/GUACHE | | 9 | | pinceladas de gouache |
| TR/LAPIZ | | 7 | | barras verticales de grafito y carbón, 1536×2752 |
| TR/OLEO | | 3 | | pinceladas de óleo |

### 3.4 Tipos de asset, uno por uno

#### A) Librerías de trazos `pin_<familia>.bin`: pinceladas reales estiradas

- **Qué son.** Muestras de trazos individuales extraídas de escaneos. Cada muestra está
  enderezada a lo largo de su eje central (vertical, de cabeza a cola) y lleva estos metadatos:
  - `head`/`tail`: filas donde acaba la cabeza y empieza la cola;
  - `top`/`bottom`, `fill` (cobertura), `paint`, `aspect` (alto/ancho);
  - `q`: peso de calidad.
- **Script.** `tools/build_assets.py` (`build_pin`), que usa funciones de `extract_strokes.py`.
- **Proceso.**
  1. `load_rgb(f, 2752)` y `density()`: cada canal se divide por el fondo ajustado (polinomio
     cúbico, `ES.fit_background`), y D = 1 − mín(canal).
  2. `components(D)`: gaussiana σ=2; umbral `max(0.05, 4·σ_papel)`; apertura; dilatación con
     hueco `max(4, 0.6 % del lado menor)`; se quedan las áreas ≥ 0,15 % de la imagen.
  3. `frame_of`: enderezado por PCA. Se descartan:
     - trazos con longitud < 2,4·ancho o < 60 px;
     - rizos y bucles (más de un 22 % de filas con varias franjas).
  4. `ES.extract_stroke`: remuestreo a lo largo de la línea central, con `BODY_FRAC 0.70` y
     detección de cabeza y cola. Se escala a la anchura `WIDTH` y la altura máxima es
     `HMAXF`.
  5. Planos:
     - familias opacas: A = smoothstep(0,1·Db, 0,62·Db); S = relieve normalizado a σ 0,11,
       recortado a ±0,75 y guardado como `128 + S·127,5`;
     - familias transparentes (`lapiz`, `acuarela`): A = R / p99,3, un solo plano.
  6. Selección:
     - se descartan muestras con h < 40 y duplicados (md5 por familia);
     - se ordenan por (−q, |fill−0,7| + ruido·0,3) y se guardan las `CAP` primeras;
     - se escribe con `ES.write_library`.
- **Formato final.** TRZ1 «trazos»: uint8, 1 o 2 planos.

| Familia | WIDTH | HMAXF | CAP | Opaca | Fuentes (q = peso) | Uso en motor |
|---|---|---|---|---|---|---|
| `gouache` → **pin_gouache** | 96 | 720 | 30 | sí | q3: RFORMA `Gemini*`, `Mancha vertical*`, `Pincelada*`, `Trazo de gouache*`, `005/006/007/014.png`; q1: TR/GUACHE/*, TR `Muestras abstractas de pincel seco*` | **solo Óleo** (mainLib oleo = [pin_gouache, pin_oleo]) |
| `oleo` → **pin_oleo** | 112 | 720 | 30 | sí | q2: TR `Cuatro pinceladas rojas*`, `Franjas de pintura roja*`, `Muestras de pinceladas azules*`, `Ocho pinceladas azules*`, `Pinceladas azules sobre*`, `Pinceladas rojas sobre*`, `Trazos azules sobre fondo blanco.png`; q1: TR/OLEO/* | Óleo |
| `guache` → **pin_guache** | 96 | 720 | 40 | sí | q2: TR/GUACHE/* + TR `Gemini_Generated_Image_{1m2v,xw72,i9od,uoqx,gtyi,fooa}…jpg` + TR `Pincelada gris sobre blanco.png` | Gouache, Mixta |
| `cera` → **pin_cera** | 80 | 640 | 26 | sí | q2: TR `Cinco trazos azules sobre*`, `Cinco trazos rojos*`, `Cuatro trazos rojos texturizados*`, `Tres trazos azules texturizados*`, `Gemini_4k0x*`, `Garabato de carb*`, `Trazo serpenteante*`; q1: TR/CERAS/* | **no se usa** (ver 3.6) |
| `barra` → **pin_barra** | 96 | 720 | 30 | sí | q2: TR/CERAS/* | Ceras (barra y Manley) |
| `manley` → **pin_manley** | 72 | 720 | 30 | sí | q2: TR `Cinco trazos rojos*`, `Cuatro trazos rojos texturizados*`, `Cinco trazos azules sobre*`, `Tres trazos azules texturizados*` | Ceras, variante Manley |
| `pastel` → **pin_pastel** | 96 | 640 | 30 | sí | q2: TR `Gemini_4k0x*`, `Garabato de carb*` | **no se usa** (ver 3.6) |
| `lapiz` → **pin_lapiz** | 56 | 640 | 30 | no | q1: TR/LAPIZ/*, TR `Gemini_uy13*`, `Gemini_2tepo*`, `Hoja de garabatos de grafito*`, `Garabatos abstractos de grafito*`, `Doodles de grafito*` | Mixta y Acuarela-dibujo (vía sketch.js); acuarela (cargado) |
| `acuarela` → **pin_acuarela** | 96 | 640 | 21 | no | q1: TR/AGUADAS/* | Acuarela (`brushMarks`), Gouache diluido |

**Cómo se aplican los trazos (`painter3.js`, `library.js prepare/sampleAt`).**

- **Elección.** `pickSample` elige una muestra al azar, ponderada por `q` × el parecido entre el
  `aspect` de la muestra y la longitud/anchura del trazo pedido × el parecido de la escala de
  cerdas. Está sembrado con mulberry32.
- **Mapeo.** La muestra se recorre a lo largo de la curva del trazo:
  - la cabeza y la cola se mapean 1:1;
  - el cuerpo se estira o se repite (`sampleAt` mapea filas head/body/tail);
  - el ancho se escala al radio del trazo, con mipmaps para reducir.
- **Rotación.** Sigue el campo de flujo de la imagen (tangente a los bordes).
- **Mezcla.** El plano A es la cobertura y el color es el de la región. El plano S modula la
  luminancia y se acumula en un mapa de relieve. Después, `painter.finish` aplica relieve e
  iluminación (*impasto*).
- **Varias librerías.** Óleo y Manley alternan muestras de dos librerías.

#### B) Mosaicos de textura `tiles_pintura.bin` y `tiles_acuarela.bin`

- **Qué son.** Texturas tileables de pintura y aguada que modulan la luminancia (y el color en
  pintura) dentro de las zonas pintadas.
- **Script.** `build_assets.py` (`build_tiles`). Se redimensiona con `BOX`, que conserva la
  repetibilidad. Estadísticas por tile: `mean`, `std`, `empaste`, `manchado`, `blanco`, `ang`,
  `coh` (+`cr`, `cb`, `rgb` en los de color).
- **tiles_pintura.bin** (kind `tiles`):
  - RTILE `Bruchazos_Guache*` → 384 px, tags `[brochazo|puntos, real, gris]`, q3, 1 plano L.
  - MAT `Guache_Pinceladas_Calidas` (8), `Frias` (8) y `Grises` (4), elegidas de forma
    equiespaciada → 320 px.
    - Planos: [L, cr, cb]. cr y cb van a N/4 y se guardan como `128 + 400·desviación`.
    - Tags `[pincelada, calida|fria|gris]`, q1.
- **tiles_acuarela.bin** (kind `tiles`):
  - RTILE `ACUARELAS_BASE*` → 384, `[aguada, real]`, q3.
  - MAT:
    - `Acuarela_Base_*` (las 5 primeras) → 320, `[aguada]`;
    - `Acuarela_Grano_*` (las 6 primeras) → 384, `[grano]`;
    - `Acuarela_manchas_*` (las 4 primeras) → 320, `[manchas]`.

    Todas con q1.
- **Cómo se aplican (`kit.js`).**
  - `tilePrep`: L se normaliza a media 0 / sd 1, recortada a ±3; cr y cb se dividen por 400.
  - `pickTile(lib, rand, tags, warmth)`: elección ponderada por q. Los tiles cálidos o fríos
    pesan ×3 si coinciden con la temperatura de la región y ×0,4 si no.
  - `tileScale = 1,5 · N / ladoLargo · mul`, es decir, escala relativa al tamaño del documento,
    no física. `tileSampler` gira el tile y lo desplaza al azar.
  - **Pintura** (`painter3.js tileFor(r)`). Hay un sampler por región de la segmentación:
    - `mul = 0,8 + 0,5·rand`;
    - ángulo = orientación de la región − `it.ang` + π/2;
    - en la capa base, la luminancia se multiplica por `(1 + 0,11·tileAmt·l)`;
    - también se suman el color cr/cb y el relieve.
  - **Acuarela** (`watercolor2.js`). Hay un sampler por capa de lavado:
    - húmeda → tags `[manchas, aguada]`; última capa → `[grano, aguada]`; resto → `[aguada]`;
    - `mul = 0,8 + 0,6·rand` y rotación aleatoria;
    - el pigmento se multiplica por `1 + tileK·clamp(l, −2, 2)`, con
      `tileK = 0,12 + 0,18·granulado (+0,08 si húmeda)`.

#### C) Manchas con forma `manchas.bin` (kind `stamps`)

- **Fuentes** (22 stamps):
  - RFORMA `001–016.png`, salvo 005, 006, 007 y 014, que se usan como trazos de gouache.
    Etiquetas `STAMP_TAGS`: 1 relleno, 2 remolino, 3 veta, 4 remolino, 8 remolino, 9–11
    puntos, 12, 13 y 15 toques, 16 relleno.
  - Todo RGRAND: tag `puntos_grande` si el nombre contiene «11»; si no, `parche`.
- **Proceso** (`build_manchas`):
  1. `load_rgb` con máximo 1500 px;
  2. recorte con un margen del 3 %;
  3. redimensionado a lado 320 (los `parche`, 384).
- **Planos y metadatos.**
  - Plano 0: A = densidad / p98. Plano 1: S = detalle `128 ± 127`.
  - Meta: `ang` y `coh` (orientación por tensor de estructura) y `fill`.
- **Uso.**
  - `painter3.js` (Óleo y Gouache): en zonas grandes pone «FORMAS» con tags
    `parche|relleno|remolino` (`Lib.pick` ponderado):
    - tamaño = `clamp(lado·exp(−0,25 + 0,55·gauss), 2,2·R0, 1,5·lado)`;
    - ángulo = flujo − `it.ang` + ±0,075 rad;
    - opacidad = `shapeOp·(0,6 + 0,4·rand)` y alfa = `smoothstep(0,08, 0,75, A)·op`, recortado
      contra el color de la región;
    - se dibuja con `K.drawStamp`.
  - `mixta.js`: la variante «manchas» usa las tags `relleno|remolino|parche|toques` como
    **máscara** de la capa de gouache.

#### D) Superposiciones de material `ov_*.bin` (kind `overlays`)

- **Fuentes.** Imágenes de T916 elegidas por clave en el nombre de archivo (las copias «(1)» se
  saltan).

| Overlay | Claves (fragmento del nombre Gemini) | Nº fuentes |
|---|---|---|
| `ov_impresion` | 1f8a, flvu, gjqu, v3eb | 4 |
| `ov_madera` | 2a6p, 2uid, xydf | 3 |
| `ov_goteos` | 2nzv, bmol, v9cx | 3 |
| `ov_grafito` | 614e, h24g, o4l9 | 3 |
| `ov_carbon` | e6zo, uwxt | 2 |

- **Proceso** (`build_overlays`):
  1. se convierte a luminancia (L);
  2. lado menor a 288 px (Lanczos);
  3. se divide por el fondo (gaussiana σ 60) × la mediana;
  4. se estira entre p1 y p99,5.

  Resultado: 1 plano uint8.
- **Uso.** `kit.overlaySampler`: ajuste tipo *cover* al documento, con espejado para no dejar
  costuras.
  - `ov_madera` (Xilografía): veta de madera en la masa negra y en las tintas de color, zoom 0,8.
  - `ov_impresion` (Xilografía): motas y fallos de entintado.
  - `ov_carbon`: solo en `sketch.js` modo carboncillo, que no se usa en la práctica.
  - `ov_goteos`: se carga en Acuarela, pero **no se confirmó ningún uso** en
    `watercolor2.js`; casi seguro es carga muerta (**sin verificar**).
  - `ov_grafito`: **no se carga** (no está en `ASSETS_FOR`).

#### E) Grano de grafito `grano_grafito.bin` (kind `tiles`)

- **Fuente.** TR/LAPIZ/* (7 escaneos de barras verticales de grafito y carbón).
- **Proceso** (`build_grano`):
  1. Se toma cada barra vertical de más de 50 px de ancho.
  2. Se recorta al 60 % central de sus columnas y a la racha de filas buenas más larga
     (≥ 400 filas, menos 20 por cada extremo).
  3. Se normaliza: G = S / gaussiana(22).
  4. Se ecualiza por rangos a uint8; altura máxima 1400.
  5. Tag `carbon` si la media es > 0,5; si no, `lapiz`. Meta: `mean` y `pxmm = ancho/12`.

  Resultado: 19 tiras, 6 de lápiz y 13 de carbón.
- **Uso** (`lapiz.js`).
  - Cada línea muestrea una tira según el modo: `lapiz`, o `carbon` en las variantes de
    carboncillo.
  - El muestreo va a lo largo de la línea, con escala `ktg = clamp(17/grosor, 0,45, 4)`.
  - El grano modula la densidad del grafito, que es multiplicativo sobre el papel.

#### F) Soportes `soporte-{lienzo,acuarela,dibujo}.bin` (forma «papel»)

- **Script.** `tools/extract_papers.py`, con N = 512.
- **Fuentes.** Solo los `*.jp*g` dentro de cada subcarpeta de TR, deduplicados por md5:

  | Soporte | Fuentes |
  |---|---|
  | `lienzo` | TR/OLEO |
  | `acuarela` | TR/AGUADAS + TR/GUACHE |
  | `dibujo` | TR/LAPIZ + TR/CERAS |
- **Proceso.**
  1. `background_blocks`: bloques de 256 px lejos de los trazos (dilatación 45);
     T = Nn − gaussiana(24).
  2. Síntesis espectral de **fase aleatoria** (`random_phase`, semilla 11). Así sale un papel
     **tileable** con el espectro real.
  3. Lienzo: `periodic_from_block` (rng 3) + `make_tileable`, que conserva la trama periódica.
  4. Se guarda como `u8 = 128 + t/(4σ)·127`.

  Previsualizaciones: `tools/out/soporte_*.png`.
- **Qué soporte usa cada técnica** (`SUPPORT_FOR`):

  | Técnica | Soporte |
  |---|---|
  | oleo | lienzo |
  | gouache, acuarela | acuarela |
  | lapiz, ceras, mixtalg, xilografia | dibujo |
- **Uso.** `library.preparePaper`: ecualización de histograma, planos `eq`/`raw` y mipmaps.
  `paperSampler(prep, texPerPx)` con escala física
  `paperScale(ladoLargo, mm) = 10 / (ladoLargo/mm)`, que supone escaneos a unos 10 px/mm. El
  tamaño físico supuesto del documento es `PHYS_MM`:

  | Técnica | `PHYS_MM` |
  |---|---|
  | oleo | 600 mm |
  | gouache | 320 mm |
  | acuarela | 380 mm |
  | lapiz | 300 mm |
  | ceras | 420 mm |
  | mixtalg | 300 mm |
  | xilografia | 340 mm |

  El soporte interviene en tres sitios:
  1. **`K.paperTooth`** (todas las técnicas, al final). Actúa donde el alfa está entre 0 y 1:
     `na = a·(1 + amount·signo·(1−a)·r·1,6)`.

     | Técnica | Modo | amount |
     |---|---|---|
     | oleo | lienzo (también modula el color ×(1 + 0,12·amount·r·(1−a))) | 0,55 |
     | gouache | lienzo | 0,4 |
     | acuarela | valles (signo −) | 0,55 |
     | lapiz | picos | 0,8 |
     | ceras | picos | 0,45 |
     | mixtalg | picos | 0,5 |
     | xilografia | picos | 0,55 |
  2. **Dentro de cada motor:**
     - granulación y bordes en acuarela;
     - mordiente de la cera, paperBreak y pincel seco en painter3;
     - motas en los valles en xilografía;
     - la trama del lienzo donde la pintura es fina, en `painter.finish`.
  3. **Capa Papel** (`paper.js realPaper`): un color BASE por técnica + `raw` × amplitud:

     | Técnica | Amplitud |
     |---|---|
     | oleo | 30 |
     | acuarela, gouache | 22 |
     | resto | 18 |

### 3.5 Tabla resumen fuente → familia → uso → parámetros

| Fuente | Familia / .bin | Uso (motor) | Parámetros clave |
|---|---|---|---|
| RFORMA Gemini*, Pincelada*, Mancha vertical*, Trazo de gouache*, 005/006/007/014 (q3); TR/GUACHE, TR «Muestras abstractas de pincel seco» (q1) | pin_gouache | Óleo, trazos (`painter3`) | W96, Hmax720, CAP30, A+S |
| TR pinceladas rojas/azules (7 patrones) (q2), TR/OLEO (q1) | pin_oleo | Óleo, trazos | W112, Hmax720, CAP30, A+S |
| TR/GUACHE + 6 Gemini TR + «Pincelada gris sobre blanco» | pin_guache | Gouache, Mixta | W96, Hmax720, CAP40, A+S |
| TR/CERAS | pin_barra | Ceras | W96, Hmax720, CAP30, A+S |
| TR trazos rojos/azules texturizados (4 patrones) | pin_manley | Ceras Manley | W72, Hmax720, CAP30, A+S |
| TR/LAPIZ, Gemini uy13/2tepo, hojas de grafito | pin_lapiz | sketch.js (Mixta, Acuarela-dibujo) | W56, Hmax640, CAP30, solo A |
| TR/AGUADAS | pin_acuarela | Acuarela `brushMarks`, Gouache diluido | W96, Hmax640, CAP21, solo A |
| TR cera de colores, Gemini 4k0x, carbón, TR/CERAS | pin_cera | **sin uso efectivo** | W80, Hmax640, CAP26 |
| TR Gemini 4k0x, «Garabato de carb*» | pin_pastel | **sin uso efectivo** | W96, Hmax640, CAP30 |
| RTILE Bruchazos_Guache* + MAT Guache_Pinceladas (8 cálidas, 8 frías, 4 grises) | tiles_pintura | Óleo y Gouache, capa base | 384/320 px; L(+cr,cb); 1+0,11·tileAmt·l |
| RTILE ACUARELAS_BASE* + MAT Acuarela_Base 1–5, Grano 1–6, manchas 1,2,3,5 | tiles_acuarela | Acuarela, por capa | 384/320 px; tileK 0,12+0,18·gran |
| RFORMA 001–016 (excepto 005/006/007/014) + RGRAND (10) | manchas | FORMAS en painter3; máscara en Mixta | 320/384 px; A+S; shapeOp |
| T916 1f8a, flvu, gjqu, v3eb | ov_impresion | Xilografía | lado 288, 1 plano |
| T916 2a6p, 2uid, xydf | ov_madera | Xilografía | lado 288, zoom 0,8 |
| T916 2nzv, bmol, v9cx | ov_goteos | se carga en Acuarela; uso **sin verificar** (probablemente ninguno) | lado 288 |
| T916 e6zo, uwxt | ov_carbon | sketch.js carboncillo; **sin uso efectivo** | lado 288 |
| T916 614e, h24g, o4l9 | ov_grafito | **no se carga** | lado 288 |
| TR/LAPIZ (barras) | grano_grafito | Lápiz (todas las variantes) | 19 tiras; ktg = clamp(17/lw, 0,45, 4) |
| TR/OLEO (*.jpg) | soporte-lienzo | Óleo | 512², fase aleatoria + periódico |
| TR/AGUADAS + TR/GUACHE (*.jpg) | soporte-acuarela | Acuarela, Gouache | 512², fase aleatoria |
| TR/LAPIZ + TR/CERAS (*.jpg) | soporte-dibujo | Lápiz, Ceras, Mixta, Xilografía | 512², fase aleatoria |

**Fuentes presentes en `TEXTURES/` que NO usa ningún build:**

- **TR (nivel superior), tinta y rotulador:**
  - «Cinco líneas azules…», «Cuatro líneas rojas…», «Líneas azules sobre fondo/papel…»,
    «Líneas rojas sobre papel…», «Líneas horizontales dibujadas a mano», «Tres líneas negras…»;
  - «Hoja de garabatos en tinta…», «Hoja de pruebas de garabatos…», «Hoja minimalista…»,
    «Garabatos abstractos en tinta…», «Composición minimalista…»;
  - «Pruebas abstractas de rotulador seco» (2), «Garabatos de marcador negro…», «Cuatro trazos
    negros horizontales».

  Antes alimentaban `pin_rotulador` y `pin_linea`, que se eliminaron.
- **TR Gemini** `dd9o`, `ogcc` (no aparecen en ningún glob; **sin verificar** que no entren
  por otro patrón).
- **TR** «Pincelada vertical gris…» (nivel superior; la versión de RFORMA sí se usa). Es
  probable que «Trazos azules sobre fondo blanco (1).png» quede fuera porque el glob termina en
  `.png` exacto; también podría entrar por `Pinceladas azules sobre*` (**sin verificar**).
- **T916:** unas 110 de las 125 imágenes. Solo se usan las 15 claves de overlays; las de
  salpicaduras y aguadas alimentaban `ov_salpicaduras` y `ov_aguadas`, ya eliminados.
- **MAT:**
  - `Acuarela_Grano_7–10`;
  - `Guache_Pinceladas_Calidas` (6 de 14), `Frias` (4 de 12) y `Grises` (6 de 10) no
    elegidas.
- **RGRAND:** todas se usan. **RTILE:** todas se usan.
- **REFERENCIAS/** completa: solo análisis visual.

### 3.6 Assets que se construyen pero no aportan nada (peso muerto en el .ccx)

| .bin | Peso | Motivo |
|---|---|---|
| `pin_cera` | 1,85 MB | se carga para Lápiz, pero `lapiz.js` no lo usa; `sketch.js` solo lo usa en modo carboncillo, al que nunca se llega |
| `pin_pastel` | 0,68 MB | se carga para Ceras, pero `painter3` solo usa barra y manley; mismo caso de `sketch.js` carboncillo |
| `ov_carbon` | 0,30 MB | solo en `sketch.js` carboncillo |
| `ov_goteos` | 0,45 MB | se carga en Acuarela; no se encontró ningún uso (**sin verificar**) |
| `ov_grafito` | 0,45 MB | no se carga |

En total son unos 3,7 MB que se podrían quitar del paquete sin cambiar el resultado
(**sin verificar** con renders A/B).

### 3.7 Efectos 100 % procedurales (sin textura)

- Segmentación, campo de flujo, recorridos de trazo y paleta (todo el análisis de imagen).
- Relieve e iluminación de `painter.finish` (a partir del plano S, que sí es textura) y el
  ruido fbm de bamboleo (`C.fbmGrid`).
- Acuarela: bordes oscuros (`edgeTile`, grano procedural), floraciones/coliflores, **gotas**,
  difusión de capas húmedas y transparencia (Kubelka-Munk simplificado, **sin verificar** el
  modelo exacto).
- Lápiz: geometría de las líneas, rayados, zigzags, acentos oscuros y mapa de irregularidad.
  Solo el grano viene de textura.
- Xilografía: separación de tintas, gubiadas y contornos. La madera y la impresión vienen de
  overlays.
- `C.makeGrainTile` (papel, lienzo, mordiente, fino): reserva cuando falta un soporte o se usa
  `--procedural`.
- `Lib.synthetic(kind)`: trazos sintéticos de reserva.
- `paper.js`: papel procedural de reserva.

---

## 4. NOMBRES

**Nombres de familia que usa Trazo** (son las claves que el motor pide por nombre):

- Trazos: `pin_oleo`, `pin_gouache`, `pin_guache`, `pin_acuarela`, `pin_lapiz`, `pin_cera`,
  `pin_barra`, `pin_manley`, `pin_pastel`.
- Tiles: `tiles_pintura`, `tiles_acuarela`, `grano_grafito`.
- Manchas: `manchas`.
- Overlays: `ov_impresion`, `ov_madera`, `ov_goteos`, `ov_grafito`, `ov_carbon`.
- Soportes: `soporte-lienzo`, `soporte-acuarela`, `soporte-dibujo`.

**Ojo con estos nombres:**

- Hay **`pin_gouache` y `pin_guache`**: son dos familias distintas con fuentes distintas. La
  primera es para óleo, la segunda para gouache. En la biblioteca común conviene renombrarlas
  por su contenido, por ejemplo `pincelada_gouache_gris_realista` y
  `pincelada_gouache_escaneada`, y que Trazo las mapee.
- Las tags internas también están en español y sin tildes: `aguada`, `grano`, `manchas`,
  `pincelada`, `brochazo`, `puntos`, `calida/fria/gris`, `real`, `parche`, `relleno`,
  `remolino`, `veta`, `toques`, `puntos_grande`, `lapiz`, `carbon`.

**Posibles solapes con otros plugins** (no he visto su código: **todo sin verificar**):

| Recurso de Trazo | Posible solape | Comentario |
|---|---|---|
| `soporte-*` (papel, lienzo) | PAPELATOR, A mano, Analog FX | casi seguro que los demás también tienen grano de papel o lienzo; candidato número 1 a unificar |
| `grano_grafito`, `pin_lapiz`, `ov_grafito`, `ov_carbon` | A mano | grafito y carbón |
| `tiles_acuarela`, `pin_acuarela`, `ov_goteos` | A mano, PAPELATOR | aguadas y manchas de agua |
| `ov_impresion` | Analog FX, NEONIZADOR | ruido de impresión, motas, entintado irregular |
| `ov_madera` | — | probablemente exclusivo de Trazo (xilografía) |
| `pin_*` opacos, `tiles_pintura`, `manchas` | — | probablemente exclusivos de Trazo |
| Nombre de la familia «trazo» / «TRAZOS» | el propio plugin **Trazo** y la carpeta `TEXTURES/TRAZOS` | evitar llamar «trazos» a una familia genérica de la biblioteca; mejor `pinceladas/…`, `lineas/…` |

---

## 5. QUÉ NECESITA DE LA BIBLIOTECA COMÚN

### 5.1 Qué cambiaría (solo las herramientas de construcción)

El plugin en tiempo de ejecución **no necesita cambiar**: sigue leyendo
`plugin/textures/<nombre>.bin` empaquetados en el .ccx. Solo cambiarían las herramientas que
**localizan las fuentes**:

1. **`tools/build_assets.py`**. Las listas de globs fijas (`FAMILIES`, `STAMP_TAGS`,
   `OVERLAYS`, rutas MAT, RTILE y RGRAND) pasarían a ser consultas al índice. Por ejemplo,
   `pin_oleo` = «trazos de familia `oleo` con calidad ≥ 2» del `Biblioteca/index.json`.
   - Los parámetros de proceso (`WIDTH`, `HMAXF`, `CAP`, OPAQUE, tamaños de tile) seguirían
     en Trazo, porque son decisiones del motor.
   - La `q` y las tags podrían venir del índice.
2. **`tools/extract_papers.py`**: `KINDS` (OLEO, AGUADAS, GUACHE, LAPIZ, CERAS) pasaría a ser
   «fondos de papel de tipo lienzo/acuarela/dibujo» del índice.
3. **`tools/extract_strokes.py`**: la constante `SRC`/`FOLDERS` (solo afecta a su `main()`
   antiguo).
4. **`ES.ROOT`**: la ruta raíz pasaría de `TEXTURES/` a `Biblioteca/`, configurable por
   argumento o variable de entorno.

Campos mínimos que Trazo necesita en el índice por cada fuente:

- `ruta`;
- `familia`/`tipo`: trazo, tile, mancha, overlay, papel o barra de grafito;
- `medio`: óleo, gouache, acuarela, grafito, carbón, cera, tinta…;
- `tileable` (bool);
- `color` (bool) y temperatura (`calida/fria/gris`);
- `q` (calidad 1–3);
- tags de forma (`relleno`, `remolino`, `veta`, `puntos`, `toques`, `parche`…);
- `px_por_mm` aproximado (**hoy se supone 10 px/mm**);
- `md5`, para la deduplicación, que Trazo ya hace.

### 5.2 Qué prefiere preprocesado y qué procesa él

| Preferiría recibir preprocesado de la biblioteca | Prefiere seguir procesando él |
|---|---|
| Recortes ya limpios: un trazo por archivo, sin rizos, con fondo blanco y su máscara | Enderezado por la línea central, cabeza/cuerpo/cola, `WIDTH`/`HMAXF` (específico del motor de trazos) |
| Tiles ya **tileables y sin costuras** a resolución completa | Escalado final (BOX 320/384), normalización L, cr y cb, estadísticas de tile |
| Fondos de papel limpios (zonas sin trazos), de unos 1024² o más | Síntesis espectral de fase aleatoria y codificación `128 + t/(4σ)` |
| Metadatos semánticos (tags de forma, temperatura, medio, calidad) | La codificación binaria TRZ1 y la selección CAP |
| Orientación dominante (`ang`, `coh`) | (se puede recalcular; no es crítico) |

Resumen: la biblioteca debe dar **fuentes normalizadas y etiquetadas**. El paso fuente →
`.bin` se queda en Trazo, que conoce su formato.

### 5.3 Texturas que faltan o vendrían bien

- **Papeles escaneados de verdad, sin trazos** (acuarela de grano fino/medio/grueso, Canson,
  Ingres, kraft, lienzo de lino y de algodón), con su escala en px/mm. Hoy los soportes se
  sintetizan a partir de los huecos entre trazos.
- **Más óleo**: TR/OLEO solo tiene 3 archivos; óleo con empaste y espátula.
- **Pastel blando y pastel al óleo de verdad.** `pin_pastel` sale de dos imágenes Gemini de
  carbón.
- **Grafito por durezas** (2H, HB, 4B, 8B) a escala conocida, para `grano_grafito`.
- **Bordes de acuarela, floraciones y granulación reales.** Hoy son procedurales.
- **Madera de grabado más variada** y presión de tórculo o baren para xilografía.
- **Tinta y rotulador** limpios, por si se recupera una técnica de línea; las fuentes ya
  existen sin usar.

### 5.4 Autonomía (requisito)

- El .ccx debe seguir **llevando dentro todos los `.bin`**. La biblioteca común solo se usa al
  **construir**, en la máquina de desarrollo.
- El plugin no debe leer `Biblioteca/` en tiempo de ejecución, ni depender de rutas absolutas,
  red, Claude ni ningún servicio.
- Las alternativas procedurales (`synthetic`, `makeGrainTile`, papel procedural) deben
  mantenerse.
- `package.py` debería **fallar** si falta algún `.bin` de `ASSETS_FOR` (hoy no lo comprueba:
  **sin verificar**).

---

## 6. CÓMO COMPROBAR QUE NO SE ROMPE

### 6.1 Nivel 1: binarios idénticos (lo ideal)

1. Antes de migrar, guardar los hashes:

   ```bash
   md5sum plugin/textures/*.bin > /tmp/textures_antes.md5
   ```

2. Reconstruir **con las herramientas actuales y `TEXTURES/` actual**:

   ```bash
   python3 tools/build_assets.py && python3 tools/extract_papers.py
   ```

   - Si los md5 coinciden, el build es reproducible y sirve de referencia.
   - Si no coinciden, hay que saberlo antes de migrar. Motivos posibles:
     - los soportes son del 3 de noviembre y las fuentes LAPIZ/CERAS pueden haber cambiado
       desde entonces;
     - el orden de `glob`;
     - versiones de numpy, scipy o Pillow.

   La reproducibilidad actual está **sin verificar**.
3. Migrar a `Biblioteca/` + `index.json`, reconstruir y comparar con `md5sum -c`.
   - Si todo coincide, la migración es transparente.
   - Si algo cambia, aplicar el nivel 2.

### 6.2 Nivel 2: comparación estructural de cada `.bin`

Hay que escribir un script pequeño, fuera del plugin, que parsee la cabecera TRZ1 y compare:

- número de muestras o items;
- `w`/`h`, `name`, `tags` y `q` de cada uno;
- la diferencia media absoluta de los planos.

Umbral orientativo: tiene que dar 0. Si las fuentes se han recodificado (por ejemplo, de
PNG a WebP), se acepta una diferencia media de 0,5 niveles o menos.

### 6.3 Nivel 3: renders de referencia con el motor real

`tools/run.js` renderiza en Node con el mismo motor (`plugin/js/engine.js`) y semilla fija. El
motor es determinista con semillas mulberry32 (**sin verificar** de forma formal: conviene
ejecutar dos veces el mismo comando y comparar). Comando por técnica:

```bash
node tools/run.js tools/img/retrato.jpg <tecnica> '{"preset":"…"}' out_<tecnica>.png --scale 1 --paper --seed 7
```

- Generarlo para las 7 técnicas y sus variantes. Como mínimo:
  - óleo;
  - gouache opaco y gouache diluido;
  - acuarela húmeda y acuarela con dibujo;
  - las 4 variantes de lápiz;
  - ceras barra y ceras Manley;
  - mixta y mixta con manchas;
  - xilografía.

  Usar 2 o 3 imágenes fijas: retrato, paisaje (faro) y un sintético de color plano. Las
  imágenes de prueba de `tools/img/` están en `.gitignore`: guardar copia junto a los PNG de
  referencia.
- Comparar con los PNG de referencia generados antes de migrar, por md5 o por diferencia de
  píxeles (por ejemplo, `compare -metric AE` de ImageMagick).
  - Esperado: AE = 0 si los `.bin` son idénticos.
- Repetir con `--procedural` para comprobar que las alternativas siguen funcionando.

### 6.4 Nivel 4: panel y empaquetado

- `node tools/serve.js &` y luego `node tools/flow_test.js /tmp/flow`. Debe terminar en
  «TODO OK». Comprueba:
  - las 7 técnicas, los sliders y los presets;
  - GENERAR, que crea 2 `putPixels` (papel + pintura);
  - cancelar.
- `bash tools/package.sh`:
  - el .ccx debe tener los mismos 56 archivos;
  - su tamaño debe parecerse a 18,7 MB.
- Instalar el .ccx en Photoshop y generar una vez por técnica **sin conexión a internet**.
- La prueba de bordes (`edge_test2.js`: todas las variantes, con y sin assets, selección,
  papel y cancelar) **no está en el repo**: vivía en el scratchpad de una sesión. Habría que
  rehacerla si se quiere usar.

---

## 7. ANEXO JSON

```json
[
  {"fuente": "TEXTURES/REALISTAS/MANCHA CON  FORMA CONCRETA/{Gemini*, Mancha vertical*, Pincelada*, Trazo de gouache*, 005.png, 006.png, 007.png, 014.png} (q3); TEXTURES/TRAZOS/GUACHE/*, TEXTURES/TRAZOS/Muestras abstractas de pincel seco* (q1)",
   "familia": "pin_gouache", "uso": "Óleo: trazos (painter3, mainLib oleo junto a pin_oleo)",
   "formato_final": "TRZ1 trazos v1, uint8, 2 planos (A alfa + S relieve 128±127)",
   "parametros": {"script": "tools/build_assets.py --only pin --fam gouache", "WIDTH": 96, "HMAXF": 720, "CAP": 30, "opaca": true, "load_max_px": 2752, "BODY_FRAC": 0.7, "h_min": 40, "A": "smoothstep(0.1*Db,0.62*Db)", "S": "sigma 0.11, clamp ±0.75"}},
  {"fuente": "TEXTURES/TRAZOS/{Cuatro pinceladas rojas*, Franjas de pintura roja*, Muestras de pinceladas azules*, Ocho pinceladas azules*, Pinceladas azules sobre*, Pinceladas rojas sobre*, Trazos azules sobre fondo blanco.png} (q2); TEXTURES/TRAZOS/OLEO/* (q1)",
   "familia": "pin_oleo", "uso": "Óleo: trazos",
   "formato_final": "TRZ1 trazos v1, uint8, A+S",
   "parametros": {"WIDTH": 112, "HMAXF": 720, "CAP": 30, "opaca": true}},
  {"fuente": "TEXTURES/TRAZOS/GUACHE/*; TEXTURES/TRAZOS/Gemini_Generated_Image_{1m2v,xw72,i9od,uoqx,gtyi,fooa}*.jpg; TEXTURES/TRAZOS/Pincelada gris sobre blanco.png (q2)",
   "familia": "pin_guache", "uso": "Gouache (opaco y diluido) y Técnica mixta: trazos",
   "formato_final": "TRZ1 trazos v1, uint8, A+S",
   "parametros": {"WIDTH": 96, "HMAXF": 720, "CAP": 40, "opaca": true}},
  {"fuente": "TEXTURES/TRAZOS/CERAS/* (q2)",
   "familia": "pin_barra", "uso": "Ceras (barra y Manley): trazos",
   "formato_final": "TRZ1 trazos v1, uint8, A+S",
   "parametros": {"WIDTH": 96, "HMAXF": 720, "CAP": 30, "opaca": true}},
  {"fuente": "TEXTURES/TRAZOS/{Cinco trazos rojos*, Cuatro trazos rojos texturizados*, Cinco trazos azules sobre*, Tres trazos azules texturizados*} (q2)",
   "familia": "pin_manley", "uso": "Ceras variante Manley: trazos (alterna con pin_barra)",
   "formato_final": "TRZ1 trazos v1, uint8, A+S",
   "parametros": {"WIDTH": 72, "HMAXF": 720, "CAP": 30, "opaca": true}},
  {"fuente": "TEXTURES/TRAZOS/{Cinco trazos azules sobre*, Cinco trazos rojos*, Cuatro trazos rojos texturizados*, Tres trazos azules texturizados*, Gemini_4k0x*, Garabato de carb*, Trazo serpenteante*} (q2); TEXTURES/TRAZOS/CERAS/* (q1)",
   "familia": "pin_cera", "uso": "SIN USO EFECTIVO (cargado para Lápiz; solo sketch.js carboncillo, inalcanzable)",
   "formato_final": "TRZ1 trazos v1, uint8, A+S",
   "parametros": {"WIDTH": 80, "HMAXF": 640, "CAP": 26, "opaca": true}},
  {"fuente": "TEXTURES/TRAZOS/{Gemini_4k0x*, Garabato de carb*} (q2)",
   "familia": "pin_pastel", "uso": "SIN USO EFECTIVO (cargado para Ceras; solo sketch.js carboncillo)",
   "formato_final": "TRZ1 trazos v1, uint8, A+S",
   "parametros": {"WIDTH": 96, "HMAXF": 640, "CAP": 30, "opaca": true}},
  {"fuente": "TEXTURES/TRAZOS/LAPIZ/*; TEXTURES/TRAZOS/{Gemini_uy13*, Gemini_2tepo*, Hoja de garabatos de grafito*, Garabatos abstractos de grafito*, Doodles de grafito*} (q1)",
   "familia": "pin_lapiz", "uso": "sketch.js (Técnica mixta y Acuarela con dibujo): tile de rayado",
   "formato_final": "TRZ1 trazos v1, uint8, 1 plano A",
   "parametros": {"WIDTH": 56, "HMAXF": 640, "CAP": 30, "opaca": false, "A": "R/p99.3"}},
  {"fuente": "TEXTURES/TRAZOS/AGUADAS/* (q1)",
   "familia": "pin_acuarela", "uso": "Acuarela (brushMarks) y Gouache diluido (capa Water2)",
   "formato_final": "TRZ1 trazos v1, uint8, 1 plano A",
   "parametros": {"WIDTH": 96, "HMAXF": 640, "CAP": 21, "opaca": false}},
  {"fuente": "TEXTURES/REALISTAS/TEXTURAS REALISTAS TILEABLES/Bruchazos_Guache* (q3); TEXTURES/MATERIALE_TILEABLES/Guache_Pinceladas_{Calidas(8),Frias(8),Grises(4)}_*_Basecolor.png (q1)",
   "familia": "tiles_pintura", "uso": "Óleo y Gouache: textura de pincelada en la capa base por región (painter3 tileFor)",
   "formato_final": "TRZ1 items v2 kind tiles, uint8; realistas 1 plano L; MAT 3 planos [L, cr, cb] (cr/cb a N/4, 128+400·dev)",
   "parametros": {"script": "build_assets.py --only tiles", "lado_real": 384, "lado_mat": 320, "resize": "BOX", "tags": ["brochazo|puntos,real,gris", "pincelada,calida|fria|gris"], "aplicacion": "lum*(1+0.11*tileAmt*l), tileScale=1.5*N/ladoLargo*(0.8+0.5r), rot=orientación región - ang + pi/2", "peso_temperatura": "x3 coincide / x0.4 no"}},
  {"fuente": "TEXTURES/REALISTAS/TEXTURAS REALISTAS TILEABLES/ACUARELAS_BASE_* (q3); TEXTURES/MATERIALE_TILEABLES/Acuarela_Base_1-5, Acuarela_Grano_1-6, Acuarela_manchas_1,2,3,5 (q1)",
   "familia": "tiles_acuarela", "uso": "Acuarela: modulación de pigmento por capa de lavado (watercolor2)",
   "formato_final": "TRZ1 items v2 kind tiles, uint8, 1 plano L",
   "parametros": {"lado": "384 (real, grano) / 320 (base, manchas)", "resize": "BOX", "tags": ["aguada,real", "aguada", "grano", "manchas"], "tileK": "0.12+0.18*granulado(+0.08 húmeda)", "escala": "tileScale*(0.8+0.6r)", "rotacion": "aleatoria"}},
  {"fuente": "TEXTURES/REALISTAS/MANCHA CON  FORMA CONCRETA/001-016.png excepto 005,006,007,014; TEXTURES/REALISTAS/MANCHAS GRANDES DE VARIOS TRAZOS_TEXTURA COMPLEJA/* (10)",
   "familia": "manchas", "uso": "Óleo/Gouache: FORMAS (parche|relleno|remolino) en zonas grandes; Técnica mixta: máscara (relleno|remolino|parche|toques)",
   "formato_final": "TRZ1 items v2 kind stamps, uint8, 2 planos (A densidad/p98, S detalle 128±127); 22 stamps",
   "parametros": {"script": "build_assets.py --only manchas", "load_max_px": 1500, "margen_recorte": 0.03, "lado": "320 (parche 384)", "meta": ["ang", "coh", "fill"], "tamaño": "clamp(lado*exp(-0.25+0.55g), 2.2*R0, 1.5*lado)", "opacidad": "shapeOp*(0.6+0.4r)", "alfa": "smoothstep(0.08,0.75,A)*op"}},
  {"fuente": "TEXTURES/TEXTURAS EN 9-16 NO TILEABLES/*{1f8a,flvu,gjqu,v3eb}*",
   "familia": "ov_impresion", "uso": "Xilografía: motas y fallos de entintado",
   "formato_final": "TRZ1 items v2 kind overlays, uint8, 1 plano L",
   "parametros": {"script": "build_assets.py --only ov", "lado_min": 288, "resize": "LANCZOS", "fondo": "/gauss(60)*mediana", "estirado": "p1-p99.5", "ajuste": "cover + espejado"}},
  {"fuente": "TEXTURES/TEXTURAS EN 9-16 NO TILEABLES/*{2a6p,2uid,xydf}*",
   "familia": "ov_madera", "uso": "Xilografía: veta de madera en negro y en tintas de color",
   "formato_final": "TRZ1 items v2 kind overlays, uint8, 1 plano L",
   "parametros": {"lado_min": 288, "zoom": 0.8, "ajuste": "cover + espejado"}},
  {"fuente": "TEXTURES/TEXTURAS EN 9-16 NO TILEABLES/*{2nzv,bmol,v9cx}*",
   "familia": "ov_goteos", "uso": "Cargado en Acuarela; uso no encontrado (sin verificar)",
   "formato_final": "TRZ1 items v2 kind overlays, uint8, 1 plano L",
   "parametros": {"lado_min": 288}},
  {"fuente": "TEXTURES/TEXTURAS EN 9-16 NO TILEABLES/*{e6zo,uwxt}*",
   "familia": "ov_carbon", "uso": "SIN USO EFECTIVO (sketch.js carboncillo)",
   "formato_final": "TRZ1 items v2 kind overlays, uint8, 1 plano L",
   "parametros": {"lado_min": 288}},
  {"fuente": "TEXTURES/TEXTURAS EN 9-16 NO TILEABLES/*{614e,h24g,o4l9}*",
   "familia": "ov_grafito", "uso": "NO SE CARGA (no está en ASSETS_FOR)",
   "formato_final": "TRZ1 items v2 kind overlays, uint8, 1 plano L",
   "parametros": {"lado_min": 288}},
  {"fuente": "TEXTURES/TRAZOS/LAPIZ/* (barras verticales)",
   "familia": "grano_grafito", "uso": "Lápiz (todas las variantes): grano a lo largo de cada línea, tag lapiz o carbon",
   "formato_final": "TRZ1 items v2 kind tiles, uint8, 1 plano; 19 tiras (6 lapiz, 13 carbon)",
   "parametros": {"script": "build_assets.py --only grano", "ancho_barra_min": 50, "columnas_centrales": 0.6, "filas_min": 400, "recorte_filas": 20, "normalizacion": "S/gauss(22) + ecualización por rangos", "h_max": 1400, "tag": "carbon si media>0.5", "pxmm": "ancho/12", "escala": "clamp(17/grosor,0.45,4)"}},
  {"fuente": "TEXTURES/TRAZOS/OLEO/*.jp*g (fondo entre trazos)",
   "familia": "soporte-lienzo", "uso": "Óleo: paperTooth lienzo 0.55, trama en painter.finish, capa Papel (amp 30)",
   "formato_final": "TRZ1 papel v1, 512x512, 1 canal uint8, tileable",
   "parametros": {"script": "tools/extract_papers.py", "bloques": 256, "dilatacion_trazos": 45, "pasaaltos": "gauss(24)", "sintesis": "periodic_from_block(rng 3)+make_tileable", "codificacion": "128+t/(4σ)*127", "escala": "paperScale(ladoLargo, 600mm), 10 px/mm"}},
  {"fuente": "TEXTURES/TRAZOS/AGUADAS/*.jp*g + TEXTURES/TRAZOS/GUACHE/*.jp*g (fondo)",
   "familia": "soporte-acuarela", "uso": "Acuarela (valles 0.55, granulación, bordes) y Gouache (lienzo 0.4); capa Papel amp 22",
   "formato_final": "TRZ1 papel v1, 512x512, 1 canal uint8, tileable",
   "parametros": {"sintesis": "random_phase seed 11", "codificacion": "128+t/(4σ)*127", "PHYS_MM": {"acuarela": 380, "gouache": 320}}},
  {"fuente": "TEXTURES/TRAZOS/LAPIZ/*.jp*g + TEXTURES/TRAZOS/CERAS/*.jp*g (fondo)",
   "familia": "soporte-dibujo", "uso": "Lápiz (picos 0.8), Ceras (picos 0.45), Mixta (picos 0.5), Xilografía (picos 0.55); capa Papel amp 18",
   "formato_final": "TRZ1 papel v1, 512x512, 1 canal uint8, tileable",
   "parametros": {"sintesis": "random_phase seed 11", "PHYS_MM": {"lapiz": 300, "ceras": 420, "mixtalg": 300, "xilografia": 340}, "nota": "bin del 3-nov; reproducibilidad sin verificar"}}
]
```
