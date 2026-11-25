"""「一键整理」按钮整体下移 12px（2026-11-26 用户要求，v4 最终版）。

背景：v5 当年把美术切图 button-sort-all.png（260×77，**自带不透明背景**）
整块贴在面板 (272,799)。框顶弧线距第二行提示文字只有 8px（文字尾部 803），
屏幕缩放后视觉上贴死（用户：「提示词被按钮挡住了」）。

做法（从 _backup_20261126 原版图重新生成，幂等）：
- 切图矩形整体下移 12px：(272,799) → (272,811)，框顶带 807..809 → 819..821，
  文字（真实底部 803）与按钮间距 8 → 16px；
- 只贴切图 0..69 行（框体底缘为止）：底部 70..76 行是切图自带的框下背景，
  不贴，避免矩形下缘盖住底框横线（882..884）；
- 让出的 12px 条带（799..810）用切图自带的同款深色背景（切图 0..7 行，
  原本就在 799..806）平铺回填——与按钮上方阴影无缝衔接；
- 框底缘 878..880，紧贴横线上方 2px，「坐在横线上」的观感不变。
- 横线、提示文字完全不动。
  （注：文字中段底部 5 行笔画在 v5 贴图时已被切图覆盖，属历史成因，
  各方向均无同渲染源头可无痕修复，维持现状。）
DOM 热区 .wh-sort 同步 top 819/890（见 warehouse-panel.css）。
"""
from PIL import Image
from pathlib import Path

DIR = Path('public/assets/ui/warehouse/v5')
BACKUP = DIR / '_backup_20261126'
ART = (272, 799, 532, 876)    # 切图粘贴矩形（260×77），左开右开
ART_DY = 12                   # 整体下移
ART_CROP_H = 70               # 只贴切图 0..69 行（框体底缘为止）
STRIP = (272, 799, 532, 807)  # 深色背景条带（切图 0..7 行，纯背景无内容）

for name in ('panel-all.png', 'panel-props.png', 'panel-collection.png'):
    im = Image.open(BACKUP / name).convert('RGBA')
    art = im.crop(ART)
    # 1. 原矩形位置用切图自带深色背景平铺回填（799..814，811 起被新位覆盖）
    dark = im.crop(STRIP)
    im.paste(dark, (STRIP[0], STRIP[1]))
    im.paste(dark, (STRIP[0], STRIP[1] + (STRIP[3] - STRIP[1])))
    # 2. 切图下移贴回（只到框体底缘，防压横线）
    im.paste(art.crop((0, 0, ART[2] - ART[0], ART_CROP_H)), (ART[0], ART[1] + ART_DY))
    im.save(DIR / name)
    print('done', name, im.size)
