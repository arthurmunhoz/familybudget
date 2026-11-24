#!/bin/bash
# Render the "trio" creative (site-hero style: Home phone big in the middle,
# Calendar and Lists either side) for one store language.
#
#   bash mobile/store/app-store-creative/render-trio.sh pt            # search results
#   bash mobile/store/app-store-creative/render-trio.sh pt triohead   # product page header
#
# Writes out/trio-3840x2560-<lang>.png (RGB, no alpha). en uses the v4 captures
# (with the "Tony" rename); pt/es use app-store-v3/shots/<lang> as they are.
set -euo pipefail
lang="${1:-pt}"
v="${2:-trio}"   # trio (search results 3840x2560) | triohead (header 3840x1646)
[ "$v" = triohead ] && size=3840,1646 && dim=3840x1646 || { size=3840,2560; dim=3840x2560; }
here="$(cd "$(dirname "$0")" && pwd)"
mobile="$(cd "$here/../.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
gf="$mobile/node_modules/@expo-google-fonts"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp "$here/creative.html" "$tmp/"
if [ "$lang" = en ]; then
  shots="$here/../app-store-v4/shots/en"
  python3 "$here/rename.py" "$shots" "$tmp" "$gf"
else
  # fresh captures (v4/shots/<lang>, 2026-11-23 for pt) win over the old v3 set
  shots="$here/../app-store-v4/shots/$lang"
  [ -f "$shots/hero.png" ] || shots="$here/../app-store-v3/shots/$lang"
  cp "$shots/hero.png" "$tmp/hero.png"
fi
cp "$shots/calendar.png" "$tmp/"
if [ -f "$shots/lists.png" ]; then cp "$shots/lists.png" "$tmp/"; else cp "$shots/shopping.png" "$tmp/lists.png"; fi
mkdir -p "$tmp/fonts"
cp "$gf/nunito/800ExtraBold/Nunito_800ExtraBold.ttf" "$tmp/fonts/nunito-800.ttf"
cp "$gf/nunito/700Bold/Nunito_700Bold.ttf" "$tmp/fonts/nunito-700.ttf"
cp "$gf/hanken-grotesk/400Regular/HankenGrotesk_400Regular.ttf" "$tmp/fonts/hanken-400.ttf"
cp "$gf/hanken-grotesk/600SemiBold/HankenGrotesk_600SemiBold.ttf" "$tmp/fonts/hanken-600.ttf"
cp "$gf/fraunces/600SemiBold/Fraunces_600SemiBold.ttf" "$tmp/fonts/fraunces-600.ttf"
"$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --allow-file-access-from-files --virtual-time-budget=6000 \
  --window-size=$size --screenshot="$tmp/trio.png" "file://$tmp/creative.html?v=$v&lang=$lang" 2>/dev/null
python3 -c "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2], optimize=True)" "$tmp/trio.png" "$here/out/$v-$dim-$lang.png"
echo "wrote out/$v-$dim-$lang.png"
