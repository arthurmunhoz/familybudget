#!/usr/bin/env python3
"""Render every One Roof icon from one vector definition.

    python3 mobile/store/render-app-icon.py

Writes into mobile/assets/images/ (what app.json points at) and
mobile/store/ (the 512 Play listing icon). One source for all of them, so the
launcher, the App Store, the Play listing and the splash can't drift apart.

The shapes are deliberately NOT the same size in every output:

  * icon.png / splash-icon.png — full bleed, glyph at ~63%. iOS and Play round
    the corners themselves, so the art must not pre-round or pre-pad.
  * android-icon-foreground.png — the glyph must survive a CIRCLE mask, because
    Android launchers choose their own shape. Only the middle 66% of an adaptive
    icon is guaranteed visible, which caps a square-ish glyph at ~482px on this
    1024 canvas. Anything bigger loses its eaves on a round launcher.
  * android-icon-monochrome.png — Android 13+ themed icons tint the ALPHA, so
    this is shape only. Colour in here would be ignored, then look broken.

Corners are rounded by stroking the path in its own fill colour with a round
join, rather than by hand-authoring arcs — uniform radius everywhere, and one
number to tune (ROUND).
"""
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets", "images")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SIZE = 1024

# The house in a 100x100 box: eaves wider than the body, arched doorway cut
# straight out so the background reads through it. That notch is what keeps the
# mark legible at 48dp — a filled or lit door turns to mush at launcher size.
HOUSE = ("M8,53 L50,11 L92,53 L79,53 L79,84 L60,84 L60,66 "
         "A10,10 0 0 0 40,66 L40,84 L21,84 L21,53 Z")
ROUND = 6          # stroke width → corner radius of half this, in glyph units
PAPER = "#fdf7f0"  # Warm Hearth paper, not pure white
GLYPH_FULL = 645   # full-bleed icons
# Adaptive foreground / monochrome. The limit is the glyph's DIAGONAL against
# the safe circle (radius 341 on this canvas), not its width: at 490 wide the
# half-diagonal is 325, so it clears a round launcher with ~16px to spare. 520
# would clip the eaves.
GLYPH_SAFE = 490

BG = """<defs>
 <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#cf6d48"/><stop offset="0.52" stop-color="#c2603f"/>
  <stop offset="1" stop-color="#a4482a"/></linearGradient>
 <radialGradient id="glow" cx="0.30" cy="0.20" r="0.85">
  <stop offset="0" stop-color="#e08a63" stop-opacity="0.55"/>
  <stop offset="1" stop-color="#e08a63" stop-opacity="0"/></radialGradient>
 <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75">
  <stop offset="0.55" stop-color="#000000" stop-opacity="0"/>
  <stop offset="1" stop-color="#5a2412" stop-opacity="0.28"/></radialGradient>
</defs>
<rect width="1024" height="1024" fill="url(#g)"/>
<rect width="1024" height="1024" fill="url(#glow)"/>
<rect width="1024" height="1024" fill="url(#vig)"/>"""


def glyph(size, fill):
    s = size / 84.0
    tx = SIZE / 2 - (8 + 92) / 2 * s
    ty = SIZE / 2 - (11 + 84) / 2 * s
    return (f'<g transform="translate({tx:.2f},{ty:.2f}) scale({s:.5f})">'
            f'<path fill-rule="evenodd" d="{HOUSE}" fill="{fill}" stroke="{fill}" '
            f'stroke-width="{ROUND}" stroke-linejoin="round" stroke-linecap="round"/></g>')


def render(dest, body, transparent):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" '
           f'viewBox="0 0 {SIZE} {SIZE}">{body}</svg>')
    html = (f'<!doctype html><html><head><meta charset="utf-8"><style>'
            f'*{{margin:0;padding:0}}html,body{{width:{SIZE}px;height:{SIZE}px;'
            f'overflow:hidden}}</style></head><body>{svg}</body></html>')
    page = dest + ".html"
    open(page, "w").write(html)
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
           "--force-device-scale-factor=1", f"--window-size={SIZE},{SIZE}",
           f"--screenshot={dest}", "file://" + page]
    if transparent:
        cmd.insert(2, "--default-background-color=00000000")
    subprocess.run(cmd, check=True, capture_output=True)
    os.remove(page)


def main():
    if not os.path.exists(CHROME):
        raise SystemExit(f"Google Chrome not found at {CHROME}")
    from PIL import Image

    jobs = [
        (os.path.join(ASSETS, "icon.png"), BG + glyph(GLYPH_FULL, PAPER), False),
        (os.path.join(ASSETS, "splash-icon.png"), BG + glyph(GLYPH_FULL, PAPER), False),
        (os.path.join(ASSETS, "android-icon-background.png"), BG, False),
        (os.path.join(ASSETS, "android-icon-foreground.png"), glyph(GLYPH_SAFE, PAPER), True),
        (os.path.join(ASSETS, "android-icon-monochrome.png"), glyph(GLYPH_SAFE, "#ffffff"), True),
        (os.path.join(HERE, "play-store-icon-512.png"), BG + glyph(GLYPH_FULL, PAPER), False),
    ]
    for dest, body, transparent in jobs:
        render(dest, body, transparent)
        im = Image.open(dest)
        # iOS rejects an icon with an alpha channel; the adaptive layers REQUIRE
        # one. Enforce rather than hope.
        if transparent:
            assert im.mode == "RGBA", (dest, im.mode)
        else:
            Image.open(dest).convert("RGB").save(dest, "PNG", optimize=True)
        if dest.endswith("play-store-icon-512.png"):
            Image.open(dest).convert("RGB").resize((512, 512), Image.LANCZOS).save(
                dest, "PNG", optimize=True)
        print(f"  {os.path.relpath(dest, os.path.join(HERE, '..'))}  "
              f"{Image.open(dest).size} {Image.open(dest).mode}")
    print("\nIcons rebuilt. A native rebuild is required for them to reach a device.")


if __name__ == "__main__":
    main()
