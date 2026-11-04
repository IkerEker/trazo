# TEXTURES

Material real con el que pinta Trazo. Cada técnica tiene su carpeta con el mismo nombre en
todas las secciones: `OLEO`, `GUACHE`, `AGUADAS` (acuarela), `LAPIZ` y `ROTULADORES`.
`CERAS` se mantiene por si se usa en la mixta completa. Los estilos mixtos no tienen carpeta
propia: combinan el material de sus técnicas.

| Carpeta | Qué va dentro |
|---|---|
| `PINCELADAS/` | Trazos sueltos: 9:16, fondo blanco, 3 trazos verticales que empiezan arriba (ya están) |
| `MANCHAS/` | Una mancha por imagen, centrada sobre fondo blanco |
| `TILEABLES/` | Texturas que se repiten sin costuras, para rellenar zonas |
| `PAPEL/` | Papeles y lienzos de fondo, también repetibles sin costuras |

Cada carpeta lleva un README con lo que necesito exactamente.

## Cómo subirlas con GitHub Desktop
1. Pulsa **Fetch origin** y después **Pull origin** (las pinceladas se han movido a `PINCELADAS/`).
2. **Repository › Show in Explorer** y copia tus imágenes en la carpeta que corresponda.
3. Escribe un resumen, pulsa **Commit to main** y después **Push origin**.

## Formatos
- PNG o JPG de máxima calidad, en RGB (no CMYK).
- Mínimo 1024 px de lado; mejor 2048 px.
- Los nombres son libres. La carpeta indica la técnica, y el contenido lo analizo yo.
