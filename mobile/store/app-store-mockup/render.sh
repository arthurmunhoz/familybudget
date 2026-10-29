#!/bin/bash
# Re-render the App Store mockup PNGs from app-store-mockup.html.
#
# Outputs (2x, for crisp marketing use):
#   app-store-mockup.png   3200x2000  copy + search result + product header
#   app-store-search.png   1120x2000  search-result phone only
#   app-store-header.png   1120x2000  product-page phone only
#
# assets/ holds the LIVE listing's icon + screenshots (mzstatic, 2026-10-29);
# re-download them if the listing art changes. Fonts come from the web app's
# node_modules, like ../render-feature-graphic.sh, and are NOT committed.
#
# Usage:  bash mobile/store/app-store-mockup/render.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# node_modules is absent in a git worktree, so fall back to the primary checkout.
main_repo="${repo%%/.claude/worktrees/*}"
fonts=""
for cand in "${FONT_DIR:-}" "$repo/node_modules/@fontsource-variable" "$main_repo/node_modules/@fontsource-variable"; do
  [ -n "$cand" ] && [ -d "$cand" ] && { fonts="$cand"; break; }
done

[ -x "$chrome" ] || { echo "Google Chrome not found at $chrome"; exit 1; }
[ -n "$fonts" ] || { echo "Fonts not found. Run 'npm install' in $main_repo, or set FONT_DIR=<path to @fontsource-variable>"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$here/app-store-mockup.html" "$tmp/mockup.html"
cp -R "$here/assets" "$tmp/assets"
cp "$fonts/fraunces/files/fraunces-latin-full-normal.woff2" "$tmp/fraunces.woff2"
cp "$fonts/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2" "$tmp/hanken.woff2"

shoot() { # view width height out
  "$chrome" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --allow-file-access-from-files \
    --virtual-time-budget=3000 \
    --window-size="$2,$3" --screenshot="$here/$4" "file://$tmp/mockup.html?view=$1" 2>/dev/null
  echo "wrote $here/$4"
}
shoot combined 1600 1000 app-store-mockup.png
shoot search   560 1000 app-store-search.png
shoot header   560 1000 app-store-header.png

# App Store Connect creative assets (Asset Library → Upload Creative Assets).
# Exact sizes are Apple's; JPEG/PNG with NO alpha, so flatten after the shot.
cp "$here/creative-assets.html" "$tmp/creative.html"
creative() { # view cssW cssH out
  "$chrome" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --allow-file-access-from-files \
    --virtual-time-budget=3000 \
    --window-size="$2,$3" --screenshot="$tmp/raw.png" "file://$tmp/creative.html?view=$1" 2>/dev/null
  python3 - "$tmp/raw.png" "$here/$4" "$(( $2 * 2 ))" "$(( $3 * 2 ))" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
assert im.size == (int(sys.argv[3]), int(sys.argv[4])), im.size
im.save(sys.argv[2], "PNG", optimize=True)
print("wrote", sys.argv[2], im.size, im.mode)
PY
}
creative header 1920 823  creative-header-3840x1646.png
creative search 1920 1280 creative-search-3840x2560.png
