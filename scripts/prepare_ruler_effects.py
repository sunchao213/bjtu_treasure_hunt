"""Normalize the two supplied ruler effect sheets, keeping originals and fixed anchors.

Usage: python scripts/prepare_ruler_effects.py [--source-dir <downloads>]
The source PNGs already contain alpha; never key out black or regenerate their art.
"""
from argparse import ArgumentParser
from pathlib import Path
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "像素双重斜向斩击动画序列.png": ("ruler-slash-source.png", "ruler-slash.png"),
    "像素火花爆炸动画帧表.png": ("ruler-sparks-source.png", "ruler-sparks.png"),
}
# The supplied peak/fade cells have an unwanted third, lowest streak.
# These separators follow the empty gap below the second streak, in source-cell pixels.
SEPARATORS = {2: (240, .20), 3: (260, .20), 4: (275, .12), 5: (275, .12), 6: (275, .12)}


def normalize(source, slash):
    image = Image.open(source)
    if image.mode != "RGBA" or image.size != (1536, 1024):
        raise ValueError(f"Expected the supplied 1536x1024 RGBA sheet: {source}")
    atlas = Image.new("RGBA", (1024, 512))
    for index in range(8):
        x, y = index % 4 * 384, index // 4 * 512
        cell = image.crop((x, y, x + 384, y + 512))
        alpha = cell.getchannel("A")
        pixels = alpha.load()
        for cy in range(512):
            for cx in range(384):
                a = pixels[cx, cy]
                # Remove only near-invisible halo pixels; preserve the original soft alpha.
                weight = max(0, min(1, (a - 4) / 20))
                if slash and index in SEPARATORS:
                    intercept, slope = SEPARATORS[index]
                    weight *= max(0, min(1, (intercept + slope * cx - cy) / 2))
                pixels[cx, cy] = round(a * weight)
        cell.putalpha(alpha)
        # One common square crop for every cell, never individual bbox centering.
        cell = cell.crop((0, 64, 384, 448)).resize((256, 256), Image.Resampling.NEAREST)
        atlas.paste(cell, (index % 4 * 256, index // 4 * 256))
    # Fully transparent RGB noise wastes download bytes and has no visual content.
    clear = atlas.getchannel("A").point(lambda a: 255 if a == 0 else 0)
    atlas.paste((0, 0, 0, 0), (0, 0, 1024, 512), clear)
    return atlas


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path)
    args = parser.parse_args()
    preserved = ROOT / "assets-source/item-effects"
    output = ROOT / "public/assets/effects"
    preserved.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    for original, (saved, target) in SOURCES.items():
        source = preserved / saved
        if args.source_dir:
            shutil.copyfile(args.source_dir / original, source)
        result = normalize(source, target == "ruler-slash.png")
        result.save(output / target, optimize=True)
        print(target, result.size, result.getchannel("A").getextrema())


if __name__ == "__main__":
    main()
