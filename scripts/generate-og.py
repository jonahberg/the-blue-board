#!/usr/bin/env python3
"""Generate per-section/per-hub OG images (P2-B item 5).

Every page currently shares one og-image.png, so shared links carry no
differentiation. This renders the existing og-image.png as a base with a
JetBrains-Mono-style text overlay (banner strip + big label), producing a
small set of 1200x630 images:
  - og-hubs.jpg            generic hubs-section image
  - og-hub-<iata>.png       one per hub, with the IATA code + city
  - og-fleet.jpg            generic fleet-section image
  - og-news.jpg             generic news-section image

Uses PIL (confirmed available) rather than canvas/sharp since PIL covers
everything needed here (paste + text). Falls back to a system font if the
bundled JetBrains Mono TTF isn't found, since legible-beats-fancy is the bar.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..")
BASE_IMAGE = os.path.join(ROOT, "public", "og-image.png")
OUT_DIR = os.path.join(ROOT, "public", "og")

W, H = 1200, 630
BAND_HEIGHT = 190
BG_TINT = (10, 14, 20, 235)   # near-opaque --ua-dark band for legible text over the photo/art base
AMBER = (196, 163, 90, 255)   # --ua-amber
TEXT = (226, 232, 240, 255)   # --ua-text
MUTED = (148, 163, 184, 255)  # --ua-muted

FONT_CANDIDATES_BOLD = [
    "/mnt/skills/examples/canvas-design/canvas-fonts/JetBrainsMono-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
]
FONT_CANDIDATES_REG = [
    "/mnt/skills/examples/canvas-design/canvas-fonts/JetBrainsMono-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]

HUBS = {
    "ord": "Chicago O'Hare",
    "den": "Denver",
    "iah": "Houston Bush",
    "ewr": "Newark Liberty",
    "sfo": "San Francisco",
    "iad": "Washington Dulles",
    "lax": "Los Angeles",
    "nrt": "Tokyo-Narita",
    "gum": "Guam",
}


def load_font(candidates, size):
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def render(label_top, label_main, label_sub, out_path):
    base = Image.open(BASE_IMAGE).convert("RGBA")
    base = base.resize((W, H))
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    band_top = H - BAND_HEIGHT
    draw.rectangle([0, band_top, W, H], fill=BG_TINT)
    draw.line([0, band_top, W, band_top], fill=AMBER, width=4)

    font_label = load_font(FONT_CANDIDATES_BOLD, 22)
    font_main = load_font(FONT_CANDIDATES_BOLD, 54)
    font_sub = load_font(FONT_CANDIDATES_REG, 26)

    pad_x = 60
    y = band_top + 28
    draw.text((pad_x, y), label_top, font=font_label, fill=AMBER)
    y += 40
    draw.text((pad_x, y), label_main, font=font_main, fill=TEXT)
    y += 68
    draw.text((pad_x, y), label_sub, font=font_sub, fill=MUTED)

    combined = Image.alpha_composite(base, overlay).convert("RGB")
    combined.save(out_path, format="JPEG", quality=78, optimize=True)
    print(f"wrote {out_path} ({os.path.getsize(out_path)//1024}KB)")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)

    render(
        "THE BLUE BOARD · HUB GUIDES",
        "United Hub Guides",
        "Live ops, gates, connections & routes at every UA hub",
        os.path.join(OUT_DIR, "og-hubs.jpg"),
    )
    render(
        "THE BLUE BOARD · FLEET",
        "United Fleet Database",
        "1,000+ aircraft — seat maps, configs & Starlink coverage",
        os.path.join(OUT_DIR, "og-fleet.jpg"),
    )
    render(
        "THE BLUE BOARD · NEWS",
        "United Airlines News",
        "Route changes, fleet updates & ops news, tracked live",
        os.path.join(OUT_DIR, "og-news.jpg"),
    )
    for iata, city in HUBS.items():
        render(
            "THE BLUE BOARD · HUB GUIDE",
            f"{iata.upper()} · {city}",
            "Live ops, gates, connections & routes at this hub",
            os.path.join(OUT_DIR, f"og-hub-{iata}.jpg"),
        )
