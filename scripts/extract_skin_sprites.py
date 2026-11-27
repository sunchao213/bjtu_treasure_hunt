"""Extract the six supplied wardrobe sheets. Input order matches the in-game catalogue."""

from argparse import ArgumentParser
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/assets/characters/skins"
NAMES = (
    ("red-trailblazer", "赤焰探险少女"),
    ("lavender-mage", "星灯魔法师"),
    ("navy-adventurer", "金纹探险家"),
    ("silver-researcher", "银发研究员"),
    ("lab-scientist", "白袍研究员"),
    ("orange-rescuer", "橙焰救援员"),
)
STATES = ("idle", "walk", "attack", "hurt", "death")
# Sprites are laid out in the game's clockwise order starting at the front.
COUNTERCLOCKWISE = (0, 7, 6, 5, 4, 3, 2, 1)


def crop(sheet, box):
    rgb = sheet.crop(box).convert("RGB")
    rgb_bytes = list(rgb.getdata())
    width, height = rgb.size
    # Flood fill from the outside to preserve light fabric, skin and lamp highlights.
    background = Image.new("L", (width + 2, height + 2))
    background.paste(
        Image.frombytes("L", rgb.size, bytes(0 if min(pixel) >= 221 else 255 for pixel in rgb_bytes)),
        (1, 1),
    )
    ImageDraw.floodfill(background, (0, 0), 128)
    alpha = background.crop((1, 1, width + 1, height + 1))
    alpha = alpha.point(lambda value: 0 if value == 128 else 255)
    # Tight source cells can contain fragments of a neighboring sprite or caption.
    # The connected outline of the main character includes its enclosed highlights.
    largest = (0, 0)
    label = 1
    for index in range(width * height):
        x, y = index % width, index // width
        if alpha.getpixel((x, y)) != 255:
            continue
        color = label
        if color == 255:
            raise ValueError(f"Too many disconnected pixels at {box}")
        ImageDraw.floodfill(alpha, (x, y), color)
        label += 1
    for color, size in enumerate(alpha.histogram()[1:255], 1):
        if size > largest[1]:
            largest = (color, size)
    alpha = alpha.point(lambda value: 255 if value == largest[0] and largest[1] else 0)
    rgb.putalpha(alpha)
    bounds = rgb.getbbox()
    if bounds is None:
        raise ValueError(f"Empty sprite at {box}")
    return rgb.crop(bounds)


def row(sheet, top, bottom, *edges):
    return [crop(sheet, (left, top, right, bottom)) for left, right in zip(edges, edges[1:])]


def orient(frames, order=COUNTERCLOCKWISE):
    return [frames[index] for index in order]


def standing(views):
    return [[view] for view in views]


def across_directions(frames, native_right=True):
    opposite = [ImageOps.mirror(frame) for frame in frames]
    left, right = (opposite, frames) if native_right else (frames, opposite)
    return [frames, right, right, right, frames, left, left, left]


def directional_walk(views, front, right, left):
    right_step = [right[0], right[len(right) // 2], right[-1]]
    left_step = [left[0], left[len(left) // 2], left[-1]]
    return [
        front,
        [views[1], *right_step], right, [views[3], *right_step],
        [views[4]],
        [views[5], *left_step], left, [views[7], *left_step],
    ]


def red_trailblazer(sheet):
    views = orient(row(sheet, 61, 189, 248, 332, 422, 512, 599, 686, 773, 860, 947))
    walking = orient(row(sheet, 274, 403, 248, 332, 422, 512, 599, 686, 773, 860, 947))
    run = orient(row(sheet, 485, 628, 12, 126, 250, 373, 501, 620, 752, 884, 1014))
    lunge = orient(row(sheet, 709, 853, 13, 136, 258, 376, 495, 613, 743, 876, 1012))
    hurt = orient(row(sheet, 931, 1078, 12, 129, 253, 377, 501, 623, 753, 885, 1014))
    fallen = orient(row(sheet, 1156, 1261, 14, 125, 255, 376, 501, 612, 745, 878, 1012))
    idle = row(sheet, 1339, 1489, 18, 127, 238)
    return views, {
        "idle": [[views[0], *idle], *standing(views)[1:]],
        "walk": [[stand, stride, sprint, stride] for stand, stride, sprint in zip(views, walking, run)],
        "attack": [[stand, rush, recoil, stand] for stand, rush, recoil in zip(views, lunge, hurt)],
        "hurt": [[hit, stand] for hit, stand in zip(hurt, views)],
        "death": [[hit, down] for hit, down in zip(hurt, fallen)],
    }


def lavender_mage(sheet):
    views = orient(row(sheet, 90, 290, 9, 150, 270, 389, 508, 635, 758, 875, 1015))
    idle = row(sheet, 351, 585, 98, 300, 511, 719, 926)
    walk = row(sheet, 610, 831, 88, 289, 502, 719, 942)
    casting = row(sheet, 839, 1068, 96, 313, 530, 740, 940)
    hurt = row(sheet, 1081, 1292, 101, 300, 497, 724, 966)
    death = row(sheet, 1371, 1506, 61, 288, 503, 727, 974)
    left = walk[1:]
    right = [ImageOps.mirror(frame) for frame in left]
    return views, {
        "idle": [[views[0], *idle[:3]], *standing(views)[1:]],
        "walk": directional_walk(views, walk[:1], right, left),
        "attack": across_directions(casting),
        "hurt": across_directions(hurt[:2]),
        "death": across_directions(death),
    }


def navy_adventurer(sheet):
    views = row(sheet, 73, 275, 6, 136, 260, 384, 508, 639, 764, 890, 1018)
    idle = row(sheet, 390, 572, 6, 127, 244, 362, 483)
    right = row(sheet, 391, 566, 485, 584, 674, 759, 846, 935, 1023)
    left = [ImageOps.mirror(frame) for frame in right]
    attack = row(sheet, 670, 847, 516, 638, 769, 901, 1015)
    hurt = row(sheet, 944, 1117, 15, 125, 231, 361, 505)
    death = row(sheet, 1005, 1116, 508, 662, 770, 874, 1021)
    return views, {
        "idle": [[views[0], *idle], *standing(views)[1:]],
        "walk": directional_walk(views, [views[0]], right, left),
        "attack": across_directions(attack),
        "hurt": across_directions(hurt[:3]),
        "death": across_directions(death),
    }


def silver_researcher(sheet):
    views = row(sheet, 35, 247, 14, 156, 286, 402, 511, 636, 754, 870, 1013)
    front = row(sheet, 302, 507, 75, 270, 508, 748, 950)
    right = row(sheet, 550, 752, 63, 267, 499, 743, 932)
    left = row(sheet, 798, 999, 77, 270, 509, 750, 947)
    attack = row(sheet, 1043, 1247, 36, 228, 484, 741, 951)
    end = row(sheet, 1290, 1477, 14, 165, 313, 462, 663, 855, 1014)
    return views, {
        "idle": standing(views),
        "walk": directional_walk(views, front, right, left),
        "attack": across_directions(attack),
        "hurt": across_directions(end[:3]),
        "death": across_directions(end[3:5]),
    }


def lab_scientist(sheet):
    views = orient(row(sheet, 56, 282, 10, 139, 265, 387, 514, 639, 763, 880, 1012))
    right = row(sheet, 346, 575, 11, 147, 276, 404, 529, 649, 770, 890, 1013)
    left = [ImageOps.mirror(frame) for frame in right]
    attack = row(sheet, 914, 1144, 66, 225, 404, 588, 779, 942)
    end = row(sheet, 1191, 1432, 10, 161, 313, 450, 623, 823, 1020)
    return views, {
        "idle": standing(views),
        "walk": directional_walk(views, [right[-1]], right[:-1], left[:-1]),
        "attack": across_directions(attack),
        "hurt": across_directions(end[:3]),
        "death": across_directions(end[3:]),
    }


def orange_rescuer(sheet):
    views = row(sheet, 12, 220, 4, 136, 258, 386, 513, 641, 769, 890, 1020)
    front = row(sheet, 240, 442, 92, 240, 397, 558, 721, 877)
    right = row(sheet, 452, 652, 89, 241, 405, 568, 736, 890)
    left = row(sheet, 661, 861, 92, 242, 407, 572, 739, 897)
    back = row(sheet, 873, 1093, 82, 239, 405, 572, 737, 897)
    attack = row(sheet, 1104, 1309, 338, 499, 659, 839, 1006)
    hurt = row(sheet, 1311, 1509, 15, 173, 333, 478)
    fallen = row(sheet, 1365, 1509, 478, 668, 829, 1012)
    walk = directional_walk(views, front, right, left)
    walk[4] = back
    return views, {
        "idle": standing(views),
        "walk": walk,
        "attack": across_directions(attack),
        "hurt": across_directions(hurt),
        "death": across_directions(fallen),
    }


def fitted(sprite, frame_size, standing_height, anchor=0):
    width, height = frame_size
    alpha = Image.new("RGBA", frame_size)
    new_width = max(1, round(sprite.width * standing_height))
    new_height = max(1, round(sprite.height * standing_height))
    if new_width > width - 4 or new_height > height - 4:
        ratio = min((width - 4) / new_width, (height - 4) / new_height)
        new_width, new_height = round(new_width * ratio), round(new_height * ratio)
    sprite = sprite.resize((new_width, new_height), Image.Resampling.NEAREST)
    alpha.alpha_composite(sprite, ((width - new_width) // 2, height - new_height - 4 - anchor))
    return alpha


def export_sprite(skin_id, views, actions, preview_sprite=None):
    front = preview_sprite or views[0]
    portrait = fitted(front, (128, 160), 150 / front.height)
    portrait.save(OUTPUT / f"{skin_id}-preview.png", optimize=True)
    for state in STATES:
        width, height, count = (314, 167, 4) if state == "attack" else (128, 160, 5)
        spritesheet = Image.new("RGBA", (count * width, 8 * height))
        for direction, frames in enumerate(actions[state]):
            # These source rows have different sprite sizes. Match their usual standing height,
            # or use an upright pose in the same row to preserve the shorter fallen animation.
            scale = 148 / (views[direction].height if state == "death" else max(frame.height for frame in frames))
            if state == "death" and skin_id in ("lavender-mage", "silver-researcher"):
                scale = 0.74
            if state == "death" and skin_id == "navy-adventurer":
                scale = 0.8
            for index in range(count):
                step = round(index * (len(frames) - 1) / (count - 1))
                bob = (0, 2, 4, 2, 0)[index] if state == "walk" and len(frames) == 1 else 0
                frame = fitted(frames[step], (width, height), scale, bob)
                spritesheet.alpha_composite(frame, (index * width, direction * height))
        spritesheet.save(OUTPUT / f"{skin_id}-{state}.png", optimize=True)
    return portrait


def preview(path, portraits):
    canvas = Image.new("RGB", (1060, 625), "#171e26")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 20)
    draw.text((24, 15), "交大摸金录 · 新时装", font=font, fill="#eee2cf")
    for index, ((_, name), portrait) in enumerate(zip(NAMES, portraits)):
        row_index, column = divmod(index, 3)
        x = 20 + 346 * column
        y = 60 + 277 * row_index
        draw.rounded_rectangle((x, y, x + 327, y + 260), 12, fill="#253137", outline="#495450")
        enlarged = portrait.resize((164, 205), Image.Resampling.NEAREST)
        canvas.paste(enlarged, (x + 82, y + 8), enlarged)
        draw.text((x + 16, y + 225), name, font=font, fill="#eee2cf")
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("sheets", type=Path, nargs=len(NAMES))
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    portraits = []
    extractors = (red_trailblazer, lavender_mage, navy_adventurer, silver_researcher,
                  lab_scientist, orange_rescuer)
    for index, ((skin_id, _), extract, path) in enumerate(zip(NAMES, extractors, args.sheets)):
        with Image.open(path) as sheet:
            if sheet.size != (1024, 1536):
                raise ValueError(f"{path}: expected 1024 × 1536 source image")
            views, actions = extract(sheet)
            source_portrait = crop(sheet, (0, 10, 247, 437)) if index == 0 else views[0]
            portraits.append(export_sprite(skin_id, views, actions, source_portrait))
    preview(ROOT / "artifacts/skin-preview.png", portraits)


if __name__ == "__main__":
    main()
