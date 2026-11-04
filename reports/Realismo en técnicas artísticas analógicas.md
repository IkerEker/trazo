# Trazo debe obedecer la física del medio

Lo que separa un cuadro real de un filtro no es la textura de encima. Es que cada marca respeta la física de su medio y las decisiones de un pintor: pocas masas de valor, detalle solo en un foco, bordes que se pierden donde baja el contraste, capas anteriores que asoman y ningún efecto que ese medio no pueda producir. Los artistas expertos distinguen la obra humana de la imagen generada con **un ~83 % de acierto**, y lo hacen sobre todo por las incoherencias del medio, no por el estilo ([Ha et al. 2024](https://arxiv.org/abs/2402.03214)).

Trazo ya tiene la arquitectura adecuada: pintor por capas de grueso a fino, referencia que conserva los bordes, trazos y papeles escaneados, relieve con luz rasante y aguadas. Una lectura rápida del código confirma que ya implementa la carga decreciente, el pincel cargado con dos tonos, las crestas laterales y la trama visible bajo la pintura fina. Por eso el salto no vendrá de añadir texturas, sino de las reglas que las relacionan entre sí.

Las cinco palancas transversales que más rinden por su coste son:

1. Mezcla y composición sustractivas (tipo Kubelka-Munk), con recogida del color del lienzo.
2. Una sola ley de depósito según la altura del soporte, la carga y lo lleno que esté el diente. El material arrastrado va a las crestas y el pigmento que sedimenta, a los valles.
3. Relieve ligado al valor («luces gruesas, oscuros finos»), con el brillo como canal propio y sombras proyectadas cortas.
4. Todas las texturas a la escala física de un cuadro de tamaño supuesto.
5. Un «presupuesto de detalle» que gobierne el tamaño del trazo, la dureza del borde y el número de capas.

Cada técnica añade además sus propias firmas: el anillo oscuro solo donde la aguada secó con el borde anclado; el mate absoluto y los valores comprimidos del gouache; el brillo del grafito frente al negro mate del carboncillo; el diente que se llena en las ceras; el tono en tres zonas y el desregistro rígido por plancha en la xilografía.

El respaldo de todo esto es desigual. La física cualitativa y los estudios de percepción están bien documentados, pero casi todas las cifras de parámetros son inferencias que hay que calibrar con escaneos propios. Además, la red de la sesión bloqueó la lectura completa de la mayoría de las fuentes, así que el informe se apoya sobre todo en extractos de búsqueda.

## Los expertos detectan el filtro por las incoherencias del medio, no por el estilo

La prueba de percepción más directa para el problema de Trazo es reciente. Ha et al. compararon 280 obras humanas de siete estilos con 350 imágenes de cinco generadores. El público general apenas las distingue, pero **13 artistas expertos aciertan en torno al 83 %** (falsos positivos 20,78 %, falsos negativos 14,63 %). Sus pistas no son de estilo sino de material: un «boceto» que mezcla efectos de lápiz y de carboncillo que ningún dibujante combinaría, o un óleo a la vez «sucio y liso» de una forma que la pintura física no permite ([Ha et al. 2024](https://arxiv.org/abs/2402.03214)).

El mismo estudio muestra que los expertos atribuyen a la máquina los errores propios de la poca destreza humana. Para el motor esto tiene dos consecuencias:

- Cada técnica necesita reglas que impidan lo físicamente imposible.
- La «imperfección» que se añada tiene que ser la de un pintor competente (una línea que se pasa al cerrar una esquina, una capa de encaje que asoma), no ruido aleatorio.

Un resumen secundario del estudio añade que los expertos detectaban luces puestas antes que los oscuros, en contra del orden del medio húmedo. No se pudo comprobar en el texto completo.

La segunda señal es el detalle uniforme. Con seguimiento ocular, Santella y DeCarlo vieron que la mirada va a las zonas donde una abstracción conserva el detalle local, lo que según ellos «concuerda con la idea de que los artistas manipulan el detalle para controlar el interés». En cambio, con un detalle uniformemente alto o bajo, los espectadores miran tantos sitios como en la foto: el detalle uniforme no guía la mirada ([Santella y DeCarlo 2004](https://isgwww.cs.uni-magdeburg.de/~stefans/npr/entry-Santella-2004-VIN.html)).

Mould, Mandryk y Li comprobaron con 42 participantes que cinco estilos NPR comunes **amortiguan la activación y la valencia emocional** frente al original. Los datos de mirada apuntan a confusión, a artefactos que distraen y a la pérdida de detalle semántico ([Mould et al.](https://gigl.scs.carleton.ca/papers/affect-cag.pdf)). Ya en 1998 Hertzmann diagnosticó que los métodos anteriores parecían mecánicos porque usaban trazos «all of equal size and shape» ([Hertzmann 1998](https://mrl.cs.nyu.edu/publications/painterly98/)).

La tercera señal es la falta de intención. En el estudio de Hawley-Dolan y Winner, 32 estudiantes de arte y 40 de psicología prefirieron cuadros expresionistas abstractos profesionales a obras parecidas de niños o de animales. Justificaron su elección hablando de lo que el artista intentaba, incluso con las etiquetas cambiadas ([APS](https://www.psychologicalscience.org/news/study-examines-difference-between-abstract-expressionist-masterpieces-and-paintings-by-children.html)).

Chamberlain et al. documentan además un sesgo explícito contra lo que se cree hecho por ordenador, que se explica sobre todo por lo que el observador supone que un algoritmo es capaz de hacer. Según comentarios secundarios, las imitaciones de pincelada y las pequeñas imperfecciones mejoraban la valoración ([Chamberlain et al. 2018](https://research.gold.ac.uk/id/eprint/20443)).

En dibujo, Cole et al. hallaron que las líneas de distintos artistas coinciden mucho: **el 75 % cae a menos de 1 mm de la línea de otro artista**, sobre todo en los contornos de oclusión. Aun así, un 14 % no se explica por ninguna propiedad local de la imagen: son decisiones, no ruido ([Cole et al. 2008](https://pixl.cs.princeton.edu/pubs/Cole_2008_WDP/index.php)). La historia del arte usa la misma lógica para atribuir la autoría: los pentimenti, cambios de idea que quedan visibles, son más propios del autor que del copista, que tiende a reproducir sin corregir ([Wikipedia: Pentimento](https://en.wikipedia.org/wiki/Pentimento)).

La cuarta señal es la foto que se transparenta. Las fotos dan a todos los bordes la misma nitidez ([curso de pintura fotorrealista](https://rays-digitalarts-adv.netlify.app/photorealistic_painting)), oscurecen las sombras y comprimen los medios tonos; blogs de pintores estiman que con luz intensa la cámara pierde 2–3 valores ([Brad Teare](https://bradteare.com/?p=432)). Los tutoriales de Photoshop recomiendan justo bajar la opacidad del filtro sobre la foto, lo que da «foto + textura» ([Photoshop Gurus](https://www.photoshopgurus.com/forum/threads/filters-looking-like-painting.61758)).

Un preprint de 2026 que no se pudo verificar sitúa la textura como la única pista declarada por los participantes que seguía prediciendo el acierto tras controlar otras variables ([arXiv 2608.30210](https://arxiv.org/pdf/2608.30210)). Si se confirma, refuerza que la textura del soporte y del pigmento debe ser físicamente plausible y variar con el grosor, no superponerse igual en todo el cuadro.

| Señal de «filtro» | Evidencia | Regla del medio que la corrige |
|---|---|---|
| Detalle y tamaño de trazo uniformes | Santella y DeCarlo 2004; Hertzmann 1998 | Presupuesto de detalle: trazos pequeños y densos solo en el foco, grandes y escasos fuera |
| Todos los bordes con la misma nitidez | Schmid (fuente secundaria); fotos | Dureza del borde según el contraste local, la cercanía al foco y la familia de luz o sombra |
| Efecto imposible en ese medio | Ha et al. 2024 | Un validador por técnica (ej.: nada de claro opaco sobre oscuro en acuarela; empaste solo en las luces) |
| Trazos sin intención, cruzados sin lógica | Hawley-Dolan y Winner; Cole et al. | Dirección por plano o región, con poca varianza dentro y cambio claro entre planos vecinos |
| Foto debajo de una textura | Tutoriales de Photoshop | Color por trazo promediado sobre su huella, paleta limitada; en los huecos se ve la capa anterior, nunca la foto |
| Imperfección aleatoria | Ha et al. (poca destreza = IA) | Imperfección de proceso: encaje que asoma, pentimento, salidas de línea, márgenes y viñeta |

## El pintor decide antes de pintar: tres a cinco valores, un foco y bordes jerarquizados

### Las masas de valor se sueldan aunque sean objetos distintos

El primer paso de casi todos los métodos de enseñanza es reducir la escena. El notan consiste en entornar los ojos y asignar cada forma al valor más cercano de un conjunto de 2, 3 o 4 ([Virtual Art Academy](https://www.virtualartacademy.com/notan/)); con más de cuatro ya se habla de estudio de valores ([Draw Paint Academy](https://drawpaintacademy.com/notan/)).

La regla de las familias es estricta: **el valor más claro de la familia de sombra no debe ser más claro que el más oscuro de la familia de luz**, y así las formas se leen como formas ([The Drawing Source](https://www.thedrawingsource.com/light-and-form.html)).

Gurney llama «shape welding» a fundir formas vecinas de valor parecido. Pone como ejemplo *Hip Hip Hurra* de Krøyer, donde el mantel, un vestido y una figura forman un único claro sin ningún acento oscuro que lo interrumpa ([Gurney Journey](https://gurneyjourney.blogspot.ch/2008/03/kryers-hip-hip-hurra.html)). Nathan Fowkes enseña lo mismo con su «simple statement»: las masas agregadas se ven primero y condicionan la respuesta emocional ([Artist's Cheat Sheet](https://zoungyart.substack.com/p/sketching-the-view-from-the-woodshed)). La literatura de simulación hace el mismo movimiento: Bousseau et al. segmentan y suavizan morfológicamente la foto antes de aplicar cualquier efecto de acuarela ([Bousseau et al. 2006](https://artis.inrialpes.fr/Publications/2006/BKTS06)).

Para Trazo, la inferencia es clara. La segmentación debería agrupar primero por familia de valor (luz frente a sombra, con histéresis para no fragmentar) y después en 1–3 subvalores por familia, y fusionar regiones contiguas del mismo grupo aunque sean objetos distintos. Así las masas dejan de coincidir con los contornos semánticos. Dentro de la sombra conviene comprimir el rango, aclarar algo respecto a la foto y quitar detalle, que es lo contrario de lo que hace la cámara.

### La dureza del borde sigue al contraste y al foco

En un extracto de lectores de *Alla Prima*, Richard Schmid explica que en la visión periférica no percibimos bordes duros, solo cerca de donde enfocamos. Notas de alumnos lo traducen como «pon el borde más nítido cerca del punto focal» ([Art & Perception](https://artandperception.com/tag/richard-schmid)). Un borde se pierde cuando las dos formas tienen valor parecido, sobre todo si también tienen tono parecido, y se vuelve a encontrar cuando uno de los dos cambia ([Portrait Artist Forum](https://www.portraitartistforum.com/showthread.php?p=13285)).

Livingstone aporta el mecanismo perceptivo: con colores equiluminantes, el sistema sensible a la luminancia no localiza bien el borde y la forma parece vibrar ([Harvard Gazette](https://news.harvard.edu/gazette/story/2012/11/ways-of-seeing)). En acuarela, el borde perdido se consigue dejando el papel intacto o ablandando con agua limpia, y el encontrado sale de las técnicas sobre seco ([Watercolor Affair](https://www.watercoloraffair.com/?p=3171)). Hay una voz discrepante, una galería que llama cliché a los «lost and found edges» ([Artworx Gallery](https://www.artworxgallery.com.au/art-news/2017/11/10/dont-let-the-truth-get-in-the-way-of-a-good-story-b6jxp-j3nf4-5ljm6-ygdj5-nssn5-7rxm4-836xm-p265h-zx4rp-zkm7m-l5kdg-mxdlt-ljdjt-2m3az-ayekh-sbjnf-s9sg5-88pdr-4m5lj-l3dlt)), pero el consenso docente es amplio.

La regla que se deduce es inferencia propia: dureza del borde = f(contraste local de valor y tono, distancia al foco, familia de luz o sombra). Un mismo contorno debe alternar entre encontrado, blando y perdido a lo largo de su recorrido. Hay que ablandar con la propia pintura (una pincelada que cruza el borde, una aguada que se funde), nunca con un desenfoque gaussiano, que produce halos y aspecto fotográfico. No hay ninguna cifra publicada sobre la proporción de bordes duros en cuadros reales; que sean «una minoría» es una deducción.

### De grande a pequeño, los acentos al final y un último pase ancho

La regla BLAST de Gurney resume el orden canónico: *Big brushes, Large to small, Accents last, Soften edges, Take your time* ([Gurney Journey](https://gurneyjourney.blogspot.ch/2009/01/blast-rule.html)). Los acentos son «los oscuros más oscuros, las luces más brillantes y las manchas más saturadas». En óleo, gouache y caseína funcionan mejor si se dejan para el final. Gurney cita a Sargent: trabajar desde los medios tonos hacia los extremos evita los «falsos acentos». En la acuarela transparente, en cambio, los blancos se planifican desde el principio ([Gurney Journey](https://gurneyjourney.blogspot.ch/2017/06/what-is-blast-rule.html)), y por eso se pinta de claro a oscuro ([Watercolor Affair](https://www.watercoloraffair.com/watercolor-painting-light-to-dark-watercolor-cookies/)).

Los retratos inacabados de Sargent matizan algo importante para el motor:

- Las primeras capas se hicieron con pinceles de **¼" y ½" (~6 y ~13 mm)**.
- **«The boldest, broadest strokes were used for finishing»**: las pinceladas más anchas y audaces se usaron para terminar ([Keene Wilson](https://www.keenewilson.com/page/2947/john-singer-sargents-painting-techniques)).

Otro pintor describe la misma secuencia: encajar con pincel grande, afinar los bordes con uno pequeño y volver sobre lo húmedo con el grande para simplificar ([Joe Granski](https://www.joegranski.com/art-education/on-brushwork)). En Sorolla, las caras están resueltas con cuidado y el entorno simplificado, y el pincel del pelo es mucho mayor que el de la cara ([Streamline Publishing](https://streamlinepublishing.com/inside-art/a-close-brush-with-sorolla/)).

El pintor por capas de Trazo sigue a Hertzmann: pinceles de radio decreciente que solo pintan donde el lienzo difiere de la referencia más allá de un umbral, con lo que la capa gruesa queda visible donde no hace falta detalle ([Hertzmann 1998](https://mrl.cs.nyu.edu/publications/painterly98/)). Las fuentes de taller añaden tres cosas que ese esquema no tiene, y las tres son inferencias aplicables:

- **Un pase final** de pocas pinceladas anchas que simplifiquen en las zonas no focales (ropa, fondo, pelo).
- **Acentos en número muy pequeño**, al final y cerca del foco.
- **Tamaños de pincel en unidades físicas.** Para un retrato de 60–80 cm, 6–13 mm es ~1–2 % del ancho; el detalle focal iría con 2–4 mm y el fondo con 20–40 mm.

### La dirección se decide por planos y el color por relaciones

La pincelada «va con la forma» ([WetCanvas](https://www.wetcanvas.com/forums/topic/any-tips-on-painting-alla-prima/page/2)), pero muchas pinceladas iguales en la misma dirección son «una receta para el arte aburrido» ([EmptyEasel](https://emptyeasel.com/?p=4550)). Los datos de artistas reales dan la estructura:

- **Rayado (Kalogerakis et al.):** su orientación la dominan las curvaturas principales y los ejes de simetría local ([Kalogerakis et al. 2012](https://kalo-ai.github.io/papers/MLHatching/index.html)).
- **Pinceladas de Van Gogh:** el análisis estadístico de miles de ellas las describe como «strongly rhythmic», de forma regular y densamente dispuestas en patrones repetidos ([Li et al., IEEE TPAMI 2012](https://katalog.dhi-paris.fr/vufind/Record/NLM21713548X/Description)).
- **Forma del pincel:** decide la firma del trazo. Los planos de Carol Marine le dan bordes de corte recto y aspecto moderno; otros pintores usan filberts para un aspecto más orgánico ([Seattle Artist League](https://www.seattleartistleague.com/2018/09/29/daily-painters-carol-marine/)).

La inferencia es orientar por plano o región, con poca varianza angular dentro de cada masa y un cambio claro entre planos vecinos. El «trazo que cruza al azar» rompe la unidad.

En color, el pintor no copia la foto. Gurney propone pensar en «luz cálida, sombra *más* fría» y no en reglas absolutas ([Gurney Journey](https://gurneyjourney.blogspot.com/2017/07/relative-color-temperature-on-skin-tones.html?m=0)), y limita la gama con una máscara sobre la rueda de color ([Gurney Journey](https://gurneyjourney.blogspot.com/2011/09/part-3-gamut-masking-method.html)). Livingstone explica que el sol de *Impression, soleil levant* «vibra» porque tiene la misma luminancia que el cielo, y que los impresionistas usaban manchas equiluminantes para el rielar del agua ([Harvard Gazette](https://news.harvard.edu/gazette/story/2012/11/ways-of-seeing)). No todos aceptan la explicación completa ([WashU](https://artsci.washu.edu/node/2115)).

La regla derivada para el motor:

- Proyectar los colores en una gama limitada.
- Desplazar la temperatura de la sombra respecto a la luz, no en absoluto.
- Dentro de una masa clara, variar las pinceladas vecinas más en matiz y croma que en valor.

## Una ley de depósito, una de luz y una de mezcla explican casi todas las superficies

### La marca cae primero en las crestas; el pigmento húmedo, en los valles

El hallazgo transversal más sólido de las siete líneas de investigación es que **casi todas las técnicas depositan material según la altura del soporte**:

- **Óleo con pincel seco:** al arrastrarlo sobre empaste, «the dry paint attaches only to the upper ridges of paint, allowing the previously applied color to remain visible in the valleys» ([University of Delaware](https://www1.udel.edu/artfoundations/beg_painting/techniques.html)).
- **Acuarela con pincel seco:** el pigmento se queda en las crestas del papel rugoso, salta los valles y deja motas blancas; necesita pincel y papel secos ([Painting with Watercolors](https://www.paintingwithwatercolors.com/dry-brush-technique-watercolor-paintings)).
- **Gouache con pincel seco:** «skips across the surface, catching on the raised texture» ([Painters Online](https://www.painters-online.co.uk/tips-techniques/gouache/articles/an-introduction-to-painting-in-gouache/)).
- **Grafito:** con presión ligera, las crestas recogen casi todo y los valles quedan vacíos; más presión o más pasadas rellenan los valles ([Pencilbrush](https://www.pencilbrush.com/blog/paper-tooth-graphite-vs-ink/)). La presión fuerte aplasta el diente, y entonces el papel deja de aceptar más pigmento ([Virtual Instructor](https://thevirtualinstructor.com/blog/colored-pencil-techniques-a-practical-guide)).
- **Ceras (modelo de Rudolf, Mould y Neufeld):** el papel es un campo de alturas. La barra es una máscara que se desgasta, y lo depositado depende de la fuerza y de la fricción propia de cada papel. La cera se empuja de las crestas a los valles ([Rudolf et al. 2003](https://ieeexplore.ieee.org/document/1238258/)), y en la versión de 2005 la barra también arranca cera ya depositada y la redeposita en otro sitio ([Rudolf et al. 2005](https://people.scs.carleton.ca/~mould/papers/crayon-cgf.pdf)).
- **Grabado en relieve:** un papel demasiado texturado rompe las líneas ([Artbeatbox](https://www.artbeatbox.com/blog/the-complete-guide-to-linocut-printmaking)).

La acuarela húmeda invierte el signo. La granulación es el depósito desigual de partículas grandes que **se asientan en los valles** del papel. Es una propiedad del pigmento que el papel rugoso y el exceso de agua amplifican ([The Watercolourist](https://thewatercolourist.com/materials/granulating-pigments/)), y los modelos de Curtis y sus derivados la ponderan con un mapa de granulación del papel ([WPI](https://davis.wpi.edu/~matt/courses/watercolor/rendering.html)).

La inferencia de diseño es una sola función para todo el motor: `cobertura = smoothstep(umbral(carga, presión, pasadas), umbral + ancho, h(x))`, con `h` la altura del papel o lienzo escaneado. Los medios arrastrados (pincel seco, lápiz, cera, pastel, tinta de grabado) leen `h` y los que sedimentan (granulación) leen `1 − h`. Además hay que llevar un mapa acumulado de relleno del diente: cuando se acerca a 1, los depósitos nuevos bajan y empiezan a arrastrar lo de abajo, en lugar de sumarse.

Murakami et al. proponen una mejora fiel al medio real: escanear el papel iluminado desde varias direcciones y usar como máscara de depósito la imagen cuya luz coincide con la dirección del trazo, porque el pigmento se agarra más a la cara del grano que mira contra el avance ([Murakami et al. 2006](https://isgwww.cs.uni-magdeburg.de/~stefans/npr/entry-Murakami-2006-NLS.html)). Con un solo escaneo se puede aproximar con el producto entre el gradiente de `h` y la dirección del trazo.

La segunda variable universal es **la carga, que decae a lo largo del trazo**. Handprint lo describe en acuarela con una frase que vale para cualquier pincel que se vacía: «at the start of the stroke, the paint will be dark and thick, and at the end the paint will be faint, uneven and scratchy» ([handprint](https://www.handprint.com/HP/WCL/tech18.html)). Unir carga y umbral produce a la vez el pincel seco, el scumble, el color roto y la cola arañada, sin efectos separados.

### El relieve sigue al valor y el brillo es un canal aparte

**Cuánto relieve hay de verdad:**

- **Escala.** En escaneos de dos cuadros «al estilo de Van Gogh», el mapa de alturas varía **como máximo 1,1 mm** ([Elkhuizen et al.](https://arxiv.org/pdf/1910.10836)). Un blog atribuye a un estudio de perfilometría 0,5–5 mm para el empaste «heavy body», cifra que no se pudo verificar en la fuente primaria ([Montcarta](https://montcarta.com/blogs/art-guide-inspiration/impasto-shadows-dynamic-wall-art-depth)).
- **Forma.** El análisis de Van Gogh documenta «crestas de pintura que fluyen hacia los bordes de la pincelada» ([Johnson et al. 2008](https://ericpostma.nl/publications/Johnsonetal2008.pdf), solo extracto). Un pintor que observó de cerca sus cuadros señala que en los toques de flores había tanta pintura que no quedó marcada ninguna cerda ([Brad Teare](https://bradteare.com/195-the-genius-of-van-gogh-part-1/)).
- **Dónde.** En *Los girasoles*, la pintura es más gruesa en los toques repetidos de las cabezas de semillas ([National Gallery](https://www.nationalgallery.org.uk/paintings/vincent-van-gogh-sunflowers)).

La regla de taller «luces gruesas, oscuros finos» va junto a «graso sobre magro» ([Hudson Studio](https://thomasparkerhudson.com/wordpress/2022/12/transparent-earth-colors/)). Un oscuro grueso refleja la luz en sus crestas y «adelanta» la zona, lo que contradice su función de hueco ([My French Easel](https://myfrencheasel.blogspot.com/2008/06/thick-lights-over-thin-darks.html)).

Con 1 px ≈ 0,1–0,3 mm en un cuadro de 50–80 cm, el relieve total equivale a unos pocos píxeles. Las normales deben salir de pendientes suaves con crestas finas, no de un bump exagerado (inferencia).

El brillo es independiente del relieve. Para reproducir un cuadro con impresión 3D hubo que capturar por separado **color, brillo y topografía** ([Elkhuizen et al., ACM TAP](https://dl.acm.org/doi/fullHtml/10.1145/3317949)). El barniz brillante aumenta la saturación y el contraste porque «moja» las microirregularidades ([Berns y de la Rie](https://www.researchgate.net/publication/272252901_The_Effect_of_the_Refractive_Index_of_a_Varnish_on_the_Appearance_of_Oil_Paintings)), y el mate aclara los oscuros y baja la saturación ([Natural Pigments](https://www.naturalpigments.com/mediums-grounds/varnishes.html)). El óleo sin barnizar seca con brillo desigual porque cada pigmento absorbe distinta cantidad de aceite («sinking in») ([Opus/Gamblin](https://opusartsupplies.com/en-us/blogs/resource-library/why-should-i-varnish-my-painting)).

Por medios, el brillo va así:

| Medio | Brillo | Fuente |
|---|---|---|
| Óleo | El más brillante de las pinturas | [Wikipedia: Acrylic paint](https://en.wikipedia.org/wiki/Acrylic_paint) |
| Acrílico | Suele ser satinado | [Wikipedia: Acrylic paint](https://en.wikipedia.org/wiki/Acrylic_paint) |
| Gouache | Mate | [Wikipedia: Gouache](https://en.wikipedia.org/wiki/Gouache) |
| Grafito | Brilla en los oscuros bruñidos | [Vitruvian Studio](https://vitruvianstudio.com/blog/going-dark-with-a-new-kind-of-pencil/) |
| Carboncillo | Absorbe la luz, sin reflejos | [Art Supplies UK](https://www.artsupplies.co.uk/blog/what-is-the-difference-between-graphite-and-charcoal/) |
| Cera bruñida | Lisa y brillante | [Squiggle Press](https://squiggle-press.com/burnishing-colored-pencils/) |

Un mapa de brillo por medio y por grosor distingue materiales a igual relieve. Es una inferencia directa de lo anterior.

**Cómo se ve la foto de un cuadro.** La luz rasante acentúa el empaste, y las guías de documentación recomiendan añadirla en los cuadros con mucha textura ([Wikipedia: Raking light](https://en.wikipedia.org/wiki/Raking_light)). La polarización cruzada elimina los reflejos, pero aplana el empaste y oscurece las sombras; hay fotógrafos que giran un poco el filtro para recuperar algún reflejo en las crestas ([Easy Oil Painting Techniques](https://www.easy-oil-painting-techniques.org/photograph-art.html)).

De ahí salen dos modos de render verosímiles, y la inferencia es que no hay un tercero:

- **«Museo/polarizado»:** especular casi nulo; el relieve se lee por sombras suaves.
- **«Estudio»:** destellos discretos solo en las crestas orientadas a la luz.

Un especular difuso repartido por toda la superficie no corresponde a ninguno de los dos. En el método de Hertzmann, las normales salen del campo de alturas combinado, de modo que **las fronteras entre trazos aparecen como bordes iluminados** ([Hertzmann 2002](https://www.dgp.toronto.edu/papers/ahertzmann_NPAR2002.pdf)). Es la propiedad que da a la superficie su lectura de «pinceladas superpuestas».

### El soporte se ve solo donde la pintura es fina, y a escala física

El recuento automático de hilos sobre radiografías de más de 300 cuadros de Van Gogh da valores típicos de **~12–17 hilos/cm, con densidades distintas en urdimbre y trama**. El algoritmo acierta con un margen de ±0,5 hilos/cm el 84 % de las veces ([Johnson et al., Cornell](https://people.ece.cornell.edu/johnson/pubLinxAH/SP-93-13)). *Los girasoles* miden 11,5 × 17,2 hilos/cm y el lienzo de «Elimar», 11,0 × 10,4 ([LMI Group](https://www.lmigroupintl.com/project-highlights/analyzing-the-elimar-canvas-weave)). El lino tiene variaciones naturales del grosor del hilo ([Canvas Etc](https://www.canvasetc.com/linen-canvas-fabric/)) y el algodón es más grueso y regular ([HelloArtsy](https://helloartsy.com/canvas-linen-vs-cotton/)).

El cálculo es inferencia sobre datos citados. Un paso de 0,6–1,0 mm, en un cuadro de 60 cm representado con 3000 px, da **~3–5 px por hilo**. Una trama de 10–20 px se lee como arpillera, no como lienzo de pintor. Un patrón simétrico y regular delata lo sintético: hay que usar frecuencias distintas en x e y y variación de grosor hilo a hilo.

La visibilidad de la trama debe caer con el grosor de la pintura. Donde la pintura es fina (sombras, veladuras, imprimatura), la trama se ve en el relieve y en el color, porque el pincel seco solo toca la cresta del hilo. Bajo el empaste desaparece.

Lo que asoma entre pinceladas casi nunca es blanco. La imprimatura es una mancha fina y transparente que se deja visible en zonas del cuadro acabado ([Methods.art](https://methods.art/journal/grisaille-and-underpainting)), y un fondo entonado aporta un medio tono «gratis» en toda zona sin pintar ([WetCanvas](https://www.wetcanvas.com/forums/topic/imprimatura-vs-grisaille-or-both/)).

En papel ocurre lo mismo con otra firma. Cada tipo tiene su textura:

- **Mi-Teintes:** cara en panal de abeja ([Canson](https://us.canson.com/artist-series-mi-teintesr)).
- **Ingres:** líneas verjuradas finas y líneas de cadena, que se marcan más donde hay medio ([Jackson's](https://www.jacksonsart.com/blog/?p=1419947)).
- **UART:** lija en grados de 240 a 800 ([Soft Pastels AU](https://www.softpastels.com.au/pastel_paper/uart/uart.php)).
- **Papel de acuarela:** satinado (prensado en caliente), grano fino (prensado en frío) y rugoso ([Paul Rubens](https://www.paulrubensshop.com/blogs/knowledge/hot-press-vs-cold-press-watercolor-paper-full-comparison)).

### Los colores se mezclan como pigmentos, no como luz

Curtis et al. componen cada aguada con Kubelka-Munk, con coeficientes de absorción y dispersión por pigmento ([WPI](https://davis.wpi.edu/~matt/courses/watercolor/rendering.html)). RealPigment parte de una constatación: la mezcla alfa en RGB no reproduce el aspecto de la pintura. Su ajuste paramétrico KM, calibrado con la foto de una carta de mezclas real, generaliza mejor que una interpolación arbitraria ([Adobe Research](https://research.adobe.com/publication/realpigment-paint-compositing-by-example)).

Hay dos implementaciones listas:

- **Mixbox** modela los colores como pigmentos con KM y tiene versión JavaScript, pero **su licencia es CC BY-NC 4.0** y el uso comercial exige otra licencia ([GitHub scrtwpns/mixbox](https://github.com/scrtwpns/mixbox)).
- **spectral.js**, con **licencia MIT**, implementa KM de una constante con siete canales base y mezcla de N colores ([npm spectral.js](https://npmjs.com/package/spectral.js)).

El comportamiento físico que hay que reproducir es concreto. Mezclar húmedo sobre húmedo agrisa ligeramente ([Will Kemp](https://willkempartschool.com/how-to-paint-like-monet-part-2/)). Una veladura azul sobre blanco sale luminosa y saturada, y sobre un marrón oscuro, profunda y apagada. La linaza tiene un índice de refracción de ≈1,48, y los pigmentos con índice cercano (ftalocianinas, dioxazina, perileno) son transparentes y sirven para velar ([Natural Pigments](https://www.naturalpigments.com/artist-materials/preparing-oil-paint-glazes)). Donde dos aguadas se solapan, el resultado es más oscuro y el contorno de cada una sigue visible ([Montesdeoca et al. 2017](https://diglib.eg.org/items/1f77ad01-7118-4a6d-9aea-d4904f850565)).

## Cada técnica tiene firmas medibles que un filtro no reproduce

### Óleo y acrílico con pincel: carga, crestas y la capa de abajo

La pincelada de óleo es asimétrica a lo largo de su recorrido: empieza cargada y opaca y acaba fina y arañada.

**La forma de la punta decide el borde:**

| Pincel | Marca que deja |
|---|---|
| Plano | Borde cuadrado y nítido; de canto, líneas finas |
| Bright | Plano de pelo corto. Aguanta pintura pesada y, en húmedo sobre húmedo, puede **arrastrar la capa de debajo** en vez de añadir |
| Filbert | Extremos ovalados, sin esquina |
| Redondo | Punta afilada |

Fuente: [Paul Rubens shop](https://www.paulrubensshop.com/blogs/knowledge/oil-painting-brushes).

**El pelo importa tanto como la forma.** La cerda de cerdo tiene puntas abiertas que retienen la pintura espesa, y la forma y el material son decisiones separadas ([Trekell](https://www.trekell.com/blogs/experience/hog-bristle-brushes)). La cerda rígida también retira pintura y deja ver la capa inferior aquí y allá ([University of Delaware](https://www1.udel.edu/artfoundations/beg_painting/techniques.html)).

**Hay dos clases de pincelada.** Gurney distingue las pinceladas emergentes, que «sit up on the surface, catching the light», de las embebidas, fundidas con la pintura ([International Artist](https://www.internationalartist.com/issues/165/Brush-It-Off)).

**El color dentro del trazo no es uniforme.** Cargar cada lado del plano con un color distinto da una gama de tonos en una sola pincelada ([Canvaslot](https://blog.canvaslot.com/learn-oil-painting-technique-broken-color/)), y arrastrar un pincel con dos o tres colores mezcla en el lienzo y no en la paleta ([WetCanvas](https://www.wetcanvas.com/forums/topic/what-is-meant-by-broken-color/)).

**Alla prima frente a pintura indirecta:**

- **Alla prima.** Sargent pintaba «una cosa dentro de otra», no lado a lado hasta que se tocan ([Citizen Sketcher](https://citizensketcher.com/top-posts/jss-watercolor/)).
- **Indirecta.** Construye el valor en una grisalla seca y después la cubre con veladuras transparentes y scumbles ([Methods.art](https://methods.art/journal/grisaille-and-underpainting)). El scumble es una capa opaca de pincel seco que deja asomar lo de debajo ([Hawaii.edu](http://www2.hawaii.edu/~kloe/123/Art123%20terms/painting%20terminology.html)).

**Acrílico frente a óleo.** El aglutinante acrílico es blanquecino en húmedo y transparente en seco, así que el color se oscurece al secar; además, la película encoge y el acabado típico es satinado ([Art by Cedar Lee](https://www.artbycedar.com/oils-vs-acrylics-what-are-the-differences-which-should-you-choose-and-why/)).

**Reglas de render (inferencias):**

- **Perfil transversal.** Meseta central con estrías paralelas al trazo, cuya amplitud disminuye al subir la carga, y dos crestas laterales que crecen con la carga.
- **Pincel que se ensucia.** En alla prima, el color depositado se va mezclando con el del lienzo a lo largo del trazo, también entre colores distintos, con agrisado KM en lugar de barro RGB.
- **Pintura indirecta.** Transiciones más lisas, oscuros más profundos y relieve concentrado en los puntos de luz.
- **Acrílico.** Relieve más bajo y redondeado, menos especular y valores algo más oscuros que el óleo equivalente.

### Espátula: planos lisos, crestas afiladas y raspado

La espátula deposita pintura «without the repeated hair marks of a brush», y sus crestas gruesas «catch highlights and create shadows» ([ArtWeb](https://blog.artweb.com/how-to/artists-palette-painting-knives/)). La pintura fluida se escurre de la hoja y pierde las crestas. En acrílico se recomienda mezclar gel o pasta de modelar a ~1:1 para que los picos se mantengan afilados ([Paul Rubens shop](https://www.paulrubensshop.com/blogs/knowledge/palette-knife-oil-painting-paint-thickness-surfaces-and-starter-mistakes)).

El esgrafiado y el raspado son usos sustractivos: el canto de la hoja quita pintura y revela las capas anteriores ([PastPaperHero](https://www.pastpaperhero.com/resources/edexcel-a-level-applied-art-and-design-9711-materials-processes-and-technology-in-fine-art-tools-for-applying-paint)). Para el motor esto implica que la espátula también debe poder **restar** altura y color. Además, el plano debe salir casi sin estrías, con una cresta afilada donde se levanta la hoja y «transparencias» donde raspó.

### Acuarela: el agua decide el borde

**El borde lo decide la humedad del papel en el momento del toque.** El papel pasa de brillante a satinado, de ahí a húmedo-mate y por último a seco:

| Estado del papel | Qué hace la pintura |
|---|---|
| Brillante | Se expande rápido en floraciones suaves |
| Satinado | Fundidos controlables |
| Húmedo-mate | Zona de riesgo: el papel absorbe el agua nueva y empuja la pintura asentada |
| Seco | Bordes duros |

Fuentes: [Watercolor Affair](https://www.watercoloraffair.com/why-timing-matters-more-than-technique-in-watercolor-the-water-cycle/); [Café Watercolor](https://cafewatercolor.com/blog/113). La regla práctica es «igual o menos agua»: un pincel más húmedo que el papel produce floración, y uno más seco funde sin ella ([Watercolor Affair](https://www.watercoloraffair.com/watercolor-blooms-turning-mistakes-into-success/)).

**El oscurecimiento de borde tiene física publicada en *Nature*.** El anillo se forma porque la línea de contacto queda anclada. El líquido que se evapora en el borde se repone con líquido del interior, y ese flujo puede llevar casi todo el material disperso al perímetro. Hacen falta tres condiciones: ángulo de contacto no nulo, borde anclado y evaporación ([Deegan et al. 1997](https://www.nature.com/articles/39827)). Curtis et al. lo trasladan a la acuarela: el encolado y la tensión superficial impiden que la pincelada se extienda, y el pigmento migra hacia los bordes ([Curtis et al. 1997](https://www.cs.princeton.edu/courses/archive/fall00/cs597b/papers/curtis97.pdf)).

De ahí se deducen reglas que no están medidas:

- El anillo aparece en lo pintado sobre seco y apenas en lo húmedo sobre húmedo (borde no anclado) o en el pincel seco (no hay película de agua).
- Es una banda interior al contorno, con el interior algo más claro porque el pigmento se ha ido al borde.
- No es uniforme: se interrumpe y engrosa con el agua y con el grano.
- Las veladuras superpuestas muestran cada una su propio contorno.

Una banda de ancho constante tipo diferencia de gaussianas, como la de Montesdeoca et al. ([Montesdeoca et al. 2016](https://dl.acm.org/doi/pdf/10.5555/2981324.2981332)), es justo lo que hay que modular para que no delate lo digital.

**Las floraciones dejan centro pálido y borde oscuro.** Se forman cuando agua o pintura más húmeda entra en una aguada que ya empieza a secar. Queda un centro pálido y un **borde oscuro, duro, irregular y ramificado** ([Paul Cheney](https://paulcheney.ca/backruns-and-blooms/)). Si lo que entra es pintura se habla de *backrun*; si es agua, de *bloom* ([Watercolor Affair](https://www.watercoloraffair.com/watercolor-blooms-turning-mistakes-into-success/)). El charco que se acumula en el borde inferior de una aguada refluye al secar y es su origen más típico ([Watercolor Affair](https://www.watercoloraffair.com/9-reasons-why-your-watercolor-washes-look-streaky/)). Una floración realista no es un círculo: sigue la pendiente y se detiene en las zonas ya secas (inferencia).

**Granulación y manchado son propiedades del pigmento, e independientes.** Granulan el ultramar, el cobalto, el manganeso, el cerúleo y las tierras; los ftalos y el azul de Prusia no granulan, pero manchan ([Jane Blundell](https://www.janeblundellart.com/characteristics-of-watercolour.html)). El viridián granula y no mancha, y el verde ftalo hace lo contrario ([Light Sculpture](https://www.light-sculpture.com/2025/10/10/%F0%9F%8E%A8-the-secret-lives-of-pigments-a-watercolorists-guide-to-staining-granulation-transparency-lightfastness/)). Curtis et al. agrupan la granulación con la separación de pigmentos en las mezclas, que se disocian en motas de colores distintos ([Curtis et al. 1997](https://www.cs.princeton.edu/courses/archive/fall00/cs597b/papers/curtis97.pdf)).

Para una foto, esto se traduce en asignar coeficientes por familia de tono:

- Azules de cielo y sombras frías: alta granulación.
- Tierras: granulación media o alta.
- Verdes y azules intensos: lisos.
- Grises de sombra: separación en dos motas desfasadas, que es una firma muy reconocible y barata.

**Veladuras, blancos y bordes entre zonas.**

- **Veladuras.** Funcionan porque la luz atraviesa capas finas y se refleja en el papel blanco ([Paul Rubens](https://www.paulrubensshop.com/blogs/knowledge/watercolor-glazing)). Cada capa debe estar completamente seca ([Jenna Rainey](https://jennarainey.com/watercolor-glazing/)).
- **Número de capas.** La única cifra (3–4 antes del «barro») viene de un blog que no se pudo identificar con seguridad.
- **Blancos.** Son papel reservado, nunca pintura ([Watercolor Affair](https://www.watercoloraffair.com/watercolor-painting-light-to-dark-watercolor-cookies/)).
- **Bordes entre zonas.** Montesdeoca et al. tratan los *gaps* (huecos blancos entre zonas vecinas) y los *overlaps* (solapes más oscuros) como efectos característicos ([Montesdeoca et al. 2017](https://diglib.eg.org/items/1f77ad01-7118-4a6d-9aea-d4904f850565)). Bousseau et al. desplazan el contorno según el gradiente de la textura del papel («wobbling») ([Bousseau et al. 2006](https://artis.inrialpes.fr/Publications/2006/BKTS06)).

**Proceso y efectos finales.** La viñeta usa el papel sin pintar como parte del diseño, con bordes que unas veces se funden con el blanco y otras se cortan ([Dennis Pendleton](https://www.dennispendletonstudio.com/single-post/painting-a-vignette)). La sal necesita una aguada húmeda, ni muy mojada ni seca ([Louise De Masi](https://www.louisedemasi.com/tips/2024/10/26/experimenting-with-salt-in-watercolour-painting)). El alcohol se aplica cuando la aguada ha perdido el brillo y deja círculos claros con halo ([Jerwood Visual Arts](https://jerwoodvisualarts.org/blog/how-to-use-alcohol-drops-in-watercolor/)). La salpicadura sale blanda sobre húmedo y dura sobre seco, y suele ir al final ([Russell Collection](https://russell-collection.com/what-is-splattering-technique-in-watercolor-painting/)).

**El papel también cuenta.** El encolado controla cuánto tarda en entrar el agua ([Cursa](https://cursa.app/en/page/watercolor-paper-weight-texture-and-how-paper-changes-your-washes)). Un papel de 300 g/m² acepta una aguada ligera, pero hay que tensarlo para técnicas húmedas ([Jackson's](https://www.jacksonsart.com/art-techniques/paper-stretching)).

### Gouache: mate, valores comprimidos y capas que se ensucian

El gouache lleva más pigmento y menos goma arábiga que la acuarela. Eso lo hace más opaco y reflectante y lo deja mate al secar ([Wikipedia: Gouache](https://en.wikipedia.org/wiki/Gouache)). Algunos fabricantes añaden cargas inertes como el blanc fixe o la creta ([Natural Pigments](https://www.naturalpigments.com/artist-materials/gouache-paint-recipe)).

**Al secar comprime los valores: los claros se oscurecen y los oscuros se aclaran** ([Wikipedia: Gouache](https://en.wikipedia.org/wiki/Gouache)). Gurney lo cuenta entre sus siete riesgos del gouache ([Gurney Journey](https://gurneyjourney.blogspot.ch/2015/06/the-seven-gouache-hazards-and-how-to.html)). La causa física probable es el aire entre partículas en una película con poco aglutinante, que dispersa la luz ([Laurie](https://issuu.com/amantesdelapintura/docs/paintersmethodsm00lauruoft/118)). Ninguna fuente cuantifica el cambio, así que el rango (por ejemplo, L* entre ~12 y ~94) es un parámetro a ajustar.

**Sigue siendo soluble en agua.** Las capas nuevas levantan las de abajo y ensucian el color; una mezcla más seca y opaca perturba menos ([blog de capas en gouache](https://beige-triceratops-wztm.squarespace.com/blog/layering-problems)). Gurney observa que el gouache sobre acuarela seca puede quedar como «a kind of grey semi-transparent layer» ([Gurney Journey](https://gurneyjourney.blogspot.com/2018/09/streetcorner-sketching-in-watercolor.html)). El gouache acrílico no se rehumecta y admite capas limpias ([Opus](https://opusartsupplies.com/blogs/resource-library/acrylic-gouache-vs-traditional-gouache)), así que conviene un parámetro «aglutinante» que active o desactive la contaminación. Para el tradicional, mezclar entre un 5 y un 20 % del color de abajo en un trazo claro es una cifra inferida.

**Proceso y pincelada.** Gurney trabaja «from wet application first to drybrush later; big areas to small shapes» ([Gurney Journey](https://gurneyjourney.blogspot.com/2020/03/questions-about-gouache-painting.html)), y deja las luces para el final («Highlights are like dessert», [Gurney Journey](https://gurneyjourney.blogspot.com/2017/02/highlights-are-like-dessert.html)). Para un plano liso la pintura se diluye a «heavy cream». Las estrías vienen sobre todo de usar muchos trazos pequeños, y lo correcto es cubrir el plano en 2–3 pasadas ([Common gouache mistakes](https://beige-triceratops-wztm.squarespace.com/blog/common-gouache-mistakes-and-how-to-fix-them)).

**Referentes de estilo.** Los fondos Disney se pintaban con gouache Winsor & Newton en capas gruesas para poder fundir con pinceles difuminadores ([Animation Backgrounds](https://animationbackgrounds.blogspot.com/2009/04/question-and-answer.html)). Mary Blair pintaba planos de color sin sombreado, con profundidad por superposición y pincel seco para las texturas ([Made Good Designs](https://madegooddesigns.com/mary-blair/)). Su opacidad permite pintar sobre papel tintado y dejar el tono del papel como medio tono ([Art in Context](https://artincontext.org/how-to-use-gouache-paint/)).

**Reglas de render (inferencias):**

- Mate absoluto, sin ningún especular.
- Tintes claros con menos croma y un ligero desplazamiento frío («calcáreo»).
- Bordes duros entre planos que alternan rendijas de papel y solapes cargados.
- Pincel seco como umbral sobre la altura del papel.

### Mixta lápiz + gouache: contraste mate-brillo y construcción visible

**Lápiz debajo.** El gouache fino deja ver el lápiz y hacen falta 2–3 manos para que desaparezca ([CYPaint](https://cypaint.com/article/how-to-paint-over-a-pencil-drawing)). El grafito además «migra» hacia la superficie con la mayoría de medios ([WetCanvas](https://www.wetcanvas.com/forums/topic/under-drawing-for-gouache)).

**Lápiz encima.** El orden inverso es igual de auténtico. La superficie mate del gouache seco acepta casi todos los medios de dibujo, y se habla de «overdrawing» ([International Artist](https://www.internationalartist.com/issues/152/Paint-First-Then-Draw)). Gurney alterna gouache y lápiz de color en las fases finales, «weaving light over dark and dark over light» ([Gurney Journey](https://gurneyjourney.blogspot.com/2016/01/using-gouache-with-colored-pencils.html)). Un flujo típico de urban sketching es encaje a lápiz, gouache y detalles con lápiz de color ([Skillshare](https://www.skillshare.com/en/classes/urban-sketching-how-to-draw-a-street-with-gouache-and-colored-pencils/661685877)).

**El brillo.** El grafito es reflectante por naturaleza ([WetCanvas](https://www.wetcanvas.com/forums/topic/pencils-darks-shine)), y al fotografiar dibujos aparecen «bright patches and washed-out dark tones» ([Unique Photo](https://www.uniquephoto.com/community/qa/how-can-i-photograph-pencil-drawings-without-bright-patches-and-washed-out-dark-tones)). La inferencia central para esta técnica es que **el contraste entre el gouache mate y el grafito ligeramente brillante y nunca negro** es la firma que la separa de un lápiz digital multiplicado sobre color.

**Reglas de render (inferencias):**

- **Visibilidad del grafito bajo la pintura.** Inversa a la opacidad local, con un 3–8 % de «fantasma» incluso bajo pintura media.
- **Líneas encima.** El grafito se engancha en el diente y en el relieve de la pintura.
- **Construcción a la vista.** Las líneas de construcción sobreviven fuera de las zonas pintadas.
- **Estética de cuaderno.** El color se concentra en el centro de interés; lo secundario queda solo a lápiz, y la mancha no sigue exactamente el dibujo (desregistro entre línea y color).

### Grafito y carboncillo: el grafito nunca llega al negro

**Durezas.** La dureza la fija la proporción de grafito y arcilla. Las minas H son claras, finas y «arañan»; las B son oscuras, se emborronan y pierden la punta ([Eckersley's](https://www.eckersleys.com.au/blogs/learn/what-are-pencil-grades)).

**Brillo.** Incluso con un 8B los oscuros «no llegan a ser oscuros»: el brillo hace que las sombras parezcan más claras y aumenta al acumular capas ([Vitruvian Studio](https://vitruvianstudio.com/blog/going-dark-with-a-new-kind-of-pencil/)). La presión fuerte aplana y pule el diente, y como la arcilla es mate, las minas duras brillan menos ([Vitruvian Studio](https://vitruvianstudio.com/blog/3-ways-to-reduce-graphite-shine-in-your-drawings/)).

**Carboncillo.** El de vid o sauce es gris, polvoriento y se borra casi entero. El comprimido da negros profundos que se incrustan en el diente ([Drawingbyte](https://drawingbyte.com/vine-charcoal-vs-compressed-charcoal/)), y la goma moldeable lo levanta peor que al de vid ([Fiveable](https://fiveable.me/drawing-foundations/key-terms/compressed-charcoal)). Sobre papel tintado, el papel hace de medio tono: el carbón va debajo y el blanco encima, porque pastel blanco ceroso sobre carbón da un tono sucio y azulado ([Fine Art Tutorials](https://finearttutorials.com/guide/toned-drawing/)).

**Tono y línea en tres modelos de investigación:**

- **Lu, Xu y Jia** modelan el tono de dibujos reales en tres capas: luces sin dibujar, medios con presión variable y oscuros densos ([CUHK](https://www.cse.cuhk.edu.hk/leojia/projects/pencilsketch/pencil_drawing.htm)).
- **AlMeraj et al.** muestran que en una línea real la anchura varía del inicio al final y el gris sigue a la anchura. Sus líneas sintéticas, basadas en el movimiento del brazo, fueron indistinguibles de las reales en pruebas con usuarios ([AlMeraj et al. 2009](https://tobias.isenberg.cc/personal/papers/Meraj_2009_AMU.pdf)).
- **Sousa y Buchanan** modelan la mina, el papel, el difumino y la goma a partir de la observación ([Eurographics](https://diglib.eg.org/items/0f0d430c-7ac9-4aba-b96a-77bb6836cbc4)).

**Rayado y herramientas.**

- **Rayado.** Más junto es más oscuro, el cruce va a 45–90° y su dirección habla de la forma ([Strathmore](https://www.strathmoreartist.com/files/content/templates/Graphite%20Shading%20Techniques%20Template.pdf)). Cada capa deja huecos blancos irregulares entre líneas ([Mike Sibley](https://sibleyfineart.com/draw-with-mike-videos/ds008-linear-shading.htm)).
- **Incisiones.** Surcos marcados con una punta roma antes de sombrear, que quedan como líneas blancas imborrables para pelo y bigotes ([Mike Sibley](https://sibleyfineart.com/tutorial--indenting.htm)).
- **Difumino.** Se carga de grafito y acaba depositándolo, lo que ensucia las luces ([Personal Artworks](https://www.personalartworks.uk/mastering-using-tortillons-and-blending-stumps/)).

**Reglas de render (inferencias):**

- El grafito no llega al negro: su valor mínimo queda en L* ≥ 20–25. En las zonas densas lleva un brillo metálico débil, ausente en el carboncillo.
- Las luces quedan como papel limpio, sin velo gris.
- Gomas, incisiones y difumino se tratan como herramientas activas del motor, no como posprocesos.

### Ceras: el diente se llena y la cera arrastra

**Óleo en barra.** Es óleo sólido: al aire forma una piel que hay que retirar y, apretado, da pasta para empaste ([Fine Art Tutorials](https://finearttutorials.com/guide/oil-paint-sticks/)). La Oilbar de W&N es «dura como una vela» y la R&F «blanda como un pintalabios» ([Jackson's](https://www.jacksonsart.com/blog/2019/05/16/oil-stick-vs-oil-pastel/)). Sobre papel sin preparar, el aceite migra y deja **un halo más oscuro más allá del borde visible del trazo**, que amarillea con la oxidación ([Craig Maher](https://craigmaher.net/articles/oil-sketching-on-paper-prep)).

**Pastel graso.** Usa aceite mineral no secante y cera, así que nunca cura ([Wikipedia: Oil pastel](https://en.wikipedia.org/wiki/Oil_pastel)). El esgrafiado funciona mejor con dos capas gruesas, y la presión fuerte mezcla ([Artchive](https://www.artchive.com/art-tutorials/oil-pastels/techniques/)). Según un minorista, tras unas tres capas la cera satura el diente (dato anecdótico) ([Paul Rubens](https://www.paulrubensshop.com/blogs/knowledge/oil-pastel-vs-soft-pastel)).

**Pastel seco.** Tiene la mayor concentración de pigmento de todos los medios y refleja la luz sin oscurecerse ([Wikipedia: Pastel](https://en.wikipedia.org/wiki/Pastel)). El canto barre zonas amplias y la punta hace líneas cuyo grosor cambia con la presión ([Fine Art Tutorials](https://finearttutorials.com/guide/soft-pastel-techniques/)). Se trabaja de duro a blando, y un pastel duro sobre uno blando raspa la capa de abajo en vez de marcar ([Artists Network](https://www.artistsnetwork.com/art-mediums/pastel/do-you-work-with-hard-pastels-first/)). El fijador apaga y oscurece los colores ([Creative Bloq](https://www.creativebloq.com/features/how-to-fix-your-finished-pastel-artwork)).

**Ceras escolares.** La fórmula de patente típica es 68 % parafina, 30 % ácido esteárico y 1 % cera microcristalina ([US3933708A](https://patents.google.com/patent/US3933708A/en)). Dejan una línea firme, algo brillante, que se queda encima del papel y se resiste a la mezcla ([Composition Gallery](https://www.composition.gallery/glossary/what-is-crayon/)), y repelen la acuarela ([The Artful Parent](https://artfulparent.com/watercolor-resist-art-with-young-children/)).

**Manley es otra cosa.** Es una cera blanda barcelonesa fundada en 1964, de textura «supercubriente» ([catálogo Manley](https://exhibitorsearch.messefrankfurt.com/images/original/mics/10000003202501/0015015408/1698392319637_1616895731.pdf)). Frente a Plastidecor, que es dura, limpia y poco cubriente, Manley es blanda, opaca y grasa ([Ofistore](https://www.ofistore.com/material-oficina/ceras/)). El relleno infantil por vaivén aparece como etapa del desarrollo hacia los 3–5 años ([Voilà](https://voila.art/en/magazine/coloring-by-age)).

**Inferencias:**

- **Dos submodos de cera.** La cera dura es translúcida (multiplicación suave), con el grano muy marcado y un brillo ceroso en lo bruñido. Manley es casi opaca y arrastra el color de debajo.
- **Diente y arrastre.** Todas las ceras comparten el mapa de relleno del diente y el arrastre bidireccional de Rudolf.
- **Pastel seco.** Es el modo más luminoso y saturado, con color roto solo en las crestas y difuminado con el dedo solo en zonas puntuales.
- **Óleo en barra.** Relieve real con un montículo al final del trazo.

### Xilografía y linograbado: un sello binario con huellas de proceso

**Las gubias.** Un grabado en relieve estampa la superficie sin tallar, así que todo el tono sale de la geometría de los cortes:

- **Gubia en V:** líneas que se afinan en punta en los dos extremos.
- **Gubia en U:** ancho constante y extremos redondeados.
- **Golpes con la U:** un punteado.

Fuente: [Handprinted](https://handprinted.co.uk/blogs/blog/using-different-tools-to-make-marks-on-lino).

**Talla negra y talla blanca.** En la talla negra se vacía el fondo y quedan las líneas en relieve; en la talla blanca se cortan las líneas y estampa el fondo ([Fitzwilliam Museum](https://fitzmuseum.cam.ac.uk/dept/pdp/prints/highlights/20.html)). La madera de hilo, más blanda, es menos apta para el detalle fino; la línea blanca fina y el cruzado denso son propios de la madera de testa ([Wood engraving](https://www.wikiwand.com/en/Wood-engraver)).

**Tradición refinada frente a expresiva.** Durero modelaba con líneas «that swell and taper» ([Met](https://www.metmuseum.org/art/collection/search/360117)). Vallotton eliminó el modelado por rayado en favor de grandes negros planos y blancos sin modular ([Swann Galleries](https://www.swanngalleries.com/profile/felix-vallotton/)). De la observación de grabados reales, la literatura NPR concluye que **las zonas más claras son blancas y las más oscuras negras, ambas sin textura apreciable** ([Mesquita y Walter 2019](https://www.scitepress.org/Papers/2019/73859/73859.pdf)).

**La madera se ve en la estampa.** El «chatter» es tinta recogida por zonas vaciadas poco profundas, que unos artistas conservan y otros enmascaran ([Handprinted](https://handprinted.co.uk/blogs/blog/using-a-mylar-mask-to-reduce-chatter-in-a-linocut)). La veta aparece cuando la plancha no es plana:

- Munch usó un taco de fondo con veta vertical en *El beso IV* ([Nasjonalmuseet](https://www.nasjonalmuseet.no/en/collection/object/NG.K_H.A.19517)). También serraba la plancha en piezas que se entintaban por separado, y los cortes de sierra estampan como líneas blancas ([MoMA](https://www.moma.org/collection/works/73795)).
- Nolde hizo de la veta olas y nubes ([UMMA](https://umma.umich.edu/objects/verzweiflung-despair-1965-2-72)).

**La estampación tampoco es uniforme.** Con baren, la cobertura «will not be as even or solid» y da un moteado más suave ([McClain's](https://www.imcclains.com/catalog/baren/index.html), página exacta sin verificar). Demasiada tinta en el rodillo rellena las líneas finas ([Galveston Arts Center](https://www.galvestonartscenter.org/s/Printmaking-Lesson-1-Art-Club-enp8.pdf)). La presión deja un relieve visible por el dorso ([HKU UMAG](https://ulearninglabs.umag.hku.hk/en/?p=3434)).

**El registro es mecánico y deriva.** El kento es una marca en L en una esquina más una recta en el borde contiguo ([Yoshabunko](https://www.yoshabunko.com/nishikie/articles/Woodblock_publishing.html)), y los cambios de humedad del papel o de la plancha desplazan el registro ([JAANUS](https://www.aisf.or.jp/~jaanus/deta/k/kentou.htm)). Los pigmentos del ukiyo-e son transparentes: el azul sobre amarillo da verde y el color sobre la línea negra sigue negro ([Yoshabunko](https://www.yoshabunko.com/nishikie/articles/Woodblock_publishing.html)). El *ichimonji bokashi* es una franja horizontal de degradado en cielos y mares ([Wikipedia: Bokashi](https://en.wikipedia.org/wiki/Bokashi_(printing))). Gauguin desregistraba a propósito y variaba la presión de una estampa a otra ([Grob Gallery](https://grobgallery.com/artworks/1441)). Picasso grababa por reducción, de claro a oscuro con una sola plancha ([Mia](https://new.artsmia.org/stories/picasso-cutting-the-bull-in-printmaking)), y el Taller de Gráfica Popular estampaba en negro sobre papel crema ([Art Institute of Chicago](https://www.artic.edu/artworks/160038/firing-squad)).

**Reglas de render (inferencias):**

- **Tono.** En tres zonas.
- **Cortes.** La V tiene forma de lente y la U extremos redondos. En la «madera de hilo» no se cruzan líneas blancas, porque se leería como grabado a testa.
- **Moteado.** Umbralizado por la altura del papel, nunca con ruido uniforme.
- **Veta.** Como atenuación solo dentro de lo que estampa.
- **Desregistro.** Un desplazamiento rígido por plancha más una rotación pequeña alrededor de la esquina del kento, nunca jitter por píxel. Las magnitudes (0,3–1,5 mm cuidado, 1–4 mm expresivo) no se han medido.

## La literatura y el software comercial convergen en ideas baratas

### Trazos: de la rejilla de Hertzmann al muestreo adaptativo

El linaje de los métodos por trazos (SBR):

- **Litwinowicz** recorta los trazos en los bordes y perturba al azar su longitud, color y orientación ([SIGGRAPH](https://history.siggraph.org/?p=117290)).
- **Hertzmann 1998** introduce los «estilos» como conjuntos de parámetros, con radios típicos de 8, 4 y 2 ([Waterloo CS798](https://cs.uwaterloo.ca/~csk/Old/cs798/winter2004/a1/)). *Paint by Relaxation* busca la pintura de energía mínima ([NYU](https://mrl.cs.nyu.edu/publications/painterly-relaxation/)).
- **Zeng et al.** usan un diccionario de **760 pinceladas reales de artistas**, cada una con mapas de color, opacidad y grosor, y pintan siguiendo un orden de oclusión semántico ([SIGGRAPH](https://history.siggraph.org/?p=123108); [patente](https://patents.justia.com/patent/20120133664)).
- **Im2Oil** replantea el óleo como muestreo adaptativo: un mapa de densidad según la complejidad de la textura, anclas por Voronoi y un único hiperparámetro que controla número y tamaño de los trazos ([Im2Oil](https://arxiv.org/pdf/2209.13219)).
- **El robot e-David** pinta dentro de un bucle de realimentación: una cámara mide el lienzo y el robot corrige ([Lindemeier et al. 2012](https://diglib.eg.org/items/5b2da6f9-17fe-460e-a03f-753b567273aa/full)).
- **Semmo et al.** reajustan la imagen a una paleta global de colores dominantes antes de sintetizar la textura ([Semmo et al. 2015](https://diglib.eg.org/handle/10.2312/exp20151188)).

Las inferencias para Trazo:

- **Densidad.** Una rejilla con un trazo por celda produce un ritmo regular. Sembrar por densidad de complejidad (Poisson o Voronoi sobre la energía del tensor de estructura, que el motor ya calcula) da trazos grandes y escasos en lo plano y pequeños y densos en el detalle.
- **Error medido sobre lo pintado.** Medir el error sobre el lienzo realmente renderizado, con huecos y textura, y no sobre el planificado, evita tanto que se vea «la foto debajo» como los huecos sin intención.

### Física: las simulaciones completas no caben, sus ideas sí

Las simulaciones completas son de GPU:

- **Curtis et al.** modelan cada aguada con tres capas: fluido superficial, deposición y capilar ([patente US6198489](https://patents.google.com/patent/US6198489)).
- **MoXi** simula la tinta con lattice Boltzmann en GPU ([SIGGRAPH](https://history.siggraph.org/?p=113877)).
- **IMPaSTo** guarda volumen y pigmento por píxel con KM en shaders ([IMPaSTo](https://math.vu.nl/~eliens/demo/local/documents/impasto.htm)).
- **Wetbrush** simula cerdas en 3D con CUDA ([Adobe Research](https://research.adobe.com/news/adobe-nvidia-wet-brush)).

La estimación propia es que un flujo completo a 6 MP en JavaScript no cabe en 10 s, pero sí a 1/4–1/8 de resolución y solo en las zonas húmedas.

Las versiones en espacio imagen sí son baratas:

- **Bousseau et al.** modulan la densidad de pigmento a tres frecuencias: papel escaneado, dispersión (suma de gaussianas) y turbulencia (ruido grande) ([Bousseau et al. 2006](https://artis.inrialpes.fr/Publications/2006/BKTS06)).
- **Montesdeoca et al.** añaden pincel seco, *gaps & overlaps* y granulación con controles separados para la rugosidad y la acumulación ([Montesdeoca et al. 2017](https://diglib.eg.org/items/1f77ad01-7118-4a6d-9aea-d4904f850565)).
- **dAb** (Baxter) aporta la idea clave para el óleo: transferencia bidireccional de pintura entre pincel y lienzo ([IMPaSTo/dAb](https://math.vu.nl/~eliens/demo/local/documents/impasto.htm)).

### Los ejemplos escaneados ganan a las redes en realismo material

- **RealBrush** sintetiza trazos *y sus interacciones*, como el emborronado, a partir de escaneos de medios reales, sin física ([Google Research](https://research.google/pubs/realbrush-painting-with-examples-of-physical-media/)).
- **Brushables** optimiza a la vez el interior y el borde de una región siguiendo un campo de dirección ([CTU](https://dcgi.fel.cvut.cz/~sykorad/brushables.html)).
- **Stylized Neural Painting** trata el óleo como opaco (alfa = 1), con forma y color interpolados, y por eso da un aspecto de cinta o vector ([CVPR 2021](https://openaccess.thecvf.com/content/CVPR2021/papers/Zou_Stylized_Neural_Painting_CVPR_2021_paper.pdf)).
- **Inverse Painting**, entrenado con time-lapses reales, confirma el proceso: bloque general, masas y después detalle ([Inverse Painting](https://arxiv.org/html/2409.20556v1)).

La lección para Trazo, cuyo techo de realismo lo fijan sus escaneos, es invertir en tres cosas:

- Mapa de altura propio por trazo, no derivado de la luminancia.
- Variantes por carga.
- Ejemplos de borde y de interacción (trazo sobre húmedo, arrastre).

### Lo que venden y lo que critican las herramientas comerciales

**Rebelle.** Simula humedad, secado y re-mojado, con granulación al secar y goteos que responden al papel ([Wikipedia: Rebelle](https://en.wikipedia.org/wiki/Rebelle_(software))). Su impasto acumula **crestas en los bordes del trazo** y permite rascar a través de las capas ([CG Channel](https://www.cgchannel.com/?p=122272)), y usa Mixbox para mezclar ([80.lv](https://80.lv/articles/mixbox-realistic-pigment-based-color-mixing-library-from-ebsynth-creators)). Un usuario critica que de cerca el impasto muestra **la forma repetida del pincel** ([G2](https://www.g2.com/survey_responses/rebelle-review-1241709)).

**Corel Painter.** Thick Paint permite empujar, arrastrar y raspar ([Corel](https://product.corel.com/help/Painter/540111162/Corel-Painter-en/Corel-Painter-Painting-with-Thick-Paint.html)), aunque un artista le reprocha bordes borrosos a alta resolución ([foro ArtRage](https://forums.artrage.com/archive/index.php/t-53572.html)). Su Auto-Painting achica el pincel a medida que avanza y devuelve detalle selectivamente con pinceles de restauración ([Corel](https://product.corel.com/help/Painter/540230868/Main/EN/Win-Documentation/Corel-Painter-Auto-Painting-Photos.html)).

**Dynamic Auto-Painter.** No filtra los píxeles: usa la foto como guía, elimina detalles poco importantes y nunca pinta dos veces igual ([manual DAP7](https://www.mediachance.com/dap/DAP7-manual.pdf)).

**ArtRage.** Controla la carga y el diluyente del pincel ([TechRadar](https://www.techradar.com/reviews/pc-mac/software/graphics-and-media-software/image-editing-software/ambient-design-artrage-2-5-295240/review)).

**Filtro Óleo de Photoshop.** Es la referencia a superar en casa: sus surcos de cerda se vuelven ruido al reducir la imagen, y con «Shine» alto queda exagerado ([Photoshop Essentials](https://photoshopessentials.com/?p=34175)).

En conjunto, lo que los artistas reconocen como «real» se puede implementar sin simulación: crestas, raspado, carga variable, papel que condiciona el depósito y mezcla pigmentaria. Lo que critican es exactamente el riesgo de un motor de texturas: el sello repetido y los bordes blandos genéricos.

## Diez cambios ordenados por impacto y coste para el motor

Una lectura rápida del código (no una auditoría) sitúa el punto de partida.

**Lo que `painter3.js` ya hace bien:**

- Carga que decae a lo largo del trazo.
- Pincel cargado con dos tonos.
- Crestas laterales en el relieve.
- Paletas por k-medias.
- Mezcla húmeda.

**Lo que falta o hay que revisar:**

- **Mezcla en RGB lineal.** La composición se hace en RGB lineal (`Pr = Pr·(1−a) + rr·a`) y la mezcla húmeda solo se aplica entre colores parecidos (diferencia < 0,6), probablemente para evitar el barro que produce el RGB.
- **Grosor y luminosidad.** El grosor depende de la luminosidad solo entre 0,55 y 1,0 en al menos una ruta.
- **Iluminación en `finish()`.** Usa una luz fija arriba a la izquierda (~31° de elevación), oclusión por diferencia de desenfoque y un especular blanco que se suma por encima de un umbral. No hay sombras proyectadas.
- **Lienzo.** Ya se suma más al relieve donde la pintura es fina.
- **Escala física.** `library.js` asume 300 mm de lado largo para todas las técnicas. Un óleo de 60–80 cm mostraría así la trama y las cerdas 2–2,7 veces más gruesas que en la realidad.
- **Grafito.** No encontré brillo de grafito en `pencil.js` ni en `mixta.js`.
- **Acuarela.** Compone las aguadas por absorción, que ya es un modelo sustractivo razonable.

Con ese punto de partida, la priorización queda así. Es inferencia propia; los costes son estimaciones de las notas sin medir en el motor:

| # | Cambio transversal | Qué corrige | Respaldo | Coste estimado |
|---|---|---|---|---|
| 1 | Mezcla y composición KM (spectral.js, MIT, o KM propio con LUT 32³); recogida del color del lienzo a lo largo del trazo también entre colores distintos | Barro gris en RGB, mezclas «digitales», solapes sin agrisado natural | RealPigment, Curtis, Mixbox; impacto inferido | Muy bajo |
| 2 | Ley única de depósito: umbral(carga, presión, pasadas) sobre la altura del soporte, con signo por medio y mapa de relleno del diente | Pincel seco, scumble, grano y saturación de capas incoherentes entre técnicas | Fuentes de taller coherentes; Rudolf; Murakami | Bajo |
| 3 | Presupuesto de detalle (saliencia, contraste o clic del usuario) que module umbral, tamaño mínimo, dureza de borde, acentos y nº de capas; pase final ancho en zonas no focales | Detalle uniforme, bordes iguales | Santella y DeCarlo; Sargent; Schmid (secundaria) | Muy bajo |
| 4 | Relieve ∝ valor (oscuros casi planos), sombras proyectadas cortas (8–16 pasos hacia la luz), elevación de luz ajustable, canal de brillo por medio y grosor, modos «museo» y «estudio» | Superficie de filtro, especular difuso uniforme | Elkhuizen; Berns y de la Rie; Hertzmann 2002 | Bajo-medio (~0,3–1 s estimado) |
| 5 | Tamaño físico supuesto por técnica y variante, que escale pincel, trama, grano y cerdas | Trama de arpillera, cerdas que se vuelven ruido | Recuentos de hilos; crítica al filtro Óleo | Muy bajo |
| 6 | Siembra adaptativa (Poisson o Voronoi por complejidad) en vez de rejilla | Ritmo regular de rejilla | Im2Oil; e-David | Bajo (<0,3 s estimado) |
| 7 | Validador de coherencia del medio por técnica (QA automático) | Efectos imposibles, el criterio de los expertos | Ha et al. 2024 | Bajo |
| 8 | Bucle de corrección: error medido sobre el lienzo renderizado y siembra de la capa siguiente | Foto debajo, huecos sin intención | e-David; Paint by Relaxation | Medio |
| 9 | Ejemplos: más variantes por carga, altura propia por trazo, ejemplos de borde y de interacción | Sello repetido, bordes de recorte | RealBrush; Brushables; Zeng; crítica a Rebelle | Coste de captura, no de CPU |
| 10 | Imperfección de proceso: encaje y pentimento que asoman, viñeta, márgenes, cinta | Rectángulo lleno y uniforme | Pentimenti; DAP «Underpaint Reveal»; valor perceptivo no medido | Muy bajo |

Por técnica, las tres acciones de mayor rendimiento que se deducen de las secciones anteriores son:

| Técnica | Prioridad 1 | Prioridad 2 | Prioridad 3 |
|---|---|---|---|
| Óleo (pincel) | KM + pincel que se ensucia; el bright y la cerda también restan | Luces gruesas y oscuros finos, especular solo en crestas, sombras cortas, brillo desigual sin barnizar | Huecos con imprimatura (no blanco), pase final ancho, estrías ∝ 1/carga |
| Acrílico | Igual que el óleo, con relieve más bajo y redondeado | Satinado (menos especular) | Valores algo más oscuros al secar |
| Espátula | Plano sin estrías, cresta afilada al levantar la hoja | Raspado que revela la capa inferior | Vetas de dos colores (ya existe) |
| Acuarela | Anillo oscuro solo en lo pintado sobre seco, interior más claro, irregular, contornos superpuestos visibles | Granulación y manchado por familia de pigmento; separación en grises; *gaps & overlaps*; *wobbling* | Floraciones solo con humedad media y entrada más húmeda, sobre todo en el borde inferior; 2–4 capas; blancos de papel |
| Gouache | Mate absoluto; compresión de valores; tintes claros calcáreos | Contaminación por rehumectación (tradicional) frente a capas limpias (acrílico) | Planos en 2–3 pasadas, rendijas y solapes en los bordes, modo papel tintado |
| Mixta L+G | Grafito visible bajo pintura fina y oculto bajo 2–3 capas opacas, con fantasma | Overdrawing que se engancha en el diente; brillo del grafito frente a gouache mate | Color en el foco, lo secundario solo a lápiz, mancha desregistrada respecto a la línea |
| Grafito | Tres zonas de tono (luces de papel limpio) | Nunca negro, brillo en lo denso | Presión a lo largo del trazo (AlMeraj), rayado con huecos, incisiones y gomas |
| Carboncillo | Negro mate profundo, grano muy marcado en los medios | Difuminado amplio, polvo, fantasma de goma | Papel tintado con luces de tiza que no se mezclan con los oscuros |
| Óleo en barra | Pasta tipo pintalabios con montículo final | Rotura sobre el grano en el arrastre rápido | Halo de aceite opcional sobre papel sin preparar |
| Pastel graso | Opaco, arrastre bidireccional (Rudolf) | Diente saturado tras ~3 capas | Esgrafiado y lavados con disolvente |
| Pastel seco | El modo más luminoso; canto en crestas y punta para plumear | Capas que pierden cobertura en los valles | Dedo solo en zonas puntuales; papeles Mi-Teintes, Ingres y UART; fijado opcional |
| Ceras Manley / escolares | Dos submodos: dura translúcida frente a Manley opaca y grasa | Relleno del diente y arrastre | Vaivén infantil opcional, caja de 12/24 colores |
| Xilografía | Tres zonas; gubia en V en lente, en U redonda; sin cruces blancos en madera de hilo | Moteado por la altura del papel, moteado de baren, líneas finas que se rellenan, relieve en el papel | Desregistro rígido por plancha, composición multiplicativa, bokashi, veta por plancha, papel crema |

Hay dos recomendaciones de método que valen tanto como cualquier cambio de código. La primera es evaluar con artistas, no con métricas: Mould defiende la evaluación subjetiva y sistemática ([Mould](https://gigl.scs.carleton.ca/papers/position-jun7.pdf)), y los expertos de Ha et al. son exactamente el público que detecta lo que falla. La segunda es calibrar los parámetros con los escaneos del proyecto (`REFERENCIAS/`, `TEXTURES/`): anchura e intensidad del anillo, longitud de la cola seca, espaciado de cerdas, cambio de valor del gouache y desregistro. Casi ninguna de esas cifras existe publicada.

## Qué está probado, qué es inferencia y qué falta medir

**Método y limitación de red.** Las siete líneas de investigación chocaron con el mismo límite: el proxy de la sesión bloqueó WebFetch para casi todos los dominios. Entre ellos están handprint.com, el blog de Gurney, arxiv.org, los servidores de Princeton y UNC, Wikipedia, winsornewton.com y los PDFs de Eurographics. En la parte de medios secos se agotó además el presupuesto de búsquedas. Por eso **casi todo lo citado procede de extractos y resúmenes del buscador, no de la lectura completa**. Las citas literales son paráfrasis cercanas, y no se pudieron leer enteros los artículos que más pesan en el diseño: Curtis, Hertzmann 1998/2002, Sousa y Buchanan, Rudolf, AlMeraj, Lu et al., Li et al., Isenberg y Chamberlain.

**Bien respaldado.** Lo mejor fundado es la física y los datos de museo:

- El mecanismo del anillo de café ([Deegan et al.](https://www.nature.com/articles/39827)).
- Los recuentos de hilos ([Cornell](https://people.ece.cornell.edu/johnson/pubLinxAH/SP-93-13)).
- La separación de color, brillo y topografía ([Elkhuizen et al.](https://dl.acm.org/doi/fullHtml/10.1145/3317949)).
- El efecto del barniz ([Berns y de la Rie](https://www.researchgate.net/publication/272252901_The_Effect_of_the_Refractive_Index_of_a_Varnish_on_the_Appearance_of_Oil_Paintings)).
- Las descripciones de grabados de MoMA, el Met, la NGA y JAANUS.
- Los resultados principales de los estudios de percepción (Ha et al., Santella y DeCarlo, Mould et al., Cole et al.), aunque leídos a partir de resúmenes.

**Respaldo medio.** Las descripciones de técnica vienen sobre todo de blogs de artistas, tiendas y foros. Son muy coherentes entre sí (pincel seco en crestas, de claro a oscuro en acuarela, cambio de valor del gouache, brillo del grafito), pero ninguna está medida.

**Inferencia.** Son inferencias todas las cifras de parámetros:

- L* del gouache.
- 5–20 % de contaminación.
- Rendijas de 1–3 px.
- Desregistro de 0,3–4 mm.
- Anchura del anillo.
- Umbrales.
- Costes en JavaScript.

También lo son el orden de prioridades y las observaciones sobre el código.

**Datos débiles o sin verificar:**

- Los 0,5–5 mm de empaste.
- Las 3–4 capas de acuarela antes del «barro».
- La proporción 29:29:42 de Lu et al., que no se pudo asignar a cada capa.
- El preprint arXiv 2608.30210.
- El dato de 1,1 mm, que viene de cuadros «al estilo de» Van Gogh, no de originales.

**Contradicciones entre fuentes:**

- Si la presión ligera deposita en crestas o en valles (la mayoría dice crestas).
- Si el carboncillo de sauce es más oscuro que el de vid.
- Cómo encaja «graso sobre magro» con el orden de valores.
- Graf o Bewick como origen de la talla blanca.
- Las cifras de Elgammal et al. según la fuente.
- Si los bordes perdidos son un cliché.

**Siguiente paso.** Una segunda ronda con esos dominios permitidos para leer los PDFs primarios, y medir sobre escaneos propios lo que la literatura no da.

## Conclusión

La investigación desplaza el problema de Trazo. El motor no necesita más textura ni más ruido: necesita que cada píxel responda a qué material hay ahí, qué capa queda debajo, qué grosor tiene y con qué luz se fotografió. Tres ideas cubren la mayoría de las firmas de todos los medios:

- Una ley de depósito según la altura del soporte, cuyo signo cambia entre medios arrastrados y pigmento que sedimenta.
- Una mezcla sustractiva.
- Un brillo separado del relieve.

Eso convierte doce técnicas aparentemente distintas en variaciones de pocos parámetros físicos. También da una prueba objetiva de calidad, porque los expertos juzgan justo por la coherencia del medio.

La otra mitad del realismo no es física sino de juicio: pocas masas, un foco, bordes que se pierden y un orden de trabajo visible. Es barata de implementar porque Trazo ya tiene regiones, un mapa de importancia y capas. Lo que falta es dejar que gobierne el tamaño, el borde, el número de trazos y lo que queda sin terminar, en lugar de aplicar la misma resolución a todo el lienzo. La imperfección que convence no es aleatoria: es la huella de un proceso competente.
