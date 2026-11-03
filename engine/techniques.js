"use strict";
/*
 * Trazo · definición de técnicas, parámetros y presets.
 * La interfaz y el motor leen de aquí: un único sitio para ajustar valores.
 */

const PARAMS = {
  intensidad: { label: "Intensidad del trazo", hint: "Presión y opacidad de cada trazo" },
  grosor:     { label: "Grosor del trazo", hint: "Ancho del pincel o de la punta" },
  longitud:   { label: "Longitud del trazo", hint: "Lo largo que es cada pincelada" },
  curvatura:  { label: "Curvatura del trazo", hint: "0 = rectos · 100 = siguen las formas" },
  cobertura:  { label: "Cobertura del blanco", hint: "Cuánto lienzo queda cubierto. Lo no cubierto será transparente" },
  empaste:    { label: "Empaste", hint: "Grosor de la pintura: relieve y brillo" },
  humedad:    { label: "Humedad", hint: "Cuánto se corre y se funde el color" },
  granulado:  { label: "Granulado", hint: "Pigmento que se asienta en el grano del papel" },
  cruzado:    { label: "Sombreado cruzado", hint: "Capas de rayado en distintas direcciones" },
  varTono:    { label: "Variación de tono", hint: "Cambio de matiz entre trazos" },
  varSat:     { label: "Variación de saturación", hint: "Cambio de intensidad de color entre trazos" },
  varLuz:     { label: "Variación de luz", hint: "Cambio de claridad entre trazos" },
  detalle:    { label: "Detalle", hint: "Trazos finos en bordes y zonas importantes" },
};

const TECHNIQUES = [
  {
    id: "lapiz",
    name: "Lápiz",
    desc: "Grafito con rayado que sigue las formas",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "cruzado", "detalle"],
    colorParams: ["varTono", "varSat"],
    toggles: [{ key: "color", label: "Lápiz de color", def: false }],
    defaults: { intensidad: 65, grosor: 22, longitud: 50, curvatura: 55, cobertura: 85, cruzado: 55, detalle: 60, varTono: 15, varSat: 20, color: false },
    presets: [
      { name: "Boceto suelto", values: { intensidad: 55, grosor: 28, longitud: 75, curvatura: 40, cobertura: 70, cruzado: 25, detalle: 40 } },
      { name: "Sombreado fino", values: { intensidad: 60, grosor: 14, longitud: 45, curvatura: 60, cobertura: 90, cruzado: 80, detalle: 75 } },
      { name: "Grafito intenso", values: { intensidad: 90, grosor: 32, longitud: 55, curvatura: 55, cobertura: 95, cruzado: 60, detalle: 65 } },
    ],
  },
  {
    id: "oleo",
    name: "Óleo",
    desc: "Pinceladas cargadas con relieve y brillo",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "varTono", "varSat", "varLuz", "detalle"],
    defaults: { intensidad: 85, grosor: 45, longitud: 40, curvatura: 60, cobertura: 100, empaste: 55, varTono: 25, varSat: 30, varLuz: 25, detalle: 55 },
    presets: [
      { name: "Impresionista", values: { grosor: 35, longitud: 22, curvatura: 45, empaste: 60, varTono: 50, varSat: 45, varLuz: 35, detalle: 45 } },
      { name: "Empaste grueso", values: { grosor: 62, longitud: 35, curvatura: 55, empaste: 92, varTono: 25, varSat: 25, varLuz: 25, detalle: 40 } },
      { name: "Detallado", values: { grosor: 30, longitud: 45, curvatura: 70, empaste: 35, varTono: 15, varSat: 20, varLuz: 15, detalle: 88 } },
    ],
  },
  {
    id: "gouache",
    name: "Gouache",
    desc: "Color opaco y mate, zonas planas",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "varTono", "varSat", "varLuz", "detalle"],
    defaults: { intensidad: 90, grosor: 50, longitud: 30, curvatura: 45, cobertura: 95, empaste: 20, varTono: 15, varSat: 15, varLuz: 20, detalle: 45 },
    presets: [
      { name: "Ilustración plana", values: { grosor: 45, longitud: 25, empaste: 8, varTono: 5, varSat: 5, varLuz: 8, detalle: 55 } },
      { name: "Pincel seco", values: { intensidad: 70, grosor: 40, longitud: 45, cobertura: 80, empaste: 30, detalle: 50 } },
      { name: "Manchas grandes", values: { grosor: 75, longitud: 20, curvatura: 30, detalle: 25, varLuz: 30 } },
    ],
  },
  {
    id: "ceras",
    name: "Ceras",
    desc: "Trazo graso con el grano del papel",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "empaste", "varTono", "varSat", "varLuz", "detalle"],
    defaults: { intensidad: 70, grosor: 35, longitud: 45, curvatura: 55, cobertura: 90, empaste: 30, varTono: 30, varSat: 25, varLuz: 25, detalle: 50 },
    presets: [
      { name: "Infantil", values: { intensidad: 75, grosor: 55, longitud: 55, curvatura: 75, varSat: 40, varTono: 40, detalle: 35 } },
      { name: "Pastel suave", values: { intensidad: 50, grosor: 45, longitud: 35, empaste: 10, cobertura: 85, detalle: 45 } },
      { name: "Trazo denso", values: { intensidad: 92, grosor: 30, longitud: 40, cobertura: 100, empaste: 45, detalle: 65 } },
    ],
  },
  {
    id: "acuarela",
    name: "Acuarela",
    desc: "Manchas transparentes con bordes de pigmento",
    params: ["intensidad", "grosor", "longitud", "curvatura", "cobertura", "humedad", "granulado", "varTono", "varSat", "varLuz", "detalle"],
    defaults: { intensidad: 70, grosor: 45, longitud: 40, curvatura: 50, cobertura: 85, humedad: 50, granulado: 45, varTono: 25, varSat: 20, varLuz: 20, detalle: 45 },
    presets: [
      { name: "Húmedo sobre húmedo", values: { humedad: 88, granulado: 30, grosor: 55, detalle: 35 } },
      { name: "Seco y definido", values: { humedad: 15, granulado: 55, grosor: 35, detalle: 75 } },
      { name: "Manchas sueltas", values: { cobertura: 55, grosor: 65, humedad: 60, detalle: 25 } },
    ],
  },
];

const BY_ID = {};
for (const t of TECHNIQUES) BY_ID[t.id] = t;

function defaultsFor(id) {
  const t = BY_ID[id];
  return Object.assign({}, t.defaults);
}

/** Normaliza parámetros 0..100 → 0..1 rellenando los que falten. */
function normalized(id, params) {
  const t = BY_ID[id];
  const p = Object.assign({}, t.defaults, params || {});
  const out = {};
  for (const k of Object.keys(PARAMS)) {
    const v = p[k] === undefined ? 50 : +p[k];
    out[k] = Math.max(0, Math.min(100, isFinite(v) ? v : 50)) / 100;
  }
  out.color = !!p.color;
  return out;
}

module.exports = { PARAMS, TECHNIQUES, BY_ID, defaultsFor, normalized };
