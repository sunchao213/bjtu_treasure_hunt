# 校园像素草地

- 原图：用户于 2026-11-22 提供的「无缝像素草地纹理.png」，保留为 `user-grass-source.png`（1254×1254）。
- 用途：用户已要求加工并接入现有三维地图；生成工具及其条款未在本次会话提供。
- 处理：`python scripts/prepare_campus_grass.py`，依赖 Pillow、NumPy。面积缩采样至 256×256，周期分量修复拼接，降低色块对比，调整为苔绿底色，匹配两组外缘像素。
- 输出：`public/assets/environment/campus-grass/grass-albedo.png`，RGB、不透明、无烘焙灯光；四边对应像素差为零。
- 显示：世界 X/Z 投影，每 8 场景单位（256 逻辑单位）重复一次；放大最近邻，缩小使用 mipmap 和最多 8 倍各向异性过滤。继续响应白昼、夜间和手电照明。
- 材质范围：`district_grass`、`district_lawn`、`forecourt_lawn`，以及南门／思源楼样板的基础草地。道路、树木、建筑和布局沿用现有资源。
- 样张与检查输出：`artifacts/campus-3d/grass/`，其中草坪近景采用独立预览镜头以便前后对照，未改变游戏默认相机。
