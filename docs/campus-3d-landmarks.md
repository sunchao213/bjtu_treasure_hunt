# 天佑会堂、明湖、图书馆与球场精修

页面：<http://localhost:5173/campus-3d.html?area=district>。本轮沿用独立三维页面、人物环绕镜头、现有角色操作及独立存档。

## 参考与实现

用户本轮提供八张图片，原图保留在 `assets-source/campus-3d/district/reference/`，来源及范围记录在同目录 `sources.json` 的 `landmarkRefinement` 字段。网站与现场照片属于用户已授权的参考；GLB 几何由本项目在 Blender 重建，不是从官网提取的原始模型。材质均为程序纯色，不增加外部贴图或联网依赖。

| 修改           | 参考文件                                    | 实现                                                                                                                                                                                                 |
| -------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 球场与道路重叠 | `basketball-overlap.png`                    | 两场宽度从 135 缩至 120 个参考地面单位，并向西退让；球场外沿与草坪西路、路沿保持间隔。补充罚球区、弧线、三分线、篮板及真实高度的篮圈。                                                               |
| 天佑会堂       | `tianyou-before.png`、`tianyou-front.png`   | 替换普通窗格盒体；灰色墙砖体块、蓝色通高入口玻璃、六组玻璃门、竖向银灰柱、宽深挑檐、上层玻璃带、竖向叶片、顶部遮阳格栅与栏杆，以及入口台阶。                                                         |
| 五星红旗       | `flag-before.png`                           | 红色旗面比例 3:2；以 30×20 网格布置大星中心 `(5,5)`、半径 3，小星中心 `(10,2)`、`(12,4)`、`(12,7)`、`(10,9)`、半径 1。四颗小星各有一尖朝向大星中心。旗面轻微起伏，两侧均有金星几何。                 |
| 明湖           | `ming-lake-before.png`、`ming-lake-map.png` | 用 60 点圆润岸线替换尖角多边形；深蓝湖面、石质挡墙、浅色环湖步道、弧形浅水边、两处下水台阶和少量水纹。亭子移至西岸附近，改为六角石台、红柱、绿边金黄重檐、栏杆及近岸连接。岸边增加简化垂柳和阔叶树。 |
| 图书馆         | `library-map.png`、`library-front.png`      | 后高前低的四个切角阅览翼、前翼三层与后翼五层连续窗带；中央高体、两个侧塔、红色坡屋顶与红色屋缘、分面蓝玻璃中庭、入口门廊和宽台阶。                                                                   |

建筑位置、相互分离关系和主要道路沿用上一轮校准，不恢复悬浮文字说明牌。未提供的背立面、真实米制尺寸、室内与细部仍为低模估算。明湖亭台属于景观，当前水域仍阻挡人物，尚未提供登亭玩法。图书馆和会堂仍使用原占地作为保守建筑碰撞，不开放室内。

## 源文件与重建

- 共享布局：`assets-source/campus-3d/district/layout.json`；湖面显示与水域碰撞读取同一条岸线，小地图同步更新。
- Blender 可编辑源：`assets-source/campus-3d/district/district.blend`。
- 游戏模型：`public/assets/models/bjtu-district/district.glb`。
- 新部件脚本：`scripts/build_campus_landmarks.py`；国旗位于 `scripts/build_forecourt.py`。
- 选择性重建：`scripts/refine_campus_landmarks.py`，只替换环境、会堂、图书馆和球场，保留精修第九教学楼、思源楼与其他建筑。全量构建也调用同一部件脚本。
- 预览脚本：`scripts/render_campus_landmarks.py`，重新导入实际 GLB 渲染；输出到 `artifacts/campus-3d/landmarks/`。

```powershell
python scripts/create_campus_district.py
& 'E:/Blender/blender.exe' --background --factory-startup --python scripts/refine_campus_landmarks.py
# 导出后执行项目现有 glTF Transform 优化及 Khronos 校验流程。
& 'E:/Blender/blender.exe' --background --factory-startup --python scripts/render_campus_landmarks.py
```

运行时按建筑和材质合批，保留原有建筑遮挡淡化和镜头碰撞分类；国旗、湖面及球场不作为建筑触发整组遮挡。

## 验收

- 65 个测试文件、439 项测试通过；包括全路网球场退距、湖岸与道路／图书馆间距、湖面碰撞同源、五颗双面金星、GLB 结构与所有建筑边界，以及八箱可达／四箱撤离。
- TypeScript、ESLint 和正式构建通过。构建仍提示已有 `/assets/fonts/zpix.ttf` 路径警告。完整 `npm run check` 的历史阻断为无关 `src/main.ts`、`docs/delivery/d-changelog.md` 的格式问题，本轮未改这两个文件。
- 最终模型 146 个网格、199,159 三角形、10,339,520 字节；相比前版增加约 0.54 MB。全区块体积预算随三处精修改为 11 MB；没有新增运行时图片。Khronos glTF 校验 0 错误、0 警告。
- 正式构建挂在 `/demo/` 子目录，真实按键完成四箱搜索、草坪通行和返回南门撤离，无页面错误／资源 404。记录为 `artifacts/campus-3d/forecourt-browser-report.json`；末段单机采样 60 FPS、16.7 ms 平均／16.9 ms P95，73 次绘制、166 个几何体、4 张纹理，仅供本机参考。
- 实际 GLB 近景：`artifacts/campus-3d/landmarks/{tianyou,library,ming-lake,flag,courts}.png`。
- 正式构建中从南门实际按键步行至会堂、球场、明湖和图书馆，并检查缩放和区域总览，无页面错误／资源 404；截图及记录位于 `artifacts/campus-3d/landmarks/`。最终独立复验的总览末段采样 60 FPS、平均 16.7 ms／P95 16.8 ms；与离线渲染并行的较早一次采样为 37 FPS，因此这些数字仅供本机参考，不作为跨设备结论。
