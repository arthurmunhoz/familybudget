#!/bin/bash
# Render the v4 (1.6.0) TABLET store screenshots from slides-ipad.html.
#
#   bash mobile/store/app-store-v4/render-ipad.sh          # every language with iPad captures
#   bash mobile/store/app-store-v4/render-ipad.sh en       # one language
#
# Output, RGB with NO alpha:
#   out-ipad13/<lang>/NN-<id>.png        2064x2752  App Store "iPad 13-inch display" (10)
#   out-play-tablet10/<lang>/NN-<id>.png 1600x2560  Google Play 10" tablet (8)
#   out-play-tablet7/<lang>/NN-<id>.png  1200x1920  Google Play 7" tablet (same 8, resized)
# Modo Casa is slide 2 on tablets (an iPad IS the Modo Casa device). Play
# drops money + utilities (max 8) and uses the Play wording (no Apple
# Calendar, the hero without the Whereabouts tile — it's off on Android).
# Needs: Google Chrome, Python 3 + Pillow, `npm install` in mobile/ (fonts),
# and app-store-v3/out/<lang>/03-ai.png (the receipt illustration).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mobile="$(cd "$here/../.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
gf="$mobile/node_modules/@expo-google-fonts"
[ -x "$chrome" ] || { echo "Google Chrome not found"; exit 1; }
[ -d "$gf/nunito" ] || { echo "Run npm install in $mobile first"; exit 1; }

ORDER=(hero casa roof calendar lists receipt money games pets utilities)
PLAY=(hero casa roof calendar lists receipt games pets)
LANGS=("$@")
[ ${#LANGS[@]} -gt 0 ] || LANGS=($(ls "$here/shots-ipad"))

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp "$here"/{slides-ipad.html,copy.js,icons.js} "$tmp/"
cp -R "$here/shots" "$here/shots-ipad" "$here/assets" "$tmp/"
mkdir -p "$tmp/fonts"
cp "$gf/nunito/800ExtraBold/Nunito_800ExtraBold.ttf" "$tmp/fonts/nunito-800.ttf"
cp "$gf/nunito/700Bold/Nunito_700Bold.ttf" "$tmp/fonts/nunito-700.ttf"
cp "$gf/hanken-grotesk/400Regular/HankenGrotesk_400Regular.ttf" "$tmp/fonts/hanken-400.ttf"
cp "$gf/hanken-grotesk/600SemiBold/HankenGrotesk_600SemiBold.ttf" "$tmp/fonts/hanken-600.ttf"

shoot() { # url w h scale out
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor="$4" \
    --allow-file-access-from-files --virtual-time-budget=4000 --window-size="$2,$3" \
    --screenshot="$5" "$1" 2>/dev/null
}

for lang in "${LANGS[@]}"; do
  # The v3 receipt illustration, cut below its own headline (the slide sets its own).
  v3="$here/../app-store-v3/out/$lang/03-ai.png"
  [ -f "$v3" ] || v3="$here/../app-store-v3/out/en/03-ai.png"
  python3 - "$v3" "$tmp/shots-ipad/$lang/receipt-v3.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
im.crop((0, 680, im.width, im.height)).save(sys.argv[2])
PY
  mkdir -p "$here/out-ipad13/$lang" "$here/out-play-tablet10/$lang" "$here/out-play-tablet7/$lang"
  for i in "${!ORDER[@]}"; do
    id="${ORDER[$i]}"; name="$(printf %02d $((i + 1)))-$id.png"
    shoot "file://$tmp/slides-ipad.html?slide=$id&lang=$lang&fmt=ipad" 1032 1376 2 "$tmp/raw.png"
    python3 -c "
import sys; from PIL import Image
im = Image.open('$tmp/raw.png').convert('RGB'); assert im.size == (2064, 2752), im.size
im.save('$here/out-ipad13/$lang/$name', 'PNG', optimize=True)"
    echo "wrote ipad13/$lang/$name"
  done
  for i in "${!PLAY[@]}"; do
    id="${PLAY[$i]}"; name="$(printf %02d $((i + 1)))-$id.png"
    shoot "file://$tmp/slides-ipad.html?slide=$id&lang=$lang&fmt=tab&play=1" 1000 1600 1.6 "$tmp/raw.png"
    python3 -c "
import sys; from PIL import Image
im = Image.open('$tmp/raw.png').convert('RGB'); assert im.size == (1600, 2560), im.size
im.save('$here/out-play-tablet10/$lang/$name', 'PNG', optimize=True)
im.resize((1200, 1920), Image.LANCZOS).save('$here/out-play-tablet7/$lang/$name', 'PNG', optimize=True)"
    echo "wrote play-tablet/$lang/$name"
  done
done
