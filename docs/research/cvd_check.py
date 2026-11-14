#!/usr/bin/env python3
"""Colour-vision-deficiency check for the Flickline palette (docs/research/cues.md).

Simulation: Machado, Oliveira & Fernandes (2009), severity 1.0, applied in linear sRGB.
Contrast: WCAG 2.x relative-luminance ratio. Distinctness: CIE76 delta E in CIELAB (D65).
Run: python3 -I docs/research/cvd_check.py
"""
import itertools

PAL = {
    'ink': '0B0D14', 'slate': '151A26', 'steel': '26304A', 'trim': '38E8FF', 'ember': 'FF5A36',
    'core': 'FFF1D6', 'gold': 'FFD23F', 'ok': '5BF2A5', 'warn': 'FFB020', 'alert': 'FF3D5A',
    # proposed additions (not in design yet)
    'white': 'FFFFFF', 'magenta': 'FF4FD8', 'lime': '9CFF3A',
}
M = {
    'normal': [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    'protan': [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    'deutan': [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    'tritan': [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}

def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def rgb(h):
    return [lin(int(h[i:i + 2], 16)) for i in (0, 2, 4)]

def sim(h, kind):
    v = rgb(h)
    m = M[kind]
    return [min(1.0, max(0.0, sum(m[r][c] * v[c] for c in range(3)))) for r in range(3)]

def lum(v):
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]

def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def lab(v):
    x = 0.4124564 * v[0] + 0.3575761 * v[1] + 0.1804375 * v[2]
    y = 0.2126729 * v[0] + 0.7151522 * v[1] + 0.0721750 * v[2]
    z = 0.0193339 * v[0] + 0.1191920 * v[1] + 0.9503041 * v[2]
    def f(t):
        return t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116
    fx, fy, fz = f(x / 0.95047), f(y), f(z / 1.08883)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))

def de(a, b):
    la, lb = lab(a), lab(b)
    return sum((p - q) ** 2 for p, q in zip(la, lb)) ** 0.5

if __name__ == '__main__':
    kinds = list(M)
    print('## Contrast vs ink (WCAG ratio)')
    print('colour    ' + '  '.join(f'{k:>7}' for k in kinds))
    for n in PAL:
        if n == 'ink':
            continue
        print(f'{n:<9} ' + '  '.join(f'{contrast(sim(PAL[n], k), sim(PAL["ink"], k)):7.2f}' for k in kinds))
    print('\n## Echo colours vs environment surfaces (min over ink/slate/steel)')
    for n in ('ember', 'magenta', 'lime', 'warn', 'white'):
        print(f'{n:<9} ' + '  '.join(f'{min(contrast(sim(PAL[n], k), sim(PAL[s], k)) for s in ("ink", "slate", "steel")):7.2f}' for k in kinds))
    pairs = [('gold', 'core'), ('gold', 'warn'), ('gold', 'white'), ('ok', 'alert'), ('ember', 'alert'), ('trim', 'ok'),
             ('ember', 'warn'), ('ember', 'magenta'), ('ember', 'lime'), ('warn', 'alert'), ('trim', 'core'), ('core', 'white')]
    print('\n## Pair distinctness: delta E76 (>= 20 clearly separable, < 10 risky)  | luminance ratio')
    print('pair                ' + '  '.join(f'{k:>7}' for k in kinds) + '    lumratio(normal)')
    for a, b in pairs:
        des = '  '.join(f'{de(sim(PAL[a], k), sim(PAL[b], k)):7.1f}' for k in kinds)
        print(f'{a + "/" + b:<19} {des}    {contrast(sim(PAL[a], "normal"), sim(PAL[b], "normal")):.2f}')
