"""Normalize the user-supplied grass image into a repeatable ground albedo.

Requires Pillow and NumPy. No image generation or painted lighting is added.
"""
from pathlib import Path
import json

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets-source/campus-3d/grass/user-grass-source.png'
OUTPUT = ROOT / 'public/assets/environment/campus-grass/grass-albedo.png'
REVIEW = ROOT / 'artifacts/campus-3d/grass'


def periodic_component(pixels):
    # Remove the smooth boundary discontinuity with a periodic Poisson solve.
    height, width, _ = pixels.shape
    boundary = np.zeros_like(pixels)
    boundary[0] = pixels[-1] - pixels[0]
    boundary[-1] = -boundary[0]
    boundary[:, 0] += pixels[:, -1] - pixels[:, 0]
    boundary[:, -1] -= pixels[:, -1] - pixels[:, 0]
    denominator = (
        2 * np.cos(2 * np.pi * np.arange(height) / height)[:, None]
        + 2 * np.cos(2 * np.pi * np.arange(width) / width)[None, :] - 4
    )
    denominator[0, 0] = 1
    smooth = np.fft.fft2(boundary, axes=(0, 1)) / denominator[:, :, None]
    smooth[0, 0] = 0
    return pixels - np.fft.ifft2(smooth, axes=(0, 1)).real


def match_edges(pixels):
    # Match the actual outer texels too, fading corrections over six texels.
    for axis in (0, 1):
        p = np.swapaxes(pixels, 0, axis)
        delta = (p[-1] - p[0]) / 2
        for i in range(6):
            weight = (1 - i / 6) ** 2
            p[i] += delta * weight
            p[-1 - i] -= delta * weight
    return pixels


def main():
    source = Image.open(SOURCE).convert('RGB')
    pixels = np.asarray(source.resize((256, 256), Image.Resampling.BOX), dtype=float)
    pixels = periodic_component(pixels)
    # Reduce busy dark/light clusters; preserve the supplied grass shapes.
    pixels = (pixels - pixels.mean(axis=(0, 1))) * 0.70 + np.array([66, 89, 56])
    pixels = np.clip(np.rint(match_edges(pixels)), 0, 255).astype('uint8')
    tile = Image.fromarray(pixels)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    tile.save(OUTPUT, optimize=True)
    preview = Image.new('RGB', (768, 768))
    for y in range(3):
        for x in range(3):
            preview.paste(tile, (x * 256, y * 256))
    preview.save(REVIEW / 'grass-tiled.png')
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
