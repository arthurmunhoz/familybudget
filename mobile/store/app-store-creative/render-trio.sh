#!/bin/bash
# Render the "trio" search-results creative (site-hero style: Home phone big
# in the middle, Pets and Money either side) for one store language.
#
#   bash mobile/store/app-store-creative/render-trio.sh pt   # or es, en
#
# Writes out/trio-3840x2560-<lang>.png (RGB, no alpha). en uses the v4 captures
# (with the "Tony" rename); pt/es use app-store-v3/shots/<lang> as they are.
set -euo pipefail
lang="${1:-pt}"
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
  shots="$here/../app-store-v3/shots/$lang"
  cp "$shots/hero.png" "$tmp/hero.png"
fi
cp "$shots/pets.png" "$shots/money.png" "$tmp/"
mkdir -p "$tmp/fonts"
cp "$gf/nunito/800ExtraBold/Nunito_800ExtraBold.ttf" "$tmp/fonts/nunito-800.ttf"
cp "$gf/nunito/700Bold/Nunito_700Bold.ttf" "$tmp/fonts/nunito-700.ttf"
cp "$gf/hanken-grotesk/400Regular/HankenGrotesk_400Regular.ttf" "$tmp/fonts/hanken-400.ttf"
cp "$gf/hanken-grotesk/600SemiBold/HankenGrotesk_600SemiBold.ttf" "$tmp/fonts/hanken-600.ttf"
cp "$gf/fraunces/600SemiBold/Fraunces_600SemiBold.ttf" "$tmp/fonts/fraunces-600.ttf"
"$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --allow-file-access-from-files --virtual-time-budget=6000 \
  --window-size=3840,2560 --screenshot="$tmp/trio.png" "file://$tmp/creative.html?v=trio&lang=$lang" 2>/dev/null
python3 -c "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2], optimize=True)" "$tmp/trio.png" "$here/out/trio-3840x2560-$lang.png"
echo "wrote out/trio-3840x2560-$lang.png"
