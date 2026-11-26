"""Prepare the user supplied Minghu stone as a feet anchored alpha cutout.

Only the black region connected to the image border is removed. Dark lettering
and stone cracks inside the silhouette are retained.
"""

from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "assets-source/story/minghu-stele-reference.png"
output = ROOT / "public/assets/props/minghu-stele.png"
image = Image.open(source).convert("RGB")
channels = image.split()
brightness = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
outside = brightness.point(lambda value: 0 if value < 28 else 255)
ImageDraw.floodfill(outside, (0, 0), 128)
alpha = outside.point(lambda value: 0 if value == 128 else 255)
alpha = alpha.filter(ImageFilter.MinFilter(3))
image.putalpha(alpha)
bounds = alpha.getbbox()
image = image.crop(bounds)
image.thumbnail((768, 960), Image.Resampling.LANCZOS)
output.parent.mkdir(parents=True, exist_ok=True)
image.save(output)
print(f"{output.relative_to(ROOT)}: {image.size}, RGBA")
