# AGENTS.md · AI 接手说明

> 适用对象：任何接手本仓库的 AI 编程助手。
> 交接时间：2026-11-03 00:37（GMT+8）
> 项目根目录：`D:\26-27\实训\bjtu_treasure_hunt`
> 当前分支：`feature/d-ui-quest-story`
> 当前用户角色：D（界面与剧情），不是 A（框架/集成）、B（存档/库存）、C（战斗/敌人）、E（CI/发布）。

先完整读完本文件，再读代码和文档。不要凭旧 README 或历史提交猜测现状。

---

## 0. 必须遵守的硬规则

1. **未经用户明确指令，不得 `git commit`、`git push`、创建 PR、合并分支或改写远程历史。**
   用户已多次明确要求：先改代码，验收通过后由用户下指令再提交。
2. **不得执行 `git reset --hard`、`git checkout --`、`git clean`、`git stash drop` 或任何会丢弃工作区改动的命令。**
   当前工作区同时存在已暂存和未暂存改动，见第 1 节。
3. **不要为了“整理”而重构整个项目。** 先修用户指出的具体问题，再做最小必要改动。
4. **不要擅自修改团队接口和玩法数值。**
   `RaidControllerPort`、`InventoryPort`、`SavePort`、网络协议、价值表、撤离门槛、存档 schema 属于跨角色契约；改之前必须说明影响并等待用户确认。
5. **不要声称“已完成 / 已修复 / 已通过”而没有实际运行验证。**
   至少运行 `npm run check`，涉及画面时再做浏览器实测。
6. 不要提交密钥、真实个人信息、用户浏览器存档或未授权素材。
7. 用户偏好中文、简洁、可直接执行的说明；指出问题时给出文件位置和具体改法，不要只讲概念。

---

## 1. 当前 Git 与工作区快照

```text
仓库：https://github.com/sunchao213/bjtu_treasure_hunt.git
分支：feature/d-ui-quest-story
上游：origin/feature/d-ui-quest-story
状态：ahead 8（本地含 1 个未推送的 merge commit，以及从 main 合入的提交）
HEAD：05678bc Merge remote-tracking branch 'origin/main' into feature/d-ui-quest-story
```

- `3e2738b`（CHG-29 固定画框）已在远端特性分支。
- `05678bc`（合入 main 的 merge commit）**尚未推送**。
- 本地 `main` 落后 `origin/main` 13 个提交，**不要直接在本地 main 上开发**。
- 最近一次完整质量门禁：**34 个测试文件 / 268 条测试全部通过，生产构建通过**。

### 未提交改动（不要丢弃）

| 文件                                | 状态            | 内容                                                                  |
| ----------------------------------- | --------------- | --------------------------------------------------------------------- |
| `src/main.ts`                       | 已暂存          | 确认弹窗接线、合并后的 `activeController` 适配、HUD / 房间 / 阶段渲染 |
| `src/modules/ui/reference-shell.ts` | 已暂存          | 确认弹窗标记、HUD 入口、联机房间卡折叠                                |
| `src/style.css`                     | 已暂存 + 未暂存 | 固定画框、HUD、确认弹窗、房间卡、校园图缩略卡、布局细节               |
| `src/scenes/world-scene.ts`         | 未暂存          | CHG-34 镜头改跟随人物身体中心                                         |
| `src/modules/ui/confirm-dialog.ts`  | 未跟踪          | 游戏内确认弹窗模块（CHG-32）                                          |
| `tests/unit/confirm-dialog.test.ts` | 未跟踪          | 确认弹窗 7 条测试                                                     |
| `docs/delivery/d-changelog.md`      | 已暂存 + 未暂存 | CHG-32 / 33 / 34 记录                                                 |
| `docs/desktop-mobile-testing.md`    | 已暂存          | 确认弹窗与画面适配验收行                                              |

**这些改动是用户正在验收的内容，不代表已提交。** 新接手时先运行：

```bash
git status --short
git diff --stat HEAD
```

不要因为“工作区不干净”就 stash、reset 或重新克隆。

---

## 2. 项目是什么

《交大摸金录 · 思源密码》是五人课程项目：Phaser 3 + TypeScript + Vite 的校园夜间搜打撤游戏。

当前实际具备：

- 单人对局闭环：准备、带入、搜索、战斗、价值达标、撤离、结算、仓库、图鉴。
- 海淀主校区地图、随机物资箱、夜间手电与遮挡、敌人巡逻 / 抱抱怪 / 变异。
- 主线两件证据（残缺手记、异常羽毛）与章节解锁。
- 新手五步引导、剧情弹窗、规则、校园图、存档导入导出。
- 桌面端固定 1280×720 画框；触屏端独立横屏布局。
- 联机房间客户端骨架：未配置服务器时用 `BroadcastChannel` 双标签页演示；配置 `VITE_REALTIME_URL` 后走 WebSocket。**没有已部署的权威服务端。**

尚未达成或不能夸大的部分：

- 真实手机设备未验收，现有触屏结论来自 Chrome 模拟。
- 桌面端全屏尚未实现（见 6.3）。
- 联机仍是客户端骨架，不能宣称完整多人上线。
- 视觉/动效令牌已经定义，但尚未全面接入业务组件。
- 工作区正在验收的改动尚未提交，不能写成“已完成并入库”。

### 文档可信顺序

1. **当前代码**（最高）
2. `docs/delivery/d-changelog.md` 最新 CHG 条目
3. 本文件
4. `docs/delivery/d-design-r07-r08.md`、`docs/desktop-mobile-testing.md`
5. `docs/handoff.md`
6. 旧 README、`docs/night-gameplay.md` 的历史条目（最低）

已知过期内容：

- `README.md` 写的是旧机器路径 `E:\BJTU_finding\...`，且称“没有敌人 AI、任务、多人”，与当前代码不符。
- `README.md` 称 Node 24.18.0，正确；但根目录实际是 `D:\26-27\实训\bjtu_treasure_hunt`。
- `docs/night-gameplay.md` 中“世界 3600×2400”“抱抱掉落神器”等是历史记录；当前 `WORLD` 为 **1280×1824**，抱抱已不产出奖励。
- 文档中的 R/F 编号：`R01–R08` 是冻结需求基线，`F01–F05` 是助教整改项，不能混用。

---

## 3. 快速启动与验证

环境：

- Node **24.18.0**（见 `.nvmrc` / `.node-version`）
- npm 11.x
- 桌面 Chrome 或 Edge（存档单写者锁依赖 Web Locks）

```bash
cd "D:/26-27/实训/bjtu_treasure_hunt"
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。

Vite 配置为 `strictPort: true`；如果 5173 被占用，`npm run dev` 会直接失败，而不是自动换端口。先检查：

```bash
netstat -ano | grep ":5173"
```

Windows Git Bash 下停止指定进程：

```bash
taskkill //PID <PID> //F
```

如果当前已有开发服务器，`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/` 返回 `200`，不要重复启动。

质量门禁：

```bash
npm run check
```

它依次执行 Prettier 检查、ESLint（0 warning）、TypeScript、Vitest、生产构建。**提交前必须全绿。**

可选联机环境变量：

```bash
# 不配置：BroadcastChannel，开发环境双标签页演示
# 配置：客户端尝试连接 WebSocket 服务端
VITE_REALTIME_URL=ws://127.0.0.1:8787
```

---

## 4. 代码地图

| 位置                                  | 职责                                             | 注意                               |
| ------------------------------------- | ------------------------------------------------ | ---------------------------------- |
| `index.html`                          | `#stage > #app` 固定画框入口                     | 不要移除 `#stage`                  |
| `src/main.ts`                         | 组装根：存档锁、控制器、场景、DOM 渲染、事件接线 | 已 1000+ 行；不要把业务判定塞进来  |
| `src/modules/ui/reference-shell.ts`   | 静态页面壳与全部主要 DOM id                      | 改 UI 先在这里找节点               |
| `src/style.css`                       | 桌面端主样式与固定画框                           | 2200+ 行，改动要限定选择器         |
| `src/mobile-layout.css`               | 触屏端横屏 / 旋转 / 安全区布局                   | 不要被桌面画框规则污染             |
| `src/modules/ui/stage.ts`             | 计算 `--stage-scale`，固定 1280×720              | 桌面端整框等比缩放                 |
| `src/scenes/world-scene.ts`           | Phaser 地图、输入、镜头、交互、夜色渲染          | 场景负责表现与接线，不负责对局结算 |
| `src/modules/raid/raid-controller.ts` | **唯一对局状态机**                               | 价值、撤离、死亡、超时、结算幂等   |
| `src/modules/inventory/`              | 背包、价值计算、带入物来源                       | 不复制第二套库存逻辑               |
| `src/modules/save/`                   | 正式存档、迁移、单写者锁                         | 改 schema 必须加迁移与测试         |
| `src/modules/quests/`                 | 任务判定与章节内容                               | 证据必须来自本局 `raid-loot`       |
| `src/modules/ui/`                     | 规则、图鉴、剧情、引导、确认框、HUD 渲染         | 渲染函数入参即状态，不直接写存档   |
| `src/modules/world/`                  | 移动碰撞、搜索、物资生成、夜间系统               | 与地图坐标强耦合                   |
| `src/modules/network/`                | 房间、传输、在线控制器与库存适配                 | 未配置服务端时不是完整联机         |
| `src/config/`                         | 物品、规则、地图、怪物、战斗配置                 | 数值改这里，不要散落到 UI          |
| `src/shared/types/game.ts`            | 跨角色接口契约                                   | 改动需通知其他角色                 |
| `tests/`                              | Vitest 单元与集成测试                            | 34 文件 / 268 条                   |

### 数据流

```text
PersistentSave ──快照──► main.ts（编排 + DOM 渲染）
      ▲                    │
      │                    ├─► ui/*（纯展示）
      │                    └─► WorldScene（地图 / 输入 / 表现）
      │
      └── finalizeRaid ◄── RaidController（权威状态）
                              ▲
                              └── InventoryPort / SavePort
```

### 对局状态机

```text
preparing ──start 保存成功──► active
active ──价值达标且在南门区域──► extracting
extracting ──受伤 / 离区 / 价值下降 / 暂停──► active
active / extracting ──死亡 / 超时 / 放弃 / 读条完成──► settling
settling ──保存成功──► success | failed
success | failed ──返回准备──► preparing
```

关键不变量：

- 开局的持久化写入成功后才进入 `active`。
- 结算只执行一次，保存失败冻结同一结果并允许重试。
- 只有本局搜到且仍携带的物品计分；带入物不计分，失败仍损失。
- 章节解锁必须成功撤离并带齐本局证据，不能仅靠“拾取过”。
- `RaidController` 是决策者，UI 和 Phaser 场景只能消费快照 / 事件。

### 存档

- 正式存档键：`bjtu-treasure-hunt:save:v2`
- 旧联调存档键：`bjtu-treasure-hunt:a-framework:v1`
- 新手引导独立键：`localStorage.bjtu-tutorial-v1`
- `localStorage` 不可写、损坏存档、刷新中断、第二标签页都有专门路径，不要用“直接清空存档”掩盖问题。

---

## 5. 界面与固定画框约定（D 的重点）

1. 桌面端画面恒为 **1280×720** 设计基准，整框 `transform: scale(var(--stage-scale))` 居中；页面不允许滚动。
2. 画框内尺寸用容器单位 `cqh` / `cqw`，不要新增 `vh` / `vw` / `svh` / `dvh`。
3. 桌面端媒体查询若只针对触屏，必须带 `(pointer: coarse)`；否则窗口宽度变化会重排固定画框内部。
4. `#stage` 有 `transform`，因此其内部 `position: fixed` 以画框为包含块；弹窗 `showModal()` 会进入浏览器顶层，桌面弹窗由 `html:not([data-touch='true']) #stage dialog[open]` 单独缩放。
5. 主布局：

   ```text
   .play-layout = 左地图 minmax(0, 1fr) + 右栏 320px，间距 20px
   ```

   右栏预算很紧。新增卡片、增大 padding、加展开区，都可能把「申请撤离 / 放弃探索」顶出画框。**画框外是裁切，不是页面滚动。**

6. 对局阶段收起网站式 `.masthead`，图鉴 / 规则入口在 HUD 顶栏 `#hud-codex` / `#hud-rules`。
7. 底部 `#notice` 在桌面对局/结算阶段固定到画框底部，按左栏宽度对齐，避免和右栏抢空间。
8. 原生 `confirm()` / `alert()` 已全部禁用。破坏性操作统一用 `bindConfirmDialog().ask()`；默认焦点在取消，Esc / 遮罩 / 取消都返回 `false`。
9. 右上角校园图缩略卡为 **112px 宽**，保持 `1280 / 1824` 地图比例，不拉伸、不裁图。
10. 主场景镜头 `setFollowOffset(0, 35)`，跟随人物身体中心；出生点靠近地图边缘时允许因镜头边界略偏，不要为此露出地图外黑区。
11. Phaser 使用 `Phaser.Scale.NONE` + 父容器 `clientWidth/clientHeight` 调整逻辑分辨率。不要随意改成 FIT / ENVELOP，可能影响输入坐标和画面清晰度。

---

## 6. 当前待办与已知问题

### 6.1 背包死结（等待用户决策）

右栏一屏只剩约 7px 余量，一件背包物品高约 55px，装 1 件就可能把结算按钮顶出画框。

三个方向：

- A：背包改浮层（推荐）
- B：右侧抽屉
- C：暂时保留栏内滚动

**用户尚未拍板，不要擅自选一个就大改。** 当前只有栏内滚动兜底。

### 6.2 联机房间入口位置（等待 A 决策）

main 合入的「联机房间」卡原本只在开局后可见，因为准备阶段整块 `.play-layout` 被隐藏。当前已改成 `<details>` 折叠，默认只占一行，避免顶掉背包与结算卡。

但正确的信息架构还没定：应挪进准备大厅，还是在大厅顶部放入口。这个问题需要 A 决定，不要单方面搬动联机模块。

### 6.3 桌面端全屏未实现

`src/modules/ui/mobile-layout.ts` 的 `requestLandscape()` 中有：

```ts
if (!isTouchLayout()) return;
```

因此桌面端不会请求 Fullscreen API。桌面全屏属于需求空白，涉及画布策略变更，必须先与 A（组长 sunchao）确认，不要直接删掉这一行上线。

### 6.4 其他遗留

- 右侧栏在背包塞满时会出现栏内滚动；根因是纵向预算不足，不是滚动条样式问题。
- 图标只接入关闭按钮和两个 HUD 入口，未全站替换。
- 动效令牌 0 条接入业务组件。
- 手机端仅做浏览器触屏模拟，没有真实 iOS / Android 验收。
- 文档存在历史口径残留，改需求前先对照代码。

---

## 7. 修改流程

新接手时按这个顺序做：

1. `git status --short`、`git diff --stat HEAD`，确认不会覆盖用户正在验收的改动。
2. 读相关源码与最新 CHG 条目，确认问题属于 D、A、B、C 还是 E。
3. 只改必要文件，保持现有 DOM id、事件名、存档键和接口签名。
4. 先跑相关测试：
   ```bash
   npx vitest run tests/unit/<相关文件>.test.ts
   ```
5. 再跑完整门禁：
   ```bash
   npm run check
   ```
6. 涉及画面时在 **1280×720** 实测，并至少再看一档较大和一档较小窗口；检查页面零滚动、按钮不被裁切、弹窗居中。
7. 更新 `docs/delivery/d-changelog.md` 的 CHG 编号；界面验收变化同步 `docs/desktop-mobile-testing.md`。
8. 向用户汇报改了哪些文件、验证结果、还没解决什么。
9. **停在这里，等待用户下指令再提交。**

### 常见改动落点

| 需求                     | 首选位置                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| 改文案 / 加按钮 / 调 DOM | `modules/ui/reference-shell.ts` + `main.ts` 绑定                         |
| 改桌面视觉 / 布局        | `style.css`，尽量限定 `#app` / `#stage`                                  |
| 改手机布局               | `mobile-layout.css`                                                      |
| 加游戏内弹窗             | 新建/复用 `ui/*.ts` 标记 + `bind*` + `<dialog>` + CSS + 测试             |
| 改对局规则               | `modules/raid/raid-controller.ts` + `tests/unit/raid-controller.test.ts` |
| 改物品 / 数值            | `config/game-config.ts` + 图鉴目录 + 测试                                |
| 改地图 / 碰撞 / 物资点   | `config/world-config.ts` + `campus-map.test.ts`                          |
| 改存档结构               | `modules/save/persistent-save.ts` + 迁移和集成测试                       |
| 改联机                   | `modules/network/` + `shared/net/protocol.ts`，先确认服务端边界          |

---

## 8. 最小验收清单

提交前至少确认：

- [ ] `npm run check` 全绿（当前基线 34 文件 / 268 条）。
- [ ] 1280×720 页面 `scrollWidth == clientWidth`、`scrollHeight == clientHeight`。
- [ ] 能完成一局：开始 → 移动 → 搜物 → 价值达 100 → 南门撤离 → 结算。
- [ ] 放弃探索、丢弃任务物、重置存档弹的是游戏内确认框，不是浏览器原生弹窗。
- [ ] 规则 / 图鉴 / 校园图 / 确认弹窗居中且随画框缩放。
- [ ] 右栏「申请撤离 / 放弃探索」没有被画框下沿裁掉。
- [ ] 触屏布局未被桌面画框改动影响。
- [ ] 新增行为有对应测试；修 bug 时至少保留一条回归测试。
- [ ] 没有提交、没有推送，除非用户明确要求。

---

## 9. 可直接发给接手 AI 的提示词

```text
项目根目录：D:\26-27\实训\bjtu_treasure_hunt
当前分支：feature/d-ui-quest-story

请先完整阅读根目录 AGENTS.md，再运行 git status --short 和 git diff --stat HEAD。

硬性要求：
1. 未经我明确指令，不得 commit、push、合并分支或丢弃工作区改动。
2. 保留现有未提交改动，不执行 reset / checkout -- / clean / stash。
3. 先说明你理解的现状、准备改哪些文件、为什么，再动手。
4. 改完运行 npm run check；涉及画面时在 1280×720 实测。
5. 不要依据旧 README 判断功能，以 AGENTS.md、最新 d-changelog 和当前代码为准。

我现在的需求是：<在这里写具体需求>
```

---

## 10. 交接一句话总结

这是一个已经能完整跑通单人搜打撤流程、但仍有界面预算、联机入口和桌面全屏待收尾的 Phaser 课程项目；当前分支有用户正在验收的未提交改动，接手者最重要的是**先读懂现状、只做最小改动、验证后等指令再提交**。
