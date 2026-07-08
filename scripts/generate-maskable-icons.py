#!/usr/bin/env python3
"""Generate maskable PWA icon variants (P2-B item 4b).

Maskable icons must keep all meaningful content within the center ~80% "safe
zone" — OS launchers (esp. Android adaptive icons) crop to a circle/rounded-
square and can clip anything outside that zone. Our existing icon-*.png files
were authored as plain (purpose:"any") icons with the glyph filling most of
the canvas, so they'd get clipped if reused directly for purpose:"maskable".

This script pads each source icon onto a full-bleed canvas of the PWA's
background_color (#0a0e14, per manifest.json) so the artwork occupies exactly
the center 80% of the frame, and writes icon-<size>-maskable.png alongside
the originals. purpose:"any" entries in manifest.json keep pointing at the
original (unpadded) files.
"""
import os
from PIL import Image

ICON_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
BG_COLOR = (10, 14, 20, 255)  # #0a0e14, matches manifest.json background_color/theme_color
SAFE_ZONE_RATIO = 0.8  # artwork occupies the center 80% of the canvas

SOURCES = [
    ("icon-192.png", "icon-192-maskable.png"),
    ("icon-512.png", "icon-512-maskable.png"),
]


def make_maskable(src_path, dst_path):
    src = Image.open(src_path).convert("RGBA")
    size = src.size[0]  # source icons are square
    canvas = Image.new("RGBA", (size, size), BG_COLOR)
    inner = int(round(size * SAFE_ZONE_RATIO))
    resized = src.resize((inner, inner), Image.LANCZOS)
    offset = (size - inner) // 2
    canvas.paste(resized, (offset, offset), resized)
    canvas.save(dst_path)
    print(f"wrote {dst_path} ({size}x{size}, artwork {inner}x{inner} centered)")


if __name__ == "__main__":
    for src_name, dst_name in SOURCES:
        make_maskable(
            os.path.join(ICON_DIR, src_name),
            os.path.join(ICON_DIR, dst_name),
        )
