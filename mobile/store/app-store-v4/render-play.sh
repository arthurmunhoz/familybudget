#!/bin/bash
# Render the Google Play phone screenshots from slides.html (?play=1).
#
#   bash mobile/store/app-store-v4/render-play.sh          # every language with captures
#   bash mobile/store/app-store-v4/render-play.sh en       # one language
#
# Output: out-play/<lang>/NN-<id>.png at exactly 1080x1920 (9:16, inside
# Play's 16:9–9:16 limit), RGB, no alpha. Play takes at most 8 phone
# screenshots, so money (covered by the receipt slide) and utilities drop out.
# 1.6.0 had no Android capture session: the frames reuse the iOS captures
# (shots/), with hero-play.png = the Home with the Whereabouts tile turned off
# (Whereabouts is OFF on Android — PLAY-STORE-RELEASE §0b) and the calendar
# pop-out saying Google Calendar only. Pass ANDROID=1 to use shots-android/
# once Android captures exist (same file names).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mobile="$(cd "$here/../.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
gf="$mobile/node_modules/@expo-google-fonts"
ORDER=(hero roof calendar lists receipt games casa pets)
LANGS=("$@"); [ ${#LANGS[@]} -gt 0 ] || LANGS=($(ls "$here/shots"))
extra=""; [ "${ANDROID:-}" = 1 ] && extra="&android=1"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp "$here"/{slides.html,copy.js,icons.js} "$tmp/"
cp -R "$here/shots" "$here/assets" "$tmp/"
[ -d "$here/shots-android" ] && cp -R "$here/shots-android" "$tmp/"
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
      --screenshot="$tmp/raw.png" "file://$tmp/slides.html?slide=$id&lang=$lang&play=1$extra" 2>/dev/null
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

# Slide 5 = the approved v3 receipt illustration (see render.sh).
for lang in "${LANGS[@]:-en}"; do
  [ -f "$here/../app-store-v3/out-play/$lang/03-ai.png" ] && cp "$here/../app-store-v3/out-play/$lang/03-ai.png" "$here/out-play/$lang/05-receipt.png"
done
