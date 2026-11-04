# Genera los iconos SVG del panel (formas simples compatibles con UXP).
import os
OUT = os.path.join(os.path.dirname(__file__), "..", "plugin", "icons")
os.makedirs(OUT, exist_ok=True)
GRAY, GREEN, INK, WHITE = "#c9d0c8", "#3ee08f", "#04170c", "#f2f5f1"

def svg(body, size=24):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 24 24">{body}</svg>\n'

def S(c, w=1.7):
    return f'fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"'

TECH = {
    # lápiz: cuerpo, virola y punta
    "lapiz": lambda c: f'<path d="M15.2 4.6 19.4 8.8 8.6 19.6 3.6 20.4 4.4 15.4Z" {S(c)}/>'
                       f'<path d="M13.2 6.6 17.4 10.8" {S(c)}/>'
                       f'<path d="M4.4 15.4 8.6 19.6" {S(c)}/>'
                       f'<path d="M3.6 20.4 5.4 18.6" {S(c, 2.2)}/>',
    # óleo: paleta con agujero y manchas
    "oleo": lambda c: f'<path d="M12 3.5C6.8 3.5 3 7.1 3 11.6c0 4.4 3.6 8.4 8.6 8.4 1.6 0 2.2-.9 2.2-1.8 0-1.4-1.3-1.7-1.3-3 0-1 .8-1.7 2-1.7h2.2c2.6 0 4.3-1.7 4.3-4.1C21 6.2 17.2 3.5 12 3.5Z" {S(c)}/>'
                      f'<circle cx="7.6" cy="11.2" r="1.3" fill="{c}"/><circle cx="10.2" cy="7.6" r="1.3" fill="{c}"/><circle cx="14.6" cy="7.4" r="1.3" fill="{c}"/>',
    # gouache: pincel plano
    "gouache": lambda c: f'<path d="M20.5 3.5 12.8 11.2" {S(c, 2)}/>'
                         f'<path d="M13.6 9.4 14.6 10.4 11.4 13.6 10.4 12.6Z" {S(c)}/>'
                         f'<path d="M10.6 12.8 11.2 13.4C11.2 16.6 9.2 19.6 4 20.2 4.4 15.6 7 13 10.6 12.8Z" {S(c)}/>',
    # ceras: barra de cera con punta y bandas
    "ceras": lambda c: f'<path d="M14.6 3.8 20.2 9.4 10.4 19.2 4.8 13.6Z" {S(c)}/>'
                       f'<path d="M4.8 13.6 3.4 18.2 5.8 20.6 10.4 19.2" {S(c)}/>'
                       f'<path d="M12.2 6.2 17.8 11.8" {S(c)}/><path d="M9.8 8.6 15.4 14.2" {S(c)}/>',
    # acuarela: gota y mancha
    "acuarela": lambda c: f'<path d="M12 3.2C9.4 7 7.4 9.6 7.4 12.4a4.6 4.6 0 0 0 9.2 0C16.6 9.6 14.6 7 12 3.2Z" {S(c)}/>'
                          f'<path d="M3.5 20.3c2.4-1.3 4.8-1.3 7.2 0s4.8 1.3 7.2 0c.9-.5 1.7-.7 2.6-.8" {S(c)}/>'
                          f'<path d="M10.2 12.8c.2 1.1.9 1.8 2 2" {S(c, 1.3)}/>',
    # rotulador: cuerpo, punta biselada y trazo
    "rotulador": lambda c: f'<path d="M14.5 3.8 20.2 9.5 11.4 18.3 5.7 12.6Z" {S(c)}/>'
                           f'<path d="M5.7 12.6 3.6 18.6 5.4 20.4 11.4 18.3" {S(c)}/>'
                           f'<path d="M12.6 5.7 18.3 11.4" {S(c)}/>',
    # mixta lápiz + gouache: lápiz cruzado sobre una mancha
    "mixtalg": lambda c: f'<path d="M4 15.5C4 11 8.5 9 12 10.2 15.8 11.5 18 15 15.5 18.5 13 21.5 4 20.5 4 15.5Z" fill="{c}" opacity="0.35" stroke="none"/>'
                         f'<path d="M17.8 3.2 20.8 6.2 9.2 17.8 5.4 18.6 6.2 14.8Z" {S(c)}/>'
                         f'<path d="M15.8 5.2 18.8 8.2" {S(c)}/>',
    # mixta completa: recortes superpuestos y garabato
    "mixta": lambda c: f'<rect x="3.5" y="4" width="9.5" height="9.5" rx="1" transform="rotate(-6 8 9)" {S(c)}/>'
                       f'<rect x="10.5" y="10" width="9.5" height="9.5" rx="1" fill="{c}" opacity="0.35" stroke="none"/>'
                       f'<path d="M4.5 18.5c2-2 3 1 5-1.2s2.6 1 4.5-.6" {S(c, 1.5)}/>',
    # xilografía: gubia y cortes
    "xilografia": lambda c: f'<rect x="3.5" y="3.5" width="17" height="17" rx="1.5" {S(c)}/>'
                            f'<path d="M6.5 8.5 17.5 7M6.5 12 17.5 10.8M6.5 15.6 13.5 14.8" {S(c, 1.6)}/>',
}
for k, f in TECH.items():
    open(os.path.join(OUT, f"t-{k}.svg"), "w").write(svg(f(GRAY)))
    open(os.path.join(OUT, f"t-{k}-on.svg"), "w").write(svg(f(GREEN)))

UI = {
    "refresh": f'<path d="M19.5 11A7.5 7.5 0 1 0 17.3 16.3" {S(GRAY, 1.8)}/><path d="M20 4.5V9.5H15" {S(GRAY, 1.8)}/>',
    "image": f'<rect x="3.5" y="5" width="17" height="14" rx="2.5" {S(GRAY, 1.5)}/><circle cx="9" cy="10" r="1.6" {S(GRAY, 1.5)}/><path d="M4 17.5 9.5 13 13 16 16 13.5 20 17" {S(GRAY, 1.5)}/>',
    "chevron-up": f'<path d="M6.5 14.5 12 9 17.5 14.5" {S(GRAY, 2)}/>',
    "chevron-down": f'<path d="M6.5 9.5 12 15 17.5 9.5" {S(GRAY, 2)}/>',
    "dice": f'<rect x="4" y="4" width="16" height="16" rx="3.5" {S(WHITE, 1.6)}/><circle cx="8.6" cy="8.6" r="1.3" fill="{WHITE}"/><circle cx="15.4" cy="15.4" r="1.3" fill="{WHITE}"/><circle cx="12" cy="12" r="1.3" fill="{WHITE}"/><circle cx="15.4" cy="8.6" r="1.3" fill="{WHITE}"/><circle cx="8.6" cy="15.4" r="1.3" fill="{WHITE}"/>',
    "download": f'<path d="M12 4V15" {S(WHITE, 1.8)}/><path d="M7.5 10.5 12 15 16.5 10.5" {S(WHITE, 1.8)}/><path d="M5 19.5H19" {S(WHITE, 1.8)}/>',
    "brush-dark": f'<path d="M20.5 3.5 11.6 12.4" {S(INK, 2.2)}/><path d="M11 11.6C7.6 11.4 5.6 13.8 5.4 16.2 5.2 18.2 4.4 19.4 3.4 20.2 7.8 21 12.4 18.8 12.6 13.2Z" fill="{INK}" stroke="{INK}" stroke-width="1.2" stroke-linejoin="round"/>',
    "stop": f'<rect x="6" y="6" width="12" height="12" rx="2.5" fill="{GREEN}"/>',
}
for k, body in UI.items():
    open(os.path.join(OUT, f"{k}.svg"), "w").write(svg(body))

# marca: cuadrado verde redondeado con un trazo de pincel
MARK = (f'<rect x="1" y="1" width="22" height="22" rx="6.5" fill="{GREEN}"/>'
        f'<path d="M6 15.8C8.2 9.6 11 16.6 13.4 10.4 14.6 7.4 16.4 7 18 8.2" fill="none" stroke="{INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<circle cx="17.6" cy="15.6" r="1.6" fill="{INK}"/>')
open(os.path.join(OUT, "mark.svg"), "w").write(svg(MARK))

# glifos monocromos para el icono del panel (se rasterizan a PNG)
def glyph(c):
    return svg(f'<path d="M5 16.5C7.6 9 10.8 17.5 13.6 10 15 6.4 17.2 5.8 19 7.2" fill="none" stroke="{c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
               f'<circle cx="18.4" cy="16.6" r="1.9" fill="{c}"/>')
open(os.path.join(os.path.dirname(__file__), "icons-src", "glyph-dark.svg"), "w").write(glyph("#e8ebe7"))
open(os.path.join(os.path.dirname(__file__), "icons-src", "glyph-light.svg"), "w").write(glyph("#3a3f39"))
print("iconos SVG generados en", os.path.abspath(OUT))
