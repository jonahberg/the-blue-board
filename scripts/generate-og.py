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

# Entries are either a path or a (path, ttc_index) tuple. macOS entries use Menlo
# (closest system mono to JetBrains Mono); the PIL bitmap-font fallback renders
# illegible 1200x630 cards, so load_font now fails loudly instead of falling back.
FONT_CANDIDATES_BOLD = [
    "/mnt/skills/examples/canvas-design/canvas-fonts/JetBrainsMono-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    ("/System/Library/Fonts/Menlo.ttc", 1),
    "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
]
FONT_CANDIDATES_REG = [
    "/mnt/skills/examples/canvas-design/canvas-fonts/JetBrainsMono-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    ("/System/Library/Fonts/Menlo.ttc", 0),
    "/System/Library/Fonts/Supplemental/Courier New.ttf",
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
    for entry in candidates:
        path, index = entry if isinstance(entry, tuple) else (entry, 0)
        if os.path.exists(path):
            return ImageFont.truetype(path, size, index=index)
    raise SystemExit(
        "generate-og: no usable TTF found — PIL's bitmap fallback renders illegible "
        "cards. Add a font path to FONT_CANDIDATES_* for this machine."
    )


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
    # Trackers — the sub line carries the headline stat, so re-run this script
    # when the numbers move (see MAINTENANCE.md monthly ritual).
    render(
        "THE BLUE BOARD · TRACKERS",
        "Trackers",
        "Living maps of aviation's long stories, updated monthly",
        os.path.join(OUT_DIR, "og-trackers.jpg"),
    )
    render(
        "THE BLUE BOARD · MODERN SKIES TRACKER",
        "Is Your Airport Off Paper Yet?",
        "18 towers off paper flight strips, 71 to go — check yours",
        os.path.join(OUT_DIR, "og-tracker-atc.jpg"),
    )
    render(
        "THE BLUE BOARD · UNITED HUB TRACKER",
        "What's United Building at Your Hub?",
        "3 flagship clubs & 36 new gates land in 2026 — every project, tracked",
        os.path.join(OUT_DIR, "og-tracker-united-hubs.jpg"),
    )
    for iata, city in HUBS.items():
        render(
            "THE BLUE BOARD · HUB GUIDE",
            f"{iata.upper()} · {city}",
            "Live ops, gates, connections & routes at this hub",
            os.path.join(OUT_DIR, f"og-hub-{iata}.jpg"),
        )
