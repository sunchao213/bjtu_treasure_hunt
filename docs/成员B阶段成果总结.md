# 成员 B 阶段成果总结

## 一、总结范围

本总结对应《成员B代码事项与实施步骤.md》中的第 1 至第 6 步，当前工作分支为：

```text
feature/b-inventory-save
```

本阶段重点围绕商品目录、库存模型、物品操作、撤离价值、存档事务和版本迁移展开。用户已经自行创建并切换到分支，因此没有重复创建分支，也没有修改或覆盖其他分支。

## 二、已完成的代码成果

### 1. 代码与产品差异盘点

- 对共享类型、配置、库存、撤离控制器、存档和组装入口进行了盘点。
- 明确 `SavePort`、`InventoryPort`、`RaidResult`、`ItemInstance` 和 `ItemOrigin` 的边界。
- 保持现有公共 `itemId`、`instanceId`、`raidId` 和来源类型兼容。
- 明确 B 不复制 A 的撤离状态机，不在库存层自行决定撤离成功，不猜测 D 的章节条件字段。
- 明确当前项目仍使用 Phaser、TypeScript 和浏览器 `localStorage`，没有引入 SQL、服务器端数据库或额外依赖。

对应文档：

- `docs/b-step1-gap-analysis.md`

### 2. 库存数据模型与不变量

- 保持 `ItemDefinition`、`ItemInstance`、`ItemOrigin` 等共享类型的一致性。
- 增加库存实例去重、来源校验、容量检查和快照复制规则。
- 区分 `carry-in` 与 `raid-loot` 两种物品来源。
- 防止同一 `instanceId` 在仓库、背包和结算结果中重复引用。
- 对不可信的外部 JSON 使用 `unknown` 校验，不直接使用强制类型转换。

对应文档：

- `docs/b-step2-data-model.md`（如该文件在当前工作树中尚未出现，相关规则已经落实在库存、存档和测试代码中）

### 3. 商品目录与 ID 校验

- 在 `src/config/game-config.ts` 中整理产品设计对应的 12 个图鉴商品 ID。
- 为商品补充名称、稀有度和用途分类。
- 将治疗物品、武器和入场装备与 12 个图鉴商品区分开。
- 增加 `isKnownItemId`、`isCatalogItemId` 和 `assertKnownItemId` 校验入口。
- 对重复目录 ID 和未知商品 ID fail closed。
- 保持训练棍等装备不被误计入图鉴商品目录。

主要文件：

- `src/config/game-config.ts`
- `tests/unit/game-config.test.ts`

### 4. 库存、装备、消耗和治疗入口

- 增加更明确的库存数据模型和操作边界。
- 支持拾取、移除、丢弃、容量校验和库存快照。
- 增加消耗品和治疗入口，并区分物品不可使用、重复装备、装备栏占用和背包已满等错误。
- 对搜索失败、满包和无效物品路径保留可重试状态。
- 不在库存层复制 A 的读条、受伤、超时和撤离裁决逻辑。

主要文件：

- `src/modules/inventory/inventory-model.ts`
- `src/modules/inventory/reference-inventory.ts`
- `src/modules/inventory/extraction-value.ts`
- `src/shared/types/game.ts`

### 5. 价值函数与撤离联调

- 固化四档价值规则：common 10、uncommon 25、epic 60、legendary 150。
- 固化撤离门槛为 100。
- 保持价值计算为纯函数。
- 覆盖 95 不达标、100 恰好达标、110 达标、带入物价值不计入本局、85 不达标等边界。
- 处理实例 ID 去重、旧 raid 来源、未知 ID、丢弃后价值下降和重新拾回后的价值恢复。
- 由 `RaidController` 继续作为撤离状态机和最终裁决者。
- 库存变化通过既有事件和控制器视图影响 UI，不额外创建第二套撤离成功事件或分值写入路径。

主要文件：

- `src/modules/inventory/extraction-value.ts`
- `src/modules/raid/raid-controller.ts`
- `tests/unit/raid-controller.test.ts`
- `tests/unit/inventory.test.ts`

### 6. 正式存档事务与迁移

新增正式存档适配器：

- `src/modules/save/persistent-save.ts`

正式存档设计：

```text
正式 key：bjtu-treasure-hunt:save:v2
schemaVersion：2
参考 key：bjtu-treasure-hunt:a-framework:v1
```

已实现：

- 正式存档和参考存档使用独立 key。
- `importReference()` 只允许显式执行 v1 参考档到 v2 正式档的迁移。
- 导入成功后不删除、不覆盖旧参考存档。
- 已存在正式存档时拒绝重复导入参考存档。
- `importRaw()` 只接受合法正式 v2 数据。
- 损坏 JSON、未知版本、非法字段、重复实例 ID 和不变量冲突均拒绝导入。
- 构造完整 next 对象并验证后，先写入 storage，成功后才替换内存状态。
- storage 写入失败时，内存、正式存储和活动局状态均不推进。
- `beginRaid()` 原子完成带入物扣除和 `activeRaid` 建立。
- `finalizeRaid()` 支持成功/失败结算和相同 `raidId` 幂等重试。
- 成功结算只接收当前 raid 产生的 `raid-loot`；失败结算不把本局物品入仓。
- `recoverInterrupted()` 支持活动局中断恢复。
- `exportRaw()` 提供正式存档 JSON 导出文本。
- `reset()` 通过正式提交入口重置正式存档。
- 未将装备栏写入正式 schema，避免猜测尚未确认的装备持久化字段。
- 章节解锁字段保留，但没有把拾取手记或其他物品直接等同于章节解锁；D 的任务证据契约确定后再接入。

主要测试：

- `tests/integration/persistent-save.test.ts`
- `tests/unit/single-writer.test.ts`

## 三、存档事务不变量

- 存储写入失败时不更新内存。
- begin 写入成功前不返回带入物，不建立活动局。
- finalize 写入成功前不清除活动局，不记录成功结算，不发放物品。
- 成功结果中的物品实例 ID 必须唯一，并且来源属于当前 `raidId`。
- 失败结果不能携带结算物品。
- `activeRaid` 不能同时出现在 `settledRaidIds` 中。
- 已结算的 `raidId` 不允许重新开局。
- 损坏档或未来 schema 不自动清空、不静默覆盖原始数据。
- 参考存档导入必须显式执行，并且保留原始参考 key。
- Web Locks 不可用或已有其他标签页持有锁时 fail closed。

## 四、测试与构建结果

已执行：

```powershell
npm.cmd run check
git diff --check
```

结果：

- Prettier 格式检查通过。
- ESLint 检查通过。
- TypeScript 类型检查通过。
- 8 个测试文件通过。
- 48 项测试全部通过。
- Vite 生产构建通过。
- `git diff --check` 通过。

新增或重点覆盖的测试包括：

- 商品目录和未知 ID 校验。
- 库存容量、实例去重和物品操作。
- 价值函数和撤离边界。
- v1 参考存档导入。
- 参考 key 保留和重复导入拒绝。
- begin/finalize 写入失败保护。
- 成功与失败结算。
- 相同 `raidId` 的幂等 finalize。
- 中断恢复。
- 损坏 JSON 和未知 schema 保护。
- 正式存档导出与重置。
- Web Locks 不可用和竞争标签页处理。

## 五、当前明确未完成的内容

第 7 步之前，`src/main.ts` 仍然组装：

- `ReferenceInventory`
- `ReferenceSave`

这是有意保留的边界，避免在正式适配器尚未完成 A/D 联调前改变运行时接线。后续第 7 步需要由 A 协调：

1. 在 `main.ts` 中接入正式库存和正式存档适配器。
2. 与 C 接通真实敌人掉落和唯一实例入口。
3. 与 D 接通经过验证的任务证据、图鉴和章节结果。
4. 联调刷新中断、主动放弃、死亡、超时、治疗消耗、带入物损失、仓库留存和多标签页保护。
5. 完成跨模块手工验收并同步接口、schema、事件和 ID 变更。

## 六、当前工作区状态说明

本阶段修改仍保留在当前分支工作区中，未执行提交、合并或创建 PR。已有修改同时包含前置第 1–5 步的实现、测试和文档，以及第 6 步的正式存档实现、测试和文档。

本阶段没有：

- 修改现有商品 ID。
- 删除或覆盖参考存档 key。
- 引入 SQL、服务器端数据库或额外依赖。
- 将 D 未确认的章节证据字段写入正式 schema。
- 提前把正式存档接入 `main.ts`。
