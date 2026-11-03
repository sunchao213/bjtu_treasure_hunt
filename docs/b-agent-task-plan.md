# B 组员 V1.0 任务计划

## 本轮 V1.0 范围

- 6 格背包。
- 拾取、丢弃、使用。
- 普通、稀有、史诗、传说四档价值计算。
- 带入物不计入本局价值。
- 成功入库、失败损失。
- 刷新中断、重复结算不重复增加物品。
- 使用 localStorage 保存 JSON 存档。
- 对应冻结需求 R03、R06。

## 非本轮范围 第二阶段

以下内容只记录为后续规划，本轮不实现：

- 二维网格。
- 物品宽高和旋转。
- 装备槽交换。
- 商店。
- 钱包。
- 交易。
- 升级。
- 联机资产事务。
- IndexedDB 或服务端资产事务。
- SQL 数据库。

## 第二阶段候选范围，需组长确认后实施

以下内容仅作为候选规划，须由组长确认范围、优先级、接口和验收标准后另行实施：

- 二维网格。
- 物品宽高和旋转。
- 装备槽交换。
- 钱包。
- 出售、购买和升级。
- `transactionId` 和交易记录。
- IndexedDB 或服务端资产事务。
- 如未来引入数据库，再单独设计 schema、迁移和事务；本轮不创建或实施 SQL 数据库。

这些功能会同时影响共享类型、存档结构与迁移、UI 交互、业务接口、持久化实现和测试，必须成组设计和验证，不能只增加一个数据库文件来实现。当前 V1.0 不实现上述任何功能，也不修改 `src/` 下代码。

## 步骤清单

### Step 1 冻结范围与任务计划

- [x] 状态：已完成
- 目标：明确本轮 V1.0 的库存、价值、仓库和存档边界，记录第二阶段内容，避免范围漂移。
- 操作：创建本文件，写入本轮范围、非本轮范围和 Step 1 至 Step 8 任务清单。
- 涉及文件：`b-agent-task-plan.md`
- 执行命令：无
- 结果：已完成范围冻结和后续任务拆分。
- 风险：若团队重新确认需求，需要在本文件中记录范围变更及影响，不直接扩大本轮实现范围。
- 下一步：执行 Step 2，建立分支并进行基线检查。

### Step 2 建分支与基线检查

- [x] 状态：已完成
- 目标：建立B组员独立工作分支，确认当前代码基线可运行。
- 操作：读取任务计划；执行 `git status --short --branch`；确认并切换到已有的 `feature/b-inventory-save` 分支；执行项目基线检查。
- 涉及文件：Git 分支、项目现有代码和测试文件；本任务计划文件
- 执行命令：`git status --short --branch`；`git switch feature/b-inventory-save`；`npm.cmd run check`
- 结果：当前分支为 `feature/b-inventory-save`，跟踪 `origin/feature/b-inventory-save`，本地领先远端 7 个提交。基线检查通过：Prettier、ESLint、TypeScript 类型检查、Vitest（20 个测试文件、151 个测试）和 Vite 构建全部成功。
- 风险：工作区包含 Step 1 新增的未跟踪文件 `b-agent-task-plan.md`；本次未修改业务代码。此前误创建了本地 `codex/b-inventory-save` 分支，它指向与正确分支相同的基线提交，本次不使用也不删除，避免未经确认进行分支清理。
- 下一步：执行 Step 3，阅读并确认现有库存、价值计算、存档接口、迁移逻辑和测试覆盖情况。

### Step 3 阅读确认现有文件

- [x] 状态：已完成
- 目标：确认现有库存、价值计算、存档接口、迁移逻辑和测试覆盖情况。
- 操作：阅读共享类型、游戏配置、库存模块、存档模块、主入口、库存/存档集成测试和 `package.json` scripts；按“现有实现、缺口、后续计划、风险”整理事实。
- 涉及文件：`src/shared/types/game.ts`；`src/config/game-config.ts`；`src/modules/inventory/reference-inventory.ts`；`src/modules/inventory/inventory-model.ts`；`src/modules/inventory/extraction-value.ts`；`src/modules/save/persistent-save.ts`；`src/modules/save/reference-save.ts`；`src/main.ts`；`tests/unit/inventory.test.ts`；`tests/integration/persistent-save.test.ts`；`tests/integration/save-flow.test.ts`；`package.json`
- 执行命令：`Get-Content` 阅读上述文件；`rg -n "PersistentSave|ReferenceInventory|InventoryModel|calculateExtractionValue" src tests docs README.md`
- 结果：
  - 当前库存模型：`ItemInstance` 由 `instanceId`、`itemId`、`origin` 组成；`origin` 只有 `carry-in` 或带 `obtainedInRaidId` 的 `raid-loot`。`ReferenceInventory` 当前以 `items: ItemInstance[]` 保存随身物品，以 `Map<slotId, instanceId>` 保存装备引用，以 `carryIn` 保存本局开始时的带入物快照；`getCarriedItems()` 返回深拷贝。容量按物品件数计算，装备物不占背包容量。拾取会校验物品来源、实例唯一性和容量；移除会清理对应装备引用；恢复物通过 `consumeHealing()` 先确认效果成功再消耗。
  - 当前价值计算：`calculateExtractionValue()` 使用本次调用提供的物品定义和值表；只计算来源为当前 `raidId` 的 `raid-loot`，排除 `carry-in` 和其他对局来源；按 `instanceId` 去重，冲突实例会抛错；未知物品或非法价值会抛错。当前配置为普通10、稀有25、史诗60、传说150，背包容量6，撤离门槛100。
  - 当前 localStorage 存档：`StoragePort` 只提供 `getItem` 和 `setItem`。正式键为 `bjtu-treasure-hunt:save:v2`，JSON 根对象包含 `schemaVersion`、`warehouse`、`codexIds`、`unlockedChapterIds`、`activeRaid`、`settledRaidIds`、`lastResult`。参考适配器另使用 `bjtu-treasure-hunt:a-framework:v1`，其 schema 1 的 `activeRaid` 只有 `raidId`；正式 schema 3 的 `activeRaid` 还包含已经从仓库扣除的 `loadout` 实例清单。
  - `PersistentSave` 和 schema 3：构造时读取正式键，校验 JSON、物品定义、实例唯一性、活动局和结算不变量；schema 3 直接加载，schema 2 会迁移到 schema 3，旧活动局因没有可信带入清单而记录为 `interrupted` 失败，不猜测返还物品。`importRaw()` 支持 v2/v3 正式备份，`importReference()` 显式导入 v1 参考存档并保留参考键。`commit()` 先校验完整对象，存储写入成功后才替换内存。`exportRaw()`、`reset()` 和 `recoverInterrupted()` 已存在。
  - `beginRaid()` 约定：`SavePort.beginRaid(raidId, loadoutIds)` 返回 `Promise<readonly ItemInstance[]>`；要求没有其他活动局、raidId 未结算、带入数量不超过 `RAID_RULES.bagCapacity` 且实例 ID 不重复；从仓库找到指定实例后复制为 `carry-in`，原子扣出仓库物并写入活动局。`PersistentSave` 记录完整 loadout，`ReferenceSave` 只记录 raidId。
  - `finalizeRaid()` 约定：`SavePort.finalizeRaid(result: RaidResult): Promise<void>`；已结算 raidId 重复提交直接幂等返回；其他情况必须匹配当前活动局并通过结算校验。失败结果必须没有物品；正式 schema 3 的成功结果可包含与活动局 loadout 匹配的 `carry-in` 和本局 `raid-loot`，成功时一次性写入仓库、图鉴和满足条件的章节，再清除活动局并记录结算结果。
  - 已实现逻辑：6件容量限制；拾取、移除/丢弃；恢复物使用；装备引用的基础接口；普通/稀有/史诗/传说价值计算；带入物和非当前对局物品不计价值；实例去重和冲突拒绝；成功入库、失败损失；刷新/重开后的活动局中断记录；重复结算幂等；存档损坏/未知版本拒绝；存储写失败时不提前替换内存；v1/v2 到正式 schema 3 的导入或迁移；主入口使用 `PersistentSave(localStorage)`，并在启动时调用 `recoverInterrupted()`。
  - 本轮需要补齐或确认的逻辑：依据冻结的 R03/R06 核对并补齐所有验收证据；确认库存的丢弃、恢复物消耗和满包路径在正式 UI/控制器链路中都保持价值即时重算；确认带入物在开始、丢弃后拾回、失败、成功和重复提交场景中的实例身份与损失/保留规则；补充当前测试未覆盖或覆盖不足的边界，并在设计文档中明确 localStorage JSON 的字段、约束和保存时机。本项不预设必须重写已有逻辑。
  - 第二阶段后续计划：二维网格、物品宽高和旋转、装备槽交换/正式布局持久化、商店、钱包、交易、升级、联机资产事务、IndexedDB 或服务端资产事务、SQL 数据库。本阶段只记录，不实现。
  - 阅读发现的潜在风险或需求冲突：`inventory-model.ts` 已定义 `itemsByInstanceId` 与 `placementByInstanceId` 及校验错误类型，但文件明确说明该模型尚未接入 `ReferenceInventory`；当前运行时库存仍是数组和内存装备 Map。`ReferenceSave` schema 1 与 `PersistentSave` 的正式校验规则不完全一致，例如旧适配器对 `obtainedInRaidId` 只检查字符串类型，而正式校验还要求非空。正式存档的 `warehouse`、`lastResult` 和活动局清单需要在 Step 4 明确来源和互斥关系，避免把逻辑模型误写成已接入 SQL 表。`main.ts` 当前 UI 已提供恢复物“使用”、丢弃、带入选择、导出 v3 JSON 和保存失败重试，但 `InventoryPort` 公共接口本身没有声明装备或恢复物方法，调用方依赖具体的 `ReferenceInventory` 类型。
  - `package.json` scripts：`format:check`、`lint`、`typecheck`、`test:unit`、`build`，以及串联全部检查的 `check`；本 Step 未修改代码，也未删除测试。
- 风险：当前“已实现”与“本轮需要补齐”必须以实际调用链和验收测试为准，不能仅凭接口或设计文件宣称完成；`inventory-model.ts` 接入、二维网格和SQL/IndexedDB均不属于本轮实现。
- 下一步：执行 Step 4，依据本 Step 的事实整理 `docs/b-data-design.md`，明确当前 localStorage JSON 物理结构、逻辑实体、约束、保存时机和后续范围。

### Step 4 写 docs/b-data-design.md

- [x] 状态：已完成
- 目标：形成与当前代码一致的B模块数据模型和localStorage JSON持久化设计。
- 操作：读取 Step 3 记录；新增 `docs/b-data-design.md`，整理 ItemDefinition、ItemInstance、warehouse、activeRaid、settledRaidIds、lastResult、codexIds、unlockedChapterIds、版本和保存键、唯一性约束、成功/失败/中断/重复结算流程，并区分当前已实现、本轮需要补齐和后续计划。
- 涉及文件：`docs/b-data-design.md`；`docs/b-agent-task-plan.md`
- 执行命令：读取 `docs/b-agent-task-plan.md`；使用补丁新增和更新 Markdown 文档。
- 结果：已完成数据设计文档。文档明确当前使用 `localStorage` JSON 而非 SQL 数据库，记录了 B 对 ER 图、字段表、F2 背包/价值设计和 F6 存档/恢复设计的责任；未修改业务代码、公共接口或存档 schema，未实现第二阶段功能。
- 风险：当前 schema 3 已能表达 R03/R06，本轮不提前升 schema；`InventoryPort` 未声明具体库存扩展方法，Step 5 需先确认是否有必要扩展；`inventory-model.ts` 仍是未接入的逻辑模型，不能误写成已实现二维网格。
- 下一步：暂停并等待确认后再执行 Step 5；Step 5 仅根据本设计和确认后的缺口修改 V1.0 代码。

### Step 5 补齐 V1.0 代码

- [x] 状态：已完成
- 目标：完成R03、R06要求的库存、价值和存档行为。
- 操作：先确认 `docs/b-data-design.md` 存在且 Step 4 已完成；阅读库存、价值、存档和控制器实现及现有测试；仅收紧旧 `ReferenceSave` 对 `raid-loot.obtainedInRaidId` 的非空校验，并增加对应回归测试；未修改公共接口、存档 schema 或架构。
- 涉及文件：`src/modules/save/reference-save.ts`；`tests/integration/save-flow.test.ts`；`docs/b-data-design.md`（仅按 Prettier 格式化）；`docs/b-agent-task-plan.md`
- 执行命令：定向测试 `npm.cmd run test:unit -- tests/unit/inventory.test.ts tests/integration/persistent-save.test.ts tests/integration/save-flow.test.ts`；完整检查 `npm.cmd run check`；文档格式化 `npm.cmd exec prettier -- --write docs/b-data-design.md`
- 结果：
  - 满包不能吞物：现有 `ReferenceInventory.addLoot()` 在容量达到6时返回 `INVENTORY_FULL`，定向测试覆盖，未需业务修改。
  - 丢弃后价值立即减少：现有 `remove()` 触发 `InventoryChanged`，控制器重新从当前携带实例计算价值；现有丢弃/价值集成路径通过，未需业务修改。
  - 消耗后价值立即减少：现有 `consumeHealing()` 仅在效果确认成功后移除实例并触发库存变化；现有单元测试通过，未需业务修改。
  - 丢弃再拾回不重复加分：实例 ID和来源保留，价值计算按 `instanceId` 去重；现有单元测试通过，未需业务修改。
  - 带入物不计本局价值：价值计算只计当前对局的 `raid-loot`，`carry-in` 被排除；现有边界测试通过，未需业务修改。
  - 同一 `instanceId` 不同时存在两份：库存拾取、正式存档校验、结算校验都拒绝重复实例；现有单元和集成测试通过，未需业务修改。
  - 成功结算只入库一次：`PersistentSave`/`ReferenceSave` 对已结算 `raidId` 幂等返回，并检查仓库实例冲突；现有重复结算测试通过，未需业务修改。
  - 失败结算不写入本局物品：失败结果必须为空物品列表，活动局清除但仓库不增加本局物品；现有正式和参考存档测试通过，未需业务修改。
  - 刷新后活动局按中断失败：`recoverInterrupted()` 写入 `interrupted` 失败、清除活动局且不猜测返还带入物；现有集成测试通过，未需业务修改。
  - 存档写入失败不提前显示成功：`commit()` 在 storage 写入成功后才替换内存，控制器保存失败停留在 `settling` 并支持重试；现有存储失败和控制器重试测试通过，未需业务修改。
  - 实际代码补齐：旧 `ReferenceSave.validItem()` 原先只检查 `obtainedInRaidId` 是字符串，现已要求非空字符串，与正式 schema 3 校验一致；新增空来源 ID 被拒绝的回归测试。
  - 定向测试结果：3 个测试文件、36 个测试全部通过。
  - 完整检查结果：Prettier、ESLint、TypeScript、32 个测试文件共256个测试和 Vite 生产构建全部通过。
- 风险：`inventory-model.ts` 仍未接入运行时库存，二维布局不属于本轮；`InventoryPort` 的具体装备/恢复物扩展未在本轮修改；正式 schema 3 和旧参考 schema 1 仍是两个适配器格式，但来源校验已对齐非空要求；本轮未引入 SQL、IndexedDB、商店、钱包、交易、升级或联机资产事务。
- 下一步：暂停并等待确认后执行 Step 6；Step 6 只补充或整理测试证据，不删除已有测试。

### Step 6 补充测试

- [x] 状态：已完成
- 目标：验证V1.0正常路径、异常路径和边界规则。
- 操作：先读取本计划和 `docs/b-data-design.md`，检查现有测试覆盖；新增 99 价值拒绝撤离测试和重复拾取不重复计分测试；保留已有的 100、110→85、带入150不计分、满包搜索、成功/失败结算、刷新中断、损坏存档和迁移失败保护测试；每组新增测试后运行对应命令，再运行重点组合测试和完整检查。
- 涉及文件：`tests/unit/raid-controller.test.ts`；`tests/unit/inventory.test.ts`；`tests/integration/persistent-save.test.ts`；`tests/integration/save-flow.test.ts`；`docs/b-agent-task-plan.md`
- 执行命令与结果：
  - `npm.cmd run test:unit -- tests/unit/raid-controller.test.ts`：通过，1 个文件、15 个测试。
  - `npm.cmd run test:unit -- tests/unit/inventory.test.ts`：通过，1 个文件、13 个测试。
  - `npm.cmd run test:unit -- tests/unit/inventory.test.ts tests/unit/raid-controller.test.ts tests/integration/persistent-save.test.ts tests/integration/save-flow.test.ts`：通过，4 个文件、52 个测试。
  - `npm.cmd run check`：通过；Prettier、ESLint、TypeScript、32 个测试文件共 258 个测试和 Vite 构建全部成功。
- 结果：已补充并确认 V1.0 重点边界；新增测试只验证现有 R03/R06 规则，没有实现新功能或第二阶段能力。
- 风险：当前测试验证的是现有 `localStorage` 适配器和单机库存链路；`inventory-model.ts` 的二维布局模型、SQL/IndexedDB、商店、钱包、交易、升级和联机资产事务仍不属于本轮测试范围。
- 下一步：执行 Step 7，整理验收证据、最终报告和已知限制。

### Step 7 验收与最终报告

- [x] 状态：已完成
- 目标：确认代码、测试、数据设计和R03/R06验收证据一致。
- 操作：执行 `git status`；阅读 `package.json` scripts；运行完整 `npm.cmd run check` 和独立 `npm.cmd run test:unit`；按 R03/R06 验收清单核对库存、价值、结算、恢复、存档和范围边界；确认设计文档与任务计划已更新。
- 涉及文件：`docs/b-agent-task-plan.md`；`docs/b-data-design.md`；B模块代码；库存和存档测试文件；`package.json`
- 执行命令与结果：
  - `git status --short --branch`：当前为 `feature/b-inventory-save`；工作区包含本轮文档、存档校验和测试改动，未发现未记录的业务范围外修改。
  - `npm.cmd run check`：首次在受限执行环境中因 Vitest 写入 `node_modules/.vite-temp` 返回 `EPERM`，格式检查、Lint 和类型检查均已先通过；使用允许临时文件写入的执行权限重试后通过，Prettier、ESLint、TypeScript、32 个测试文件共 258 个测试和 Vite 生产构建全部成功。
  - `npm.cmd run test:unit`：通过（使用相同执行权限）；32 个测试文件共 258 个测试全部成功。
- 验收清单：
  - [x] 6 格背包逻辑符合本轮范围。
  - [x] 拾取、丢弃、使用逻辑正确。
  - [x] 普通/稀有/史诗/传说价值计算正确。
  - [x] 带入物不计本局价值。
  - [x] 成功结算只入库一次。
  - [x] 失败结算不写入仓库。
  - [x] 刷新中断记录为 `interrupted`。
  - [x] 重复结算不重复增加物品。
  - [x] 满包不吞物品。
  - [x] 同一 `instanceId` 不重复存在。
  - [x] `localStorage` JSON 存档正常。
  - [x] 损坏存档拒绝加载。
  - [x] 迁移失败保留原存档。
  - [x] 未实现本轮明确排除的第二阶段功能。
  - [x] 未创建 SQL 数据库。
  - [x] `docs/b-data-design.md` 已更新并通过格式检查。
  - [x] `docs/b-agent-task-plan.md` 已完整记录 Step 1 至 Step 7。
- 结果：V1.0 R03/R06 验收通过；本轮没有新增第二阶段功能，没有创建 SQL 数据库，没有修改公共接口或存档 schema。
- 风险：二维布局模型仍未接入运行时库存；第二阶段功能和关系数据库方案尚未实现；当前结论基于自动化测试和静态代码/文档核对，不替代真实浏览器试玩与课程验收。受限执行环境可能无法让 Vitest 写入 `node_modules/.vite-temp`，验收时需保留可写临时目录的运行条件。
- 下一步：执行 Step 8，仅记录第二阶段规划和依赖，不实现第二阶段功能。

### Step 8 第二阶段规划记录 不实现

- [x] 状态：已完成
- 目标：记录需组长确认的第二阶段候选范围、跨层改动要求和实施边界。
- 操作：在本计划中增加第二阶段候选清单，明确二维网格、物品宽高和旋转、装备槽交换、钱包、出售/购买/升级、`transactionId` 与交易记录、IndexedDB 或服务端资产事务，以及未来数据库方案的单独 schema/迁移/事务设计；同步说明这些能力需要类型、存档、UI、测试和接口协同修改。
- 涉及文件：`docs/b-agent-task-plan.md`
- 执行命令：读取本计划并更新 Markdown 文档；未修改 `src/`，未创建数据库。
- 结果：第二阶段候选范围已记录，明确须组长确认后实施；本轮 V1.0 保持不变，未实现任何候选功能。
- 风险：候选功能可能引入存档版本迁移、资产一致性和接口兼容风险，实施前需完成单独设计、评审和验收标准；不能以新增数据库文件替代跨层改造。
- 下一步：等待组长确认第二阶段优先级和技术方案后，另行建立实施任务。
