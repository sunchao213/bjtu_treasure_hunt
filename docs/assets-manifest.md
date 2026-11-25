# 素材来源

2026-11-25：明湖石碑改为根据用户实拍照片重建的封闭三维 GLB，保留照片题字、落款及粗糙石面，增加真实厚度、侧背面和底部托石。Blender 源文件、照片、纹理及重建流程见 [明湖石碑模型记录](../assets-source/campus-3d/minghu-stele/README.md)。正式场景停止加载原平面图片，调查剧情保持原有规则。

2026-11-22：三维校园乔木新增用户提供的繁茂像素树图片，保留透明背景、清理外围碎点并固定树根锚点，输出为 `public/assets/environment/campus-trees/tree.png`。原图、处理方式和面片显示范围见 [像素乔木素材记录](../assets-source/campus-3d/trees/README.md)。

2026-11-22：三维道路新增用户提供的深蓝灰像素沥青图片，经过无缝修整、缩采样和对比度调整，输出为 `public/assets/environment/campus-asphalt/asphalt-albedo.png`。原图、处理方式和覆盖范围见 [沥青素材记录](../assets-source/campus-3d/asphalt/README.md)。

2026-11-22：三维校园草地新增用户提供的像素草地图片，经过无缝修整、缩采样及色彩调整，输出为 `public/assets/environment/campus-grass/grass-albedo.png`。原图、处理方式和运行时范围见 [草地素材记录](../assets-source/campus-3d/grass/README.md)。

天佑会堂、明湖、图书馆、五星红旗与篮球场的本轮用户参考、几何制作方式及 GLB 信息见 [地标精修记录](campus-3d-landmarks.md)。未新增第三方模型或运行时图片。

用户选定的南部校园区域参考图与低模制作来源见 [连续区块制作说明](campus-3d-district.md)。Blender 源文件位于 `assets-source/campus-3d/district/`，运行时模型位于 `public/assets/models/bjtu-district/`；几何由本项目重建，沿用用户已确认的官网资源授权。

独立 Three.js 试验网页的程序生成校园模型、纹理及复用素材规格见
[三维试验区素材清单](campus-3d.md#素材清单)。本次未新增第三方模型；现有图片与音效的来源和授权状态继续沿用项目记录。

三维南门已升级为 Blender 参考重建样板：网站资源授权、参考图、程序贴图与 GLB 源文件见
[南门模型来源与制作记录](campus-3d-south-gate.md)。官网展示提供的是地图／全景 JPG；交付模型是本项目重建，不是官网原网格。

思源楼参考重建的 `.blend`、GLB、官网地图／正门照片及布局描绘对照位于 `assets-source/campus-3d/siyuan/` 和 `public/assets/models/bjtu-siyuan/`。来源、估算范围与坐标基准见 [思源楼制作记录](campus-3d-siyuan.md)。模型使用纯色材质，不新增外部运行时贴图；用户已在本会话授权官网资源复用。

| 内容                     | 位置                                                            | 来源                                                    | 说明                                                                                     |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 校园夜景地图底图         | public/assets/maps/campus-night/campus-base.png                 | 用户自制                                                | Phaser 正交俯视静态底图；游戏碰撞与交互坐标单独配置                                      |
| 玩家动作源图与精灵条     | public/assets/characters/player/player-source.png、player-*.png | 用户提供、scripts/prepare_player_sprites.ps1 处理       | 四方向待机／行走／受伤／死亡；攻击动作暂复用受伤姿势，输出为 128×160 固定帧              |
| 地图标记、角色与交互效果 | src/scenes/world-scene.ts                                       | 本次项目代码绘制                                        | 地图标记、角色和动态交互效果由场景绘制                                                   |
| 宝箱精灵表               | public/assets/props/treasure-chest.png                          | 用户提供的宝箱动画图                                    | 6 帧透明精灵条；闭合帧用于地图显示，开启帧用于搜查成功动画                               |
| 字体                     | 用户设备系统字体                                                | Microsoft YaHei／系统字体栈                             | 不分发字体文件                                                                           |
| 道具像素图标             | public/assets/items/icons/*.png                                 | 用户提供的 16 张像素图已转换                            | 128×128 RGBA；仓库、详情与图鉴共用；转换方法见该目录 README                              |
| 怪物原始精灵表           | public/assets/characters/monster-animals-source.png             | 用户提供的 `怪物动物像素动画精灵表.png`                 | 鸭子、松鼠及变异松鼠动画源图；作者、许可和署名信息待用户补充，当前仅限本地开发，不得发布 |
| 怪物处理动画条           | public/assets/characters/processed/*.png                        | scripts/prepare_monster_sprites.py 基于用户提供源图处理 | 统一 176×176 RGBA 帧、底部中心锚点；发布前必须确认源素材再分发授权                       |

尚未选定项目开源许可证。A 应与全组确定许可后再发布正式开源版本；GitHub公开仓库不等于自动获得开源许可。

## 局内背包界面（2026-11-20）

- `public/assets/ui/backpack.png`：用户提供的「棕色像素风背包图标.png」，裁去透明外边距，保留原始 RGBA 像素；输出 982×904。
- `public/assets/ui/inventory-panel.png`：用户提供的「像素风背包道具栏.png」，裁去透明外边距，保留原始 RGBA 像素；输出 880×1355。局内仅底图以 75% 不透明度显示，物品与文字单独渲染。
- 格子内物品插画复用现有图鉴 SVG，并为小黄车、羽绒服补充同规格简图；不依赖新增在线素材服务。
