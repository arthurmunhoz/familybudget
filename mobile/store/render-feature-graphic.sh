#!/bin/bash
# Re-render mobile/store/play-feature-graphic.png from its HTML source.
#
# Play wants exactly 1024x500, no transparency. Headless Chrome renders at 2x
# and Pillow downsizes (crisper text than a 1x render). Fonts are the same
# Nunito + Hanken Grotesk the store slides use, copied from mobile/node_modules
# (@expo-google-fonts, NOT committed). The phone and Modo Casa pictures are
# the store captures: app-store-v4/shots/en/hero-play.png and casa-web.png.
#
# Usage:  bash mobile/store/render-feature-graphic.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mobile="$(cd "$here/.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
gf="$mobile/node_modules/@expo-google-fonts"
shots="$here/app-store-v4/shots/en"
[ -x "$chrome" ] || { echo "Google Chrome not found at $chrome"; exit 1; }
[ -d "$gf/nunito" ] || { echo "Run npm install in $mobile first"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$here/play-feature-graphic.html" "$tmp/graphic.html"
cp "$mobile/assets/images/icon.png" "$tmp/icon.png"
cp "$shots/hero-play.png" "$tmp/hero.png"   # Home without the Whereabouts tile (off on Android)
cp "$shots/casa-web.png" "$tmp/casa.png"
cp "$gf/nunito/800ExtraBold/Nunito_800ExtraBold.ttf" "$tmp/nunito-800.ttf"
cp "$gf/nunito/700Bold/Nunito_700Bold.ttf" "$tmp/nunito-700.ttf"
cp "$gf/hanken-grotesk/600SemiBold/HankenGrotesk_600SemiBold.ttf" "$tmp/hanken-600.ttf"

"$chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --allow-file-access-from-files --virtual-time-budget=4000 \
  --window-size=1024,500 --screenshot="$tmp/raw.png" "file://$tmp/graphic.html" 2>/dev/null

python3 - "$tmp/raw.png" "$here/play-feature-graphic.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")   # convert(): Play rejects alpha
assert im.size == (2048, 1000), im.size
im = im.resize((1024, 500), Image.LANCZOS)
im.save(sys.argv[2], "PNG", optimize=True)
print("wrote", sys.argv[2], im.size, im.mode)
PY
