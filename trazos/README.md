# Biblioteca de trazos

Imágenes de trazos (generadas con IA) a partir de las que Trazo construye sus pinceles reales.

| Carpeta | Técnica en el plugin |
|---|---|
| `AGUADAS/` | Acuarela |
| `GUACHE/` | Gouache |
| `LAPIZ/` | Lápiz |
| `OLEO/` | Óleo |
| `CERAS/` | Ceras |

## Cómo subirlas
1. En GitHub, entra en la carpeta de la técnica (por ejemplo `trazos/OLEO`).
2. **Add file › Upload files** y arrastra las imágenes de esa técnica.
3. **Commit changes**.

## Formato de las imágenes
- 9:16 en vertical, fondo blanco y trazos en gris.
- Tres trazos por imagen, separados entre sí.
- Verticales y **empezando arriba**.
- No hace falta nombrarlas: la carpeta indica la técnica y el procesado les pone nombre.

## Qué hace el procesado
1. Limpia el fondo y separa cada trazo, uniendo sus fragmentos y migas cercanas.
2. Convierte el gris en cantidad de pintura (más oscuro = más carga).
3. Calcula la línea central, la anchura y la dirección, y estima el relieve.
4. Genera una hoja de contacto numerada para revisar qué trazos se quedan.
