"""Prepare photo-derived PBR maps for the real, solid Minghu stele.

Usage: python scripts/prepare_minghu_model_textures.py [user-photo.png]
The photographed inscription is preserved; no replacement font is invented.
"""
from pathlib import Path
import shutil
import sys

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets-source/campus-3d/minghu-stele'
SOURCE.mkdir(parents=True, exist_ok=True)
photo = SOURCE / 'reference.png'
if len(sys.argv) > 1:
    shutil.copyfile(sys.argv[1], photo)
image = Image.open(photo).convert('RGB')
if image.size != (1290, 2796):
    raise ValueError('The authored silhouette uses the supplied 1290×2796 reference.')

# The front contour is authored against this exact crop. It excludes the rear
# thickness, pool, trees and nearby people; those are not projected onto the mesh.
front = image.crop((170, 1140, 900, 2440)).resize((768, 1368), Image.Resampling.LANCZOS)
front = ImageEnhance.Color(front).enhance(0.76)
front = ImageEnhance.Brightness(front).enhance(1.12)
front.save(SOURCE / 'front-albedo.jpg', quality=94, subsampling=0)

# A letter-free patch of the same photographed stone, mirrored at its edges so
# the back, thickness and foot rocks share the front's mineral grain and colour.
patch = image.crop((349, 1930, 529, 2150)).resize((256, 256), Image.Resampling.LANCZOS)
patch = ImageEnhance.Color(patch).enhance(0.68)
patch = ImageEnhance.Brightness(patch).enhance(1.24)
stone = Image.new('RGB', (512, 512))
stone.paste(patch, (0, 0))
stone.paste(ImageOps.mirror(patch), (256, 0))
stone.paste(ImageOps.flip(patch), (0, 256))
stone.paste(ImageOps.flip(ImageOps.mirror(patch)), (256, 256))
# Keep only fine photographed grain; remove the mirrored patch's broad seams
# and add non-directional mineral variation rather than repeating large cracks.
sample = np.asarray(stone, dtype=np.float32)
smooth = np.asarray(stone.filter(ImageFilter.GaussianBlur(7)), dtype=np.float32)
yy, xx = np.mgrid[0:512, 0:512] / 512 * np.pi * 2
rng = np.random.default_rng(5241)
mineral = np.zeros((512, 512), dtype=np.float32)
for frequency in [1, 2, 3, 5, 9, 17, 31, 53]:
    for _ in range(3):
        ax, ay = rng.integers(1, frequency + 1, size=2)
        mineral += np.sin(xx * ax + rng.random() * 6.28) * np.cos(yy * ay + rng.random() * 6.28) / frequency ** 0.48
mineral /= mineral.std()
base = np.median(sample.reshape(-1, 3), axis=0) * 0.91
stone = Image.fromarray(np.clip(base + mineral[..., None] * 8 + (sample - smooth) * 0.24, 0, 255).astype('uint8'))
stone.save(SOURCE / 'stone-albedo.jpg', quality=91)


def relief_maps(albedo, prefix, strength):
    grey = albedo.convert('L')
    pixels = np.asarray(grey, dtype=np.float32) / 255
    broad = np.asarray(grey.filter(ImageFilter.GaussianBlur(9)), dtype=np.float32) / 255
    # Remove broad photographed light/shadow, retaining the rock grain and
    # recessed lettering. Geometry samples the same height field as the normal map.
    height = np.clip(0.5 + (pixels - broad) * 1.5, 0, 1)
    height_image = Image.fromarray((height * 255).astype('uint8'))
    height_image.save(SOURCE / f'{prefix}-height.png')
    gy, gx = np.gradient(height)
    normal = np.stack((-gx * strength, gy * strength, np.ones_like(gx)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    normal_image = Image.fromarray(((normal * 0.5 + 0.5) * 255).astype('uint8'))
    normal_image = normal_image.resize((albedo.width // 2, albedo.height // 2), Image.Resampling.LANCZOS)
    normal_image.save(SOURCE / f'{prefix}-normal.png', optimize=True)


relief_maps(front, 'front', 4.5)
relief_maps(stone, 'stone', 4.0)
print(f'Prepared photo textures in {SOURCE}')
