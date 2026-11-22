"""Swap the demo member's name in the store captures ("Alex" -> "Tony",
owner 2026-11-18) without re-shooting: erase the glyphs (mask + interpolate
the background from the surrounding pixels) and set the new text in the app's
own fonts at the measured size.

    python3 rename.py <shots/en> <out dir> <mobile/node_modules/@expo-google-fonts>
writes hero.png and casa-web.png (patched copies) into <out dir>.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

src, out, gf = sys.argv[1:4]
NUNITO = f'{gf}/nunito/800ExtraBold/Nunito_800ExtraBold.ttf'
HANKEN = f'{gf}/hanken-grotesk/600SemiBold/HankenGrotesk_600SemiBold.ttf'


def erase(im, box, is_text, grow=3):
    """Mask the text pixels in box (grown a little for anti-aliasing) and
    fill each from the nearest clean pixels left/right and up/down."""
    px = im.load()
    x0, y0, x1, y1 = box
    mask = {(x, y) for y in range(y0, y1) for x in range(x0, x1) if is_text(px[x, y])}
    for _ in range(grow):
        mask |= {(x + dx, y + dy) for (x, y) in mask for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))}
    for (x, y) in sorted(mask):
        samples = []
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k = 1
            while (x + dx * k, y + dy * k) in mask:
                k += 1
            nx, ny = x + dx * k, y + dy * k
            if 0 <= nx < im.width and 0 <= ny < im.height:
                samples.append((1 / k, px[nx, ny]))
        w = sum(s for s, _ in samples)
        px[x, y] = tuple(round(sum(s * c[i] for s, c in samples) / w) for i in range(3))


def fit(font_path, text, width):
    """The font size whose ink width matches the text it replaces."""
    size = 10
    while ImageFont.truetype(font_path, size + 1).getbbox(text)[2] - ImageFont.truetype(font_path, size + 1).getbbox(text)[0] <= width:
        size += 1
    return ImageFont.truetype(font_path, size)


def put(im, text, font, left, baseline, color):
    """Ink starts at x=left; the text sits on the measured baseline."""
    l = font.getbbox(text, anchor='ls')[0]
    ImageDraw.Draw(im).text((left - l, baseline), text, font=font, fill=color, anchor='ls')


# ---- Home: "Hi, Alex." ------------------------------------------------------
hero = Image.open(f'{src}/hero.png').convert('RGB')
ink = (30, 30, 34)
f = fit(NUNITO, 'Hi, Alex.', 483 - 56)
# Erase only "Alex." (keep "Hi, "): its ink starts after the comma.
hi_l, _, hi_r, _ = f.getbbox('Hi, ')
alex_x = 56 + (f.getlength('Hi, ') - f.getbbox('Hi, ')[0])
erase(hero, (int(alex_x) - 6, 360, 500, 482), lambda c: sum(c) < 330)
put(hero, 'Tony.', f, int(alex_x) + (f.getbbox('A')[0]), 458, ink)  # baseline of the H

# ---- avatar initial "A" -> "T" (blue on the pale blue circle) -------------
cx, cy = 120, 750
blue = (47, 98, 196)
erase(hero, (92, 718, 150, 782), lambda c: c[2] - c[0] > 70 and (c[0] + c[1]) < 330, grow=2)
fa = ImageFont.truetype(NUNITO, 58)
l, t, r, b = fa.getbbox('T')
ImageDraw.Draw(hero).text((cx - (l + r) / 2, cy - (t + b) / 2), 'T', font=fa, fill=blue)

# ---- "Sport · Alex" on the green card ------------------------------------
white = lambda c: min(c) > 200
fs = fit(HANKEN, 'Sport · Alex', 1135 - 937)
sport_end = 937 + fs.getlength('Sport · ') - fs.getbbox('Sport · ')[0]
erase(hero, (int(sport_end) - 4, 1095, 1150, 1152), white)
put(hero, 'Tony', fs, int(sport_end) + fs.getbbox('A')[0], 1142, (255, 255, 255))  # baseline of the S
hero.save(f'{out}/hero.png')

# ---- Modo Casa: the name under the photo avatar --------------------------
casa = Image.open(f'{src}/casa-web.png').convert('RGB')
erase(casa, (312, 955, 380, 985), lambda c: min(c) > 150)
fc = fit(HANKEN, 'Alex', 371 - 320)
w = fc.getbbox('Tony')[2] - fc.getbbox('Tony')[0]
put(casa, 'Tony', fc, round((320 + 371) / 2 - w / 2), 979, (235, 230, 225))
casa.save(f'{out}/casa-web.png')
print('patched hero.png, casa-web.png')
