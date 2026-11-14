#!/bin/bash
# Render the App Store "Header and Search Results" creative assets (1.6.0)
# from creative.html, plus crop-check previews.
#
#   bash mobile/store/app-store-creative/render.sh
#
# Output (RGB PNG, NO alpha — App Store Connect rejects transparency):
#   out/header-3840x1646.png         product page header (21:9)
#   out/search-3840x2560.png         search results (3:2, max size)
#   out/universal-5244x2950.png      universal asset, one PNG for BOTH (16:9)
#   out/crop-check/<name>-*.png      Apple's art safe area outlined, and the
#                                    tightest 21:9 / 16:9 / 3:2 / 4:3 / 1:1
#                                    crops that still hold the safe area
# Same toolchain as render-feature-graphic.sh: Google Chrome headless (1×, the
# canvases are already full size), Pillow, fonts from mobile/node_modules
# (@expo-google-fonts — run npm install in mobile/ first). Pictures: the
# app icon, app-store-v4/shots/en/hero.png (Home) and casa-web.png (Modo Casa).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mobile="$(cd "$here/../.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
gf="$mobile/node_modules/@expo-google-fonts"
shots="$here/../app-store-v4/shots/en"
[ -x "$chrome" ] || { echo "Google Chrome not found at $chrome"; exit 1; }
[ -d "$gf/nunito" ] || { echo "Run npm install in $mobile first"; exit 1; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp "$here/creative.html" "$tmp/"
cp "$shots/hero.png" "$tmp/hero.png"
cp "$shots/casa-web.png" "$tmp/casa.png"
mkdir -p "$tmp/fonts" "$here/out/crop-check"
cp "$gf/nunito/800ExtraBold/Nunito_800ExtraBold.ttf" "$tmp/fonts/nunito-800.ttf"
cp "$gf/nunito/700Bold/Nunito_700Bold.ttf" "$tmp/fonts/nunito-700.ttf"
cp "$gf/hanken-grotesk/400Regular/HankenGrotesk_400Regular.ttf" "$tmp/fonts/hanken-400.ttf"
cp "$gf/hanken-grotesk/600SemiBold/HankenGrotesk_600SemiBold.ttf" "$tmp/fonts/hanken-600.ttf"
cp "$gf/fraunces/600SemiBold/Fraunces_600SemiBold.ttf" "$tmp/fonts/fraunces-600.ttf"

render() { # name w h
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --allow-file-access-from-files --virtual-time-budget=6000 \
    --window-size="$2,$3" --screenshot="$tmp/$1.png" "file://$tmp/creative.html?v=$1" 2>/dev/null
}
render header 3840 1646
render search 3840 2560
render universal 5244 2950

python3 - "$tmp" "$here/out" <<'PY'
import sys
from PIL import Image, ImageDraw
tmp, out = sys.argv[1], sys.argv[2]
SAFE = {  # Apple's art safe area: x, y, w, h
  'header':    ((3840, 1646), (1097, 493, 1646, 661)),
  'search':    ((3840, 2560), (836, 765, 2168, 1030)),
  'universal': ((5244, 2950), (1921, 660, 1402, 962)),
}
ASPECTS = [('21x9', 21/9), ('16x9', 16/9), ('3x2', 3/2), ('4x3', 4/3), ('1x1', 1.0)]
for name, ((W, H), (sx, sy, sw, sh)) in SAFE.items():
    im = Image.open(f'{tmp}/{name}.png').convert('RGB')  # drop alpha
    assert im.size == (W, H), (name, im.size)
    fn = f'{name}-{W}x{H}.png'
    im.save(f'{out}/{fn}', 'PNG', optimize=True)
    print('wrote', fn, im.size, im.mode)
    # 1. full frame with the safe area outlined
    g = im.copy(); d = ImageDraw.Draw(g)
    d.rectangle([sx, sy, sx + sw, sy + sh], outline=(0, 255, 234), width=max(6, W // 500))
    g.thumbnail((1600, 1600)); g.save(f'{out}/crop-check/{name}-safe-outline.png')
    # 2. exactly the safe area (worst case)
    c = im.crop((sx, sy, sx + sw, sy + sh)); c.thumbnail((1200, 1200))
    c.save(f'{out}/crop-check/{name}-safe-only.png')
    # 3. tightest crop of each aspect that still holds the safe area,
    #    centred on it and slid back inside the canvas
    cx, cy = sx + sw / 2, sy + sh / 2
    for tag, a in ASPECTS:
        w, h = (sw, sw / a) if sw / sh > a else (sh * a, sh)
        if w > W or h > H: continue
        x0 = min(max(cx - w / 2, 0), W - w); y0 = min(max(cy - h / 2, 0), H - h)
        c = im.crop((round(x0), round(y0), round(x0 + w), round(y0 + h))); c.thumbnail((1200, 1200))
        c.save(f'{out}/crop-check/{name}-min-{tag}.png')
PY
