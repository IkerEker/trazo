# Acuarela real: física del agua, pigmento y papel, y los rasgos visuales que la delatan

> Nota de método: en esta sesión no se podía descargar ninguna web (WebFetch y curl recibían 403/ENOTFOUND para handprint.com, grail.cs.washington.edu, wikipedia, winsornewton.com y arxiv). Solo funcionaba WebSearch, así que **todas las citas proceden de los extractos y resúmenes de búsqueda**, no de la lectura completa de las páginas. Las afirmaciones atribuidas a Curtis et al. 1997 que no aparecieron literalmente en los extractos van marcadas con **[verificar en el PDF]**. Las reglas de render que propongo están en los apartados «Inferences» y son deducciones mías, no hechos citados.

## 1. Húmedo sobre húmedo, húmedo sobre seco y papel húmedo-mate: bordes, difusión y forma de la expansión

### Takeaway
Cuánto se extiende la pintura y con qué borde depende casi por completo del **estado de humedad del papel** en el instante del toque, que pasa por la secuencia brillante → satinado → mate-húmedo → seco, y de la **diferencia de humedad entre pincel y papel**. Un papel brillante da difusión blanda y plumosa. El satinado da bordes suaves controlados. El mate-húmedo es la zona de peligro de las coliflores. El seco da bordes duros y oscurecimiento de borde.

### Cited Findings
- **Húmedo sobre húmedo** (wet-in-wet, wet-on-wet) consiste en mojar el papel con agua limpia y añadir pigmento mientras sigue húmedo. **Húmedo sobre seco** (wet-on-dry) es pintar sobre papel seco, y la pintura «se queda donde la pones», con bordes nítidos y formas definidas — [Paint In Watercolor](https://paintinwatercolor.com/watercolor-technique-wet-on-wet/); [ArtTechniques](https://arttechniques.com/techniques/wet-on-wet); [Emily Teaches Art](https://www.emilyteachesart.com/post/wet-into-wet-watercolor-technique-a-beginner-friendly-guide)
- Secuencia de estados según el brillo de la superficie:
  - **Muy mojado o brillante**: la pintura se expande rápido y forma floraciones suaves.
  - **Satinado o brillo uniforme**: es el estado más controlable que todavía permite fundidos suaves («hay brillo pero el agua no corre»).
  - **Húmedo-mate**: las fuentes no coinciden. Una dice que con aspecto mate ya se ha terminado el húmedo sobre húmedo y se vuelve a seco. Otra lo trata como zona de transición. En lo que sí coinciden es en que es arriesgado, porque el papel absorbe el agua nueva y empuja la pintura ya asentada, lo que produce coliflores o *backruns*.
  - **Seco**: bordes duros y detalle nítido.

  — [Watercolor Affair, «Why timing matters…»](https://www.watercoloraffair.com/why-timing-matters-more-than-technique-in-watercolor-the-water-cycle/); [Café Watercolor](https://cafewatercolor.com/blog/113); [Washes & Wells](https://washesandwells.com/posts/wet-on-wet-watercolor-soft-blends-for-beginners)
- En húmedo sobre húmedo el pigmento se extiende solo y se difunde hacia fuera con **bordes suaves y plumosos** («feathered edges»). El húmedo sobre seco se usa para el detalle de primer plano, los bordes nítidos y la línea botánica — [Pink Creative Crab](https://pinkcreativecrab.com/wet-on-wet-watercolor-master-this-essential-technique/); [Washes & Wells](https://washesandwells.com/posts/wet-on-wet-watercolor-soft-blends-for-beginners)
- Consejo habitual: húmedo sobre húmedo para los fondos y húmedo sobre seco para el detalle. Si una zona está a medio secar, es mejor dejarla secar del todo y volver a mojarla antes de seguir, porque añadir color sobre papel medio seco produce coliflores y bordes duros — [Café Watercolor](https://cafewatercolor.com/blog/113); [Watercolor Affair](https://www.watercoloraffair.com/why-timing-matters-more-than-technique-in-watercolor-the-water-cycle/)
- **Regla de igual o menos agua**: al tocar una zona que se está secando, la carga del pincel tiene que tener la misma humedad que el papel o menos. Si está más húmeda, aparece una floración. Si está más seca, se funde sin floración — [Watercolor Affair, blooms](https://www.watercoloraffair.com/watercolor-blooms-turning-mistakes-into-success/); [Solving Watercolour](https://www.solvingwatercolour.com/how-to-fix-watercolor-mistakes/)
- Curtis et al. llaman *flow patterns* al efecto del húmedo sobre húmedo: formas blandas y plumosas con patrones ramificados delicados, que el viewer reconoce como acuarela **[verificar en el PDF]** — [Curtis et al. 1997, PDF (copia Princeton)](https://www.cs.princeton.edu/courses/archive/fall00/cs597b/papers/curtis97.pdf); [ResearchGate, figura 1 con los efectos reales](https://www.researchgate.net/figure/Real-watercolor-effects-drybrush-a-edge-darkening-b-backruns-c-granulation-d_fig1_2917328)
- Montesdeoca et al. tratan el *color bleeding* (sangrado de color entre zonas húmedas) como uno de los efectos «esenciales y característicos» de la acuarela tradicional — [Montesdeoca et al. 2016, ACM](https://dl.acm.org/doi/pdf/10.5555/2981324.2981332)

### Inferences
- Regla de render: un **parámetro de humedad por píxel o región en el momento de la pincelada** debería seleccionar el comportamiento del borde.
  - `w > 0.8` (brillante): difusión amplia de varios cm a escala A4, perfil muy blando y dedos ramificados.
  - `0.5–0.8` (satinado): difusión corta de mm a 1 cm, borde blando sin dedos.
  - `0.2–0.5` (mate-húmedo): si el pincel lleva más agua que el papel → *backrun* (sección 3); si lleva menos → borde semiduro.
  - `< 0.2` (seco): borde duro con oscurecimiento (sección 2).
- La difusión real **no es un desenfoque gaussiano isótropo**. Avanza por los capilares del papel y forma frentes irregulares, digitados y con dedos. Un blur gaussiano limpio delata la imitación digital. Habría que deformar el frente con ruido de baja frecuencia anclado a la textura del papel y dejar un frente algo más oscuro donde se detiene el agua.
- En una misma pintura conviven **zonas sangradas** (fondo, cielo) y **zonas de borde duro** (primer plano). Si todo tiene el mismo borde, deja de parecer acuarela.

### Gaps
- No encontré medidas cuantitativas del radio de expansión en función de la humedad ni del tiempo de secado según el papel. Una aproximación física razonable sería la ley de Lucas-Washburn (penetración ∝ √t), pero no la verifiqué con fuentes en esta sesión.
- No pude leer la página de handprint.com sobre técnicas húmedas (dominio bloqueado).

## 2. Oscurecimiento de borde (*edge darkening*, efecto «anillo de café»)

### Takeaway
Cuando una aguada se seca sobre papel encolado con el **borde anclado**, la evaporación es mayor en el perímetro y crea un flujo capilar del interior hacia el borde. Ese flujo arrastra el pigmento y deja una **línea oscura fina en el lado interior del contorno**. Hacen falta un borde fijo, una capa de agua con pigmento en suspensión y un secado sin perturbar. Por eso es típico del húmedo sobre seco y apenas aparece en el húmedo sobre húmedo ni en el pincel seco.

### Cited Findings
- Física (Deegan et al., *Nature* 389, 827–829, 1997): el anillo se forma por un flujo capilar. El **anclaje de la línea de contacto** obliga a que el líquido que se evapora en el borde se reponga con líquido del interior, y ese flujo hacia fuera puede llevar casi todo el material disperso al borde — [Nature](https://www.nature.com/articles/39827); [Nagel, resumen U. Chicago](https://jfi.uchicago.edu/~tten/Science%20topics/Coffee.drops/Nagel.7.4.pdf)
- Condiciones necesarias según los autores:
  1. Ángulo de contacto no nulo.
  2. Línea de contacto anclada en su posición inicial.
  3. Que el disolvente se evapore. Si la gota no se seca, no hay anillo.

  La teoría predice además un crecimiento de la masa del anillo como ley de potencia del tiempo, independiente del sustrato, del líquido y del sólido. Los autores descartaron como causa el flujo de Marangoni, la convección, la difusión y los efectos electrostáticos — [Nature](https://www.nature.com/articles/39827); [Softbites](https://softbites.org/2017/11/29/when-espresso-evaporates-the-physics-of-coffee-rings/); [IDEAS/RePEc](https://ideas.repec.org/a/nat/nature/v389y1997i6653d10.1038_39827.html)
- En acuarela, según Curtis et al.: el encolado del papel, junto con la tensión superficial del agua, impide que la pincelada se extienda. En un proceso gradual, el pigmento migra del interior de la zona pintada hacia sus bordes — [Curtis et al. 1997](https://www.cs.princeton.edu/courses/archive/fall00/cs597b/papers/curtis97.pdf) (frase recogida en el extracto de búsqueda); [Block, resumen del paper (Montana State)](https://www.cs.montana.edu/courses/spring2005/525/students/Block1.pdf)
- La patente de Curtis et al. lo atribuye a una **evaporación mayor cerca de los bordes de un charco pequeño**, donde hay más superficie de fluido por unidad de papel — [US6198489B1](https://patents.google.com/patent/US6198489B1/en)
- Observación de una acuarelista: el agua lleva el pigmento hacia el borde exterior, donde se acumula, y por eso el contorno seca más oscuro que el interior — [Louise De Masi, «Common water problems»](https://www.louisedemasi.com/tips/2022/8/13/common-water-problems)
- Un borde duro aparece cuando una aguada se seca antes de que la pintura vecina pueda fundirse con ella. Para evitarlo hay que trabajar rápido y no dejar que el borde de avance se seque antes del siguiente trazo — [Klasel Art](https://klaselart.com/how-to-fix-watercolor-mistakes/); [Paul Cheney](https://paulcheney.ca/backruns-and-blooms/); [Watercolor Affair, washes streaky](https://www.watercoloraffair.com/9-reasons-why-your-watercolor-washes-look-streaky/)
- En graficación: Montesdeoca et al. tratan el *edge darkening* como acumulación gradual de pigmento y lo implementan con una diferencia de gaussianas, controlable por el artista. Lo agrupan con *gaps*, *overlaps* y *dry-brush* como efectos «de borde y de sustrato» — [Montesdeoca et al. 2016](https://dl.acm.org/doi/pdf/10.5555/2981324.2981332); [Montesdeoca et al. NPAR 2017, Eurographics DL](https://diglib.eg.org/items/1f77ad01-7118-4a6d-9aea-d4904f850565)
- Bousseau et al. 2006 obtienen el oscurecimiento de borde, igual que la textura de papel y la dispersión, oscureciendo o aclarando la imagen de color con una textura en escala de grises (descripción secundaria) — [Bousseau et al., INRIA](https://artis.inrialpes.fr/Publications/2006/BKTS06); [3dstereophoto blog](https://3dstereophoto.blogspot.com/2018/05/non-photorealistic-rendering-watercolor.html)

### Inferences
- Cuándo aplicarlo:
  - Sí: en aguadas y pinceladas sobre seco con carga de agua media o alta.
  - Más fuerte donde se encharcó más agua, normalmente en el borde inferior si el tablero está inclinado.
  - No o muy débil: en zonas pintadas sobre húmedo (el borde no está anclado), en el pincel seco (no hay película de agua) y en tintas muy diluidas.
- Perfil: una banda **interior** al contorno, con su máximo justo en el borde, que decae hacia dentro en una anchura pequeña respecto al tamaño de la mancha. El interior queda algo más claro, porque el pigmento se ha ido al borde, así que la densidad total se conserva. Por fuera del contorno no hay oscuridad. La línea **no es uniforme**: se interrumpe y se engruesa donde hubo más agua y sigue el grano del papel.
- Las capas superpuestas (veladuras) muestran cada una su propio borde oscuro. Ver varios contornos oscuros que se cruzan es una firma muy fuerte de acuarela real; es lo que Montesdeoca llama *overlaps*.
- Una banda de oscurecimiento de ancho constante y suave en todo el perímetro, al estilo de un DoG, delata la imitación digital. Conviene modularla con ruido y con la humedad local.

### Gaps
- No encontré mediciones de la **anchura ni de la intensidad** del borde oscuro en acuarela real, ni en mm ni en porcentaje de densidad. Mi observación personal no verificada es una línea de unos 0,3–2 mm y entre 1,2 y 2 veces la densidad del interior; habría que medirla en escaneos de REFERENCIAS.
- No verifiqué cómo influyen el surfactante (hiel de buey) y la goma arábiga en el anclaje del borde. Tampoco si el flujo de Marangoni o la forma de las partículas lo atenúan; hay literatura física posterior a Deegan (Hu & Larson 2006; Yunker et al. 2011) que no consulté.

## 3. Floraciones, *backruns* y coliflores; gotas, salpicaduras, inclinación y escurridos

### Takeaway
Una floración (*bloom*, *backrun*, coliflor) se forma cuando **agua o pintura más húmeda entra en una aguada que ya ha empezado a secar**. El agua nueva se expande y empuja el pigmento asentado hacia fuera. El resultado es una mancha de **centro pálido con un borde oscuro, duro, irregular y ramificado**. Lo más típico es que aparezcan al final de las aguadas, donde el charco del borde inferior refluye, o donde se vuelve a tocar una zona húmeda-mate.

### Cited Findings
- Mecanismo: el agua nueva inunda hacia fuera y empuja el pigmento que se está secando hasta formar un anillo irregular («ragged ring»). Queda un centro pálido y un **borde oscuro, duro y ramificado** — [Paul Cheney, «Backruns & Blooms»](https://paulcheney.ca/backruns-and-blooms/)
- Forma: manchas irregulares y curvas con bordes oscuros y duros — [Louise De Masi, «How to create or avoid blooms»](https://www.louisedemasi.com/tips/2024/5/21/how-to-create-or-avoid-watercolour-blooms)
- *Backruns* según Curtis et al.: se forman cuando un charco de agua se extiende hacia una aguada que se está secando y arrastra el pigmento, dejando formas ramificadas con bordes oscuros. El extracto de búsqueda se cortaba antes del mecanismo **[verificar en el PDF]** — [Curtis et al. 1997](https://www.cs.princeton.edu/courses/archive/fall00/cs597b/papers/curtis97.pdf); [ResearchGate, fig. 1](https://www.researchgate.net/figure/Real-watercolor-effects-drybrush-a-edge-darkening-b-backruns-c-granulation-d_fig1_2917328)
- Momento de máximo riesgo: con el papel húmedo, cuando absorbe el agua nueva y empuja la pintura ya asentada. Otra fuente añade que la pintura del papel ya está algo seca y es más densa que la que se añade — [Café Watercolor](https://cafewatercolor.com/blog/113); [Solving Watercolour](https://www.solvingwatercolour.com/how-to-fix-watercolor-mistakes/)
- Distinción: añadir **pintura** a una zona húmeda produce *backruns*; añadir **agua** produce *blooms* — [Watercolor Affair, blooms](https://www.watercoloraffair.com/watercolor-blooms-turning-mistakes-into-success/); [artgraphica](http://www.artgraphica.net/free-art-lessons/watercolor/watercolor-blooms.html)
- Tamaño según el agua: cuanta más agua o un pincel más húmedo en una aguada más húmeda, mayor y más blanda es la floración. Con menos agua es más pequeña y apretada. Se usan a propósito para plumas, pelo, follaje y moteados de flores — [Watercolor Affair, blooms](https://www.watercoloraffair.com/watercolor-blooms-turning-mistakes-into-success/)
- Charco final: el líquido que se acumula en la parte baja de una aguada puede refluir mientras seca y empujar el pigmento en una floración plumosa. Remedio: retirar la gota del borde con un pincel «sediento» — [Watercolor Affair, washes streaky](https://www.watercoloraffair.com/9-reasons-why-your-watercolor-washes-look-streaky/); [WetCanvas](https://www.wetcanvas.com/forums/topic/beginner-how-to-avoid-unwanted-effects/); [Solving Watercolour](https://www.solvingwatercolour.com/how-to-fix-watercolor-mistakes/)
- Papel: los papeles de celulosa absorben el agua muy despacio, y eso hace los *backruns* más frecuentes — [Solving Watercolour](https://www.solvingwatercolour.com/how-to-fix-watercolor-mistakes/)
- Gotas y salpicaduras:
  - Sobre papel húmedo dan gotas blandas que se funden.
  - Sobre papel seco dan gotas de borde duro.
  - Sobre papel muy mojado desaparecen.
  - Sobre una aguada seca añaden textura sin alterar el color de base, por eso se suelen usar al final — [Russell Collection, splattering](https://russell-collection.com/what-is-splattering-technique-in-watercolor-painting/); [Paul Cheney, texture](https://paulcheney.ca/watercolor-texture/)
- Pendleton usa la salpicadura para integrar el borde de un viñeteado con el papel blanco — [Dennis Pendleton, «Venice Vignette»](https://www.dennispendletonstudio.com/single-post/venice-vignette)

### Inferences
- Regla de floración: aparece **solo** cuando en una región con humedad residual media (mate-húmeda) entra agua o pintura con más humedad que la local.
  - Forma: un frente que se expande desde el punto de entrada con perímetro digitado o fractal y dedos más finos al final. Fuera del frente se acumula una franja oscura de 0,5–2 mm (mismo mecanismo que el borde oscuro) y el interior queda **más claro** que la aguada circundante.
  - Escala: de unos pocos mm (toque seco) a varios cm (agua abundante).
  - Lugares típicos: (a) borde inferior o terminal de aguadas grandes, (b) zonas donde se superponen dos colores con humedad distinta, (c) gotas deliberadas.
- Una floración realista **no es un círculo**. Es asimétrica, sigue la pendiente del papel y se detiene en zonas ya secas, a menudo con forma de «coliflor» de lóbulos múltiples.
- Escurridos e inclinación: con el tablero inclinado (lo habitual, unos 10–30°, valor no verificado) el agua y el pigmento se acumulan en el borde inferior de cada aguada. Ahí el borde oscuro es más ancho y es donde nacen los *backruns*. Si se simula, cada aguada debería tener una «dirección de gravedad» global y un borde inferior más denso.
- Gotas de salpicadura: tamaño en distribución log-normal (muchas pequeñas, pocas grandes). Las gotas sobre seco tienen borde oscuro y forma algo elíptica según el ángulo; las de sobre húmedo son halos blandos.

### Gaps
- No encontré fuentes físicas sobre la geometría del frente de un *backrun* (dimensión fractal, inestabilidad de digitación en medio poroso). Tampoco verifiqué el ángulo típico de inclinación del tablero ni la distribución de tamaños de gota en una salpicadura.

## 4. Granulación, floculación, pigmentos manchantes y no manchantes, sedimentación

### Takeaway
La **granulación**, el depósito desigual de partículas grandes y densas que se asientan en los valles del papel, y la **floculación**, la aglomeración de partículas en grumos, son **propiedades del pigmento**. El papel rugoso y el exceso de agua las amplifican. Granulan ultramar, cobalto, manganeso, cerúleo, tierras y algunos cadmios. Los ftalos, el azul de Prusia y las quinacridonas no granulan, pero **manchan**: tiñen las fibras y no se pueden levantar. Granulación y manchado son propiedades independientes entre sí.

### Cited Findings
- La granulación es el resultado de un asentamiento desigual. La floculación es la atracción y aglomeración de partículas; algunas fuentes la tratan como un subtipo de granulación — [Obsidian Atelier](https://www.obsidianatelier.com/information/granulation)
- Las partículas finas granulan menos. Las grandes e irregulares granulan más, como muchas tierras, los ultramares y los cadmios — [Daniel Smith, tutorial de Jane Blundell](https://danielsmith.com/tutorials/jane-blundell-granulating-watercolors-what-why/)
- Los azules de cobalto y ultramar están entre los pigmentos más gruesos. El ultramar puede apelmazarse con la presión del molido — [handprint, «material attributes of paints»](https://www.handprint.com/HP/WCL/pigmt3.html)
- Ultramar genuino, cobalto, manganeso y cerúleo suelen granular; ftalo y Prusia no. Las tierras suelen granular; los ftalos son transparentes y manchantes — [Jane Blundell, «Characteristics of Watercolour»](https://www.janeblundellart.com/characteristics-of-watercolour.html)
- El papel rugoso o de grano fino y más agua amplifican el efecto, pero la granulación es una propiedad del pigmento, no del papel — [The Watercolourist](https://thewatercolourist.com/materials/granulating-pigments/)
- handprint puntúa la granulación y la floculación juntas en una escala «Gr» de 0 a 4 — [handprint, «what the ratings mean»](https://www.handprint.com/HP/WCL/pigmt8.html)
- El mismo pigmento puede granular distinto según la marca, porque cambian la formulación y el tamaño de partícula — [Watercolor Affair, granulation](https://www.watercoloraffair.com/all-you-ever-wanted-to-know-about-watercolor-granulation/)
- Curtis et al. agrupan granulación y **separación de pigmentos**, en la que un pigmento de una mezcla se deposita antes que otro y la mezcla se disocia en motas de colores distintos. En su modelo cada pigmento tiene parámetros de densidad, poder de manchado y granulación **[verificar en el PDF]**. Una fuente secundaria confirma que la granulación depende de una constante por pigmento ponderada por un mapa de granulación del papel — [Curtis et al. 1997](https://www.cs.princeton.edu/courses/archive/fall00/cs597b/papers/curtis97.pdf); [WPI, «Rendering the pigmented layers»](https://davis.wpi.edu/~matt/courses/watercolor/rendering.html); [Real-time watercolor, PCM 2004](https://www.cs.nthu.edu.tw/~chunfa/pcm2004.pdf)
- Variación de densidad de pigmento según la descomposición de Bousseau, usada también en trabajos posteriores:
  - **Baja frecuencia**: el «flujo turbulento», por la distribución desigual del agua.
  - **Alta frecuencia**: la «dispersión de pigmento», por la distribución desigual del pigmento en el agua.
  - **Textura del papel**: el pigmento se acumula en sus cavidades.

  — [Bousseau et al. 2006, INRIA](https://artis.inrialpes.fr/Publications/2006/BKTS06); [3dstereophoto blog](https://3dstereophoto.blogspot.com/2018/05/non-photorealistic-rendering-watercolor.html); [gracelgilbert/watercolor-stylization](https://github.com/gracelgilbert/watercolor-stylization)
- Manchantes: ftalo (azul y verde), rosas y magentas de quinacridona, violeta de dioxazina, carmín de alizarina y la mayoría de los rojos «permanentes» dejan tinte aunque se frote. Ejemplos de no manchantes: cobalto y cerúleo, que se levantan limpiamente — [Parkablogs](https://www.parkablogs.com/content/staining-vs-non-staining-watercolour); [Natural Pigments, medir el manchado](https://www.naturalpigments.com/artist-materials/watercolor-staining); [Peerless Color Labs](https://peerlesscolorlabs.com/blogs/peerless-art-class/watercolor-pigments-explained)
- Prueba de manchado de Blundell: pintar una aguada, dejarla secar, frotar con un pincel duro húmedo y secar con papel. Si se recupera el blanco del papel, el color no mancha; si queda color, mancha — [Jane Blundell](https://www.janeblundellart.com/characteristics-of-watercolour.html)
- Las dos propiedades son independientes. El viridián granula y no mancha; el verde ftalo mancha y no granula — [Light Sculpture](https://www.light-sculpture.com/2025/10/10/%F0%9F%8E%A8-the-secret-lives-of-pigments-a-watercolorists-guide-to-staining-granulation-transparency-lightfastness/); [Jane Blundell](https://www.janeblundellart.com/characteristics-of-watercolour.html)
- Una capa previa de goma arábiga diluida reduce el manchado y facilita levantar color; con el azul ftalo apenas funciona — [Jackson's, mediums](https://www.jacksonsart.com/blog/2021/04/09/a-guide-to-watercolour-mediums/)
- No encontré «sedimentary» como término formal de ensayo. En la práctica la idea coincide con la granulación: partículas grandes que se quedan en superficie y se levantan con más facilidad — [Parkablogs](https://www.parkablogs.com/content/staining-vs-non-staining-watercolour)

### Inferences
- Regla de render: cada «pigmento» de la paleta virtual necesita dos coeficientes independientes, `granulación ∈ [0,1]` y `manchado ∈ [0,1]`.
  - La granulación modula la densidad con la **altura del papel escaneado**: más densidad en los valles y menos en las crestas. El efecto crece con la cantidad de agua de la aguada y es nulo en el pincel seco.
  - La floculación es un ruido de **grumos no correlacionado con el papel**, con manchitas de unas pocas décimas de mm.
- Paleta para convertir fotos, por familias de tonos:
  - Azules de cielo y sombras frías (ultramar, cobalto): granulación alta.
  - Ocres, sienas y sombras (tierras): granulación media o alta.
  - Verdes y azules intensos (ftalos): sin granulación, aspecto liso y manchante.
  - Rosas y magentas (quinacridonas): lisos y transparentes.
- **Separación** en mezclas: en las sombras grises hechas con ultramar y siena tostada, el azul y el marrón se separan en motas de color distinto a escala de grano. Es una firma muy reconocible y barata de simular: dos capas con granulación desfasada.
- La granulación es **más visible en tonos medios** de aguadas abundantes, y en papel rugoso más que en satinado.

### Gaps
- No pude leer handprint (bloqueado), así que me faltan las tablas de tamaños de partícula en µm y los ratings Gr de cada pigmento. Tampoco conseguí datos de fabricante (W&N, Daniel Smith, Schmincke) sobre su escala de granulación, aunque sé que la indican en sus cartas de color.

## 5. Veladuras y capas, mezcla óptica, «barro», levantado, pincel seco y reserva de blancos

### Takeaway
La acuarela es **transparente y sustractiva**. La luz atraviesa capas finas, se refleja en el papel blanco y vuelve a atravesarlas, así que **el blanco del papel es la luz**. Las veladuras se aplican sobre capas **completamente secas**; si se moja una capa, se reactiva y se embarra. Los pigmentos opacos y las capas excesivas dan «barro». Los blancos se reservan, no se pintan. El pincel seco solo deposita pigmento en las crestas del papel.

### Cited Findings
- Las veladuras funcionan porque la luz atraviesa capas finas y transparentes y se refleja en el papel. El papel blanco actúa como una fuente de luz que ilumina los pigmentos desde abajo, y el ojo mezcla ópticamente las capas — [Paul Rubens, glazing](https://www.paulrubensshop.com/blogs/knowledge/watercolor-glazing); [Peerless, glazing](https://peerlesscolorlabs.com/blogs/peerless-art-class/watercolor-glazing-wet-on-wet-techniques)
- Cada capa tiene que secarse completamente antes de la siguiente. Rehumedecer una capa la reactiva y provoca floraciones incontroladas y mezcla embarrada — [Jenna Rainey](https://jennarainey.com/watercolor-glazing/); [Belinda Del Pesco](https://www.belindadelpesco.com/watercolor-painting-tips/watercolor-glazing-technique-demonstration/); [Kelly Crockett](https://kellycrockettarts.com/avoid-muddy-colors-when-layering-watercolor-washes/)
- Número de capas: un blog recomienda **3–4** como regla práctica y avisa de que demasiadas embarran el color. No pude identificar con seguridad cuál de los resultados lo dice; está entre [Mary Moreno](https://www.marymorenostudio.com/blog/layering-and-glazing-watercolor-techniques-for-beginners), [Umbrella Art Studio](https://www.umbrellaartstudio.com/2026/05/how-to-layer-watercolor.html) y [Kelly Crockett](https://kellycrockettarts.com/avoid-muddy-colors-when-layering-watercolor-washes/). Las demás fuentes no dan número.
- Los pigmentos opacos se quedan en la superficie en vez de brillar a través de las capas y pueden parecer calcáreos. Se recomiendan los transparentes, como las quinacridonas — [Kelly Crockett](https://kellycrockettarts.com/avoid-muddy-colors-when-layering-watercolor-washes/)
- Modelo óptico de Curtis et al. y de la literatura posterior: **Kubelka-Munk**, con coeficientes de absorción K y dispersión S por pigmento, y capas compuestas en orden — [WPI, «Rendering the pigmented layers»](https://davis.wpi.edu/~matt/courses/watercolor/rendering.html); [Curtis et al. 1997](https://www.cs.princeton.edu/courses/archive/fall00/cs597b/papers/curtis97.pdf)
- Curtis et al. definen la *glazing* como la superposición de capas muy finas y puras, una sobre otra, para ajustar el color, y la cuentan entre los efectos distintivos de la acuarela — [Curtis et al. 1997](https://www.cs.princeton.edu/courses/archive/fall00/cs597b/papers/curtis97.pdf); [ResearchGate](https://www.researchgate.net/publication/2917328_Computer-Generated_Watercolor)
- **Levantado** (*lifting*):
  - Con pigmentos no manchantes se vuelve al blanco.
  - Con manchantes queda un tinte.
  - Se usa con pincel húmedo y papel absorbente para crear luces de borde suave.

  — [Louise De Masi, lifting](https://www.louisedemasi.com/tips/2024/4/lifting-techniques-in-watercolour); [Jane Blundell](https://www.janeblundellart.com/characteristics-of-watercolour.html)
- **Pincel seco** (*dry brush*):
  - Mecanismo: el pigmento se queda en las crestas del papel rugoso y salta los valles, que quedan como motas blancas.
  - Papel: el satinado no sirve, el de grano fino va bien y el rugoso es el mejor.
  - Agua: el pincel y el papel tienen que estar secos; un papel que aún brilla no acepta el pincel seco.
  - Gesto: en papel liso hace falta un trazo más rápido, y una presión más ligera da un trazo más roto.

  — [Painting with Watercolors](https://www.paintingwithwatercolors.com/dry-brush-technique-watercolor-paintings); [Watercolor Affair, dry brush](https://www.watercoloraffair.com/?p=8591); [Louise De Masi, dry brushing](https://louise-demasi-4nkf.squarespace.com/tips/2023/5/18/what-is-dry-brushing-in-watercolour)
- Curtis et al. describen el pincel seco como un pincel casi sin pintura que deja un trazo de textura rugosa y deshilachada, porque la pintura solo se adhiere a las partes elevadas del papel rugoso — [Curtis et al. 1997](https://www.cs.princeton.edu/courses/archive/fall00/cs597b/papers/curtis97.pdf); [Block](https://www.cs.montana.edu/courses/spring2005/525/students/Block1.pdf)
- **Reserva de blancos**:
  - Tradicionalmente el blanco no se pinta: se deja el papel sin pintar donde van los blancos más blancos.
  - La técnica se llama «reservar blancos». Para los pequeños se usa líquido de enmascarar, normalmente de látex, que se retira cuando todo está seco. También se puede aplicar sobre una aguada seca.

  — [Watercolor Affair, light to dark](https://www.watercoloraffair.com/watercolor-painting-light-to-dark-watercolor-cookies/); [Jackson's, masking fluid](https://www.jacksonsart.com/blog/2011/01/13/using-masking-fluid/); [Louise De Masi, masking](https://www.louisedemasi.com/tips/2023/12/22/top-tips-for-using-masking-fluid)
- Enmascarar en exceso aplana la pintura; conviene reservarlo para los pocos blancos importantes. También libera para pintar suelto la primera aguada — [Hurrell Editions](https://hurrelleditions.com/how-to-use-masking-fluid-in-watercolor-painting/); [Jennifer Branch](https://jenniferbranch.com/PaintingWatercolor/Art-Lessons/How-To-Use-Masking.html)
- Montesdeoca et al. NPAR 2017 identifican ***gaps*** (huecos blancos entre zonas de color adyacentes) y ***overlaps*** (solapes más oscuros donde dos aguadas se pisan) como efectos de borde característicos — [Montesdeoca et al. 2017](https://diglib.eg.org/items/1f77ad01-7118-4a6d-9aea-d4904f850565); [ResearchGate](https://www.researchgate.net/publication/318763978_Edge-_and_substrate-based_effects_for_watercolor_stylization)

### Inferences
- Composición de capas: hay que componer en **modo multiplicativo/sustractivo** (Kubelka-Munk o una aproximación por transmitancia), nunca en modo normal con alfa. Donde dos aguadas se solapan, el resultado es **más oscuro y más saturado** que cada una por separado, y el contorno de cada capa sigue visible.
- La **cuenta de capas** de la imagen final debería ser baja: 2–4 en la mayoría de zonas y algo más solo en los oscuros de acento. Muchas capas finas acumuladas desaturan y «embarran».
- **Huecos blancos** de 0,5–3 mm entre regiones adyacentes que no se tocan, con el papel visible: es la firma de un acuarelista que pinta por áreas sobre seco. **Solapes oscuros** donde las regiones se pisan. Un render con regiones perfectamente adosadas, sin huecos ni solapes, parece una ilustración vectorial.
- Las **luces son papel**. Las altas luces de la foto deberían quedar como blanco del papel, con su textura, y nunca llevar pigmento blanco ni aclarado por encima. Con reserva por líquido de enmascarar, el borde de la reserva es nítido y algo irregular, con el pigmento acumulado junto a él. Con reserva pintando alrededor, el borde es el de la aguada.
- **Levantado**: luces de borde blando con un halo de tinte residual cuyo color depende del pigmento manchante. Si se simula, la «goma» digital no debe llegar al blanco puro en los colores manchantes.
- **Pincel seco**: el pigmento se pone donde `altura_papel > umbral(presión, carga)`, con el umbral subiendo a lo largo del trazo a medida que el pincel se descarga. Las motas blancas siguen el grano real del papel escaneado. El final del trazo es más roto que el principio.

### Gaps
- No encontré datos ópticos (K y S medidos) de pigmentos reales de acuarela en las fuentes alcanzables. Tampoco una cifra consensuada del máximo de capas antes del barro, aparte de la regla práctica de 3–4 de un único blog.

## 6. El papel: prensado en caliente, grano fino y rugoso; gramaje, encolado, algodón frente a celulosa; cómo se ve la textura; ondulado (*cockling*)

### Takeaway
La superficie decide cuánto se ve la granulación y si el pincel seco se rompe:
- **Prensado en caliente** (*hot press*, satinado): liso.
- **Prensado en frío** (*cold press*, grano fino o NOT): textura media; es el papel de aguadas por excelencia.
- **Rugoso** (*rough*, torchon): textura muy marcada.

El **encolado de gelatina** controla cuánto tarda el agua en entrar y deja el pigmento en superficie, lo que da tiempo de trabajo, permite levantar color y sostiene bordes nítidos. El **gramaje** controla el ondulado: 300 g/m² (140 lb) aguanta aguadas ligeras pero se ondula con aguadas abundantes si no se tensa; 640 g/m² (300 lb) apenas se mueve.

### Cited Findings
- El prensado en caliente es liso y adecuado para el detalle y la tinta. El grano fino tiene textura y es el más fácil para aguadas, paisaje y húmedo sobre húmedo. El rugoso tiene un diente más pronunciado. Fuentes comerciales — [Paul Rubens, hot vs cold press](https://www.paulrubensshop.com/blogs/knowledge/hot-press-vs-cold-press-watercolor-paper-full-comparison); [Paul Rubens](https://www.paulrubensshop.com/blogs/knowledge/hot-press-vs-cold-press-watercolor-paper)
- El encolado controla la velocidad a la que penetra el agua y cuánto se queda el pigmento en superficie. Más encolado da más tiempo de trabajo y facilita levantar color; menos encolado deja que el agua se hunda rápido — [Cursa, «Watercolor paper: weight, texture…»](https://cursa.app/en/page/watercolor-paper-weight-texture-and-how-paper-changes-your-washes)
- Arches: 100 % algodón, de molde, con encolado de gelatina **en masa** (interno) y también **superficial** (externo). Se presenta como el único molino que encola con gelatina hasta el núcleo. Es un argumento de fabricante y distribuidor — [Talas, Arches](https://www.talasonline.com/Arches-Watercolor-Paper); [Schleiper, Arches](https://www.schleiper.com/eshopexpress/series/9728-arches-watercolour-paper-sheet-100-cotton-4-deckled-edges?lang=en)
- Hahnemühle describe sus papeles como encolados en superficie — [Hahnemühle, The Collection](https://www.hahnemuehle.com/en/artist-papers/the-collection/the-collection-watercolour.html)
- Gramaje: el de 300 lb (unos 640 g/m²) es muy estable, admite mucha agua y a menudo se usa sin tensar. El de 300 g/m² (140 lb) acepta una aguada ligera sin deformarse, pero hay que tensarlo para técnicas más húmedas. Se recomienda tensar el de 90 lb y cualquier papel que se vaya a inundar — [Cursa](https://cursa.app/en/page/watercolor-paper-weight-texture-and-how-paper-changes-your-washes); [Jackson's, paper stretching](https://www.jacksonsart.com/art-techniques/paper-stretching)
- Tensar el papel evita que se combe, se abombe o se ondule cuando se trabaja con mucha agua — [Jackson's, paper stretching](https://www.jacksonsart.com/art-techniques/paper-stretching)
- Los papeles de celulosa absorben el agua muy lentamente, lo que hace más frecuentes los *backruns*. Los proveedores afirman que el algodón rinde «mucho mejor», aunque es un argumento comercial — [Solving Watercolour](https://www.solvingwatercolour.com/how-to-fix-watercolor-mistakes/); [FeatherJoy, test de 10 papeles](https://featherjoy.com/articles/artistpapercomparisons)
- En los modelos de Curtis y derivados, el papel se modela como un campo de alturas que guía el flujo capilar y en cuyos valles microscópicos se asienta el pigmento (granulación) — [Curtis et al. 1997](https://www.cs.princeton.edu/courses/archive/fall00/cs597b/papers/curtis97.pdf); [GitHub morphogenesis-resources #65](https://github.com/jasonwebb/morphogenesis-resources/issues/65)
- Montesdeoca incluye la *paper distortion*, el desplazamiento del color por la textura del papel en los bordes, entre los efectos característicos — [Montesdeoca et al. 2016](https://dl.acm.org/doi/pdf/10.5555/2981324.2981332); [Artineering, watercolor style](https://artineering.io/styles/watercolor)

### Inferences
- La textura escaneada del plugin tiene que intervenir en al menos cuatro sitios:
  1. Modulación de la densidad por granulación (valles más oscuros).
  2. Umbral del pincel seco (crestas pintadas).
  3. **Distorsión de los bordes**: los contornos de las aguadas se desplazan unas décimas de mm siguiendo el grano, de modo que el borde nunca es una curva limpia.
  4. Luz rasante sutil sobre todo el papel, también en los blancos sin pintar.
- Elegir el tipo de papel debería cambiar a la vez la amplitud de la granulación, la rotura del pincel seco y la rugosidad de los bordes. El satinado da bordes nítidos, poca granulación y aguadas con más marcas de pincel y más oscurecimiento de borde. El rugoso da mucha granulación y pincel seco muy roto.
- El **ondulado** en un papel de 300 g/m² sin tensar forma ondas suaves de varios cm. El pigmento se encharca en los valles de las ondas y deja franjas o manchas más oscuras de baja frecuencia (observación habitual, no verificada con fuente). Se podría simular con un campo de baja frecuencia que module la acumulación de agua.
- Los **bordes barbados** del pliego (*deckle*) y los márgenes blancos sin pintar son pistas de «objeto real» si el plugin muestra el pliego completo.

### Gaps
- No encontré datos de profundidad de grano en µm por tipo de papel, de absorbencia medida (tipo Cobb) ni de amplitud de ondulado. Tampoco pude consultar las fichas técnicas de Arches, Saunders Waterford ni Fabriano directamente.

## 7. Proceso típico del acuarelista: de claro a oscuro, de lo grande a lo pequeño, simplificación, viñeteado y bordes «perdidos y encontrados»

### Takeaway
Se pinta **de claro a oscuro**, en aguadas grandes y diluidas primero, con los oscuros y el detalle al final, reservando el papel para los blancos. La pintura alterna **bordes perdidos**, blandos, que se funden con el papel o con la zona vecina, y **bordes encontrados**, duros. Los estilos sueltos simplifican mucho y dejan zonas sin acabar que se funden con el blanco del papel (viñeta). Lo no pintado forma parte del diseño.

### Cited Findings
- Pintar de claro a oscuro es la forma más aceptada de construir una acuarela: empezar con tonos claros y diluidos y oscurecer en capas posteriores — [Watercolor Affair, «light to dark»](https://www.watercoloraffair.com/watercolor-painting-light-to-dark-watercolor-cookies/)
- Las texturas (sal, salpicadura) se añaden después de establecer el color base y la forma, como último paso. La salpicadura sobre aguada seca suele ir al final de la pintura — [Paul Cheney, texture](https://paulcheney.ca/watercolor-texture/); [Russell Collection](https://russell-collection.com/what-is-splattering-technique-in-watercolor-painting/)
- **Viñeta**: una imagen que se funde con el fondo sin borde definido y usa el papel no pintado como parte del diseño; las formas negativas deben ser tan interesantes como las pintadas — [Dennis Pendleton, «Painting a vignette»](https://www.dennispendletonstudio.com/single-post/painting-a-vignette)
- En una viñeta, unos bordes se suavizan hacia el papel blanco y otros son más abruptos, y esa mezcla es la típica. Para llevar una zona al blanco se usan trazos más claros y salpicadura — [Dennis Pendleton, «Venice Vignette»](https://www.dennispendletonstudio.com/single-post/venice-vignette)
- El pintor decide qué es esencial y qué puede dejar sin acabar o fuera, y la imaginación del espectador completa el resto — [Dennis Pendleton](https://www.dennispendletonstudio.com/single-post/venice-vignette)
- **Borde perdido**: se deja esa parte del papel intacta, o se difumina con agua limpia, para que las superficies parezcan fundirse. Los **bordes encontrados** (duros) salen de las técnicas sobre seco — [Watercolor Affair, lost & found edges](https://www.watercoloraffair.com/?p=3171); [worksheet PDF](https://www.watercoloraffair.com/wp-content/uploads/2020/11/worksheet-lost-and-found-edges-in-watercolor.pdf); [American Watercolor, «The lowdown on lost edges»](https://americanwatercolor.net/the-lowdown-on-lost-edges/)
- Para arreglar el «barro» se recomienda planificar los valores con un estudio previo y levantar y volver a velar en vez de añadir capas — [Kelly Crockett](https://kellycrockettarts.com/avoid-muddy-colors-when-layering-watercolor-washes/); [Paul Cheney, troubleshooting](https://paulcheney.ca/watercolor-troubleshooting/)
- Bousseau et al. 2006 abstraen la foto con una segmentación de color (*mean shift*) y la suavizan morfológicamente antes de aplicar los efectos. Es decir, en la conversión de fotos la **simplificación de formas** es un paso previo esencial — [3dstereophoto blog](https://3dstereophoto.blogspot.com/2018/05/non-photorealistic-rendering-watercolor.html); [Bousseau et al. 2006](https://artis.inrialpes.fr/Publications/2006/BKTS06)

### Inferences
Orden de render que imita el proceso real:
1. Aguada general muy diluida, en húmedo sobre húmedo y con sangrados, en las zonas de color de fondo, dejando el papel en las luces.
2. Aguadas de tonos medios sobre seco, por regiones simplificadas, con bordes duros, oscurecimiento, huecos y solapes.
3. Oscuros de acento: pocas manchas pequeñas, más saturadas y de borde nítido.
4. Detalle lineal final con pincel fino tipo *rigger* (ramas, cables, siluetas).
5. Salpicadura y efectos de textura al final.

- El detalle debe **concentrarse en el centro de interés** y disolverse hacia la periferia. Lo más reconocible del estilo suelto es una **viñeta irregular**: los bordes del cuadro se pierden en el blanco con mezcla de bordes blandos y abruptos, algunas pinceladas sueltas sobresalen y hay salpicaduras.
- **Simplificar**: pocas regiones grandes con valores agrupados, en 3–5 niveles de valor (cifra no verificada en las fuentes). La textura fina de la foto (hojas, ladrillos) se sugiere con unas pocas marcas y no se reproduce entera.

### Gaps
- No encontré fuentes de calidad (libros de Joseph Zbukvic, John Yardley, Alvaro Castagnet ni el apartado de técnica de handprint) con descripciones explícitas del «less is more», del número de valores ni de la proporción de papel en blanco. No pude acceder a handprint.

## 8. Pinceles y sus marcas; sal, alcohol y salpicado

### Takeaway
- **Redondo**: la marca universal (punta fina, panza ancha y trazos que van de fino a grueso).
- **Mop o pincel de pelo**: aguadas grandes, sueltas y blandas.
- **Plano**: bordes rectos nítidos, arquitectura y troncos.
- **Rigger** o liner: líneas largas, finas y continuas como ramas o hierba.

Las texturas especiales dependen del momento:
- **Sal** sobre aguada húmeda-mate: estrellas claras.
- **Alcohol** sobre aguada que acaba de perder el brillo: círculos claros con halo.
- **Salpicado**: blando sobre húmedo y duro sobre seco.

### Cited Findings
- Redondo: el más versátil, «el todoterreno» que más usan los pintores. Mop: redondo grande y blando que retiene mucha agua, para aguadas y fondos sueltos, más difícil de controlar. Rigger: redondo de pelo excepcionalmente largo para líneas finas y continuas (ramas, briznas). Plano: bordes nítidos y aguadas; su punta cuadrada sirve para troncos, edificios y postes — [Paul Cheney, brush shapes](https://paulcheney.ca/watercolor-brush-shapes/); [Louise De Masi, brush shapes](https://www.louisedemasi.com/tips/2024/2/19/choosing-the-right-watercolour-brush-a-guide-to-brush-shapes); [Emily Wassell](https://www.emilywassell.co.uk/watercolour-for-beginners/supplies/watercolour-brush-types/)
- Pincel seco: se recomienda un redondo del n.º 6 u 8 o un plano arrastrado sobre papel seco — [Louise De Masi](https://www.louisedemasi.com/tips/2024/2/19/choosing-the-right-watercolour-brush-a-guide-to-brush-shapes); [Solving Watercolour, brushes](https://www.solvingwatercolour.com/what-watercolor-brushes-do-i-need/)
- **Sal**: necesita una aguada húmeda. Si está demasiado mojada, la sal se disuelve sin formar estrellas; si está demasiado seca, se pega al papel. La humedad ambiente influye. La sal gruesa da una textura más marcada que la fina — [Louise De Masi, salt](https://www.louisedemasi.com/tips/2024/10/26/experimenting-with-salt-in-watercolour-painting); [House of Watercolor, salt](http://www.houseofwatercolor.com/salt); [Paul Cheney, texture](https://paulcheney.ca/watercolor-texture/)
- **Alcohol**: el alcohol isopropílico sobre una aguada húmeda repele el pigmento y deja manchas claras con halo. Se aplica cuando la pintura ha perdido el brillo inicial pero sigue húmeda; si la aguada está demasiado mojada, se difunde sin bordes fuertes. Un alcohol más concentrado repele más — [Jerwood Visual Arts, alcohol](https://jerwoodvisualarts.org/blog/how-to-use-alcohol-drops-in-watercolor/); [Paul Cheney, texture](https://paulcheney.ca/watercolor-texture/)
- **Salpicado**: blando sobre húmedo, duro sobre seco, invisible si el papel está muy mojado. Sobre aguada seca añade textura sin alterar el color base — [Russell Collection](https://russell-collection.com/what-is-splattering-technique-in-watercolor-painting/); [Paul Cheney, texture](https://paulcheney.ca/watercolor-texture/); [Watercolor Learning Center PDF](https://www.watercolorlearningcenter.com/uploads/2/4/8/5/24852303/intro_to_watercolor-textures_whites.pdf)
- Montesdeoca incluye el **temblor de mano** (*hand tremors*) entre los efectos simulados: pequeñas irregularidades en los contornos — [Montesdeoca et al. 2016](https://dl.acm.org/doi/pdf/10.5555/2981324.2981332); [Montesdeoca et al. 2017, C&G](https://www.sciencedirect.com/science/article/abs/pii/S0097849317300316)

### Inferences
- Marcas de pincel para el motor:
  - **Redondo**: trazos que empiezan en punta, se ensanchan con la presión y terminan en punta o en un charco con borde oscuro. Ancho variable a lo largo del trazo.
  - **Plano**: rectángulos con dos bordes paralelos nítidos y extremos cuadrados; muy útiles para arquitectura.
  - **Mop**: aguadas grandes con borde ondulado y blando y un charco al final.
  - **Rigger**: líneas finas de 0,5–2 mm, largas, con temblor y adelgazamiento, que se rompen en papel rugoso.
- **Sal**: estrellas o cristales claros de unos 2–8 mm (no verificado) con bordes plumosos irregulares, solo en zonas de aguada media-oscura y húmeda. Se ven más con pigmentos no manchantes y en tonos oscuros.
- **Alcohol**: círculos claros casi perfectos con un anillo más oscuro alrededor. Con varias gotas, círculos de tamaños distintos. Visualmente es distinto de una floración, que es irregular.
- **Salpicado**: gotas de distribución log-normal con algunas alargadas en la dirección del golpe. Unas son de color y otras de agua limpia, que crean mini-floraciones claras sobre zonas húmedas.
- Combinar sal y alcohol produce patrones superpuestos ([Paul Cheney, texture](https://paulcheney.ca/watercolor-texture/)). Para que parezca real, mejor usarlo con mucha moderación y en zonas localizadas.

### Gaps
- No pude acceder a la página de handprint sobre pinceles ([brush1](https://www.handprint.com/HP/WCL/brush1.html)), que trata la fabricación y la capacidad de carga de cada forma de pincel. Tampoco encontré medidas del tamaño de las estrellas de sal ni de los halos de alcohol.
