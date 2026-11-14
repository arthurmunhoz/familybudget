#!/bin/bash
# Render the v4 (1.6.0) App Store screenshots from slides.html.
#
#   bash mobile/store/app-store-v4/render.sh            # every language with captures
#   bash mobile/store/app-store-v4/render.sh en         # one language
#   SLIDES="hero roof" bash .../render.sh en            # some slides
#
# Output, RGB with NO alpha (App Store Connect rejects transparency):
#   out-6.9/<lang>/NN-<id>.png  1320x2868 (6.9")
#   out-6.3/<lang>/NN-<id>.png  1206x2622 (6.3" — the primary "iPhone with
#                               Dynamic Island" slot; 1320x2868 is NOT accepted there)
# Needs: Google Chrome, Python 3 + Pillow, and `npm install` in mobile/ (the
# Nunito + Hanken Grotesk TTFs come from @expo-google-fonts, not committed here).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mobile="$(cd "$here/../.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
gf="$mobile/node_modules/@expo-google-fonts"
[ -x "$chrome" ] || { echo "Google Chrome not found"; exit 1; }
[ -d "$gf/nunito" ] || { echo "Run npm install in $mobile first"; exit 1; }

# Store order: Roof leads (the hero's pop-out, then its own slide).
ORDER=(hero roof calendar lists receipt money games casa pets utilities)
SLIDES=(${SLIDES:-${ORDER[@]}})
LANGS=("$@")
[ ${#LANGS[@]} -gt 0 ] || LANGS=($(ls "$here/shots"))

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp "$here"/{slides.html,copy.js,icons.js} "$tmp/"
cp -R "$here/shots" "$here/assets" "$tmp/"
mkdir -p "$tmp/fonts"
cp "$gf/nunito/800ExtraBold/Nunito_800ExtraBold.ttf" "$tmp/fonts/nunito-800.ttf"
cp "$gf/nunito/700Bold/Nunito_700Bold.ttf" "$tmp/fonts/nunito-700.ttf"
cp "$gf/hanken-grotesk/400Regular/HankenGrotesk_400Regular.ttf" "$tmp/fonts/hanken-400.ttf"
cp "$gf/hanken-grotesk/600SemiBold/HankenGrotesk_600SemiBold.ttf" "$tmp/fonts/hanken-600.ttf"

for lang in "${LANGS[@]}"; do
  mkdir -p "$here/out-6.9/$lang" "$here/out-6.3/$lang"
  for id in "${SLIDES[@]}"; do
    n=0; for i in "${!ORDER[@]}"; do [ "${ORDER[$i]}" = "$id" ] && n=$((i + 1)); done
    name="$(printf %02d "$n")-$id.png"
    "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
      --allow-file-access-from-files --virtual-time-budget=4000 --window-size=660,1434 \
      --screenshot="$tmp/raw.png" "file://$tmp/slides.html?slide=$id&lang=$lang" 2>/dev/null
    python3 - "$tmp/raw.png" "$here/out-6.9/$lang/$name" "$here/out-6.3/$lang/$name" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
assert im.size == (1320, 2868), im.size
im.save(sys.argv[2], "PNG", optimize=True)
im.resize((1206, 2622), Image.LANCZOS).save(sys.argv[3], "PNG", optimize=True)
PY
    echo "wrote $lang/$name"
  done
done

# Slide 5 is the approved v3 "Snap a receipt. AI does the rest." illustration
# (owner, 2026-11-14: the store shows scan → expense; ticking list items off is
# for people to discover). It replaces the rendered receipt slide.
for lang in "${LANGS[@]:-en}"; do
  [ -f "$here/../app-store-v3/out/$lang/03-ai.png" ] || continue
  cp "$here/../app-store-v3/out/$lang/03-ai.png" "$here/out-6.9/$lang/05-receipt.png"
  cp "$here/../app-store-v3/out-6.3/$lang/03-ai.png" "$here/out-6.3/$lang/05-receipt.png"
done
