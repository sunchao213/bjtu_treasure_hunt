# 素材来源

| 内容                     | 位置                                                            | 来源                                                    | 说明                                                                                     |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 校园夜景地图底图         | public/assets/maps/campus-night/campus-base.png                 | 用户自制                                                | Phaser 正交俯视静态底图；游戏碰撞与交互坐标单独配置                                      |
| 玩家动作源图与精灵条     | public/assets/characters/player/player-source.png、player-*.png | 用户提供、scripts/prepare_player_sprites.ps1 处理       | 四方向待机／行走／受伤／死亡；攻击动作暂复用受伤姿势，输出为 128×160 固定帧              |
| 地图标记、角色与交互效果 | src/scenes/world-scene.ts                                       | 本次项目代码绘制                                        | 地图标记、角色和动态交互效果由场景绘制                                                   |
| 宝箱精灵表               | public/assets/props/treasure-chest.png                          | 用户提供的宝箱动画图                                    | 6 帧透明精灵条；闭合帧用于地图显示，开启帧用于搜查成功动画                               |
| 字体                     | 用户设备系统字体                                                | Microsoft YaHei／系统字体栈                             | 不分发字体文件                                                                           |
| 怪物原始精灵表           | public/assets/characters/monster-animals-source.png             | 用户提供的 `怪物动物像素动画精灵表.png`                 | 鸭子、松鼠及变异松鼠动画源图；作者、许可和署名信息待用户补充，当前仅限本地开发，不得发布 |
| 怪物处理动画条           | public/assets/characters/processed/*.png                        | scripts/prepare_monster_sprites.py 基于用户提供源图处理 | 统一 176×176 RGBA 帧、底部中心锚点；发布前必须确认源素材再分发授权                       |

尚未选定项目开源许可证。A 应与全组确定许可后再发布正式开源版本；GitHub公开仓库不等于自动获得开源许可。
