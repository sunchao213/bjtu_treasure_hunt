"""Preserve and copy the user-supplied transparent quick_note assets without pixel edits.

Usage: python scripts/prepare_quick_note_effects.py [--source-dir <downloads>]
"""
from argparse import ArgumentParser
from pathlib import Path
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "sujika_card_use_atlas_4x4.png": ("quick-note-use.png", (1024, 1024)),
    "sujika_card_ready_icon.png": ("quick-note-ready.png", (256, 256)),
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
