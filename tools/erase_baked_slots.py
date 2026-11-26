"""擦掉仓库面板底图里烘焙的 15 个格子（2026-11-26 用户报告滚动鬼影）。

背景：panel-*.png 里美术烘焙了首屏 3 行 × 5 列格子（x 26/176/326/476/626，
y 232/407/582，槽 133×158），DOM 的 .wh-slot 又叠了一层 slot.png（逐像素同位）。
静止时两层重合看不出，一旦滚动 DOM 格子移走，烘焙格框就露出来——
用户截图里「滚动时格子重叠」即此因。

做法（幂等，可重复运行）：
- 只动 15 个槽矩形，格缝/列缝/边框/铆钉全部保持原样；
- 填充源 = 行缝纯环境色带 y 391..403（13 行全宽实测 25..29 均匀噪点、
  无金色无结构；列缝不能用——里面混着槽框外溢的亮边 x159..163 r≈87..98）；
- 每个槽矩形按原 x 位置映射行缝像素（横向零位移、零拼接痕迹），
  纵向 13 行镜像平铺（i%26<13 ? i%26 : 25-(i%26)）避免周期接缝；
- 静止外观零变化：DOM slot.png 不透明，正好盖住填充区；滚动后露出的是
  干净暗底，不再有鬼影格框。

注意：本脚本在 rework_sort_button.py（按钮手术）之后运行；
rework 脚本从 _backup_20261126 重生成底图，重跑后需再跑本脚本。
"""
from PIL import Image
from pathlib import Path

DIR = Path('public/assets/ui/warehouse/v5')
COLS = (26, 176, 326, 476, 626)  # 5 列槽左边界
ROWS = (232, 407, 582)           # 3 行槽上边界
SW, SH = 133, 158                # 槽尺寸
BAND_Y0, BAND_H = 391, 13        # 行缝环境色带（y 391..403，全宽无结构）
RAIL_XS = (159, 309, 459, 609, 759)  # 每条列缝左缘的烘焙框边溢出线（3-4px 铜线）
RAIL_W = 4                       # 溢出线宽（铆钉也长在这条线上，一并擦除）


def erase(im):
    px = im.load()
    # 行缝色带整行快照（x 26..765），擦除前后它都不在槽矩形/溢出线内，恒定
    band = [[px[x, BAND_Y0 + i] for x in range(COLS[0], COLS[0] + 740)]
            for i in range(BAND_H)]

    def put_band(x, y):
        px[x, y] = band[(y - BAND_Y0) % BAND_H][x - COLS[0]]

    for sx in COLS:
        for sy in ROWS:
            # 框顶上溢 3px（y sy-3..sy-1 的金色残边，含网格顶 y229..231）
            for y in range(sy - 3, sy):
                for dx in range(SW):
                    put_band(sx + dx, y)
            for dy in range(SH):
                y = sy + dy
                k = dy % (BAND_H * 2)
                src = band[k if k < BAND_H else BAND_H * 2 - 1 - k]
                for dx in range(SW):
                    px[sx + dx, y] = src[dx]
    # 列缝左缘的框边溢出铜线（x gx..gx+3，全高）：槽矩形外残留的唯一格框痕迹，
    # DOM slot.png 自带完整框边，这层溢出线只会在滚动时变成静止的「鬼影框轨」
    for gx in RAIL_XS:
        for y in range(ROWS[0], ROWS[-1] + SH):
            for x in range(gx, gx + RAIL_W):
                put_band(x, y)


for name in ('panel-all.png', 'panel-props.png', 'panel-collection.png'):
    im = Image.open(DIR / name).convert('RGBA')
    erase(im)
    im.save(DIR / name)
    print('done', name, im.size)
