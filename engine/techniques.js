"use strict";
/*
 * Trazo · técnicas, parámetros y variantes.
 * Cada técnica tiene 4 variantes: al elegir una se rellenan todos los ajustes
 * (y el "modo" con el que pinta el motor); después se puede tocar cualquier ajuste.
 */

const PARAMS = {
  intensidad: { label: "Intensidad del trazo", hint: "Presión, carga y opacidad" },
  grosor:     { label: "Grosor del trazo", hint: "Ancho del pincel, la punta o la gubia" },
  longitud:   { label: "Longitud del trazo", hint: "Lo largo que es cada trazo" },
  curvatura:  { label: "Curvatura del trazo", hint: "0 = rectos · 100 = siguen las formas" },
  cobertura:  { label: "Cobertura del blanco", hint: "Cuánto se cubre. Lo no cubierto deja ver el papel (o queda transparente)" },
  empaste:    { label: "Empaste", hint: "Grosor de la pintura: relieve y brillo en las luces" },
  humedad:    { label: "Humedad", hint: "Cuánto se corre y se funde el color" },
  granulado:  { label: "Granulado", hint: "Grano del pigmento, de la tinta o de la impresión" },
  cruzado:    { label: "Sombreado cruzado", hint: "Capas de trazo superpuestas en distintas direcciones" },
  varTono:    { label: "Variación de tono", hint: "Cambio de matiz entre trazos" },
  varSat:     { label: "Variación de saturación", hint: "Cambio de intensidad de color entre trazos" },
  varLuz:     { label: "Variación de luz", hint: "Cambio de claridad entre trazos" },
  detalle:    { label: "Detalle", hint: "Más trazos y más finos en lo importante" },
};

const PAINT = ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "varTono", "varSat", "varLuz", "detalle"];

const TECHNIQUES = [
  {
    id: "oleo", name: "Óleo", desc: "Pinceladas cargadas sobre imprimatura, empaste en las luces",
    params: PAINT,
    variants: [
      { id: "planos", name: "Planos y espátula", values: { intensidad: 88, grosor: 50, longitud: 38, curvatura: 45, cobertura: 100, empaste: 70, varTono: 22, varSat: 25, varLuz: 22, detalle: 55 } },
      { id: "gestual", name: "Gestual", values: { intensidad: 80, grosor: 68, longitud: 70, curvatura: 65, cobertura: 92, empaste: 45, varTono: 35, varSat: 40, varLuz: 30, detalle: 40 } },
      { id: "boceto", name: "Boceto sobre imprimatura", values: { intensidad: 70, grosor: 42, longitud: 55, curvatura: 55, cobertura: 75, empaste: 30, varTono: 18, varSat: 18, varLuz: 18, detalle: 50 } },
      { id: "materico", name: "Matérico", values: { intensidad: 90, grosor: 55, longitud: 35, curvatura: 40, cobertura: 100, empaste: 85, varTono: 15, varSat: 12, varLuz: 25, detalle: 50 } },
    ],
  },
  {
    id: "lapiz", name: "Lápiz", desc: "Grafito y carboncillo en grises",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "cruzado", "detalle"],
    variants: [
      { id: "linea", name: "Línea suelta", values: { intensidad: 70, grosor: 22, longitud: 60, curvatura: 60, cobertura: 55, cruzado: 20, detalle: 70 } },
      { id: "rayado", name: "Rayado", values: { intensidad: 65, grosor: 24, longitud: 50, curvatura: 45, cobertura: 85, cruzado: 55, detalle: 60 } },
      { id: "carbon", name: "Carboncillo", values: { intensidad: 85, grosor: 55, longitud: 55, curvatura: 50, cobertura: 95, cruzado: 35, detalle: 55 } },
      { id: "negros", name: "Negros expresivos", values: { intensidad: 95, grosor: 40, longitud: 60, curvatura: 55, cobertura: 90, cruzado: 25, detalle: 50 } },
    ],
  },
  {
    id: "gouache", name: "Gouache", desc: "Planos mates y opacos con borde duro",
    params: PAINT,
    variants: [
      { id: "pleinair", name: "Plein air", values: { intensidad: 92, grosor: 48, longitud: 32, curvatura: 45, cobertura: 95, empaste: 18, varTono: 14, varSat: 14, varLuz: 18, detalle: 50 } },
      { id: "planos", name: "Planos opacos", values: { intensidad: 95, grosor: 50, longitud: 35, curvatura: 35, cobertura: 100, empaste: 10, varTono: 8, varSat: 8, varLuz: 10, detalle: 55 } },
      { id: "expresivo", name: "Retrato expresivo", values: { intensidad: 88, grosor: 50, longitud: 40, curvatura: 55, cobertura: 100, empaste: 25, varTono: 28, varSat: 30, varLuz: 30, detalle: 55 } },
      { id: "diluido", name: "Diluido", values: { intensidad: 70, grosor: 55, longitud: 35, curvatura: 45, cobertura: 85, empaste: 5, varTono: 15, varSat: 15, varLuz: 15, detalle: 40 } },
    ],
  },
  {
    id: "acuarela", name: "Acuarela", desc: "Aguadas transparentes, bordes húmedos y pigmento",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "humedad", "granulado", "varTono", "varSat", "varLuz", "detalle"],
    variants: [
      { id: "humeda", name: "Manchas húmedas", values: { intensidad: 78, grosor: 55, longitud: 35, curvatura: 50, cobertura: 75, humedad: 85, granulado: 40, varTono: 25, varSat: 20, varLuz: 20, detalle: 40 } },
      { id: "capas", name: "Paisaje por capas", values: { intensidad: 72, grosor: 45, longitud: 40, curvatura: 50, cobertura: 85, humedad: 50, granulado: 45, varTono: 22, varSat: 20, varLuz: 20, detalle: 50 } },
      { id: "dibujo", name: "Con dibujo", values: { intensidad: 65, grosor: 45, longitud: 40, curvatura: 50, cobertura: 75, humedad: 45, granulado: 40, varTono: 18, varSat: 15, varLuz: 15, detalle: 60 } },
      { id: "densa", name: "Densa", values: { intensidad: 92, grosor: 45, longitud: 45, curvatura: 50, cobertura: 92, humedad: 55, granulado: 60, varTono: 25, varSat: 30, varLuz: 22, detalle: 60 } },
    ],
  },
  {
    id: "rotulador", name: "Rotulador", desc: "Bandas de ancho fijo que oscurecen al solaparse",
    params: ["intensidad", "grosor", "longitud", "cobertura", "cruzado", "varTono", "varSat", "detalle"],
    variants: [
      { id: "moda", name: "Moda (alcohol + línea)", values: { intensidad: 80, grosor: 45, longitud: 70, cobertura: 60, cruzado: 35, varTono: 10, varSat: 20, detalle: 65 } },
      { id: "vetas", name: "Vetas de alcohol", values: { intensidad: 75, grosor: 40, longitud: 60, cobertura: 90, cruzado: 55, varTono: 10, varSat: 15, detalle: 50 } },
      { id: "acuarelable", name: "Acuarelables", values: { intensidad: 80, grosor: 50, longitud: 40, cobertura: 70, cruzado: 25, varTono: 15, varSat: 25, detalle: 45 } },
      { id: "linea", name: "Línea y relleno", values: { intensidad: 70, grosor: 30, longitud: 55, cobertura: 50, cruzado: 40, varTono: 15, varSat: 15, detalle: 70 } },
    ],
  },
  {
    id: "mixtalg", name: "Mixta L+G", desc: "Dibujo a lápiz muy presente con manchas de gouache",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "cruzado", "varTono", "varSat", "varLuz", "detalle"],
    variants: [
      { id: "maslapiz", name: "Más lápiz", values: { intensidad: 75, grosor: 40, longitud: 45, curvatura: 50, cobertura: 40, empaste: 10, cruzado: 45, varTono: 12, varSat: 12, varLuz: 12, detalle: 70 } },
      { id: "equilibrada", name: "Equilibrada", values: { intensidad: 72, grosor: 45, longitud: 40, curvatura: 50, cobertura: 62, empaste: 12, cruzado: 35, varTono: 15, varSat: 15, varLuz: 15, detalle: 60 } },
      { id: "masgouache", name: "Más gouache", values: { intensidad: 70, grosor: 50, longitud: 38, curvatura: 50, cobertura: 85, empaste: 15, cruzado: 25, varTono: 15, varSat: 15, varLuz: 15, detalle: 55 } },
      { id: "manchas", name: "Manchas sueltas", values: { intensidad: 75, grosor: 55, longitud: 35, curvatura: 50, cobertura: 55, empaste: 10, cruzado: 30, varTono: 22, varSat: 22, varLuz: 18, detalle: 60 } },
    ],
  },
  {
    id: "mixta", name: "Mixta total", desc: "Collage, gouache, tinta, ceras e impresión en la misma lámina",
    params: ["intensidad", "grosor", "longitud", "cobertura", "granulado", "varTono", "varSat", "detalle"],
    variants: [
      { id: "cuaderno", name: "Cuaderno", values: { intensidad: 70, grosor: 40, longitud: 50, cobertura: 55, granulado: 40, varTono: 15, varSat: 20, detalle: 65 } },
      { id: "collage", name: "Collage", values: { intensidad: 75, grosor: 45, longitud: 45, cobertura: 85, granulado: 55, varTono: 15, varSat: 15, detalle: 55 } },
      { id: "cartel", name: "Cartel", values: { intensidad: 85, grosor: 55, longitud: 40, cobertura: 95, granulado: 45, varTono: 20, varSat: 35, detalle: 50 } },
      { id: "impresion", name: "Impresión", values: { intensidad: 80, grosor: 45, longitud: 45, cobertura: 85, granulado: 75, varTono: 10, varSat: 20, detalle: 55 } },
    ],
  },
  {
    id: "xilografia", name: "Xilografía", desc: "Grabado en madera: cortes de gubia y tinta estampada",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "granulado", "detalle"],
    variants: [
      { id: "realista", name: "Realista", values: { intensidad: 85, grosor: 35, longitud: 55, curvatura: 70, cobertura: 85, granulado: 45, detalle: 70 } },
      { id: "expresiva", name: "Expresiva", values: { intensidad: 92, grosor: 60, longitud: 45, curvatura: 35, cobertura: 90, granulado: 55, detalle: 40 } },
      { id: "dos", name: "Dos tintas", values: { intensidad: 85, grosor: 45, longitud: 50, curvatura: 55, cobertura: 85, granulado: 55, detalle: 55 } },
      { id: "tres", name: "Tres tintas", values: { intensidad: 85, grosor: 45, longitud: 50, curvatura: 55, cobertura: 85, granulado: 55, detalle: 50 } },
    ],
  },
];

const BY_ID = {};
for (const t of TECHNIQUES) {
  t.defaults = Object.assign({ modo: t.variants[0].id }, t.variants[0].values);
  t.presets = t.variants.map((v) => ({ name: v.name, values: Object.assign({ modo: v.id }, v.values) }));
  BY_ID[t.id] = t;
}

function defaultsFor(id) {
  return Object.assign({}, BY_ID[id].defaults);
}

/** Normaliza parámetros 0..100 → 0..1 rellenando los que falten; el modo se valida. */
function normalized(id, params) {
  const t = BY_ID[id];
  const p = Object.assign({}, t.defaults, params || {});
  const out = {};
  for (const k of Object.keys(PARAMS)) {
    const v = p[k] === undefined ? 50 : +p[k];
    out[k] = Math.max(0, Math.min(100, isFinite(v) ? v : 50)) / 100;
  }
  out.modo = t.variants.some((v) => v.id === p.modo) ? p.modo : t.variants[0].id;
  out.color = false;
  return out;
}

module.exports = { PARAMS, TECHNIQUES, BY_ID, defaultsFor, normalized };
