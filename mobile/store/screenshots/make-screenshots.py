#!/usr/bin/env python3
"""Turn raw Android phone captures into Play-ready store screenshots.

Why this exists rather than uploading the raw captures:

  * PLAY'S ASPECT RATIO. Phone screenshots must sit between 16:9 and 9:16.
    A modern Android phone captures about 20:9 (1080x2340 = 0.46), TALLER than
    9:16 (0.5625), and Play rejects it. Every output here is exactly 1080x1920,
    so it passes whatever the phone produced.
  * A caption. The screenshot rail gets skimmed, not read — a short benefit line
    above each shot is what does the selling.

Rendering goes through headless Chrome, not PIL, for one reason: the captions
have to be in Hanken Grotesk, the app's own UI face, and those files are woff2,
which PIL cannot read. Same approach as render-feature-graphic.sh.

Usage:
    python3 mobile/store/screenshots/make-screenshots.py

Reads raw/NN-name.png and writes out/NN-name.png. The caption comes from
CAPTIONS, keyed by the NN prefix — so the order you shoot in is the order Play
shows, and renaming a file changes nothing else.
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "out")
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
MAIN_REPO = REPO.split("/.claude/worktrees/")[0]   # node_modules lives in the primary checkout
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

W, H = 1080, 1920

# Lead with the differentiators. Keep them short — this is a rail, not a page.
CAPTIONS = {
    "01": "See your family on a live map",
    "02": "Everything for your home, in one app",
    "03": "Snap a receipt, log the spending",
    "04": "A shopping list that syncs as you shop",
    "05": "Know the moment they get home",
    "06": "Never miss a vet date again",
    "07": "One tap: “dinner’s ready”",
    "08": "IDs and insurance, always with you",
}

PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family:'Hanken'; src:url('hanken.woff2') format('woff2-variations'); font-weight:100 900; }}
* {{ margin:0; padding:0; box-sizing:border-box; }}
html,body {{ width:{W}px; height:{H}px; overflow:hidden; }}
.stage {{ position:relative; width:{W}px; height:{H}px; background:#fbf6f0;
  background-image:radial-gradient(70% 45% at 50% 0%, rgba(194,96,63,.13) 0%, rgba(194,96,63,0) 70%); }}
.edge {{ position:absolute; inset:0 0 auto 0; height:10px; background:#c2603f; }}
.cap {{ position:absolute; left:80px; right:80px; top:96px; height:190px;
  display:flex; align-items:center; justify-content:center; text-align:center; }}
.cap span {{ font-family:'Hanken'; font-weight:700; font-size:62px; line-height:1.17;
  color:#2b2521; letter-spacing:-.8px; }}
.shot {{ position:absolute; left:50%; top:330px; transform:translateX(-50%);
  border-radius:44px; overflow:hidden; box-shadow:0 26px 60px rgba(43,37,33,.20);
  border:1px solid rgba(43,37,33,.10); }}
.shot img {{ display:block; height:{SHOT_H}px; width:auto; }}
</style></head><body>
<div class="stage">
  <div class="edge"></div>
  <div class="cap"><span>{CAPTION}</span></div>
  <div class="shot"><img src="{IMG}"/></div>
</div></body></html>"""


def find_font():
    for cand in (os.environ.get("FONT_DIR", ""),
                 os.path.join(REPO, "node_modules", "@fontsource-variable"),
                 os.path.join(MAIN_REPO, "node_modules", "@fontsource-variable")):
        if cand and os.path.isdir(cand):
            return os.path.join(cand, "hanken-grotesk", "files",
                                "hanken-grotesk-latin-wght-normal.woff2")
    return None


def main():
    if not os.path.isdir(RAW):
        sys.exit("No raw/ directory — put your phone captures there first.")
    files = sorted(f for f in os.listdir(RAW) if f.lower().endswith((".png", ".jpg", ".jpeg")))
    if not files:
        sys.exit("raw/ is empty. Shoot the screens listed in PLAY-STORE-RELEASE.md §4 first.")
    if not os.path.exists(CHROME):
        sys.exit(f"Google Chrome not found at {CHROME}")
    font = find_font()
    if not font or not os.path.exists(font):
        sys.exit(f"Hanken Grotesk not found — run 'npm install' in {MAIN_REPO}, or set FONT_DIR")

    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp()
    shutil.copy(font, os.path.join(tmp, "hanken.woff2"))
    made = 0
    try:
        for f in files:
            key = f.split("-")[0]
            caption = CAPTIONS.get(key)
            if caption is None:
                print(f"  skip {f}: no caption for prefix {key!r} — add one to CAPTIONS")
                continue
            shutil.copy(os.path.join(RAW, f), os.path.join(tmp, f))
            # Leave room under the caption; the phone keeps its own aspect ratio.
            html = PAGE.format(W=W, H=H, SHOT_H=H - 330 - 60, CAPTION=caption, IMG=f)
            page = os.path.join(tmp, key + ".html")
            open(page, "w").write(html)
            dest = os.path.join(OUT, os.path.splitext(f)[0] + ".png")
            subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                            "--force-device-scale-factor=1", "--allow-file-access-from-files",
                            f"--window-size={W},{H}", f"--screenshot={dest}",
                            "file://" + page],
                           check=True, capture_output=True)
            print(f"  {f} -> out/{os.path.basename(dest)}")
            made += 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # Play rejects alpha and off-ratio images; assert both rather than trusting.
    from PIL import Image
    for f in sorted(os.listdir(OUT)):
        if not f.endswith(".png"):
            continue
        p = os.path.join(OUT, f)
        im = Image.open(p)
        if im.mode != "RGB" or im.size != (W, H):
            Image.open(p).convert("RGB").resize((W, H), Image.LANCZOS).save(p, "PNG", optimize=True)
            im = Image.open(p)
        assert im.size == (W, H) and im.mode == "RGB", (f, im.size, im.mode)
    print(f"\n{made} ready in mobile/store/screenshots/out/ — upload 2 to 8 of them to Play.")


if __name__ == "__main__":
    main()
