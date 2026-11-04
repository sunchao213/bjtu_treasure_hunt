import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/assets/characters/monster-animals-source.png"
OUTPUT = ROOT / "public/assets/characters/processed"
FRAME_SIZE = 176
ALPHA_THRESHOLD = 8
BACKGROUND_TOLERANCE = 34


# Explicit cell boundaries in the supplied 1536x1024 source. Some neighboring
# sprites touch through outlines/effect marks, so connected components alone
# cannot identify animation frames or separate individual animals reliably.
ROWS = {
    "duck-idle": (20, 140, [16, 114, 200, 290, 379, 463, 560]),
    "duck-walk": (20, 140, [575, 685, 780, 870, 960, 1053, 1149]),
    "duck-attack": (20, 140, [1149, 1238, 1328, 1420, 1536]),
    "duck-hurt": (145, 265, [8, 104, 196, 287, 379, 478, 592, 695]),
    "duck-death": (145, 265, [695, 822, 960, 1114, 1285, 1460]),
    "squirrel-idle": (330, 440, [16, 114, 207, 296, 382, 462, 545]),
    "squirrel-walk": (330, 440, [545, 642, 744, 839, 932, 1035, 1130, 1213, 1293, 1382, 1490]),
    "squirrel-request": (445, 580, [8, 112, 215, 314, 430, 560, 691, 811, 949, 1064, 1186, 1299, 1415, 1520]),
    "squirrel-mutate": (610, 730, [8, 113, 207, 297, 382, 463, 542, 623, 702, 783, 875, 955, 1034, 1123, 1225]),
    "squirrel-mutant-idle": (735, 855, [8, 103, 192, 276, 362, 445]),
    "squirrel-mutant-walk": (735, 855, [445, 565, 678, 780, 866, 955, 1040, 1138, 1255]),
    "squirrel-mutant-hurt": (870, 990, [8, 105, 192, 280, 369, 465]),
    "squirrel-mutant-attack": (870, 990, [465, 578, 709, 855, 1017, 1164]),
    "squirrel-mutant-death": (910, 990, [1164, 1290, 1400, 1530]),
}


def remove_background(source: Image.Image) -> Image.Image:
    """Keep existing transparency or remove an edge-connected flat backdrop."""
    image = source.convert("RGBA")
    rgba = np.array(image)
    alpha = rgba[:, :, 3]
    if np.any(alpha == 0):
        rgba[alpha < ALPHA_THRESHOLD, 3] = 0
        return Image.fromarray(rgba, "RGBA")

    rgb = rgba[:, :, :3].astype(np.int16)
    height, width = alpha.shape
    corners = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    visited = np.zeros((height, width), dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x, y in corners:
        color = rgb[y, x]
        if not any(np.max(np.abs(color - rgb[sy, sx])) <= BACKGROUND_TOLERANCE for sx, sy in corners[: corners.index((x, y))]):
            queue.append((x, y))
            visited[y, x] = True

    background = np.zeros((height, width), dtype=bool)
    while queue:
        x, y = queue.popleft()
        background[y, x] = True
        reference = rgb[y, x]
        for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if next_x < 0 or next_x >= width or next_y < 0 or next_y >= height or visited[next_y, next_x]:
                continue
            visited[next_y, next_x] = True
            if np.max(np.abs(rgb[next_y, next_x] - reference)) <= BACKGROUND_TOLERANCE:
                queue.append((next_x, next_y))

    rgba[background, 3] = 0
    return Image.fromarray(rgba, "RGBA")


def make_frame(source: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    frame = source.crop(box).convert("RGBA")
    alpha = frame.getchannel("A")
    # Crop transparent padding but keep semi-transparent antialiased edges.
    bbox = alpha.point(lambda value: 255 if value > ALPHA_THRESHOLD else 0).getbbox()
    canvas = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    if bbox:
        sprite = frame.crop(bbox)
        # Keep source pixels at the same scale across every pose. Resizing each
        # tight crop separately makes animals grow/shrink as animations change.
        if sprite.width > FRAME_SIZE - 8 or sprite.height > FRAME_SIZE - 8:
            raise ValueError(f"Sprite does not fit the fixed frame: {box}")
        x = (FRAME_SIZE - sprite.width) // 2
        y = FRAME_SIZE - 4 - sprite.height
        canvas.alpha_composite(sprite, (x, y))
    return canvas


def frame_seam(alpha: np.ndarray, boundary: int) -> np.ndarray:
    """Follow the gap between a preceding muzzle and the next animal's tail."""
    height, width = alpha.shape
    if boundary <= 0 or boundary >= width:
        return np.full(height, min(width, max(0, boundary)))
    left, right = max(0, boundary - 24), min(width, boundary + 25)
    columns = np.arange(left, right)
    cost = (alpha[:, left:right] > ALPHA_THRESHOLD).astype(float) * 100
    cost += np.abs(columns - boundary) * 0.01
    paths = np.zeros(cost.shape, dtype=np.int32)
    total = cost[0].copy()
    for y in range(1, height):
        candidates = np.stack((np.r_[np.inf, total[:-1]], total, np.r_[total[1:], np.inf]))
        step = candidates.argmin(axis=0)
        paths[y] = columns - left + step - 1
        total = cost[y] + candidates[step, np.arange(right - left)]
    seam = np.empty(height, dtype=np.int32)
    index = int(total.argmin())
    for y in range(height - 1, -1, -1):
        seam[y] = left + index
        index = paths[y, index]
    return seam


def isolate_animal(cell: Image.Image) -> Image.Image:
    """Keep the main animal, removing detached bits from adjacent poses."""
    rgba = np.array(cell)
    remaining = rgba[:, :, 3] > ALPHA_THRESHOLD
    height, width = remaining.shape
    largest = []
    for y, x in zip(*np.where(remaining)):
        if not remaining[y, x]:
            continue
        component = []
        queue = deque([(int(x), int(y))])
        remaining[y, x] = False
        while queue:
            px, py = queue.popleft()
            component.append((py, px))
            for ny in range(max(0, py - 1), min(height, py + 2)):
                for nx in range(max(0, px - 1), min(width, px + 2)):
                    if remaining[ny, nx]:
                        remaining[ny, nx] = False
                        queue.append((nx, ny))
        if len(component) > len(largest):
            largest = component
    keep = np.zeros((height, width), dtype=bool)
    if largest:
        ys, xs = zip(*largest)
        keep[ys, xs] = True
    rgba[~keep, 3] = 0
    return Image.fromarray(rgba)


def verify_outputs(output_dir: Path, expected_counts: dict[str, int] | None = None) -> None:
    sheets = sorted(output_dir.glob("*.png"))
    if not sheets:
        raise ValueError(f"No animation strips found in {output_dir}")
    if expected_counts is not None:
        missing = set(expected_counts) - {path.stem for path in sheets}
        extra = {path.stem for path in sheets} - set(expected_counts)
        if missing or extra:
            raise ValueError(f"Animation set mismatch; missing={sorted(missing)}, extra={sorted(extra)}")
    for path in sheets:
        with Image.open(path) as strip:
            if strip.mode != "RGBA" or strip.height != FRAME_SIZE or strip.width % FRAME_SIZE:
                raise ValueError(f"Invalid strip dimensions or mode: {path.name} {strip.size} {strip.mode}")
            count = strip.width // FRAME_SIZE
            if count == 0:
                raise ValueError(f"Strip has no frames: {path.name}")
            if expected_counts and expected_counts.get(path.stem) is not None and count != expected_counts[path.stem]:
                raise ValueError(f"{path.name}: expected {expected_counts[path.stem]} frames, found {count}")
            if strip.getchannel("A").getbbox() is None:
                raise ValueError(f"Strip is fully transparent: {path.name}")
            for index in range(count):
                frame = strip.crop((index * FRAME_SIZE, 0, (index + 1) * FRAME_SIZE, FRAME_SIZE))
                box = frame.getchannel("A").getbbox()
                if not box or box[0] < 3 or box[2] > FRAME_SIZE - 3 or box[3] != FRAME_SIZE - 4:
                    raise ValueError(f"Empty, clipped or ungrounded frame: {path.name}:{index} {box}")
            print(f"{path.name}: {count} frames, {strip.mode}, {strip.width}x{strip.height}")


def build_sheets(source_path: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    source = remove_background(Image.open(source_path))
    if source.size != (1536, 1024):
        raise ValueError("The explicit frame layout requires the supplied 1536x1024 source")
    for name, (top, bottom, edges) in ROWS.items():
        frames = []
        band = np.array(source.crop((0, top, source.width, bottom)))
        seams = [frame_seam(band[:, :, 3], edge) for edge in edges]
        for left, right in zip(seams, seams[1:]):
            x0, x1 = int(left.min()), int(right.max())
            cell = band[:, x0:x1].copy()
            columns = np.arange(x0, x1)[None, :]
            cell[(columns < left[:, None]) | (columns >= right[:, None]), 3] = 0
            animal = isolate_animal(Image.fromarray(cell))
            if animal.getchannel("A").getbbox() is None:
                raise ValueError(f"Missing animal in {name} cell {x0}:{x1}")
            frames.append(make_frame(animal, (0, 0, animal.width, animal.height)))
        strip = Image.new("RGBA", (FRAME_SIZE * len(frames), FRAME_SIZE), (0, 0, 0, 0))
        for index, frame in enumerate(frames):
            strip.alpha_composite(frame, (index * FRAME_SIZE, 0))
        strip.save(output_dir / f"{name}.png", optimize=True)
        print(f"{name}: {len(frames)} frames")

    # The source has no brown squirrel death row. Reuse that animal's own pose
    # for a short fall/fade rather than changing it into a duck on lethal hits.
    with Image.open(output_dir / "squirrel-idle.png") as idle:
        pose = idle.crop((0, 0, FRAME_SIZE, FRAME_SIZE))
        pose = pose.crop(pose.getchannel("A").getbbox())
        strip = Image.new("RGBA", (FRAME_SIZE * 3, FRAME_SIZE))
        for index, angle in enumerate((25, 55, 90)):
            fallen = pose.rotate(angle, expand=True, resample=Image.Resampling.NEAREST)
            fallen.putalpha(fallen.getchannel("A").point(lambda a: a * (3 - index) // 3))
            fallen = fallen.crop(fallen.getchannel("A").getbbox())
            strip.alpha_composite(fallen, (index * FRAME_SIZE + (FRAME_SIZE - fallen.width) // 2, FRAME_SIZE - 4 - fallen.height))
        strip.save(output_dir / "squirrel-death.png", optimize=True)
    obsolete = output_dir / "squirrel-mutant-hurt-death.png"
    if obsolete.exists():
        obsolete.unlink()
    print(f"Prepared animation strips in {output_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Cut and validate the monster sprite sheet.")
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    if not args.verify_only:
        build_sheets(args.source, args.output)
    counts = {name: len(row[2]) - 1 for name, row in ROWS.items()}
    counts["squirrel-death"] = 3
    verify_outputs(args.output, counts)


if __name__ == "__main__":
    main()
