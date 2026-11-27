# 第九教学楼照片参考精修

页面：<http://localhost:5173/campus-3d.html?area=district>。本次精修保留建筑原占地尺寸，沿用人物环绕相机，不恢复悬浮文字说明牌。随后在[草坪与广场布局校准](campus-3d-forecourt.md)中将整栋建筑与碰撞一并向东校准，精修形体及侧通道继续保留。

参考用户三张图片：官网斜视图确定楼体与院落关系，正面照片用于石材门廊、蓝玻璃和窗组，侧面照片用于底层通道、凹入阳台与长窗。参考保留在 `assets-source/campus-3d/district/reference/teaching9-{map,front,side}.png`。

## 模型调整

- 用九个高低不同的体块替换原通用院落楼，中央低体分出两处院落，后排增加退台。
- 取消尖顶门廊，改为平顶石材矩形门廊、贯通蓝玻璃、分格玻璃门、宽浅台阶和扶手。
- 门楣以深色几何浮雕带表达凹凸层次，不复制具体浮雕图案或文字标语。
- 浅米灰色外墙增加凹窗、蓝玻璃、多扇窗框、窗台、墙肋及简化空调外机。
- 西侧底层通道留空、上部保留楼层；增加凹入阳台、屋顶平顶楼梯间、女儿墙和开放梁架。
- 侧门接到主路的步道与树木净空同时调整；室内尚未制作。

尺寸依据照片估算，遮挡背侧、院落比例、层高与窗格数量仍可校准。未把全景照片直接贴在盒体上。

## 源文件

- `assets-source/campus-3d/district/layout.json`：九块楼体、两处院落、通道净高和门柱碰撞。
- `scripts/build_teaching9.py`：独立建模函数，与完整区块构建共用。
- `scripts/refine_teaching9.py`：在现有可编辑区块中替换该楼并导出。
- `scripts/export_campus_district.py`：直接导出已经保存的区块源文件。
- `assets-source/campus-3d/district/district.blend`：更新后的 Blender 源文件。
- `public/assets/models/bjtu-district/district.glb`：游戏模型。

```powershell
python scripts/create_campus_district.py
& 'E:/Blender/blender.exe' --background --factory-startup --python scripts/refine_teaching9.py
```

完整重建仍可运行 `scripts/build_siyuan.py -- --district`。源文件先保留独立物件，运行时按建筑和材质合批；合批直接合并顶点和面，并批量移除临时对象，减少 Blender 依赖图的重复更新。重新导出后须重新优化和校验，不能套用旧模型报告。

## 验证

底层碰撞跳过净高 2.25 场景单位的侧面架空体，人物可进入院落，其他楼体及石材门柱保持阻挡。测试读取实际 GLB 三角形，检查人物高度通道没有封堵、上部确有楼层，并核对平顶门廊、建筑边界、八箱可达和原四箱撤离保存。

预览和浏览器通行记录位于 `artifacts/campus-3d/teaching9-*`。运行时体积与 Khronos 验证以 `public/assets/models/bjtu-district/asset-report.json` 为准。

本次验收：

- 更新后的完整校园为 125 个网格、185,498 三角形、9,604,296 字节，无模型图像贴图；Khronos glTF Validator 0 错误、0 警告。窗面等薄片移除了不必要的封闭侧面，优化前同版模型约 12 MB；旧版 7 MB 自动检查预算相应调整为 10 MB。
- 63 个测试文件、434 项单元／集成测试通过；lint、typecheck 和 build 通过。新增导出三角形检测确认侧通道底层为空、上层有楼体；两处院落及八箱可达检查通过。
- Edge 1600×1000 实际按键走到正门，确认墙体碰撞；从主路经侧门进入院落并返回，旋转相机查看侧面，无页面运行错误，未使用传送或状态注入。
- 预览图通过重新导入实际 GLB 生成，正面、斜视分别为 `teaching9-front-preview.png`、`teaching9-model-preview.png`。游戏截图见 `teaching9-game-{front,side,courtyard}.jpg`。
- 首次加载体积相较原简版有所增加；本次通行记录与离线渲染同时运行，其 FPS 不作为稳定性能结论。原游戏已有的字体构建提示和两处格式问题沿用之前记录，未修改无关文件。
