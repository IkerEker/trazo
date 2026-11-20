# Iconos SVG propios de Trazo · Captura (formas simples compatibles con UXP).
import os
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "captura", "icons")
os.makedirs(OUT, exist_ok=True)
GRAY, GREEN, INK, WHITE = "#c9d0c8", "#3ee08f", "#04170c", "#f2f5f1"
AMBER, RED = "#ffb547", "#ff6b6b"

def svg(body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">{body}</svg>\n'

def S(c, w=1.7):
    return f'fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"'

ICONS = {
    "scan": f'<rect x="3.5" y="9" width="17" height="9" rx="2" {S(WHITE, 1.6)}/><path d="M6 6.5H18" {S(WHITE, 1.6)}/><path d="M7 13.5H17" {S(GREEN, 1.8)}/>',
    "folder": f'<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5H9.5L11.5 7.5H18.5A2 2 0 0 1 20.5 9.5V16.5A2 2 0 0 1 18.5 18.5H5.5A2 2 0 0 1 3.5 16.5Z" {S(WHITE, 1.6)}/>',
    "template": f'<rect x="4" y="4" width="16" height="16" rx="2" {S(WHITE, 1.5)}/><path d="M7.5 6V9M6 7.5H9" {S(GREEN, 1.6)}/><path d="M16.5 6V9M15 7.5H18" {S(GREEN, 1.6)}/><path d="M7.5 15V18M6 16.5H9" {S(GREEN, 1.6)}/><path d="M16.5 15V18M15 16.5H18" {S(GREEN, 1.6)}/>',
    "save-dark": f'<path d="M5 4.5H16L19.5 8V18.5A1 1 0 0 1 18.5 19.5H5.5A1 1 0 0 1 4.5 18.5V5A.5.5 0 0 1 5 4.5Z" {S(INK, 2)}/><path d="M8 4.5V9H15V4.5" {S(INK, 2)}/><rect x="8" y="13" width="8" height="6.5" fill="{INK}"/>',
    "minus": f'<path d="M6.5 12H17.5" {S(GRAY, 2)}/>',
    "plus": f'<path d="M6.5 12H17.5M12 6.5V17.5" {S(GRAY, 2)}/>',
    "check-dark": f'<path d="M5.5 12.5 10 17 18.5 7.5" {S(INK, 3)}/>',
    "ok": f'<circle cx="12" cy="12" r="9" fill="{GREEN}"/><path d="M7.8 12.4 10.8 15.3 16.4 9.2" {S(INK, 2.2)}/>',
    "warn": f'<path d="M12 3.5 21 19.5H3Z" fill="{AMBER}" stroke="{AMBER}" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 9.5V13.8" {S("#2b1a00", 2.2)}/><circle cx="12" cy="16.6" r="1.2" fill="#2b1a00"/>',
    "bad": f'<circle cx="12" cy="12" r="9" fill="{RED}"/><path d="M8.8 8.8 15.2 15.2M15.2 8.8 8.8 15.2" {S("#2a0505", 2.2)}/>',
}
SOPORTE = lambda c: (f'<rect x="4" y="4" width="16" height="16" rx="1.5" {S(c)}/>'
                     f'<path d="M4 9.3H20M4 14.6H20M9.3 4V20M14.6 4V20" {S(c, 0.9)}/>')
ICONS["t-soporte"] = SOPORTE(GRAY)
ICONS["t-soporte-on"] = SOPORTE(GREEN)
for k, b in ICONS.items():
    open(os.path.join(OUT, k + ".svg"), "w").write(svg(b))

# marca y glifos del panel: trazo de pincel dentro de esquinas de escáner
MARK = (f'<rect x="1" y="1" width="22" height="22" rx="6.5" fill="{GREEN}"/>'
        f'<path d="M5.5 9V5.5H9M15 5.5H18.5V9M18.5 15V18.5H15M9 18.5H5.5V15" fill="none" stroke="{INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="M8.2 14.2C9.6 10.4 11.4 14.8 12.9 11 13.6 9.2 14.8 9 15.8 9.8" fill="none" stroke="{INK}" stroke-width="2.1" stroke-linecap="round"/>')
open(os.path.join(OUT, "mark.svg"), "w").write(svg(MARK))

def glyph(c):
    return svg(f'<path d="M4 8.5V4H8.5M15.5 4H20V8.5M20 15.5V20H15.5M8.5 20H4V15.5" fill="none" stroke="{c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
               f'<path d="M7.5 14.5C9.2 10 11.3 15.2 13.1 10.6 13.9 8.6 15.4 8.3 16.6 9.2" fill="none" stroke="{c}" stroke-width="2.2" stroke-linecap="round"/>')
src = os.path.join(HERE, "icons-src")
os.makedirs(src, exist_ok=True)
open(os.path.join(src, "captura-dark.svg"), "w").write(glyph("#e8ebe7"))
open(os.path.join(src, "captura-light.svg"), "w").write(glyph("#3a3f39"))
print("iconos de Captura generados")
