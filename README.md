# 交大摸金录 · 思源密码

这是五人课程项目的 **A 成员整合版本**，正式入口使用 Three.js、TypeScript、Vite，单人和组队统一探索南部三维校园。保留正式大厅、背包、设置、战斗、三章任务、结算和账号云存档；组队共享地图与玩家位置。

## 在线体验

游戏地址：[https://123.57.160.49/](https://123.57.160.49/)

在浏览器中打开后，注册或登录账号即可进入游戏。

## 本地开发

正式入口位于 `/`，加载南部三维校园、草地、道路和像素树，默认夜间近距离环绕镜头，提供区域总览与镜头重置。Tab 开关正式背包，Esc 先关闭背包、再开关设置；WASD／方向键相对镜头移动，E 交互，Q 安抚，空格攻击，L／R／G 管理照明。

接入边界、验证方法和正式入口截图见[正式三维校园接入与验收](docs/formal-campus-integration.md)。

独立的 [campus-3d.html](http://localhost:5173/campus-3d.html) 继续保留作三维试验页；其存档、固定宝箱规则和 B／F／T 快捷键不带入正式入口。
运行、素材和后续扩图说明见 [三维试验区文档](docs/campus-3d.md)，实测范围见
[三维验收记录](docs/campus-3d-verification.md)。

当前工作目录：

```text
E:\bjtu_hunt\bjtu_treasure_hunt
```

## 启动

游戏现已要求先登录，需同时启动账号与联机服务。在独立终端运行（需要 .NET 8 SDK 或兼容更新版本）：

```powershell
dotnet run --project server/OnlineHost.csproj --urls http://127.0.0.1:5080
```

服务首次启动自动创建 SQLite 数据库 `server/data/game.db`，无需另装数据库服务。然后按下面步骤启动前端，在页面注册或登录后进入游戏。账号与部署见[登录功能说明](docs/authentication.md)，数据库位置、迁移和备份见[数据库说明](docs/database.md)。

使用 VS Code 打开上面的 Git 根目录。Node 版本统一为 `.nvmrc` 指定的 24.18.0，npm 使用 11.x。

```powershell
cd "E:\bjtu_hunt\bjtu_treasure_hunt"
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

1. 勾选失败损失提示，选择初始武器后点击“开始探索”。武器会自动装备到主武器槽，不占背包格。
2. WASD／方向键移动，楼宇和明湖具有碰撞；靠近金色物资点，长按 E 搜索 2 秒。受伤、松键、离开或页面切后台会取消搜索。
3. 普通宝箱按本局种子随机刷新，累计携带价值达到 100 后可撤离。任务证据沿用本局前置要求，地点已迁移到新校园。满包不会吞掉搜索点，可以丢弃腾空间。
4. 回到南侧撤离区域（出生点附近），按 E 或点击“开始撤离”，连续停留 5 秒；受伤、离开或价值下降会取消。
5. 成功后仓库和图鉴保存到账号云存档。返回准备页可带入一件已保存物品；带入物不计本局价值，失败也会损失。
6. 开发环境有“模拟伤害／死亡”入口，供 A 在 C 未交代码时测试事件；正式构建不显示它们。没有传送、加分或自动通关接口。

仓库、图鉴、章节和对局状态按账号保存在 SQLite 云存档，换设备连接同一服务并登录即可继续。数据库确认后才更新当前进度，浏览器仅缓存备份；已有云存档优先读取远端。添加登录前的共享存档可在登录后明确确认迁移。局中刷新／关闭，下一次打开按中断失败处理。浏览器 Web Lock 与服务端租约共同保护同账号单窗口游戏，需支持 Web Locks 的浏览器及 localhost 或 HTTPS。断网保存失败可重试；租约失效后需重新读取进度。可在游戏内导出进度，或运行 `npm.cmd run db:backup` 备份账号和存档数据库。

## 当前完成到什么程度

| 负责人 | 现在已有                                                                             | 接下来负责                                  |
| ------ | ------------------------------------------------------------------------------------ | ------------------------------------------- |
| A      | 工程、类型与事件、地图、移动碰撞、对局状态、撤离、模块整合、联机协议与客户端传输边界 | 在线权威服务接入、发布整合与系统验收        |
| B      | 装备槽、容量规则、物品使用、正式存档迁移、带入/带出结算                              | 生产数据规则评审与持续数值平衡              |
| C      | 武器攻击、普通怪AI、抱抱/变异、敌人掉落                                              | 战斗体验调优和回归                          |
| D      | 大厅、HUD、背包、结算、移动布局、任务前置、地点剧情与章节解锁                        | 视觉与真机交互打磨                          |
| E      | 统一检查、自动化测试、CI、验收清单                                                   | 真实浏览器/教学机验证、正式部署、反馈与试用 |

在线协议只负责身份、房间、输入和快照传输，不把本地存档或结算结果发送给其他客户端；正式联机还需要服务器房间服务、权威战斗/掉落结算和部署地址。

第一轮提供临时同图玩家房间：启动方式、地址配置、安全边界和两浏览器验收步骤见[联机说明](docs/networking.md)。它同步玩家位置，不同步敌人、战斗、掉落或撤离结算。

## A 接下来从哪里写

- `src/modules/raid/raid-controller.ts`：唯一对局状态机；不把判定搬进 UI。
- `src/scenes/formal-world-scene.ts`：正式三维场景生命周期、输入与地图；`src/modules/world/formal-world.ts` 持有正式玩法会话。
- `src/campus-3d/view.ts`：共享三维显示，接收显式校园配置和世界快照；不处理账号存档。
- `src/modules/world/`：移动碰撞、范围判定和搜索交互。
- `src/shared/types/game.ts`、`src/shared/events/game-events.ts`：团队接口契约。
- `src/config/`：集中配置；普通10／稀有25／史诗60／传说150，门槛100。
- `tests/`：边界与集成验证，优先保留失败、取消、重复结算和刷新路径。

详细说明见 [A 实施清单](docs/a-implementation.md)、[模块交接](docs/handoff.md)、[文档对应关系](docs/requirements-mapping.md)。

## 协作

从 main 建短期任务分支，一项任务一个 PR，由另一位组员复核；main 保持可运行。当前工作在 `codex/a-game-framework`，未替任何人填写贡献记录或审批。工具只配好了本地与 CI 文件，GitHub 分支保护及发布需 A／E 在真正建好主分支后设置。

**成员文档于 2026-10-05 提交给 A（当前模板约定20:00），不是当天完成最终合稿。** 原课程平台正常截止仍为 10/9 00:00，MVP 为 10/16 上课前。本仓库 README 不覆盖你们后续教师通知。

## 发布准备

`npm run build` 输出 `dist/`，需搭配同源账号与联机服务部署，具体见[登录功能说明](docs/authentication.md)。CI 检查前端与账号服务并生成构建附件，没有自动部署、推送或发布。正式入口只启动 Three.js；历史 Phaser 场景保留作代码参考。本次三维接入仅在本地验证，线上地址未更新。

Ubuntu 云服务器的打包、上传、开机启动、存档目录与更新步骤见 [Ubuntu 部署说明](docs/ubuntu-deployment.md)。

`npm run build` 输出 `dist/`，Vite 使用相对 base，适合静态子目录部署。GitHub Pages 工作流在推送 `main`、推送 `v*` 标签或手动触发时运行完整检查，通过后发布 `dist/`。首次使用需在仓库 Settings → Pages 将 Source 设为 GitHub Actions，操作见 [GitHub Pages 发布说明](docs/github-pages.md)。Phaser 单独打包，其包体与实际校内网络加载应在 E 的性能检查中测量。

校园夜景底图为用户自制，人物和物资由代码绘制，见 [素材清单](docs/assets-manifest.md)。正式开源前由全组确定许可证。不要上传真实试用者身份信息。

## 联机客户端第一阶段

游戏大厅提供“单人探索”和“组队探索”。单人模式确认装备和风险后直接开局；组队模式统一使用同源 `/ws` 服务，由服务器生成 6 位数字房间号。旧的 `BJTU-xxxx` 演示房间已从游戏界面移除，不再使用 `BroadcastChannel` 或 `VITE_REALTIME_URL` 切换正式入口。完整步骤见[联机说明](docs/networking.md)。

校园资源加载完成后才允许开局；加载失败会显示重新加载入口。局内保留地图、任务、背包和撤离操作，结算后返回大厅或原组队房间。单人、两账号房间、连续两局和手机布局的真实浏览器回归运行 `npm.cmd run test:browser`（需要 Chrome 或 Edge），使用独立本地测试数据库，详见[游戏流程验证](docs/game-flow-verification.md)。

目前房间共享玩家位置和本轮地图布局，战斗、敌人、掉落和结算仍在各客户端执行，账号存档通过同源接口保存到服务器。

`src/shared/net/protocol.ts`、`game-session.ts`、`online-raid-controller.ts` 和 `online-inventory.ts` 保留为未来服务器权威战斗协议的独立模块与测试，不参与当前游戏入口。正式房间协议位于 `src/modules/network/network-protocol.ts`，连接与房间界面分别由 `network-session.ts` 和 `room-lobby.ts` 管理。
