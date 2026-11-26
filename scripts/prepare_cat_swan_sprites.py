"""Cut the cat/swan sheet into the same 176px grounded strips the duck uses."""

from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "public/assets/characters/cat-swan-source.png"
OUTPUT = ROOT / "public/assets/characters/processed"
FRAME_SIZE = 176
ALPHA_THRESHOLD = 8

# Row bands on the supplied 819x545 sheet.
BANDS = [
    (9, 70),
    (81, 131),
    (146, 193),
    (205, 254),
    (269, 313),
    (327, 398),
    (405, 470),
    (472, 537),
]

# Right-facing poses. The sheet itself is an 8-direction set, so each strip
# keeps one facing and lets the game flip it.
SELECTIONS: dict[str, list[tuple[int, int]]] = {
    "cat-idle": [(0, 1), (1, 1), (0, 6), (1, 6)],
    "cat-walk": [(2, 0), (2, 1), (2, 2), (2, 3)],
    "cat-attack": [(2, 2), (2, 3), (2, 4), (3, 10)],
    "cat-hurt": [(4, 0), (4, 1), (4, 5)],
    "cat-death": [(4, 9), (4, 10), (4, 12)],
    "swan-idle": [(5, 0), (5, 1), (5, 6)],
    "swan-walk": [(6, 0), (6, 1), (6, 2), (6, 6)],
    "swan-attack": [(6, 4), (6, 8), (6, 0)],
    "swan-hurt": [(7, 7), (7, 8)],
}


def erode(mask: np.ndarray, radius: int = 1) -> np.ndarray:
    height, width = mask.shape
    kept = mask.copy()
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            shifted = np.zeros_like(mask)
            y0, y1 = max(0, dy), height + min(0, dy)
            x0, x1 = max(0, dx), width + min(0, dx)
            shifted[y0:y1, x0:x1] = mask[y0 - dy : y1 - dy, x0 - dx : x1 - dx]
            kept &= shifted
    return kept


def dilate(mask: np.ndarray, radius: int = 2) -> np.ndarray:
    height, width = mask.shape
    grown = np.zeros_like(mask)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            shifted = np.zeros_like(mask)
            y0, y1 = max(0, dy), height + min(0, dy)
            x0, x1 = max(0, dx), width + min(0, dx)
            shifted[y0:y1, x0:x1] = mask[y0 - dy : y1 - dy, x0 - dx : x1 - dx]
            grown |= shifted
    return grown


def components(band: np.ndarray) -> list[Image.Image]:
    alpha = band[:, :, 3] > 16
    core = erode(alpha, 1)
    height, width = core.shape
    seen = np.zeros_like(core)
    masks: list[np.ndarray] = []
    ys, xs = np.where(core)
    for y, x in zip(ys, xs):
        if seen[y, x]:
            continue
        queue: deque[tuple[int, int]] = deque([(int(x), int(y))])
        seen[y, x] = True
        cells: list[tuple[int, int]] = []
        while queue:
            cx, cy = queue.popleft()
            cells.append((cy, cx))
            for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                if 0 <= nx < width and 0 <= ny < height and core[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((nx, ny))
        if len(cells) < 20:
            continue
        mask = np.zeros_like(core)
        for cy, cx in cells:
            mask[cy, cx] = True
        masks.append(mask)
    masks.sort(key=lambda mask: int(np.where(mask)[1].min()))
    frames: list[Image.Image] = []
    for mask in masks:
        kept = dilate(mask, 2) & alpha
        ys, xs = np.where(kept)
        crop = band[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1].copy()
        local = kept[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
        crop[~local, 3] = 0
        frames.append(Image.fromarray(crop))
    return frames


def tight_crop(sprite: Image.Image) -> Image.Image:
    image = sprite.convert("RGBA")
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > ALPHA_THRESHOLD else 0).getbbox()
    if bbox is None:
        raise ValueError("Empty sprite")
    return image.crop(bbox)


def place(sprite: Image.Image, scale: float) -> Image.Image:
    fitted = tight_crop(sprite)
    if scale != 1:
        fitted = fitted.resize(
            (max(1, round(fitted.width * scale)), max(1, round(fitted.height * scale))),
            Image.Resampling.NEAREST,
        )
    if fitted.width > FRAME_SIZE - 8 or fitted.height > FRAME_SIZE - 8:
        raise ValueError(f"Sprite does not fit the fixed frame: {fitted.size}")
    canvas = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(
        fitted,
        ((FRAME_SIZE - fitted.width) // 2, FRAME_SIZE - 4 - fitted.height),
    )
    return canvas


def animal_scale(sprites: list[Image.Image]) -> float:
    """Match the duck's on-sheet height without letting a wide death frame overflow."""
    tight = [tight_crop(sprite) for sprite in sprites]
    tallest = max(sprite.height for sprite in tight)
    widest = max(sprite.width for sprite in tight)
    return min(104 / tallest, 160 / widest)


def swan_death_frames(source: np.ndarray) -> list[Image.Image]:
    """The last two swans overlap, so split that run on the narrow neck."""
    top, bottom = BANDS[7]
    band = source[top:bottom]
    frames = components(band)
    falling = frames[8]
    body = band[:, 618:817]
    columns = (body[:, :, 3] > ALPHA_THRESHOLD).sum(axis=0)
    neck = 12 + int(columns[12:-12].argmin())
    right = body[:, neck:]

    def trim(cell: np.ndarray) -> Image.Image:
        alpha = cell[:, :, 3] > ALPHA_THRESHOLD
        ys, xs = np.where(alpha)
        crop = cell[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1].copy()
        return Image.fromarray(crop)

    # The middle of this run is two swans drawn on top of each other.
    return [falling, trim(right)]


def build(source_path: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    source = np.array(Image.open(source_path).convert("RGBA"))
    if source.shape[1] != 819 or source.shape[0] != 545:
        raise ValueError("The cat/swan layout expects the supplied 819x545 sheet")
    rows = [components(source[top:bottom]) for top, bottom in BANDS]
    grouped: dict[str, list[Image.Image]] = {}
    for name, picks in SELECTIONS.items():
        grouped[name] = []
        for row, index in picks:
            if index >= len(rows[row]):
                raise ValueError(f"{name} missing frame row {row} index {index}")
            grouped[name].append(rows[row][index])
    grouped["swan-death"] = swan_death_frames(source)
    scales = {
        animal: animal_scale([frame for name, frames in grouped.items() if name.startswith(animal) for frame in frames])
        for animal in ("cat-", "swan-")
    }

    for name, sprites in grouped.items():
        scale = scales["cat-" if name.startswith("cat-") else "swan-"]
        frames = [place(sprite, scale) for sprite in sprites]
        strip = Image.new("RGBA", (FRAME_SIZE * len(frames), FRAME_SIZE), (0, 0, 0, 0))
        for index, frame in enumerate(frames):
            strip.alpha_composite(frame, (index * FRAME_SIZE, 0))
        strip.save(output_dir / f"{name}.png", optimize=True)
        print(f"{name}: {len(frames)} frames, scale {scale:.2f}")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Cut cat and swan monster animations.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    build(args.source, args.output)


if __name__ == "__main__":
    main()
