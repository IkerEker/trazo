/*
 * Trazo · Captura — contenido de la guía y de las listas de trazos.
 * Expone window.CapturaData.
 */
(function (root) {
  "use strict";

  // Pasos de la guía. Cada bloque: {p: "párrafo"} o {ul: ["punto", ...]}
  const GUIDE = [
    {
      title: "Piloto: haz esto primero",
      body: [
        { p: "Antes de hacerlo todo, comprobamos que tu escáner capta el relieve." },
        { ul: [
          "Pinta 1 hoja de gouache con la lista «Gouache» (seca en media hora).",
          "Recorta un trozo de papel en blanco de 15×15 cm.",
          "Escanea los dos con las 4 rotaciones (paso 4) y envíamelos.",
        ] },
        { p: "Si tu escáner es de los finos y no capta relieve, usaremos la cámara (paso 5)." },
      ],
    },
    {
      title: "Material",
      body: [
        { ul: [
          "Hojas cuadradas de 20×20 cm como máximo: tienen que caber en el escáner al girarlas 90°.",
          "Óleo: cartón entelado 20×20. Gouache y acuarela: papel de acuarela 300 g, grano fino. Lápiz y ceras: tu papel de dibujo habitual.",
          "Un solo color oscuro por técnica, sin mezclar. Después le pongo cualquier color.",
          "Un rotulador fino negro para las marcas de registro.",
        ] },
        { p: "El material concreto de cada técnica está en la pestaña «Lista»." },
      ],
    },
    {
      title: "Reglas para todos los trazos",
      body: [
        { ul: [
          "Dibuja 4 cruces pequeñas (+) en las esquinas, a 1 cm del borde. Sirven para alinear los escaneos. También puedes usar la plantilla (pestaña «Escanear»).",
          "Deja al menos 2 cm entre trazos y 1,5 cm hasta el borde. Ningún trazo debe tocar a otro.",
          "Pinta siempre de izquierda a derecha; los verticales, de arriba abajo.",
          "Escribe a lápiz en una esquina el nombre de la hoja (p. ej. OLEO-H01) y el pincel.",
          "Pinta con naturalidad: las irregularidades son justo lo que buscamos.",
        ] },
      ],
    },
    {
      title: "Qué pintar",
      body: [
        { p: "Abre la pestaña «Lista», elige la técnica y ve marcando cada trazo al hacerlo. Calcula 2–4 hojas por técnica." },
        { p: "Incluye también los soportes en blanco (lienzo, papel de acuarela y papel de dibujo): son las texturas de papel y lienzo." },
      ],
    },
    {
      title: "Cómo escanear",
      body: [
        { p: "Espera a que todo esté totalmente seco. El óleo tarda de días a semanas según el grosor; el óleo alquídico seca en 24 h. Seco, se puede apoyar en el cristal." },
        { ul: [
          "600 ppp, color RGB, 16 bits por canal si el escáner lo permite.",
          "Desactiva TODAS las correcciones automáticas: exposición y color automáticos, nitidez, eliminación de polvo, mejora de texto y destramado.",
          "Guarda en PNG o TIFF, nunca en JPG.",
        ] },
        { p: "Las 4 rotaciones (óleo, gouache, ceras y soportes en blanco): escanea con la hoja apoyada en la esquina del cristal (R000), gírala 90° en sentido horario (R090), otros 90° (R180) y otros 90° (R270). La luz del escáner viene de un lado: con las 4 sombras calculo el relieve real." },
        { p: "Lápiz y acuarela: basta con un escaneo (R000)." },
        { p: "Abre cada escaneo en Photoshop, pulsa «Comprobar» y guárdalo con «GUARDAR PNG»: el nombre se pone solo." },
      ],
    },
    {
      title: "Si no capta relieve: cámara",
      body: [
        { ul: [
          "Cámara en trípode, perpendicular a la hoja, habitación a oscuras.",
          "Exposición, balance de blancos y enfoque en manual. Fotos en RAW.",
          "Una lámpara baja (unos 30°) a la izquierda, derecha, arriba y abajo de la hoja, siempre a la misma distancia: 4 fotos sin mover nada más.",
          "Una quinta foto con luz difusa.",
        ] },
      ],
    },
    {
      title: "Nombres y envío",
      body: [
        { p: "Nombre de cada archivo: TECNICA_H##_R### (p. ej. OLEO_H01_R090.png). Este plugin lo pone por ti." },
        { ul: [
          "Súbelos directamente en el chat. Si pesan mucho, recórtalos a la zona útil o guárdalos en 8 bits.",
          "Añade una nota por hoja: pincel, marca y color de pintura, y papel.",
        ] },
      ],
    },
    {
      title: "Qué hago yo con ellos",
      body: [
        { p: "Separo cada trazo automáticamente; de cada uno saco la cantidad de pintura, la veta de las cerdas, el final seco y el relieve, y calculo su línea central para doblarlo a lo largo de cualquier recorrido." },
        { p: "Así Trazo pintará con tus pinceles reales sobre tus papeles reales. La interfaz no cambia." },
      ],
    },
  ];

  const BRUSH_ITEMS = [
    { t: "Rectos medianos (8 cm), presión media", n: 3 },
    { t: "Largos (15 cm) hasta que se acabe la pintura", n: 2 },
    { t: "Toques cortos (2–3 cm)", n: 3 },
    { t: "Curva suave y curva en S", n: 2 },
    { t: "Uno con presión fuerte y otro muy suave", n: 2 },
  ];

  // Listas por técnica. code = prefijo del nombre de archivo.
  const TECHS = [
    {
      id: "lapiz", name: "Lápiz", code: "LAPIZ", icon: "t-lapiz", rotations: false,
      material: "Lápices HB, 2B y 6B · tu papel de dibujo habitual · 2–3 hojas.",
      groups: [
        { title: "Con cada lápiz (HB, 2B y 6B)", items: [
          { t: "Líneas cortas, medianas y largas · presión suave", n: 3 },
          { t: "Líneas cortas, medianas y largas · presión media", n: 3 },
          { t: "Líneas cortas, medianas y largas · presión fuerte", n: 3 },
          { t: "Trazos «lanzados» que se afinan al final", n: 4 },
        ] },
        { title: "Parches de 3×3 cm", items: [
          { t: "Rayado en 4 densidades, de claro a oscuro", n: 4 },
          { t: "Rayado cruzado", n: 1 },
          { t: "Difuminado", n: 1 },
          { t: "Parche oscuro con un borrado de goma", n: 1 },
        ] },
      ],
    },
    {
      id: "oleo", name: "Óleo", code: "OLEO", icon: "t-oleo", rotations: true,
      material: "Cartón entelado 20×20 · sombra tostada o azul ultramar, de tubo y sin disolvente · 3–4 hojas.",
      groups: [
        { title: "Pincel plano nº 6–8", items: BRUSH_ITEMS },
        { title: "Lengua de gato nº 6–8", items: BRUSH_ITEMS },
        { title: "Redondo nº 4", items: BRUSH_ITEMS },
        { title: "Plano ancho de 20 mm", items: BRUSH_ITEMS },
        { title: "Extra", items: [
          { t: "Trazos con mucha pasta (empaste)", n: 4 },
          { t: "Toques de espátula (opcional)", n: 3 },
        ] },
      ],
    },
    {
      id: "gouache", name: "Gouache", code: "GOUACHE", icon: "t-gouache", rotations: true,
      material: "Papel de acuarela 300 g, grano fino · negro o azul oscuro con consistencia de nata · 2–3 hojas.",
      groups: [
        { title: "Pincel plano de 12 mm", items: BRUSH_ITEMS },
        { title: "Redondo nº 8", items: BRUSH_ITEMS },
        { title: "Lengua de gato nº 6–8", items: BRUSH_ITEMS },
        { title: "Extra", items: [
          { t: "Manchas planas de 2×4 cm", n: 2 },
          { t: "Pincel seco", n: 3 },
        ] },
      ],
    },
    {
      id: "ceras", name: "Ceras", code: "CERAS", icon: "t-ceras", rotations: true,
      material: "Tu papel de dibujo · una cera negra o marrón oscuro · 2 hojas.",
      groups: [
        { title: "Trazos", items: [
          { t: "Trazos sueltos · presión suave", n: 3 },
          { t: "Trazos sueltos · presión media", n: 3 },
          { t: "Trazos sueltos · presión fuerte", n: 3 },
          { t: "Garabato en zigzag", n: 1 },
          { t: "Trazo con la cera de canto", n: 2 },
        ] },
        { title: "Parches de 4×4 cm", items: [
          { t: "Rayado en 3 presiones", n: 3 },
          { t: "3 capas una encima de otra hasta bruñir", n: 1 },
        ] },
      ],
    },
    {
      id: "acuarela", name: "Acuarela", code: "ACUARELA", icon: "t-acuarela", rotations: false,
      material: "Papel 300 g grano fino pegado con cinta · azul ultramar (granula) y azul ftalo (no granula) · redondo nº 8–10 · 3–4 hojas.",
      groups: [
        { title: "Azul ultramar", items: null },
        { title: "Azul ftalo", items: null },
      ],
    },
    {
      id: "soporte", name: "Soportes", code: null, icon: "t-soporte", rotations: true,
      material: "Trozos de 15×15 cm en blanco, sin pintar. Escanea cada uno con las 4 rotaciones.",
      groups: [
        { title: "En blanco", items: [
          { t: "Lienzo (cartón entelado)", n: 1 },
          { t: "Papel de acuarela 300 g", n: 1 },
          { t: "Papel de dibujo", n: 1 },
        ] },
      ],
    },
  ];
  const WATER_ITEMS = [
    { t: "Pinceladas cortas y largas · pincel cargado", n: 4 },
    { t: "Pinceladas · pincel medio seco", n: 3 },
    { t: "Pincel seco", n: 2 },
    { t: "Aguada plana de 5×5 cm", n: 1 },
    { t: "Aguada degradada", n: 1 },
    { t: "Mancha húmedo sobre húmedo", n: 1 },
    { t: "Floración: agua sobre una aguada que se seca", n: 1 },
    { t: "Dos veladuras superpuestas (la 1.ª ya seca)", n: 1 },
    { t: "Salpicaduras", n: 1 },
  ];
  for (const g of TECHS.find((t) => t.id === "acuarela").groups) g.items = WATER_ITEMS;

  // Soportes en blanco: prefijo de archivo propio
  const SUPPORTS = [
    { id: "lienzo", name: "Lienzo", code: "LIENZO" },
    { id: "pacuarela", name: "P. acuarela", code: "PAPELACUARELA" },
    { id: "pdibujo", name: "P. dibujo", code: "PAPELDIBUJO" },
  ];

  root.CapturaData = { GUIDE, TECHS, SUPPORTS };
})(typeof window !== "undefined" ? window : globalThis);
