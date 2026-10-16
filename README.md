# 交大摸金录 · 思源密码

这是五人课程项目的 **A 成员代码框架**，使用 Phaser 3、TypeScript、Vite。已实现可操作的地图、移动碰撞、搜索联调、价值达标撤离和对局结算；不是完整游戏 MVP。

实际 Git 根目录在用户给出的文件夹下一层：

```text
E:\BJTU_finding\bjtu_treature_hunt\bjtu_treasure_hunt
```

## 启动

使用 VS Code 打开上面的 Git 根目录。Node 版本统一为 `.nvmrc` 指定的 24.18.0，npm 使用 11.x。

```powershell
cd "E:\BJTU_finding\bjtu_treature_hunt\bjtu_treasure_hunt"
npm.cmd ci
npm.cmd run dev
```

浏览器打开终端给出的 `http://127.0.0.1:5173`。Windows PowerShell 若限制 npm.ps1，可像上面一样使用 `npm.cmd`。不要直接双击 index.html。

另开一个终端检查全部代码：

```powershell
npm.cmd run check
```

修改代码后先 `npm.cmd run format`，再运行 `check`。`check` 包含格式检查、ESLint、严格类型检查、单次运行测试和正式构建。CI 使用相同命令。`npm.cmd run preview` 可预览构建产物。

## 如何验证第一局

1. 勾选失败损失提示，点击“开始探索”。免费训练棍仅作为入场设定，战斗系统尚未接入。
2. WASD／方向键移动，楼宇和明湖具有碰撞；靠近金色物资点，长按 E 搜索 2 秒。受伤、松键、离开或页面切后台会取消搜索。
3. 八个物资点各有一件稀有物，至少收集四件达到 100 价值。满包不会吞掉搜索点，可以丢弃腾空间。
4. 回到南侧撤离区域（出生点附近），按 E 或点击“开始撤离”，连续停留 5 秒；受伤、离开或价值下降会取消。
5. 成功后联调仓库和图鉴持久保存。返回准备页可带入一件已保存物品；带入物不计本局价值，失败也会损失。
6. 开发环境有“模拟伤害／死亡”入口，供 A 在 C 未交代码时测试事件；正式构建不显示它们。没有传送、加分或自动通关接口。

存档使用独立键 `bjtu-treasure-hunt:a-framework:v1`。局中刷新／关闭，下一次打开按中断失败处理。单写者锁防止两个标签页同时修改存档；只支持有 Web Locks 的桌面 Chrome／Edge，需 localhost 或 HTTPS。清理浏览器数据会丢失联调收藏，可先导出备份。损坏存档不自动覆盖，明确确认后才能重置。

## 当前完成到什么程度

| 负责人 | 现在已有                                                                                      | 接下来负责                                           |
| ------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| A      | 工程、类型与事件、示意地图、移动碰撞、对局状态、10分钟计时、5秒撤离、异常中断、存档调用、测试 | 与各成员确认接口，接入 C／D 真实模块，修复整合问题   |
| B      | 可替换的参考库存／价值／存档适配器；独立联调存档                                              | 正式掉落、装备栏、物品使用、存档迁移和正式库存设计   |
| C      | DamageTaken／EnemyDefeated 事件、伤害接入方法                                                 | 武器命中、普通怪AI、抱抱／变异、敌人掉落             |
| D      | 可替换的基础 HUD、背包和结算壳；地点事件                                                      | 正式美术和五类界面、任务前置、地点剧情与章节解锁     |
| E      | 统一npm脚本、GitHub Actions检查、构建产物、PR模板                                             | 实际浏览器／教学机验证、正式部署、反馈与真实学生试用 |

此版本没有敌人 AI、真实攻击、抱抱系统、任务章节解锁、多人、排行和全校区地图；不可据此声明整个游戏已经完成。物品表中任务物的存在也不代表剧情已实现。

## A 接下来从哪里写

- `src/modules/raid/raid-controller.ts`：唯一对局状态机；不把判定搬进 UI。
- `src/scenes/world-scene.ts`：地图与各模块接线；后续 NPC 接入点在这里。
- `src/modules/world/`：移动碰撞、范围判定和搜索交互。
- `src/shared/types/game.ts`、`src/shared/events/game-events.ts`：团队接口契约。
- `src/config/`：集中配置；普通10／稀有25／史诗60／传说150，门槛100。
- `tests/`：边界与集成验证，优先保留失败、取消、重复结算和刷新路径。

详细说明见 [A 实施清单](docs/a-implementation.md)、[模块交接](docs/handoff.md)、[文档对应关系](docs/requirements-mapping.md)。

## 协作

从 main 建短期任务分支，一项任务一个 PR，由另一位组员复核；main 保持可运行。当前工作在 `codex/a-game-framework`，未替任何人填写贡献记录或审批。工具只配好了本地与 CI 文件，GitHub 分支保护及发布需 A／E 在真正建好主分支后设置。

**成员文档于 2026-10-05 提交给 A（当前模板约定20:00），不是当天完成最终合稿。** 原课程平台正常截止仍为 10/9 00:00，MVP 为 10/16 上课前。本仓库 README 不覆盖你们后续教师通知。

## 发布准备

`npm run build` 输出 `dist/`，Vite 使用相对 base，适合静态子目录部署。GitHub Pages 工作流在推送 `main`、推送 `v*` 标签或手动触发时运行完整检查，通过后发布 `dist/`。首次使用需在仓库 Settings → Pages 将 Source 设为 GitHub Actions，操作见 [GitHub Pages 发布说明](docs/github-pages.md)。Phaser 单独打包，其包体与实际校内网络加载应在 E 的性能检查中测量。

当前地图、人物和物资为代码绘制，见 [素材清单](docs/assets-manifest.md)。正式开源前由全组确定许可证。不要上传真实试用者身份信息。
