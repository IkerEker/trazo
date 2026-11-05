# Trazo · Pintura tradicional para Photoshop

Plugin UXP para Photoshop que convierte fotografías en **7 técnicas tradicionales, con 4 o 5 variantes
cada una**. Analiza la imagen como lo haría un artista: la ve en manchas, decide la dirección de
cada trazo según las formas y crea la obra en una **capa nueva con transparencia**. El papel o
el lienzo va en una capa aparte (casilla **Papel**).

| Técnica | Variantes (presets) |
|---|---|
| Óleo | Planos y espátula · Gestual · Boceto sobre imprimatura · Matérico |
| Lápiz (grises) | Línea suelta · Rayado · Carboncillo · Negros expresivos |
| Gouache | Plein air · Planos opacos · Retrato expresivo · Diluido |
| Acuarela | Manchas húmedas · Paisaje por capas · Con dibujo · Densa · Gotas de agua |
| Ceras | Óleo en barra · Pastel graso · Pastel seco · Ceras Manley |
| Mixta L+G | Más lápiz · Equilibrada · Más gouache · Manchas sueltas |
| Xilografía | Realista · Expresiva · Dos tintas · Tres tintas |

Cada variante rellena todos los ajustes. Después se pueden tocar en **Ajustes**, donde también se
puede cambiar de variante sin perder los valores. En la primera pantalla (**Técnica**), justo debajo
de las variantes, hay dos controles que se mantienen al cambiar de variante:
- **Realismo**: cuanto más alto, más se parece a la fotografía (más capas, pincel final más fino,
  bordes más nítidos, menos simplificación); cuanto más bajo, más abstracto.
- **Luz** (óleo, ceras y mixta; el gouache no tiene volumen): intensidad de la luz rasante. Al mínimo no se ven los volúmenes
  del empaste; al máximo se marcan mucho las crestas, los surcos y el brillo.

**Pinta con material real.** Lo que hay en `TEXTURES/` se convierte en las bibliotecas de
`plugin/textures/` (`tools/build_assets.py`):
- **Pinceladas** (~180): óleo, gouache, lápiz, cera y carbón, óleo en barra, cera escolar, pastel y acuarela.
  Se doblan a lo largo de cada recorrido y conservan la carga inicial, las cerdas, el final seco
  y el relieve. Las de `REALISTAS` tienen prioridad.
- **Manchas** (22): las grandes cubren con formas reales las zonas amplias del óleo y el gouache;
  también dan las manchas sueltas de la mixta lápiz + gouache.
- **Texturas repetibles** (50): frotados cálidos, fríos y grises bajo el óleo y el gouache;
  aguadas y granulado para la acuarela. A escala física y giradas con la forma.
- **Texturas 9:16** (con poco peso): ruido de impresión y veta de madera (xilografía), goteos
  (acuarela), grafito y carbón (lápiz).
- **Papel y lienzo**: su grano se marca siempre en las zonas veladas, esté o no visible el papel.

Cómo se analizó cada técnica antes de programarla: [`REFERENCIAS/ESTUDIO_TECNICAS.md`](REFERENCIAS/ESTUDIO_TECNICAS.md).

- Sin dependencias externas. Las texturas de cada técnica se cargan solo al usarla.
- Sin vista previa en el panel: la pintura se hace solo al pulsar GENERAR (es un proceso pesado).
- Interfaz en negro, blanco y verde que se adapta a cualquier tamaño de panel o grupo de pestañas.

---

## Instalación

**Requisitos:** Photoshop 24.5 o posterior y un documento en modo **RGB** de 8 o 16 bits.

### Opción A · Doble clic (recomendada para usar)
1. Haz doble clic en `dist/Trazo-1.4.0.ccx`. Creative Cloud lo instala tras avisar de que no está verificado («Instalar localmente»).
2. En Photoshop: **Plugins › Trazo · Pintura tradicional**.

> El `.ccx` no está firmado por Adobe Marketplace, así que Creative Cloud puede avisar de que
> el plugin no está verificado. Si no deja instalarlo, usa la opción B.

**Si Creative Cloud se abre pero no lo instala**, el instalador de Adobe da el motivo por línea de
comandos. En Windows, abre *Símbolo del sistema* y ejecuta (cambia la ruta del `.ccx`):
```
"C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "C:\Users\TU_USUARIO\Downloads\Trazo-1.4.0.ccx"
```
En macOS:
```
"/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install ~/Downloads/Trazo-1.4.0.ccx
```

### Opción B · UXP Developer Tool (recomendada para desarrollar)
1. Instala **UXP Developer Tool** desde Creative Cloud.
2. Pulsa **Add Plugin** y elige `plugin/manifest.json`.
3. Pulsa **Load**. El panel aparece en Photoshop.
4. Con **Package** generas un `.ccx` oficial para distribuirlo.

---

## Uso

1. Selecciona la capa que quieres pintar. Si la capa activa no es de píxeles (texto, grupo…),
   se usa la imagen combinada.
2. Pestaña **1 · Técnica**: elige una de las 7 técnicas y una de sus variantes.
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
| Empaste | Relieve y brillo de la pintura gruesa | Óleo, Gouache, Mixta L+G |
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

| Técnica | 5 MP (3000×1688) |
|---|---|
| Óleo | 11,8 s |
| Lápiz | 3,3 s |
| Gouache | 9,5 s (Diluido 13,3 s) |
| Acuarela | 7,8 s (Con dibujo 8,8 s) |
| Ceras | 11,6 s |
| Mixta L+G | 10,5 s |
| Xilografía | 3,3 s |

No hay vista previa: el panel solo pinta al pulsar GENERAR. A 6 MP el motor usa unos 300–450 MB de
memoria; en calidad Máxima (16 MP) puede pasar de 1 GB. Durante GENERAR, Photoshop muestra su barra
de progreso y se puede cancelar desde ahí o desde el propio botón.

---

## Cómo funciona

1. **Análisis**: se calcula el *tensor de estructura* de la imagen y, con él, dos campos de
   direcciones. Uno es suave, para el relleno; el otro es fino, para contornos y detalle. En
   zonas sin dirección clara (cielo, follaje) los trazos adoptan una dirección regular, como
   haría un pintor.
2. **Manchas** (`segment.js`): superpíxeles SLIC sobre la imagen suavizada. Las zonas vecinas
   se fusionan mientras su color siga siendo un único degradado; en las zonas poco
   importantes se simplifica más. Cada mancha guarda su degradado de color, su textura, su
   orientación, su importancia y su anchura.
3. **Óleo, Gouache y Ceras** (`painter3.js`), de grueso a fino, con pocas capas (no se calca la foto):
   - **Referencia sin halos:** la foto se simplifica con un filtro que conserva los bordes
     (transformada de dominio). Cada píxel de la franja de transición de un borde toma el color
     de su lado, como cuando un pintor decide dónde acaba la forma. El pincel nunca coge colores
     intermedios, así que no hay halos ni perfiles alrededor de las formas.
   - **Encaje:** una capa fina de color con el borde roto y la textura de un frotado real
     (`TEXTURAS REALISTAS TILEABLES`, cálida o fría según la zona y girada con la forma), que
     también da el relieve de esa pintura frotada.
   - **Formas:** las zonas amplias de un mismo color se cubren con manchas reales de varios
     trazos (`MANCHAS GRANDES DE VARIOS TRAZOS`) de tamaños muy distintos, orientadas con la
     forma y sin invadir otros colores. Encima solo van algunas pinceladas.
   - **Direcciones:** salen siempre de la foto. En las zonas lisas se heredan de la estructura
     que las rodea; nunca se cruzan pinceladas al azar.
   - **Capas de pincel:** de 2 a 4 tamaños, y dentro de cada uno anchos y largos muy distintos
     (unas pocas pinceladas muy largas donde la forma tiene una dirección clara, muchas cortas).
     El pincel grande cubre lo que no cubren las formas; los siguientes solo pintan donde el
     color pintado aún no es el de la referencia. Cada pincelada se detiene al llegar a otro color.
   - **Carga y empaste:** cada pincelada empieza cargada y se queda seca al final (se abre en
     vetas de cerdas); el tono es algo más hondo donde hay más pintura. El empaste cambia de un
     trazo a otro: frotados finos, pinceladas normales y algunas muy cargadas.
   - **Filo del pincel:** cada pincelada se recorta contra los cambios de color con un filo
     propio, que ondula a lo largo y se deshilacha con las cerdas. Los bordes quedan rotos,
     nunca redondeados ni con líneas oscuras.
   - Las pinceladas finas continúan la pintura que ya hay alrededor, sin costuras.
   - Cada pincelada es un **trazo real** elegido con la proporción y el tamaño de cerda
     adecuados (no se estira ni se ven cerdas gigantes o borrosas).
     El pincel va cargado con dos tonos y varía la temperatura entre trazos (blancos cremosos o
     azulados). La mezcla húmeda solo se da entre colores parecidos, para no ensuciar los bordes.
     El relieve del empaste lo hace cada trazo: cuerpo, surcos de las cerdas y crestas en los
     bordes (en el matérico, muy marcadas). Los surcos reciben menos luz (oclusión).
   - **Física del medio** (a partir del estudio de `reports/Realismo en técnicas artísticas analógicas.md`):
     mezcla de colores como pigmentos (aproximación sustractiva, no promedio de luz) en la mezcla
     húmeda y en el **pincel sucio**, que arrastra al empezar el color de donde se apoya; el pincel
     seco se agarra a las crestas del soporte (trama del lienzo, grano del papel); **luces gruesas,
     oscuros finos**; el **brillo** es propio de cada trazo y solo aparece en las crestas (con Luz
     baja, aspecto de foto de museo sin destellos); la pasta proyecta **sombras cortas**; entre
     pinceladas asoma la **imprimatura** cálida; y un **último pase de pinceladas anchas** fuera del
     foco, como hacían Sargent o Sorolla.
   - **Cerdas a escala real** (óleo): cada pincelada lleva surcos finos de cerdas (~0,7 mm en el
     tamaño supuesto del cuadro) que derivan un poco a lo largo del trazo, con mechones más o menos
     cargados; tiñen ligeramente el tono, dejan surcos en el relieve (los revela la Luz), deshilachan
     el filo y abren en vetas el final seco.
   - **Gouache sin volumen**: solo sus propios trazos (`TEXTURES/TRAZOS/GUACHE` y las pinceladas grises
     sueltas → `pin_guache.bin`), planos y mates, con la variación de tono interna de cada trazo
     real y sin relieve ni brillo. Seca con los valores comprimidos y los tintes claros algo
     calcáreos. **Diluido** es una mezcla: manchas húmedas de acuarela de base y, encima, pinceladas
     de gouache sueltas (más en lo importante) que dejan ver la aguada.
   - **Escala física**: cada técnica supone un original de tamaño real (óleo 60 cm, acuarela 38 cm,
     dibujo 30 cm…), así la trama y el grano tienen la escala correcta.
   - **Espátula** (óleo, planos y espátula): planos de pasta de borde recto, con dos colores
     arrastrados en vetas, raspados que dejan ver lo de debajo y crestas en los lados y al final.
   - **Ceras**: sin capa base. El color se queda en los picos del papel según la presión (más en
     los oscuros); el blanco lo pone el papel y los claros llevan menos trazos. Las ceras Manley
     usan una caja de colores limitada sacada de la imagen y se mezclan por capas rayadas a mano; el
     diente del papel se va llenando con cada pasada (las capas siguientes llegan a valles más hondos);
     el pastel seco se difumina con el dedo en zonas y va sobre papel de color; el óleo en barra
     y el pastel graso son cubrientes, con arrastre de color. Todas usan los trazos reales de
     `TEXTURES/TRAZOS/CERAS` (Manley también los de cera escolar) con su variación de tono interna,
     **planos**: solo ~1 % de los trazos lleva pasta, y nunca en las zonas importantes.
4. **Lápiz** (`lapiz.js`), a la manera del efecto «Lápiz» de Word / Office:
   - **Tono fiel**: el tono es el de la foto (los oscuros son oscuros, las luces son papel), con el
     contraste local algo realzado para que los bordes queden nítidos **sin contornos negros**.
   - **Garabato de grafito**: encima, miles de trazos finos de lápiz reales (`pin_lapiz`) en muchas
     direcciones (unos siguen la forma de la foto y otros van sueltos), de largos, anchos, presiones
     y curvas distintos. Hacen vibrar el tono: se ven mucho en los medios tonos, apenas en las luces,
     y en las sombras dejan huecos más claros.
   - **Papel**: el grafito se queda en los picos del grano, nunca llega al negro y brilla donde está
     muy cargado. Se evita lo que delata un filtro barato: contornos gruesos, ruido granulado,
     blancos quemados y rayado mecánico de una sola dirección.
   - Variantes: **Línea suelta** (tono ligero y líneas sueltas de dibujante), **Rayado** (tono
     completo), **Carboncillo** (barras de carbón difuminadas, negro mate) y **Negros expresivos**.
   - La mixta lápiz + gouache y la acuarela con dibujo usan las líneas de `sketch.js` (Lu et al. 2012).
5. **Acuarela** (`watercolor2.js`): de dos a cuatro aguadas según lo oscura que sea cada
   mancha. Las primeras, húmedas, tienen bordes suaves, flecos y floraciones, y sus colores
   se funden en los bordes. Las últimas, en seco, tienen bordes nítidos. Al secar, el
   pigmento se acumula en el borde y granula en los valles del papel. Las formas claras se
   respetan pintando alrededor. El filo de cada aguada se decide a resolución completa contra
   el grano del papel: se rompe en vez de redondearse, y en las aguadas secas queda pincel
   seco en el borde. Cada aguada absorbe según su color (se mezclan por superposición).
   La **granulación depende del pigmento**: los azules tipo ultramar y las tierras granulan mucho,
   los colores limpios tipo ftalo casi nada, y en los grises los pigmentos se separan en motas
   cálidas y frías.
   En **Gotas de agua**, gotas caídas sobre la aguada húmeda empujan el pigmento: centro lavado,
   acumulación en un filo de coliflor irregular, gotitas satélite y corrimientos hacia abajo. Las pinceladas reales aportan textura donde la foto la tiene. (Hasta la
   1.1: una aguada base hecha por abstracción (Kuwahara, sangrado húmedo, bordes de
   pigmento, granulado). Encima van **veladuras con aguadas reales**, más en las zonas oscuras,
   que oscurecen de forma limitada al superponerse. El papel blanco se convierte en
   transparencia.)
6. **Soporte real a escala física**: el tamaño supuesto del original depende de la técnica
   (óleo 60 cm, ceras 42 cm, acuarela 38 cm, xilografía 34 cm, gouache 32 cm, dibujo 30 cm), así
   que el grano y la trama se ven como en un original. Si faltan las texturas, el motor usa su
   modelo procedural de la 1.0.
7. **Xilografía**: tres zonas como en los grabados reales (luces de papel limpio, sombras de negro
   pleno con solo veta y moteado, y líneas de gubia solo en los medios tonos); el moteado de la
   tinta sigue los valles del papel; las planchas de color se desregistran enteras.
   Con **dos tintas**, la tinta de color es el **color frontal** de Photoshop en el momento de
   GENERAR; con **tres tintas**, el frontal y el de fondo (si el de fondo es blanco o negro, la
   segunda tinta sale de la imagen). Las zonas claras van a la tinta clara y las oscuras a la otra.

---

## Estructura del proyecto

```
plugin/              ← el plugin UXP (esto es lo que se instala)
  manifest.json
  index.html
  css/styles.css
  js/engine.js       ← motor empaquetado (generado, no editar)
  js/ps.js           ← puente con Photoshop: píxeles, capas, historial, exportar
  js/ui.js           ← interfaz: pestañas, sliders, presets y GENERAR
  icons/
  textures/          ← trazos reales por técnica (*.bin) y soportes (soporte-*.bin), generados
engine/              ← código fuente del motor (módulos)
  core.js            ← desenfoques, ruido, muestreo, textura de papel
  analysis.js        ← campo de direcciones, bordes, cobertura, pirámide de color
  strokes.js         ← trazado y rasterizado de pinceladas
  segment.js         ← manchas: SLIC, fusión por degradado, contornos, etiquetas
  painter3.js        ← Óleo, Gouache y Ceras (capas sin halos, filo roto, espátula, diente del papel)
  watercolor2.js     ← Acuarela por aguadas superpuestas
  painter.js         ← acabado (relieve, brillo, lienzo) y motor 1.1 de respaldo
  xilografia.js      ← cortes de gubia, estampación y planchas de color
  mixta.js           ← mixta lápiz + gouache
  kit.js             ← texturas repetibles, manchas, paleta, composición y grano del papel
  lapiz.js           ← Lápiz (tono fiel + garabato de grafito real, como el efecto de Word)
  sketch.js          ← líneas de lápiz para la mixta y la acuarela con dibujo (Lu et al. 2012)
  watercolor.js      ← Acuarela
  paper.js           ← papel y lienzo
  library.js         ← carga de trazos y soportes reales, mapeo sobre recorridos, mipmaps
  techniques.js      ← técnicas, parámetros por defecto y presets
tools/
  bundle.js          ← engine/*.js → plugin/js/engine.js
  build_assets.py    ← TEXTURES/* → plugin/textures/*.bin (pinceladas, manchas, texturas)
  extract_strokes.py ← extractor de pinceladas (lo usa build_assets.py)
  extract_papers.py  ← fondos de TEXTURES → plugin/textures/soporte-*.bin
  package.sh         ← genera dist/*.ccx y dist/*.zip
  run.js             ← prueba el motor en Node con una imagen
  serve.js + mock-photoshop.js ← el panel en el navegador con Photoshop simulado
  shots.js, flow_test.js       ← capturas a varios tamaños y prueba de interacción
REFERENCIAS/         ← obras de cada estilo, solo para estudio (no se usan en el plugin)
TEXTURES/            ← material real, una carpeta por técnica en cada sección
  PINCELADAS/        ← trazos sueltos (fuente de plugin/textures/<técnica>.bin)
  MANCHAS/           ← manchas centradas sobre blanco
  TILEABLES/         ← texturas repetibles para rellenar zonas
  PAPEL/             ← papeles y lienzos de fondo
dist/                ← paquete .ccx listo para instalar
```

### Desarrollo
Para regenerar todas las bibliotecas tras añadir material a `TEXTURES/` (requiere Python 3 con
numpy, scipy y Pillow; tarda unos 5 minutos):
```bash
python3 tools/build_assets.py
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
./tools/package.sh   # node tools/bundle.js + python3 tools/package.py
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
