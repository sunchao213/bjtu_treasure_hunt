"""Import supplied pixel sprites without redrawing their artwork.

The supplied RGB PNGs contain a baked-in dark checkerboard. Only neutral,
dark backdrop pixels are removed; the warm outlines and feather are retained.
Original files are archived so the conversion can be reproduced.
"""

import argparse
import json
from pathlib import Path
import shutil

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/items/icons'
SOURCES = ROOT / 'art/item-icons/references'
REFERENCES = {
    'scratch-paper': 'ec8cf3b8c88c2f86125444fdafcb08e3.png',
    'half-eraser': '7fcadad8b3f64b66708d9b5584a71eec.png',
    'anomalous-feather': '8e52fe78d92cfaed1bd929706a8a797c.png',
    'siyuan-key': 'aa9bec8d79a7c20fcaf553321466749f.png',
    'morning-coffee': '297b833fca9b721d884751da3e84550e.png',
    'torn-notebook': 'f604ea4170a812df426c239e852f0412.png',
    'gpa-charm': 'e2c561ddb13a6b9bf52288ad7e3ee8e8.png',
    'library-reward-ticket': 'c7f153a92dfe5eda35a2220954e00adb.png',
    'training-bat': '690ecd7abcc1de840684077e9546357c.png',
    'stun-baton': '5b7049af896337482eee97cd76b20d7c.png',
    'bandage': 'a3f47b30b6e578324d580bb95cd818e6.png',
    'yellow-bike': '264811fc2ec546c76c354852d3199a5f.png',
    'strange-veined-ginkgo-leaf': '336d076f18c65f005736bdd3b981ee27.png',
    'thick-down-jacket': 'b76e8ac2e449c68b60c15479843e2e21.png',
    'hunter-binoculars': '00276a73a945b5684d0a785481d4d8d2.png',
    'roller-skates': 'acc3e7448c6b6ec22885e2c7c1a779a4.png',
}


def import_references(source_dir):
    SOURCES.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for item_id, filename in REFERENCES.items():
        original = source_dir / filename
        archived = SOURCES / f'{item_id}.png'
        if original.resolve() != archived.resolve():
            shutil.copy2(original, archived)
        image = Image.open(archived).convert('RGBA')
        image.putdata([
            (0, 0, 0, 0) if max(r, g, b) <= 50 and max(r, g, b) - min(r, g, b) <= 5
            else (r, g, b, a)
            for r, g, b, a in image.getdata()
        ])
        bounds = image.getbbox()
        if bounds is None:
            raise ValueError(f'Empty sprite: {item_id}')
        sprite = image.crop(bounds)
        scale = 108 / max(sprite.size)
        sprite = sprite.resize(
            tuple(max(1, round(n * scale)) for n in sprite.size),
            Image.Resampling.NEAREST,
        )
        icon = Image.new('RGBA', (128, 128))
        icon.alpha_composite(sprite, ((128 - sprite.width) // 2, (128 - sprite.height) // 2))
        icon.save(OUT / f'{item_id}.png')
        print(f'Imported {item_id}: {bounds} -> {sprite.size}, transparent 128x128 PNG')


def overview():
    icons = sorted(p for p in OUT.glob('*.png') if p.name != 'item-icons-overview.png')
    sheet = Image.new('RGB', (5 * 192, ((len(icons) + 4) // 5) * 176), '#222924')
    draw = ImageDraw.Draw(sheet)
    for i, path in enumerate(icons):
        image = Image.open(path).convert('RGBA')
        x, y = (i % 5) * 192, (i // 5) * 176
        sheet.paste(image, (x + 32, y + 8), image)
        draw.text((x + 8, y + 144), path.stem, fill='#e3dcc4')
    sheet.save(OUT / 'item-icons-overview.png')
    preview = Image.new('RGB', (5 * 192, ((len(REFERENCES) + 4) // 5) * 176), '#222924')
    draw = ImageDraw.Draw(preview)
    for i, item_id in enumerate(REFERENCES):
        icon = Image.open(OUT / f'{item_id}.png').convert('RGBA')
        x, y = (i % 5) * 192, (i // 5) * 176
        preview.paste(icon, (x + 32, y + 8), icon)
        draw.text((x + 8, y + 144), item_id, fill='#e3dcc4')
    preview.save(ROOT / 'art/item-icons/reference-preview.png')


def write_prompts():
    """Prepare prompt files only. API calls use the unmodified skill CLI."""
    spec = json.loads((ROOT / 'art/item-icons/generation-spec.json').read_text(encoding='utf-8'))
    destination = ROOT / 'art/item-icons/prompts'
    destination.mkdir(parents=True, exist_ok=True)
    for item_id, subject in spec['items'].items():
        (destination / f'{item_id}.txt').write_text(
            spec['commonPrompt'] + subject + '\n', encoding='utf-8'
        )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path)
    parser.add_argument('--write-prompts', action='store_true')
    args = parser.parse_args()
    if args.source_dir:
        import_references(args.source_dir)
    if args.write_prompts:
        write_prompts()
    overview()
