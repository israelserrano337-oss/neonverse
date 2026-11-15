#!/usr/bin/env python3
"""NEONVERSE AI 2.0 — generador de la identidad visual.

Escribe los SVG originales (icono principal, simplificado, monocromo, instalador,
logotipo) en app/assets/brand/ y los rasteriza con rsvg-convert:
  - icon-1024.png (transparente), icon-512.png, favicon-32.png, favicon-64.png
  - build/icon.ico (multirresolución 16-256), build/installer.ico, build/icons/*.png
Uso: python3 scripts/build-icons.py
"""
import math, os, struct, subprocess, sys, io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, 'app', 'assets', 'brand')
BUILD = os.path.join(ROOT, 'build')
os.makedirs(BRAND, exist_ok=True)
os.makedirs(os.path.join(BUILD, 'icons'), exist_ok=True)

CYAN, VIOLET, MAGENTA = '#00f0ff', '#8a2bff', '#ff2bd6'


def hexagon(cx, cy, r, rot_deg, sides=6):
    pts = []
    for i in range(sides):
        a = math.radians(rot_deg + i * 360 / sides - 90)
        pts.append(f'{cx + r * math.cos(a):.2f},{cy + r * math.sin(a):.2f}')
    return ' '.join(pts)


def defs(mono=False):
    if mono:
        return '<defs><filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>'
    return f'''<defs>
  <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="{CYAN}"/><stop offset="0.5" stop-color="{VIOLET}"/><stop offset="1" stop-color="{MAGENTA}"/>
  </linearGradient>
  <linearGradient id="ringGrad2" x1="1" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="{MAGENTA}"/><stop offset="0.5" stop-color="{VIOLET}"/><stop offset="1" stop-color="{CYAN}"/>
  </linearGradient>
  <radialGradient id="tile" cx="0.5" cy="0.44" r="0.75">
    <stop offset="0" stop-color="#1a0b3d"/><stop offset="0.55" stop-color="#0a0520"/><stop offset="1" stop-color="#03020a"/>
  </radialGradient>
  <radialGradient id="core" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#ffffff"/><stop offset="0.22" stop-color="#d9fdff"/>
    <stop offset="0.45" stop-color="{CYAN}"/><stop offset="0.75" stop-color="{VIOLET}" stop-opacity="0.55"/>
    <stop offset="1" stop-color="{MAGENTA}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="{VIOLET}" stop-opacity="0.55"/><stop offset="0.6" stop-color="{MAGENTA}" stop-opacity="0.12"/>
    <stop offset="1" stop-color="{MAGENTA}" stop-opacity="0"/>
  </radialGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="9" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
</defs>'''


def portal(cx, cy, vx, vy, n, r0, ratio, twist, w0, mono=False, color='#ffffff'):
    """Anillos hexagonales que convergen hacia el punto de fuga (vx, vy)."""
    out = []
    for i in range(n):
        k = i / max(1, n - 1)
        r = r0 * (ratio ** i)
        x = cx + (vx - cx) * (1 - ratio ** i)
        y = cy + (vy - cy) * (1 - ratio ** i)
        w = max(2.2, w0 * (ratio ** (i * 0.8)))
        op = 1.0 - 0.45 * k
        stroke = color if mono else ('url(#ringGrad)' if i % 2 == 0 else 'url(#ringGrad2)')
        out.append(f'<polygon points="{hexagon(x, y, r, i * twist)}" fill="none" stroke="{stroke}" '
                   f'stroke-width="{w:.2f}" stroke-linejoin="round" opacity="{op:.2f}"/>')
    return '\n'.join(out)


def rays(cx, cy, n, r1, r2, mono=False, color='#fff'):
    out = []
    for i in range(n):
        a = math.radians(i * 360 / n + 15)
        x1, y1 = cx + r1 * math.cos(a), cy + r1 * math.sin(a)
        x2, y2 = cx + r2 * math.cos(a), cy + r2 * math.sin(a)
        c = color if mono else (CYAN if i % 3 == 0 else (VIOLET if i % 3 == 1 else MAGENTA))
        out.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{c}" stroke-width="3" stroke-linecap="round" opacity="0.55"/>')
    return '\n'.join(out)


def icon_main(tile=True):
    cx, cy, vx, vy = 512, 540, 512, 468
    body = []
    if tile:
        body.append('<rect x="32" y="32" width="960" height="960" rx="216" fill="url(#tile)"/>')
        body.append('<rect x="34" y="34" width="956" height="956" rx="214" fill="none" stroke="url(#ringGrad)" stroke-width="4" opacity="0.65"/>')
    body.append(f'<circle cx="{vx}" cy="{vy}" r="330" fill="url(#halo)"/>')
    body.append('<g filter="url(#glow)">')
    body.append(portal(cx, cy, vx, vy, 9, 400, 0.78, 7.5, 26))
    body.append(rays(vx, vy, 12, 70, 150))
    body.append('</g>')
    body.append(f'<circle cx="{vx}" cy="{vy}" r="120" fill="url(#core)" filter="url(#soft)"/>')
    body.append(f'<circle cx="{vx}" cy="{vy}" r="62" fill="url(#core)"/>')
    body.append(f'<circle cx="{vx}" cy="{vy}" r="20" fill="#ffffff"/>')
    return svg(1024, defs() + '\n'.join(body))


def icon_simple(tile=True):
    cx, cy, vx, vy = 512, 530, 512, 480
    body = []
    if tile:
        body.append('<rect x="32" y="32" width="960" height="960" rx="216" fill="url(#tile)"/>')
    body.append('<g filter="url(#glow)">')
    body.append(portal(cx, cy, vx, vy, 3, 380, 0.62, 10, 64))
    body.append('</g>')
    body.append(f'<circle cx="{vx}" cy="{vy}" r="150" fill="url(#core)"/>')
    body.append(f'<circle cx="{vx}" cy="{vy}" r="56" fill="#ffffff"/>')
    return svg(1024, defs() + '\n'.join(body))


def icon_mono(color='#ffffff'):
    cx, cy, vx, vy = 512, 540, 512, 468
    body = [f'<g filter="url(#glow)">', portal(cx, cy, vx, vy, 7, 420, 0.75, 7.5, 30, mono=True, color=color),
            rays(vx, vy, 12, 80, 150, mono=True, color=color), '</g>',
            f'<circle cx="{vx}" cy="{vy}" r="58" fill="{color}"/>']
    return svg(1024, defs(mono=True) + '\n'.join(body))


def icon_installer():
    inner = icon_main(tile=True)
    badge = f'''<g>
  <circle cx="800" cy="800" r="150" fill="#05030f" stroke="url(#ringGrad)" stroke-width="14"/>
  <path d="M800 715 V860 M742 808 L800 866 L858 808" fill="none" stroke="{CYAN}" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  <line x1="735" y1="895" x2="865" y2="895" stroke="{MAGENTA}" stroke-width="18" stroke-linecap="round"/>
</g>'''
    return inner.replace('</svg>', badge + '</svg>')


# ---------- Wordmark geométrico (trazos propios, independiente de fuentes) ----------
GLYPHS = {
    'N': (56, 'M0 80 V0 L56 80 V0'),
    'E': (50, 'M50 0 H0 V80 H50 M0 40 H40'),
    'O': (56, 'M14 0 H42 L56 14 V66 L42 80 H14 L0 66 V14 Z'),
    'V': (56, 'M0 0 L28 80 L56 0'),
    'R': (54, 'M0 80 V0 H40 L54 14 V30 L40 44 H0 M26 44 L54 80'),
    'S': (54, 'M54 0 H14 L0 14 V28 L14 40 H40 L54 52 V66 L40 80 H0'),
    'A': (58, 'M0 80 L29 0 L58 80 M11 52 H47'),
    'I': (0, 'M0 0 V80'),
    '2': (50, 'M0 14 L14 0 H36 L50 14 V30 L0 80 H50'),
    '0': (50, 'M12 0 H38 L50 12 V68 L38 80 H12 L0 68 V12 Z M8 74 L42 6'),
    '.': (8, 'M4 76 V80'),
    ' ': (24, ''),
}


def word(text, x, y, scale, spacing, stroke, sw):
    parts, cx = [], x
    for ch in text:
        w, d = GLYPHS[ch]
        if d:
            parts.append(f'<path d="{d}" transform="translate({cx:.1f},{y}) scale({scale})" fill="none" stroke="{stroke}" '
                         f'stroke-width="{sw / scale:.2f}" stroke-linecap="round" stroke-linejoin="round"/>')
        cx += (w + spacing) * scale
    return '\n'.join(parts), cx


def logo(horizontal=True, dark_bg=False):
    W, H = (2400, 640) if horizontal else (1200, 1400)
    body = []
    if dark_bg:
        body.append(f'<rect width="{W}" height="{H}" fill="#05030f"/>')
    if horizontal:
        sym = icon_main(tile=False)
        inner = sym[sym.index('<circle'):sym.rindex('</svg>')]
        body.append(f'<g transform="translate(40,40) scale(0.546875)">{inner}</g>')
        g, end = word('NEONVERSE', 640, 210, 1.9, 22, 'url(#wordGrad)', 13)
        body.append(f'<g filter="url(#glow)">{g}</g>')
        g2, _ = word('AI 2.0', 648, 430, 0.95, 20, MAGENTA, 8)
        body.append(f'<g filter="url(#glow)">{g2}</g>')
        body.append(f'<line x1="1080" y1="468" x2="{end - 40:.0f}" y2="468" stroke="url(#wordGrad)" stroke-width="5" stroke-linecap="round" opacity="0.8"/>')
    else:
        sym = icon_main(tile=False)
        inner = sym[sym.index('<circle'):sym.rindex('</svg>')]
        body.append(f'<g transform="translate(200,40) scale(0.78125)">{inner}</g>')
        total = sum((GLYPHS[c][0] + 18) * 1.25 for c in 'NEONVERSE')
        g, _ = word('NEONVERSE', (W - total) / 2 + 10, 940, 1.25, 18, 'url(#wordGrad)', 10)
        body.append(f'<g filter="url(#glow)">{g}</g>')
        total2 = sum((GLYPHS[c][0] + 16) * 0.8 for c in 'AI 2.0')
        g2, _ = word('AI 2.0', (W - total2) / 2, 1100, 0.8, 16, MAGENTA, 7)
        body.append(f'<g filter="url(#glow)">{g2}</g>')
    extra = f'<linearGradient id="wordGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{CYAN}"/><stop offset="0.5" stop-color="{VIOLET}"/><stop offset="1" stop-color="{MAGENTA}"/></linearGradient>'
    d = defs().replace('</defs>', extra + '</defs>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">{d}\n' + '\n'.join(body) + '</svg>'


def svg(size, content):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 1024 1024">\n{content}\n</svg>'


def write(name, text):
    p = os.path.join(BRAND, name)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(text)
    return p


def raster(svg_path, out, w, h=None):
    h = h or w
    subprocess.run(['rsvg-convert', '-w', str(w), '-h', str(h), '-o', out, svg_path], check=True)


def ico(out, entries):
    """ICO multirresolución con entradas PNG (válido en Windows Vista+)."""
    blobs = []
    for size, path in entries:
        with open(path, 'rb') as f:
            blobs.append((size, f.read()))
    header = struct.pack('<HHH', 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    dir_, data = b'', b''
    for size, b in blobs:
        s = 0 if size >= 256 else size
        dir_ += struct.pack('<BBBBHHII', s, s, 0, 0, 1, 32, len(b), offset + len(data))
        data += b
    with open(out, 'wb') as f:
        f.write(header + dir_ + data)


def main():
    files = {
        'icon.svg': icon_main(True),
        'icon-symbol.svg': icon_main(False),
        'icon-simple.svg': icon_simple(True),
        'icon-mono-white.svg': icon_mono('#ffffff'),
        'icon-mono-black.svg': icon_mono('#0a0a12'),
        'icon-installer.svg': icon_installer(),
        'logo-horizontal.svg': logo(True),
        'logo-vertical.svg': logo(False),
        'logo-horizontal-dark.svg': logo(True, True),
    }
    paths = {k: write(k, v) for k, v in files.items()}
    tmp = os.path.join(BUILD, 'icons')
    raster(paths['icon.svg'], os.path.join(BRAND, 'icon-1024.png'), 1024)
    raster(paths['icon.svg'], os.path.join(BRAND, 'icon-512.png'), 512)
    raster(paths['icon-symbol.svg'], os.path.join(BRAND, 'icon-symbol-1024.png'), 1024)
    raster(paths['icon-simple.svg'], os.path.join(BRAND, 'favicon-32.png'), 32)
    raster(paths['icon-simple.svg'], os.path.join(BRAND, 'favicon-64.png'), 64)
    raster(paths['icon-simple.svg'], os.path.join(BRAND, 'apple-touch-icon.png'), 180)
    raster(paths['icon-mono-white.svg'], os.path.join(BRAND, 'icon-mono-white-512.png'), 512)
    raster(paths['icon-installer.svg'], os.path.join(BRAND, 'icon-installer-512.png'), 512)
    raster(paths['logo-horizontal.svg'], os.path.join(BRAND, 'logo-horizontal.png'), 1200, 320)
    raster(paths['logo-horizontal-dark.svg'], os.path.join(BRAND, 'logo-horizontal-dark.png'), 1200, 320)
    raster(paths['logo-vertical.svg'], os.path.join(BRAND, 'logo-vertical.png'), 600, 700)
    entries, inst = [], []
    for s in (16, 24, 32, 48, 64, 128, 256):
        src = paths['icon-simple.svg'] if s <= 48 else paths['icon.svg']
        p = os.path.join(tmp, f'{s}x{s}.png')
        raster(src, p, s)
        entries.append((s, p))
        pi = os.path.join(tmp, f'installer-{s}.png')
        raster(paths['icon-simple.svg'] if s <= 32 else paths['icon-installer.svg'], pi, s)
        inst.append((s, pi))
    raster(paths['icon.svg'], os.path.join(tmp, '512x512.png'), 512)
    raster(paths['icon.svg'], os.path.join(BUILD, 'icon.png'), 1024)
    ico(os.path.join(BUILD, 'icon.ico'), entries)
    ico(os.path.join(BUILD, 'installer.ico'), inst)
    ico(os.path.join(BRAND, 'favicon.ico'), [e for e in entries if e[0] in (16, 32, 48, 64)])
    for f in os.listdir(tmp):
        if f.startswith('installer-'):
            os.remove(os.path.join(tmp, f))
    print('Identidad generada en', BRAND, 'y', BUILD)


if __name__ == '__main__':
    main()
