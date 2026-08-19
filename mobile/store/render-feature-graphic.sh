#!/bin/bash
# Re-render mobile/store/play-feature-graphic.png from its HTML source.
#
# Play wants exactly 1024x500, no transparency. Headless Chrome at that window
# size gives a pixel-exact PNG; the fonts are copied in from the WEB app's
# node_modules (this is the same Fraunces + Hanken Grotesk the app ships, so the
# graphic can't drift from the product's type) and are NOT committed.
#
# Usage:  bash mobile/store/render-feature-graphic.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# node_modules is absent in a git worktree (it is gitignored and `git worktree
# add` does not create it), so fall back to the primary checkout, which has it.
main_repo="${repo%%/.claude/worktrees/*}"
fonts=""
for cand in "${FONT_DIR:-}" "$repo/node_modules/@fontsource-variable" "$main_repo/node_modules/@fontsource-variable"; do
  [ -n "$cand" ] && [ -d "$cand" ] && { fonts="$cand"; break; }
done

[ -x "$chrome" ] || { echo "Google Chrome not found at $chrome"; exit 1; }
[ -n "$fonts" ] || { echo "Fonts not found. Run 'npm install' in $main_repo, or set FONT_DIR=<path to @fontsource-variable>"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$here/play-feature-graphic.html" "$tmp/graphic.html"
cp "$fonts/fraunces/files/fraunces-latin-full-normal.woff2" "$tmp/fraunces.woff2"
cp "$fonts/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2" "$tmp/hanken.woff2"

"$chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --allow-file-access-from-files \
  --window-size=1024,500 --screenshot="$tmp/raw.png" "file://$tmp/graphic.html" 2>/dev/null

python3 - "$tmp/raw.png" "$here/play-feature-graphic.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")   # convert(): Play rejects alpha
assert im.size == (1024, 500), im.size
im.save(sys.argv[2], "PNG", optimize=True)
print("wrote", sys.argv[2], im.size, im.mode)
PY
