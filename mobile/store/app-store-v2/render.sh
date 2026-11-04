#!/bin/bash
# Render the v2 App Store screenshots from slides.html.
#
#   bash mobile/store/app-store-v2/render.sh            # every language in copy.js
#   bash mobile/store/app-store-v2/render.sh en         # one language
#   SLIDES="hero ai" bash .../render.sh en              # some slides
#
# Output: out/<lang>/NN-<id>.png at 1320x2868 (Apple's 6.9" iPhone size),
# RGB with NO alpha (App Store Connect rejects transparency).
# Needs: Google Chrome, Python 3 + Pillow, and `npm install` in mobile/ (the
# Nunito + Hanken Grotesk TTFs come from @expo-google-fonts, not committed here).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mobile="$(cd "$here/../.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
gf="$mobile/node_modules/@expo-google-fonts"
[ -x "$chrome" ] || { echo "Google Chrome not found"; exit 1; }
[ -d "$gf/nunito" ] || { echo "Run npm install in $mobile first"; exit 1; }

# Store order. 'location' (Whereabouts) is iOS-only — Android v1 ships without it.
ORDER=(hero ai calendar shopping money location nudges pets docs family)
SLIDES=(${SLIDES:-${ORDER[@]}})
LANGS=("$@")
[ ${#LANGS[@]} -gt 0 ] || LANGS=($(grep -oE '^  [a-z]{2}: \{' "$here/copy.js" | tr -dc 'a-z\n'))

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp "$here"/{slides.html,copy.js,icons.js} "$tmp/"
cp -R "$here/shots" "$here/assets" "$tmp/"
mkdir -p "$tmp/fonts"
cp "$gf/nunito/800ExtraBold/Nunito_800ExtraBold.ttf" "$tmp/fonts/nunito-800.ttf"
cp "$gf/nunito/700Bold/Nunito_700Bold.ttf" "$tmp/fonts/nunito-700.ttf"
cp "$gf/hanken-grotesk/400Regular/HankenGrotesk_400Regular.ttf" "$tmp/fonts/hanken-400.ttf"
cp "$gf/hanken-grotesk/600SemiBold/HankenGrotesk_600SemiBold.ttf" "$tmp/fonts/hanken-600.ttf"

for lang in "${LANGS[@]}"; do
  mkdir -p "$here/out/$lang"
  for id in "${SLIDES[@]}"; do
    n=0; for i in "${!ORDER[@]}"; do [ "${ORDER[$i]}" = "$id" ] && n=$((i + 1)); done
    out="$here/out/$lang/$(printf %02d "$n")-$id.png"
    "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
      --allow-file-access-from-files --virtual-time-budget=4000 --window-size=660,1434 \
      --screenshot="$tmp/raw.png" "file://$tmp/slides.html?slide=$id&lang=$lang" 2>/dev/null
    python3 - "$tmp/raw.png" "$out" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
assert im.size == (1320, 2868), im.size
im.save(sys.argv[2], "PNG", optimize=True)
PY
    echo "wrote $out"
  done
done
