# 道具像素图标

这组 128×128 RGBA PNG 用于仓库、道具详情、物品图鉴及图鉴 PNG 导出，代码通过 `warehouseItemIconAssetPath(itemId)` 共用资源路径。显示时使用最近邻像素缩放。

本轮已导入用户提供的 9 件道具图标，连同现有素材共同用于运行时：直接转换用户提供的像素图，移除原图中烘焙的深灰棋盘格，裁去多余留白并统一尺寸；保留像素造型、深棕描边和分层色阶。完整总览在 `item-icons-overview.png`。

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
| `folding-ruler.png`              | 折叠铁尺         |
| `long-broom.png`                 | 长柄扫帚         |
| `window-breaker.png`             | 破窗锤           |
| `night-watch-spear.png`          | 夜巡长枪         |
| `bandage.png`                    | 创可贴           |
| `yellow-bike.png`                | 小黄车           |
| `thick-down-jacket.png`          | 超厚羽绒服       |
| `strange-veined-ginkgo-leaf.png` | 叶脉奇怪的银杏叶 |
| `hunter-binoculars.png`          | 猎手望远镜       |
| `roller-skates.png`              | 轮滑鞋           |
| `quick-note-card.png`            | 速记卡片         |
| `simple-detector.png`            | 简易探测器       |
| `star-compass.png`               | 星光罗盘         |
| `silent-cloak.png`               | 静音斗篷         |
| `reflective-filter.png`          | 反光滤片         |
| `marked-campus-map.png`          | 被涂改的校园地图 |
| `soothe-charm.png`               | 安抚护符         |
| `complete-record.png`            | 完整记录         |
| `electric-bike-helmet.png`       | 电瓶车头盔       |
| `david-head-statue.png`          | 大卫头雕像       |
| `silver-watch.png`               | 银色手表         |

`item-icons-overview.png` 是人工检查用的总览图，不参与运行时加载。

章节证据 `marked-campus-map.png`（被涂改的校园地图）、`soothe-charm.png`（安抚护符）和 `complete-record.png`（完整记录）同样通过 `warehouseItemIconAssetPath()` 加载。第二章使用独立的 `marked-campus-map` 物品 ID，与下述退役收藏物 `campus-map` 区分，读取旧存档时不会清理当前章节证据。

校园地图线索没有进入当前宝箱池，也没有功能逻辑，已从道具配置、图鉴、背景文案和图标中移除；已有存档中的同名道具会在读取时清理，其余物品、货币和章节保留。独立的校园导航地图功能不受影响。

随身急救包保留：`HEALING_AMOUNTS['portable-medkit'] = 30`，背包“使用”按钮通过 `consumeHealing()` 调用 `RaidController.heal()`，成功恢复后消耗，满血时保留物品。当前随机宝箱池不产出它，已有仓库物品仍可带入使用。

转换参考图：`python scripts/prepare_item_references.py --source-dir <用户原图目录>`。仅重建总览：`python scripts/prepare_item_references.py`。生成逐图提示词：添加 `--write-prompts`。

原 `scripts/generate_item_icons.py` 已改为素材处理兼容入口，不会再重绘或覆盖道具图。
