import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/assets/characters/monster-animals-source.png"
OUTPUT = ROOT / "public/assets/characters/processed"
FRAME_SIZE = 128
ALPHA_THRESHOLD = 8
BACKGROUND_TOLERANCE = 34
ANIMATION_NAMES = {
    "duck-idle",
    "duck-walk",
    "duck-attack",
    "duck-hurt",
    "duck-death",
    "squirrel-idle",
    "squirrel-walk",
    "squirrel-request",
    "squirrel-mutate",
    "squirrel-mutant-idle",
    "squirrel-mutant-walk",
    "squirrel-mutant-attack",
    "squirrel-mutant-hurt-death",
    "squirrel-mutant-death",
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


def connected_sprites(alpha: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Find alpha-connected frame bounds using horizontal run-length labeling."""
    parents: list[int] = []
    bounds: list[list[int]] = []
    previous: list[tuple[int, int, int]] = []

    def find(label: int) -> int:
        while parents[label] != label:
            parents[label] = parents[parents[label]]
            label = parents[label]
        return label

    def join(first: int, second: int) -> None:
        a, b = find(first), find(second)
        if a != b:
            parents[b] = a

    for y, row in enumerate(alpha > ALPHA_THRESHOLD):
        edges = np.diff(np.pad(row.astype(np.int8), (1, 1)))
        starts, ends = np.where(edges == 1)[0], np.where(edges == -1)[0] - 1
        current: list[tuple[int, int, int]] = []
        for left, right in zip(starts, ends):
            label = len(parents)
            parents.append(label)
            bounds.append([int(left), y, int(right), y])
            for old_left, old_right, old_label in previous:
                if old_left <= right + 1 and old_right >= left - 1:
                    join(label, old_label)
            current.append((int(left), int(right), label))
        previous = current

    merged: dict[int, list[int]] = {}
    for label, rect in enumerate(bounds):
        root = find(label)
        if root not in merged:
            merged[root] = rect.copy()
        else:
            box = merged[root]
            box[0] = min(box[0], rect[0])
            box[1] = min(box[1], rect[1])
            box[2] = max(box[2], rect[2])
            box[3] = max(box[3], rect[3])
    return [tuple(box) for box in merged.values() if box[2] - box[0] > 18 and box[3] - box[1] > 18]


def make_frame(source: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    frame = source.crop(box).convert("RGBA")
    alpha = frame.getchannel("A")
    # Crop transparent padding but keep semi-transparent antialiased edges.
    bbox = alpha.point(lambda value: 255 if value > ALPHA_THRESHOLD else 0).getbbox()
    canvas = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    if bbox:
        sprite = frame.crop(bbox)
        sprite.thumbnail((FRAME_SIZE - 12, FRAME_SIZE - 12), Image.Resampling.LANCZOS)
        x = (FRAME_SIZE - sprite.width) // 2
        y = FRAME_SIZE - 4 - sprite.height
        canvas.alpha_composite(sprite, (x, y))
    return canvas


def split_wide_box(alpha: np.ndarray, box: tuple[int, int, int, int], max_width: float) -> list[tuple[int, int, int, int]]:
    """Split touching sprites at the lowest alpha-density valley."""
    left, top, right, bottom = box
    if right - left + 1 <= max_width:
        return [box]
    density = (alpha[top : bottom + 1, left : right + 1] > ALPHA_THRESHOLD).sum(axis=0)
    margin = max(4, int(len(density) * 0.08))
    candidates = range(margin, len(density) - margin)
    split_at = min(candidates, key=lambda index: (int(density[index]), abs(index - len(density) / 2)))
    split_x = left + split_at
    if split_x <= left + 8 or split_x >= right - 8:
        return [box]
    return split_wide_box(alpha, (left, top, split_x - 1, bottom), max_width) + split_wide_box(
        alpha, (split_x, top, right, bottom), max_width
    )


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
            print(f"{path.name}: {count} frames, {strip.mode}, {strip.width}x{strip.height}")


def build_sheets(source_path: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in ANIMATION_NAMES:
        old_sheet = output_dir / f"{name}.png"
        if old_sheet.exists():
            old_sheet.unlink()
    source = remove_background(Image.open(source_path))
    alpha = np.array(source.getchannel("A"))
    boxes = connected_sprites(alpha)
    groups = {
        "duck-idle": (0, 150, 0, 565),
        "duck-walk": (0, 150, 575, 1050),
        "duck-attack": (0, 150, 1050, 1536),
        "duck-hurt": (150, 310, 0, 680),
        "duck-death": (150, 310, 680, 1536),
        "squirrel-idle": (310, 450, 0, 700),
        "squirrel-walk": (310, 450, 700, 1536),
        "squirrel-request": (450, 590, 0, 1536),
        "squirrel-mutate": (590, 735, 0, 1250),
        "squirrel-mutant-idle": (735, 865, 0, 1536),
        "squirrel-mutant-walk": (865, 1024, 0, 710),
        "squirrel-mutant-attack": (865, 1024, 710, 1160),
        "squirrel-mutant-hurt-death": (865, 1024, 1160, 1536),
        "squirrel-mutant-death": (865, 1024, 1160, 1536),
    }
    for name, (y0, y1, x0, x1) in groups.items():
        frames = sorted(
            (box for box in boxes if box[0] >= x0 and box[2] <= x1 and box[1] >= y0 and box[3] <= y1),
            key=lambda box: box[0],
        )
        if name in {"squirrel-mutant-hurt-death", "squirrel-mutant-death"}:
            frames = [part for box in frames for part in split_wide_box(alpha, box, 180)]
        frames = [box for box in frames if box[2] - box[0] < 190 and box[3] - box[1] < 170]
        if not frames:
            continue
        strip = Image.new("RGBA", (FRAME_SIZE * len(frames), FRAME_SIZE), (0, 0, 0, 0))
        for index, box in enumerate(frames):
            strip.alpha_composite(make_frame(source, box), (index * FRAME_SIZE, 0))
        strip.save(output_dir / f"{name}.png", optimize=True)
        print(f"{name}: {len(frames)} frames")
    print(f"Prepared animation strips in {output_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Cut and validate the monster sprite sheet.")
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    if not args.verify_only:
        build_sheets(args.source, args.output)
    verify_outputs(args.output, {name: None for name in ANIMATION_NAMES})


if __name__ == "__main__":
    main()
