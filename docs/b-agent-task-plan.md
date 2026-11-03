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

- [ ] 状态：未开始
- 目标：完成R03、R06要求的库存、价值和存档行为。
- 操作：补齐满包、拾取、丢弃、使用、带入物排除、实例去重、成功入库、失败损失、刷新中断和重复结算幂等；保持localStorage JSON方案。
- 涉及文件：`src/modules/inventory/`；`src/modules/save/`；必要时更新共享类型和配置
- 执行命令：待确定。
- 结果：待执行。
- 风险：不能在本步骤引入二维网格、商店、钱包、交易、升级、联机事务或SQL数据库。
- 下一步：代码完成后进入 Step 6。

### Step 6 补充测试

- [ ] 状态：未开始
- 目标：验证V1.0正常路径、异常路径和边界规则。
- 操作：补充价值门槛、满包、重复拾取、带入物、成功结算、失败结算、刷新恢复、损坏存档和重复提交测试。
- 涉及文件：`tests/unit/`；`tests/integration/`
- 执行命令：`npm.cmd run check`
- 结果：待执行。
- 风险：测试必须反映冻结规则，不能用测试替换未确认的第二阶段需求。
- 下一步：测试通过后进入 Step 7。

### Step 7 验收与最终报告

- [ ] 状态：未开始
- 目标：确认代码、测试、数据设计和R03/R06验收证据一致。
- 操作：执行完整检查，核对文档与代码版本，整理正常路径、异常路径、已知限制和提交记录。
- 涉及文件：`b-agent-task-plan.md`；`docs/b-data-design.md`；B模块代码；测试结果和验收记录
- 执行命令：`npm.cmd run check`
- 结果：待执行。
- 风险：不得把设计完成写成代码已实现，不得遗漏失败和恢复证据。
- 下一步：完成V1.0报告后进入 Step 8。

### Step 8 第二阶段规划记录 不实现

- [ ] 状态：未开始
- 目标：记录二维网格、装备、商店经济、联机资产和其他后续事项的依赖与范围。
- 操作：只记录目标、前置接口、风险和待确认事项，不修改代码，不创建数据库，不实现功能。
- 涉及文件：任务计划或后续规划文档
- 执行命令：无
- 结果：待执行。
- 风险：第二阶段规划不得反向扩大已冻结的V1.0范围。
- 下一步：等待团队确认后另行立项。
