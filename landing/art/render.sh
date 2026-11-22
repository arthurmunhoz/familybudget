#!/bin/bash
# Render the landing's "Modo Casa on a table" art, one WebP per language.
#   bash landing/art/render.sh
# Captures: mobile/store/landing-shots/casa-{pt,es}.png (light Modo Casa, 9:41,
# taken 2026-11-18) and app-store-v4/shots-ipad/en/casa-hub.png for English.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp "$here/casa-table.html" "$tmp/"
cp "$root/mobile/store/app-store-v4/shots-ipad/en/casa-hub.png" "$tmp/casa-en.png"
cp "$root/mobile/store/landing-shots/casa-pt.png" "$tmp/casa-pt.png"
cp "$root/mobile/store/landing-shots/casa-es.png" "$tmp/casa-es.png"
for l in en pt es; do
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --allow-file-access-from-files \
    --virtual-time-budget=4000 --window-size=1600,1100 --screenshot="$tmp/t-$l.png" "file://$tmp/casa-table.html?shot=casa-$l.png" 2>/dev/null
  python3 -c "import sys; from PIL import Image; im=Image.open(sys.argv[1]).convert('RGB'); im=im.resize((1600,1100), Image.LANCZOS); im.save(sys.argv[2], 'WEBP', quality=86); print('wrote', sys.argv[2])" "$tmp/t-$l.png" "$root/public/img/casa-table-$l.webp"
done
