#!/bin/bash
# Render the Google Play phone screenshots from slides.html (?play=1).
#
#   bash mobile/store/app-store-v3/render-play.sh          # every language
#   bash mobile/store/app-store-v3/render-play.sh pt       # one language
#
# Output: out-play/<lang>/NN-<id>.png at exactly 1080x1920 (9:16, inside
# Play's 16:9–9:16 limit), RGB, no alpha. Captures come from shots-android/
# (Galaxy S9+, 1440x2960). Whereabouts is OFF on Android v1, so no map slide —
# a listing must not show a feature the app doesn't have (PLAY-STORE-RELEASE §0b).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mobile="$(cd "$here/../.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
gf="$mobile/node_modules/@expo-google-fonts"
ORDER=(hero assistant ai calendar shopping money pets utilities)
LANGS=("$@"); [ ${#LANGS[@]} -gt 0 ] || LANGS=(en pt es)

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp "$here"/{slides.html,copy.js,icons.js} "$tmp/"
cp -R "$here/shots-android" "$here/assets" "$tmp/"
mkdir -p "$tmp/fonts"
cp "$gf/nunito/800ExtraBold/Nunito_800ExtraBold.ttf" "$tmp/fonts/nunito-800.ttf"
cp "$gf/nunito/700Bold/Nunito_700Bold.ttf" "$tmp/fonts/nunito-700.ttf"
cp "$gf/hanken-grotesk/400Regular/HankenGrotesk_400Regular.ttf" "$tmp/fonts/hanken-400.ttf"
cp "$gf/hanken-grotesk/600SemiBold/HankenGrotesk_600SemiBold.ttf" "$tmp/fonts/hanken-600.ttf"

for lang in "${LANGS[@]}"; do
  mkdir -p "$here/out-play/$lang"
  for i in "${!ORDER[@]}"; do
    id=${ORDER[$i]}; out="$here/out-play/$lang/$(printf %02d $((i + 1)))-$id.png"
    "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
      --allow-file-access-from-files --virtual-time-budget=4000 --window-size=660,1174 \
      --screenshot="$tmp/raw.png" "file://$tmp/slides.html?slide=$id&lang=$lang&play=1" 2>/dev/null
    python3 - "$tmp/raw.png" "$out" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
assert im.size == (1320, 2348), im.size
im.resize((1080, 1920), Image.LANCZOS).save(sys.argv[2], "PNG", optimize=True)
PY
    echo "wrote $out"
  done
done
