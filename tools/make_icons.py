"""Render the app icons with no dependencies (signed-distance shapes -> PNG).
Run: python3 tools/make_icons.py
"""
import math, struct, zlib, os

TOMATO = (0xF2, 0x54, 0x2D)
CREAM = (0xF4, 0xEF, 0xE6)
INK = (0x17, 0x14, 0x0F)

def sd_round_rect(px, py, x0, y0, x1, y1, r):
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2 - r, (y1 - y0) / 2 - r
    qx, qy = abs(px - cx) - hx, abs(py - cy) - hy
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r

def sd_segment(px, py, ax, ay, bx, by, w):
    pax, pay, bax, bay = px - ax, py - ay, bx - ax, by - ay
    h = max(0, min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)))
    return math.hypot(pax - bax * h, pay - bay * h) - w / 2

def blend(c, d, a):
    return tuple(c[i] * (1 - a) + d[i] * a for i in range(3))

def render(size, scale_content=1.0):
    s = size / 512
    k = scale_content
    def T(v):  # scale around center for maskable safe zone
        return (256 + (v - 256) * k) * s
    card = (T(118), T(118), T(378), T(378), 44 * k * s)
    shadow_off = 20 * k * s
    check = [(T(178), T(262)), (T(232), T(316)), (T(336), T(196))]
    stroke = 38 * k * s
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            col = TOMATO
            d = sd_round_rect(px - shadow_off, py - shadow_off, *card)
            col = blend(col, INK, max(0, min(1, 0.5 - d)))
            d = sd_round_rect(px, py, *card)
            col = blend(col, CREAM, max(0, min(1, 0.5 - d)))
            d = min(sd_segment(px, py, *check[0], *check[1], stroke), sd_segment(px, py, *check[1], *check[2], stroke))
            col = blend(col, INK, max(0, min(1, 0.5 - d)))
            row += bytes(int(round(c)) for c in col)
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, data):
        return struct.pack('>I', len(data)) + t + data + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

out = os.path.join(os.path.dirname(__file__), '..', 'icons')
for name, size, k in [('icon-192.png', 192, 1.0), ('icon-512.png', 512, 1.0), ('apple-touch-icon.png', 180, 1.0), ('icon-maskable-512.png', 512, 0.8)]:
    with open(os.path.join(out, name), 'wb') as f:
        f.write(render(size, k))
    print('wrote', name)
