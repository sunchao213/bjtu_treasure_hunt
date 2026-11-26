"""Make a seamless, matte albedo from the user's blue-grey pixel asphalt.

Requires Pillow and NumPy; shares the grass pipeline's periodic edge repair.
"""
from pathlib import Path
import json

import numpy as np
from PIL import Image

from prepare_campus_grass import periodic_component, match_edges

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets-source/campus-3d/asphalt/user-asphalt-source.png'
OUTPUT = ROOT / 'public/assets/environment/campus-asphalt/asphalt-albedo.png'
REVIEW = ROOT / 'artifacts/campus-3d/asphalt'


def main():
    source = Image.open(SOURCE).convert('RGB')
    pixels = np.asarray(source.resize((256, 256), Image.Resampling.BOX), dtype=float)
    pixels = periodic_component(pixels)
    # Keep the user's cool palette, but soften the large mottled clusters.
    pixels = (pixels - pixels.mean(axis=(0, 1))) * 0.65 + np.array([53, 62, 82])
    pixels = np.clip(np.rint(match_edges(pixels)), 0, 255).astype('uint8')
    tile = Image.fromarray(pixels)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    tile.save(OUTPUT, optimize=True)
    preview = Image.new('RGB', (768, 768))
    for y in range(3):
        for x in range(3):
            preview.paste(tile, (x * 256, y * 256))
    preview.save(REVIEW / 'asphalt-tiled.png')
    report = {
        'sourceSize': list(source.size), 'outputSize': list(tile.size),
        'maxOpposingEdgeDifference': int(max(
            np.abs(pixels[0].astype(int) - pixels[-1]).max(),
            np.abs(pixels[:, 0].astype(int) - pixels[:, -1]).max(),
        )),
        'meanRGB': pixels.mean(axis=(0, 1)).round(2).tolist(),
        'outputBytes': OUTPUT.stat().st_size,
    }
    (REVIEW / 'texture-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
