"""Normalize the supplied utility atlases and make a hollow shield overlay.

Usage: python scripts/prepare_utility_effects.py --source-dir <download directory>
Originals are preserved in assets-source/item-effects; runtime sheets stay 4x4.
"""
from argparse import ArgumentParser
from pathlib import Path
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "golden_bicycle_boost_sprite_4x4_1024_alpha.png": "boost-yellow-bike.png",
    "ice_blue_shield_sprite_4x4_1024_alpha.png": "shield-down-jacket.png",
    "霓虹紫色滑行特效序列.png": "boost-roller-skates.png",
    "咖啡治愈魔法精灵图.png": "healing-morning-coffee.png",
}

def normalize(source):
    image = Image.open(source).convert("RGBA")
    if image.size != (1024, 1024):
        raise ValueError(f"Expected a 1024x1024 atlas: {source}")
    result = Image.new("RGBA", image.size)
    for index in range(16):
        x, y = index % 4 * 256, index // 4 * 256
        cell = image.crop((x, y, x + 256, y + 256))
        bounds = cell.getchannel("A").point(lambda a: 255 if a > 64 else 0).getbbox()
        if bounds:
            left, top, right, bottom = bounds
            dx = round(128 - (left + right) / 2)
            dy = round(128 - (top + bottom) / 2)
            centered = Image.new("RGBA", (256, 256))
            centered.paste(cell, (dx, dy))
            result.paste(centered, (x, y))
    return result

def normalize_supplied_grid(source):
    """Slice fractional cell boundaries before resizing, preserving animation motion."""
    image = Image.open(source).convert("RGBA")
    result = Image.new("RGBA", (1024, 1024))
    for index in range(16):
        column, row = index % 4, index // 4
        cell = image.crop((round(column * image.width / 4), round(row * image.height / 4),
                           round((column + 1) * image.width / 4), round((row + 1) * image.height / 4)))
        # Keep one fixed canvas/anchor across frames and 24 px of safety padding.
        cell = cell.resize((208, 208), Image.Resampling.NEAREST)
        cell.putalpha(cell.getchannel("A").point(lambda a: 0 if a <= 4 else a))
        result.paste(cell, (column * 256 + 24, row * 256 + 24))
    return result


def hollow_shield(image):
    result = image.copy()
    pixels = result.load()
    for y in range(1024):
        for x in range(1024):
            # A broad clear center leaves the character visible, with a short
            # transition into the original ice rim. Keep the original RGB data.
            radius = (((x % 256 - 128) / 62) ** 2 + ((y % 256 - 128) / 64) ** 2) ** 0.5
            weight = max(0, min(1, (radius - 1) / 0.16))
            weight = weight * weight * (3 - 2 * weight)
            r, g, b, a = pixels[x, y]
            pixels[x, y] = (r, g, b, round(a * weight))
    return result

def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path)
    args = parser.parse_args()
    sources = ROOT / "assets-source/item-effects"
    output = ROOT / "public/assets/effects"
    sources.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    for original, target in SOURCES.items():
        preserved = sources / original
        if args.source_dir:
            supplied = args.source_dir / original
            if supplied.resolve() != preserved.resolve():
                shutil.copyfile(supplied, preserved)
        normalized = (normalize_supplied_grid(preserved)
                      if target in {"boost-roller-skates.png", "healing-morning-coffee.png"}
                      else normalize(preserved))
        normalized.save(output / target, optimize=True)
        if target == "shield-down-jacket.png":
            hollow_shield(normalized).save(output / "shield-down-jacket-aura.png", optimize=True)
        print(target)

if __name__ == "__main__":
    main()
