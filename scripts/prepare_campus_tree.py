"""Normalize the supplied RGBA tree, keeping its existing transparent cutout."""
from pathlib import Path
import json

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets-source/campus-3d/trees/user-tree-source.png'
OUTPUT = ROOT / 'public/assets/environment/campus-trees/tree.png'
REVIEW = ROOT / 'artifacts/campus-3d/trees'


def main():
    source = Image.open(SOURCE).convert('RGBA')
    rgba = np.array(source)
    # The source already has a valid cutout; remove only near-transparent specks.
    rgba[rgba[:, :, 3] < 24] = 0
    clean = Image.fromarray(rgba)
    bounds = clean.getbbox()
    assert bounds is not None
    tree = clean.crop(bounds)
    tree.thumbnail((496, 496), Image.Resampling.LANCZOS)
    pixels = np.array(tree)
    # Binary alpha works with the runtime's depth-writing cutout and pixel edges.
    pixels[:, :, 3] = np.where(pixels[:, :, 3] >= 128, 255, 0)
    pixels[pixels[:, :, 3] == 0, :3] = 0
    tree = Image.fromarray(pixels)
    # The source trunk is slightly right of centre: anchor its lowest solid pixels.
    mask = pixels[:, :, 3] > 0
    rows, cols = np.where(mask)
    root_y = int(rows.max())
    root_x = int(np.median(cols[rows >= root_y - 6]))
    origin = (256 - root_x, 504 - root_y)
    output = Image.new('RGBA', (512, 512))
    output.paste(tree, origin)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    output.save(OUTPUT, optimize=True)
    # Light/dark/actual grass backgrounds expose black boxes and edge halos.
    sheet = Image.new('RGB', (1536, 512))
    backgrounds = [Image.new('RGBA', (512, 512), '#eee8d8'),
                   Image.new('RGBA', (512, 512), '#101a2b')]
    grass = Image.open(ROOT / 'public/assets/environment/campus-grass/grass-albedo.png').convert('RGBA')
    background = Image.new('RGBA', (512, 512))
    for y in range(2):
        for x in range(2):
            background.paste(grass, (x * 256, y * 256))
    backgrounds.append(background)
    for i, bg in enumerate(backgrounds):
        bg.alpha_composite(output)
        sheet.paste(bg.convert('RGB'), (i * 512, 0))
    sheet.save(REVIEW / 'cutout-review.png')
    # A 4x edge detail sheet is useful independently of game-scale checks.
    edge = output.crop((20, 225, 148, 353)).resize((512, 512), Image.Resampling.NEAREST)
    zoom = Image.new('RGB', (1024, 512))
    for i, color in enumerate(['#eee8d8', '#101a2b']):
        bg = Image.new('RGBA', (512, 512), color)
        bg.alpha_composite(edge)
        zoom.paste(bg.convert('RGB'), (i * 512, 0))
    zoom.save(REVIEW / 'edge-review-4x.png')
    report = {'sourceSize': list(source.size), 'sourceCrop': list(bounds),
              'outputSize': [512, 512], 'rootPixel': [256, 504],
              'alphaValues': np.unique(np.array(output)[:, :, 3]).tolist(),
              'outputBytes': OUTPUT.stat().st_size}
    (REVIEW / 'texture-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
