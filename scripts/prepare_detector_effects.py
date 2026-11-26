"""Preserve and copy the user-supplied transparent detector assets without pixel edits.

Usage: python scripts/prepare_detector_effects.py [--source-dir <downloads>]
"""
from argparse import ArgumentParser
from pathlib import Path
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "simple_detector_activation_4x4.png": ("detector-activation.png", (1024, 1024)),
    "simple_detector_loot_direction_marker.png": ("detector-direction.png", (256, 256)),
}


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path)
    args = parser.parse_args()
    preserved = ROOT / "assets-source/item-effects"
    output = ROOT / "public/assets/effects"
    preserved.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    for original, (target, size) in SOURCES.items():
        source = args.source_dir / original if args.source_dir else preserved / original
        with Image.open(source) as image:
            if image.size != size or image.mode != "RGBA" or image.getchannel("A").getextrema()[0] != 0:
                raise ValueError(f"Expected transparent RGBA {size}: {source}")
        if source.resolve() != (preserved / original).resolve():
            shutil.copyfile(source, preserved / original)
        shutil.copyfile(preserved / original, output / target)
        print(target)


if __name__ == "__main__":
    main()
