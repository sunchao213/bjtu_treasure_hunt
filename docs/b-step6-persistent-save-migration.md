# B 第六步正式存档事务与迁移

## 已实现

- 新增正式存档适配器 `src/modules/save/persistent-save.ts`，实现 `SavePort`。
- 正式存档使用独立 key `bjtu-treasure-hunt:save:v2`，schemaVersion 为 `2`；现有参考 key `bjtu-treasure-hunt:a-framework:v1` 保留不动。
- `importReference()` 是显式 v1 -> v2 导入：只有参考存档通过严格校验后才写正式 key，导入成功不删除、不覆盖参考 key；正式存档已存在时拒绝重复导入。
- `importRaw()` 只接受当前正式 schema；JSON 损坏、未知版本、字段/实例/对局状态不合法时先拒绝，不改当前正式内存或存储。
- 所有提交采用“先构造/校验完整 next 对象 -> 写 storage -> 写入成功后替换内存”的顺序。写入失败时内存、正式存储和活动局状态保持原样。
- `beginRaid()` 原子完成带入物扣除与 `activeRaid` 建立；缺少物品、重复 ID、重复 raid、并行活动局和容量超限都会在写入前拒绝。
- `finalizeRaid()` 原子完成成功物品入仓、图鉴更新、清除活动局、记录已结算 raid 和保存结果；失败不把本局物品入仓；同一 raid 重试幂等。
- `recoverInterrupted()` 将已持久化活动局转为一次中断失败提交；写失败不会部分修改。
- `exportRaw()` 提供当前正式 JSON 备份文本；可以配合外部备份流程保存原始内容。

## 当前版本与边界

v2 当前字段与参考 v1 相同，故迁移只提升 schemaVersion 并重新验证所有不变量。没有猜测 D 的章节证据字段，也没有把装备栏写入正式 schema；装备跨局持久化需后续确认字段后再增加 v3 迁移。

正式 key 与参考 key 分离，避免把联调档静默覆盖为正式档。当前 `main.ts` 仍组装 `ReferenceSave`，这是第 7 步“替换接线”的内容；本步先完成正式实现和测试，不提前改变 A 的运行时接线。

## 事务不变量

- 存储写入抛错时，不更新 `this.data`。
- 成功写入前，不返回带入物，不进入 active，不显示结算成功。
- 成功结算结果中的物品必须是当前 raid 生成的 `raid-loot`，实例 ID 唯一；失败结果物品必须为空。
- formal save 中 `activeRaid` 不能同时出现在 `settledRaidIds`；已结算 raid 不能重新开始。
- 损坏/未来版本始终保留原始文本，恢复动作由显式导入/备份/重置调用者决定。

## 验证

新增 `tests/integration/persistent-save.test.ts` 与 `tests/unit/single-writer.test.ts`，覆盖 v1 导入、原 key 保留、重复导入拒绝、begin/finalize 写失败、幂等结算、损坏/未知版本导入保护、中断恢复、导出/重置和 Web Locks 不可用/竞争标签页。已执行 `npm.cmd run check`，格式、lint、类型检查、48 项测试和生产构建全部通过。
