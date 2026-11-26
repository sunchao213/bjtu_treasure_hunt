# 明湖石碑三维模型

2026-11-25，依据本次用户提供的明湖石碑实拍照片重建。`reference.png` 是保存到项目中的原始参考；不引用第三方模型。

- 碑身为封闭三维网格，具有不规则肩部、厚度和粗糙表面，底部配四块独立托石；正面朝 Three.js 的 +Z（校园南侧）。
- 正面“明湖”题字、落款及刻字面来自照片投影，表面有几何起伏和法线细节。没有把整张照片当作透明立牌，也不会随相机转动。
- 侧面、背面和厚度依据单张照片估算，使用同一块石材照片的细粒纹理补全；不是扫描或测绘结果。
- 约 10,560 三角形、2 个不透明 PBR 材质、6 次绘制；4 张贴图全部嵌入 GLB，色彩贴图使用 sRGB，法线使用线性空间。碑高约 3.34 游戏米，脚点在地面。
- `.blend` 保留编辑源文件。运行时只读取 `public/assets/models/minghu-stele/minghu-stele.glb`，原来的 `props/minghu-stele.png` 不再用于正式场景。
- 保留原有明湖石碑坐标、剧情调查半径和残缺手记前置条件。

在仓库根目录重建：

```powershell
python scripts/prepare_minghu_model_textures.py
& E:/Blender/blender.exe --background --factory-startup --python scripts/build_minghu_stele.py
```

首次准备可向纹理脚本传入用户原图路径。脚本固定本次 1290×2796 照片的裁切和轮廓坐标。

对输出运行 glTF Transform 4.5.1 的 `optimize`，保留几何、不加压缩解码器：

```powershell
npx --cache ./artifacts/npm-cache --registry https://registry.npmjs.org --yes @gltf-transform/cli optimize public/assets/models/minghu-stele/minghu-stele.glb artifacts/minghu-stele/optimized.glb --compress false --simplify false --join false --palette false --texture-compress false --flatten false --instance false
Copy-Item artifacts/minghu-stele/optimized.glb public/assets/models/minghu-stele/minghu-stele.glb -Force
npx --cache ./artifacts/npm-cache --registry https://registry.npmjs.org --yes @gltf-transform/cli validate public/assets/models/minghu-stele/minghu-stele.glb
```

从交付 GLB 渲染正面、侧面及背面预览：

```powershell
& E:/Blender/blender.exe --background --factory-startup --python scripts/render_minghu_stele.py
```

预览在 `artifacts/minghu-stele/`；浏览器夜景及调查交互检查使用 `node tests/browser/game-flow-smoke.mjs --stele-only`（先构建前端及本地测试服务）。
