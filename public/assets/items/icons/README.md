# 道具像素图标

这组 128×128 RGBA PNG 用于仓库、道具详情、物品图鉴及图鉴 PNG 导出，代码通过 `warehouseItemIconAssetPath(itemId)` 共用资源路径。显示时使用最近邻像素缩放。

本轮已导入用户提供的 12 件道具图标，连同此前的 4 件参考图与现有素材共同用于运行时：直接转换用户提供的像素图，移除原图中烘焙的深灰棋盘格，裁去多余留白并统一尺寸；保留像素造型、深棕描边和分层色阶。原图备份在 `art/item-icons/references/`，完整总览在 `item-icons-overview.png`。

目标风格：16 位 RPG，精细像素簇、暖深棕描边、有限色板与分层色阶、象牙白高光、灰蓝或靛紫阴影。避免平面几何占位图、平滑渐变、模糊、霓虹光晕和统一金色外框。

文件名直接使用 `ITEM_DEFINITIONS` 中的 item ID：

| 文件                             | 道具             |
| -------------------------------- | ---------------- |
| `scratch-paper.png`              | 草稿纸           |
| `half-eraser.png`                | 半块橡皮         |
| `window-seat.png`                | 靠窗座凭证       |
| `school-badge.png`               | 校训徽章         |
| `gpa-charm.png`                  | GPA 4.0 护符     |
| `library-reward-ticket.png`      | 图书馆占座券     |
| `siyuan-key.png`                 | 思源楼金钥匙     |
| `portable-medkit.png`            | 随身急救包       |
| `morning-coffee.png`             | 早八不困咖啡     |
| `torn-notebook.png`              | 残缺手记         |
| `anomalous-feather.png`          | 异常羽毛         |
| `training-bat.png`               | 训练棍           |
| `stun-baton.png`                 | 电击器           |
| `bandage.png`                    | 创可贴           |
| `yellow-bike.png`                | 小黄车           |
| `thick-down-jacket.png`          | 超厚羽绒服       |
| `strange-veined-ginkgo-leaf.png` | 叶脉奇怪的银杏叶 |
| `hunter-binoculars.png`          | 猎手望远镜       |
| `roller-skates.png`              | 轮滑鞋           |

`item-icons-overview.png` 是人工检查用的总览图，不参与运行时加载。

校园地图线索没有进入当前宝箱池，也没有功能逻辑，已从道具配置、图鉴、背景文案和图标中移除；已有存档中的同名道具会在读取时清理，其余物品、货币和章节保留。独立的校园导航地图功能不受影响。

随身急救包保留：`HEALING_AMOUNTS['portable-medkit'] = 30`，背包“使用”按钮通过 `consumeHealing()` 调用 `RaidController.heal()`，成功恢复后消耗，满血时保留物品。当前随机宝箱池不产出它，已有仓库物品仍可带入使用。

转换参考图：`python scripts/prepare_item_references.py --source-dir <用户原图目录>`。仅重建总览：`python scripts/prepare_item_references.py`。生成逐图提示词：添加 `--write-prompts`。

原 `scripts/generate_item_icons.py` 已改为素材处理兼容入口，不会再重绘或覆盖道具图。
