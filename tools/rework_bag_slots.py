"""把道具背包 6 个空格统一成「第二行第一格」的样式（2026-11-26）。

背景：背包空格框烘焙在 v4/bg.png 里。左列第一行三格是旧样式（圆角框 +
底部名称条分隔线），第二行第一格是定稿新样式（方框 + 中央淡「+」）。
用户要求 6 格全部用新样式。

做法（幂等）：每次都从 _backup_20261126/bg.png 原图出发，
把第二行第一格的整块切图 (229,528)-(397,710)（含边框、内底、加号）贴到其余 5 格，
再擦掉第一行三格旧底框残留的 2 行像素（旧框比新框高 3px）。

DOM（bag-panel.css）不用动：格子热区/图标/名称按原坐标叠加，新框内底
足够容纳原有布局。加号是样式的一部分，物品图标会盖住它的大半。
"""

from pathlib import Path
import shutil

from PIL import Image

V4 = Path('public/assets/ui/warehouse/v4')
BACKUP = V4 / '_backup_20261126' / 'bg.png'
TARGET = V4 / 'bg.png'

# 源切图：第二行第一格整块（含 1px 墙面余量）
SRC = (229, 528, 397, 710)  # x0, y0, x1, y1（不含 x1/y1）
# 目标左上角：列偏移 ×183（3 列 165px + 18px 列距）；
# 行 1 的框顶(319) 对齐源框顶(530)，即 y 偏移 -211；行 2 与源同行。
DESTS = [
    (229, 317),   # 行1列1
    (412, 317),   # 行1列2
    (595, 317),   # 行1列3
    (412, 528),   # 行2列2
    (595, 528),   # 行2列3
]
# 行1旧框(319..501)比新框(180 行)高，贴完后残留 500..501 两行旧底框边，擦掉
R1_REMNANT_ROWS = (500, 502)  # [y0, y1)，相对贴图区域列范围


def main() -> None:
    if not BACKUP.exists():
        BACKUP.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(TARGET, BACKUP)
        print(f'backup created: {BACKUP}')
    bg = Image.open(BACKUP).convert('RGB')
    tile = bg.crop(SRC)
    w, h = tile.size
    for dx, dy in DESTS:
        bg.paste(tile, (dx, dy))
    # 行1三格：擦残留的旧底框 2 行，用贴图区正下方第 4 行的墙面色回填
    for dx, dy in DESTS[:3]:
        for y in range(*R1_REMNANT_ROWS):
            for x in range(dx, dx + w):
                bg.putpixel((x, y), bg.getpixel((x, y + 4)))
    bg.save(TARGET)
    print(f'rebuilt {TARGET} (6 slots unified to row2col1 style)')


if __name__ == '__main__':
    main()
