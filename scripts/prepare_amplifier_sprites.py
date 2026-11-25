"""Cut the amplifier monster and red sound-wave sheets into 176px strips."""

from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MONSTER_SOURCE = ROOT / "assets-source/monsters/amplifier-monster-sheet.png"
WAVE_SOURCE = ROOT / "assets-source/monsters/amplifier-wave-sheet.png"
OUTPUT = ROOT / "public/assets/characters/processed"
FRAME_SIZE = 176
ALPHA_THRESHOLD = 8
COLS = 6
ROWS = 3


def remove_black_background(image: Image.Image, preserve_red_glow: bool = False) -> Image.Image:
    """Remove edge-connected dark backdrop while keeping dark interior outlines intact."""
    rgba = np.array(image.convert("RGBA"))
    if np.any(rgba[:, :, 3] == 0):
        rgba[rgba[:, :, 3] < ALPHA_THRESHOLD, 3] = 0
        return Image.fromarray(rgba, "RGBA")

    rgb = rgba[:, :, :3].astype(np.int16)
    max_c = rgb.max(axis=2)
    height, width = max_c.shape

    visited = np.zeros((height, width), dtype=bool)
    background = np.zeros((height, width), dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        if not visited[y, x] and max_c[y, x] <= 24:
            visited[y, x] = True
            queue.append((x, y))

    for x in range(width):
        seed(x, 0)
        seed(x, height - 1)
    for y in range(height):
        seed(0, y)
        seed(width - 1, y)

    while queue:
        x, y = queue.popleft()
        background[y, x] = True
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and not visited[ny, nx]:
                if max_c[ny, nx] <= 22:
                    visited[ny, nx] = True
                    queue.append((nx, ny))

    rgba[background, 3] = 0

    if preserve_red_glow:
        # Soften dark red glow halo pixels outside the opaque character core.
        red_dominant = (
            (~background)
            & (rgb[:, :, 0] > rgb[:, :, 1] + 22)
            & (rgb[:, :, 0] > rgb[:, :, 2] + 22)
            & (max_c < 130)
        )
        ys, xs = np.where(red_dominant)
        for y, x in zip(ys, xs):
            r = int(rgb[y, x, 0])
            alpha = int(np.clip((r - 12) * 255 / 120, 0, 255))
            if alpha < ALPHA_THRESHOLD:
                rgba[y, x, 3] = 0
            else:
                rgba[y, x, 3] = alpha
                scale = 255.0 / max(r, 1)
                rgba[y, x, 0] = min(255, int(rgb[y, x, 0] * scale))
                rgba[y, x, 1] = min(255, int(rgb[y, x, 1] * scale))
                rgba[y, x, 2] = min(255, int(rgb[y, x, 2] * scale))

    return Image.fromarray(rgba, "RGBA")


def remove_black_additive_fx(cell: Image.Image) -> Image.Image:
    """Convert black-backed luminous red wave VFX while preserving crisp arc ridges."""
    rgba = np.array(cell.convert("RGBA"), dtype=np.float32)
    rgb = rgba[:, :, :3]
    lum = rgb.max(axis=2)
    # Keep dark gaps between sonic arcs transparent so each red crescent reads clearly.
    norm = np.clip((lum - 24.0) / 225.0, 0.0, 1.0)
    alpha = np.power(norm, 1.15)
    out = np.zeros_like(rgba, dtype=np.uint8)
    mask = alpha > (ALPHA_THRESHOLD / 255.0)
    # Mild unpremultiply preserves rich crimson tones without washing dark arcs flat.
    boost = np.minimum(1.35, 255.0 / np.maximum(lum[mask], 1.0))[:, None]
    out[mask, :3] = np.clip(rgb[mask] * boost, 0, 255).astype(np.uint8)
    out[mask, 3] = np.clip(alpha[mask] * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def find_vertical_seams(band_alpha: np.ndarray, cols: int = COLS) -> list[int]:
    """Find cleanest vertical cut near each nominal column boundary."""
    width = band_alpha.shape[1]
    col_energy = (band_alpha > ALPHA_THRESHOLD).sum(axis=0).astype(np.float64)
    seams = [0]
    for index in range(1, cols):
        nominal = round(index * width / cols)
        lo = max(seams[-1] + 20, nominal - 36)
        hi = min(width - 20, nominal + 36)
        window = col_energy[lo : hi + 1]
        # Prefer zero-pixel gaps closest to the nominal grid line.
        offsets = np.abs(np.arange(lo, hi + 1) - nominal) * 0.05
        best = lo + int(np.argmin(window + offsets))
        seams.append(best)
    seams.append(width)
    return seams


def remove_edge_fragments(cell: Image.Image) -> Image.Image:
    """Drop tiny detached fragments sitting right on the left/right cut boundary."""
    rgba = np.array(cell)
    opaque = rgba[:, :, 3] > ALPHA_THRESHOLD
    height, width = opaque.shape
    seen = np.zeros_like(opaque)
    components: list[tuple[list[tuple[int, int]], bool]] = []

    ys, xs = np.where(opaque)
    for y, x in zip(ys, xs):
        if seen[y, x]:
            continue
        queue: deque[tuple[int, int]] = deque([(int(x), int(y))])
        seen[y, x] = True
        pixels: list[tuple[int, int]] = []
        touches_side = False
        while queue:
            cx, cy = queue.popleft()
            pixels.append((cy, cx))
            if cx <= 2 or cx >= width - 3:
                touches_side = True
            for ny in range(max(0, cy - 1), min(height, cy + 2)):
                for nx in range(max(0, cx - 1), min(width, cx + 2)):
                    if opaque[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((nx, ny))
        components.append((pixels, touches_side))

    if not components:
        return cell
    largest_size = max(len(pixels) for pixels, _ in components)
    for pixels, touches_side in components:
        # Remove small stray bits clipped from a neighboring frame at the seam.
        if touches_side and len(pixels) < largest_size * 0.15:
            for cy, cx in pixels:
                rgba[cy, cx, 3] = 0
    return Image.fromarray(rgba, "RGBA")


def slice_row_with_seams(row_img: Image.Image, cols: int = COLS) -> list[Image.Image]:
    alpha = np.array(row_img.getchannel("A"))
    seams = find_vertical_seams(alpha, cols)
    cells: list[Image.Image] = []
    for x0, x1 in zip(seams, seams[1:]):
        cell = row_img.crop((x0, 0, x1, row_img.height))
        cells.append(remove_edge_fragments(cell))
    return cells


def slice_grid(image: Image.Image, cols: int = COLS, rows: int = ROWS) -> list[list[Image.Image]]:
    width, height = image.size
    grid: list[list[Image.Image]] = []
    for row in range(rows):
        y0 = round(row * height / rows)
        y1 = round((row + 1) * height / rows)
        line: list[Image.Image] = []
        for col in range(cols):
            x0 = round(col * width / cols)
            x1 = round((col + 1) * width / cols)
            line.append(image.crop((x0, y0, x1, y1)))
        grid.append(line)
    return grid


def tight_crop(sprite: Image.Image) -> Image.Image:
    alpha = sprite.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > ALPHA_THRESHOLD else 0).getbbox()
    if bbox is None:
        raise ValueError("Empty sprite cell")
    return sprite.crop(bbox)


def place_grounded(sprite: Image.Image, scale: float) -> Image.Image:
    cropped = tight_crop(sprite)
    resized = cropped.resize(
        (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
        Image.Resampling.LANCZOS,
    )
    if resized.width > FRAME_SIZE - 4 or resized.height > FRAME_SIZE - 4:
        raise ValueError(f"Grounded sprite overflows frame: {resized.size}")
    canvas = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    x = (FRAME_SIZE - resized.width) // 2
    y = FRAME_SIZE - 4 - resized.height
    canvas.alpha_composite(resized, (x, y))
    return canvas


def place_centered(sprite: Image.Image, scale: float) -> Image.Image:
    cropped = tight_crop(sprite)
    resized = cropped.resize(
        (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
        Image.Resampling.LANCZOS,
    )
    if resized.width > FRAME_SIZE - 4 or resized.height > FRAME_SIZE - 4:
        raise ValueError(f"Centered sprite overflows frame: {resized.size}")
    canvas = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    x = (FRAME_SIZE - resized.width) // 2
    y = (FRAME_SIZE - resized.height) // 2
    canvas.alpha_composite(resized, (x, y))
    return canvas


def save_strip(frames: list[Image.Image], destination: Path) -> None:
    strip = Image.new("RGBA", (FRAME_SIZE * len(frames), FRAME_SIZE), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        strip.alpha_composite(frame, (index * FRAME_SIZE, 0))
    strip.save(destination, optimize=True)
    print(f"{destination.name}: {len(frames)} frames, {strip.width}x{strip.height}")


def verify_strip(path: Path, expected_frames: int, grounded: bool) -> None:
    with Image.open(path) as strip:
        if strip.mode != "RGBA" or strip.height != FRAME_SIZE or strip.width != FRAME_SIZE * expected_frames:
            raise ValueError(f"Invalid strip: {path.name} {strip.size} {strip.mode}")
        for index in range(expected_frames):
            cell = strip.crop((index * FRAME_SIZE, 0, (index + 1) * FRAME_SIZE, FRAME_SIZE))
            box = cell.getchannel("A").getbbox()
            if not box:
                raise ValueError(f"Empty frame {path.name}:{index}")
            if grounded and box[3] != FRAME_SIZE - 4:
                raise ValueError(f"Ungrounded frame {path.name}:{index} bbox={box}")


def build() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    monster_sheet = Image.open(MONSTER_SOURCE).convert("RGBA")
    width, height = monster_sheet.size
    print(f"Monster source: {monster_sheet.size}")

    cleaned_rows: list[list[Image.Image]] = []
    for row_index in range(ROWS):
        y0 = round(row_index * height / ROWS)
        y1 = round((row_index + 1) * height / ROWS)
        row_band = remove_black_background(
            monster_sheet.crop((0, y0, width, y1)),
            preserve_red_glow=(row_index == 1),
        )
        cells = slice_row_with_seams(row_band, COLS)
        # Flip horizontally so the speaker faces right, matching duck/cat/swan/squirrel.
        cleaned_rows.append([cell.transpose(Image.Transpose.FLIP_LEFT_RIGHT) for cell in cells])

    all_tight = [tight_crop(frame) for row in cleaned_rows for frame in row]
    max_width = max(frame.width for frame in all_tight)
    max_height = max(frame.height for frame in all_tight)
    monster_scale = min(166 / max_width, 148 / max_height)
    print(f"Monster max tight={max_width}x{max_height}, uniform scale={monster_scale:.3f}")

    walk_frames = [place_grounded(frame, monster_scale) for frame in cleaned_rows[0]]
    idle_frames = [walk_frames[0], walk_frames[5]]
    attack_frames = [place_grounded(frame, monster_scale) for frame in cleaned_rows[1]]
    death_frames = [place_grounded(frame, monster_scale) for frame in cleaned_rows[2]]

    save_strip(idle_frames, OUTPUT / "amplifier-idle.png")
    save_strip(walk_frames, OUTPUT / "amplifier-walk.png")
    save_strip(attack_frames, OUTPUT / "amplifier-attack.png")
    save_strip(death_frames, OUTPUT / "amplifier-death.png")

    wave_sheet = Image.open(WAVE_SOURCE).convert("RGBA")
    print(f"Wave source: {wave_sheet.size}")
    wave_rows = slice_grid(wave_sheet)
    # Row 1 (middle row) has full-bodied pulsing red sonic arcs pointing right (+X).
    wave_cleaned = [remove_black_additive_fx(cell) for cell in wave_rows[1]]
    wave_tight = [tight_crop(frame) for frame in wave_cleaned]
    wave_max_w = max(frame.width for frame in wave_tight)
    wave_max_h = max(frame.height for frame in wave_tight)
    wave_scale = min(164 / wave_max_w, 164 / wave_max_h)
    print(f"Wave max tight={wave_max_w}x{wave_max_h}, uniform scale={wave_scale:.3f}")
    wave_frames = [place_centered(frame, wave_scale) for frame in wave_cleaned]
    save_strip(wave_frames, OUTPUT / "amplifier-wave.png")

    verify_strip(OUTPUT / "amplifier-idle.png", 2, grounded=True)
    verify_strip(OUTPUT / "amplifier-walk.png", 6, grounded=True)
    verify_strip(OUTPUT / "amplifier-attack.png", 6, grounded=True)
    verify_strip(OUTPUT / "amplifier-death.png", 6, grounded=True)
    verify_strip(OUTPUT / "amplifier-wave.png", 6, grounded=False)
    print("All amplifier strips verified.")


if __name__ == "__main__":
    build()
