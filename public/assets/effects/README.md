# 局内道具特效

`healing-bandage.png` 来自用户于 2026-11-25 提供的
`healing_bandage_sprite_4x4_1024_alpha.png`，原图直接复制，未重绘或修改像素。
来源为用户提供的生成图片；授权条款未另行提供。

- PNG RGBA，1024 × 1024，4 列 × 4 行，每帧 256 × 256。
- 按从左到右、从上到下播放；最近邻采样，保留原图半透明边缘。
- 仅在当前玩家成功消耗创可贴后播放；角色头顶跟随显示，1 秒分帧动画加 0.2 秒末尾淡出。
- 满血未消耗、其他恢复物、换局及非游玩阶段不显示此特效。
- 原图边缘仍保留棋盘状颗粒，当前通过小尺寸显示控制观感。

配置见 `src/config/item-effects.ts`，渲染见 `src/campus-3d/bandage-healing-view.ts`。

## 小黄车与超厚羽绒服

原始素材为用户于 2026-11-25 提供的生成图片，原图保存在 `assets-source/item-effects/`：

- `golden_bicycle_boost_sprite_4x4_1024_alpha.png`
- `ice_blue_shield_sprite_4x4_1024_alpha.png`

两张均为 1024 × 1024 RGBA、4×4 帧。运行时图集通过 `scripts/prepare_utility_effects.py`
统一各帧锚点后输出，未重新生成图案。`shield-down-jacket-aura.png` 额外对中心使用透明遮罩，
保留外缘冰蓝护盾，避免羽绒服主体遮挡人物；完整羽绒服只在启动时于头顶显示。

小黄车第 1–4 帧启动、第 5–12 帧循环、第 13–16 帧结束；羽绒服第 1–4 帧启动、
第 5–10 帧循环、第 11–16 帧破碎消散。生效时长沿用道具配置的 5 秒，之后播放短暂结束动画。
护盾耗尽时通过 `ShieldAbsorbed` 事件提前切入破碎，包括伤害被护盾完全吸收的情况。
同一角色可同时显示加速和护盾，非游玩阶段、换局与场景销毁时清理。

重新处理（使用已保存原图）：`python scripts/prepare_utility_effects.py`。

## 轮滑鞋与早八不困咖啡

原始素材为用户于 2026-11-25 提供的 `霓虹紫色滑行特效序列.png` 和
`咖啡治愈魔法精灵图.png`，保存于 `assets-source/item-effects/`。
两张原图实际均为 1254 × 1254 RGBA、4×4 帧，有真实 Alpha 透明通道。
处理脚本按四等分的取整边界逐格切分，最近邻缩放至 208 × 208 后放入 256 × 256 帧中央，
统一输出 1024 × 1024 图集。使用固定锚点保留原动画的上浮运动，每格留 24 像素边距，
仅清除 Alpha ≤ 4 的几乎不可见噪点，原图另行完整保留。

- `boost-roller-skates.png`：第 1–4 帧启动，第 5–12 帧循环，第 13–16 帧消散。
  紫色双轨贴近脚部，随角色移动和朝向翻转；沿用 1.15 倍移速、5 秒时长。
  成功使用更强的小黄车时，轮滑鞋光轨同时进入结束动画。
- `healing-morning-coffee.png`：仅在成功消耗咖啡回血后播放，回血量仍为 25。
  咖啡杯、暖色蒸汽与治疗十字在角色头顶跟随，16 帧共 1.2 秒，随后 0.2 秒淡出。
  满血、暂停或旧局事件不触发；换局、死亡、结束和销毁时不再显示。

重新处理全部四张原图：`python scripts/prepare_utility_effects.py`。

## 简易探测器

素材由用户于 2026-11-26 提供，原图保存在 `assets-source/item-effects/`，运行时文件逐字节复制，未重绘、未更改透明度或像素：

- `simple_detector_activation_4x4.png` → `detector-activation.png`：1024 × 1024 RGBA，4×4 帧，按行播放。成功消耗后在人物头顶播放一次，时长 1.2 秒。
- `simple_detector_loot_direction_marker.png` → `detector-direction.png`：256 × 256 RGBA，源箭头朝上；作为独立纹理旋转，不使用图集裁切。

方向标记沿用 `FormalWorld.activateDetector` 选中的最近未调查箱子和 8 秒计时，随人物位置和当前镜头方向更新。
透视镜头下使用方向向量投影，防止目标在相机背面时箭头反向；区域总览使用当前正交相机。
目标箱被调查、计时到期、死亡或离开对局时隐藏。重复使用被拒绝时不消耗、不重新播放启动动画。
只对当前玩家显示，不新增网络协议、存档字段或玩法数值。

复现素材导入：`python scripts/prepare_detector_effects.py`；从下载目录导入可加 `--source-dir C:/Users/74286/Downloads`。

## 速记卡片

素材由用户于 2026-11-26 提供，原图保存在 `assets-source/item-effects/`，运行时文件逐字节复制，未重绘或修改像素：

- `sujika_card_use_atlas_4x4.png` → `quick-note-use.png`：1024 × 1024 RGBA，4×4 帧，按行播放；成功消耗后在人物头顶播放 1 秒书写动画。
- `sujika_card_ready_icon.png` → `quick-note-ready.png`：256 × 256 RGBA，动画结束后显示在人物头部旁，随人物和当前镜头移动。

待用图标持续到下一次搜索，不增加额外超时；使用加速的搜索期间图标轻微闪动，完成或中断后隐藏。
沿用原有规则：加速在搜索开始时消耗，中断搜索也不返还；充电等非搜索交互不消耗待用加速。
重复使用被拒绝时不消耗物品、不重新播放动画；死亡、换局、结束或销毁后隐藏。
只对当前玩家显示，未修改搜索时长算法、共享接口、网络协议或存档结构。

复现素材导入：`python scripts/prepare_quick_note_effects.py`；从下载目录导入可加 `--source-dir C:/Users/74286/Downloads`。

## 折叠铁尺挥击与命中

用户于 2026-11-26 提供两张 1536×1024 RGBA 原图，均为 4×2、共 8 帧，已有真实透明通道：

- `像素双重斜向斩击动画序列.png` 原样备份为 `assets-source/item-effects/ruler-slash-source.png`。
- `像素火花爆炸动画帧表.png` 原样备份为 `assets-source/item-effects/ruler-sparks-source.png`。
- 运行版 `ruler-slash.png` / `ruler-sparks.png` 为 1024×512，每帧 256×256。按统一坐标裁切、等比缩小，不按单帧内容重新居中；保留原有透明边缘，清理极低透明度光晕。挥击高峰帧多余的第三道下方亮痕沿间隔遮罩移除。

`FormalWorld` 只在折叠铁尺实际获准出手时记录位置和方向，挥击播放 160ms；仅对本次实际扣血且可见的目标记录独立命中点，火星播放 140ms。冷却中的攻击不重复触发，挥空和隔墙不生成火星；目标移动后火星保留在原命中点。暂停、结算、换局和场景销毁时隐藏或清理。

`RulerEffectView` 使用复用的透明精灵与命中精灵池，并按当前镜头投影锁定的出手方向。CHG-43 将双残影改到人物头顶上方：从当前人物脚底沿相机向上方向偏移 1.8，随人物和镜头移动；残影关闭深度测试并在表现层后绘制，避免被人物遮挡。命中火星仍固定在实际受击点，高度 0.75，保留深度测试。两者关闭深度写入；纹理沿用最近邻过滤和资源版本键。只接入正式 Three.js 局内当前玩家的表现，伤害、范围、冷却、存档和网络协议均未调整。

重新生成运行素材：`python scripts/prepare_ruler_effects.py`；首次从下载目录导入可加 `--source-dir C:/Users/74286/Downloads`。
