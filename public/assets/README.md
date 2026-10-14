# 素材说明

当前校园、人物和物资全部由 Phaser 图形 API 绘制，没有下载或引用商业游戏素材。
后续 D 添加地图／图像／音效时，在 `docs/assets-manifest.md` 记录来源、作者、许可和署名。

`characters/monster-animals-source.png` 及其 `processed/` 动画条来自用户提供的 `怪物动物像素动画精灵表.png`，用于鸭子普通怪、平静抱抱怪和变异抱抱怪的游戏内动画。作者、许可和署名信息未随素材提供，当前仅限本地开发；发布或部署前必须补齐来源与再分发授权。

运行 `python scripts/prepare_monster_sprites.py` 可重新生成并校验处理后的动画条。脚本输出使用 128×128 RGBA 帧和统一底部中心锚点，文件名遵循小写英文 kebab-case。
