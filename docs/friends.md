# 好友与私聊（R15）

本文件说明大厅「行动中心 → 好友」模块的实现口径：数据表、接口、规则与验证方式。
排行（R16）与官方邮件（R17）不在本模块范围内。

## 1 范围与入口

- 需求：R15（好友与聊天），详细设计 D10.1。
- 入口：大厅左侧导航「行动中心 → 好友」。面板与仓库、商店互斥，切页时按需拉取名册。
- 门槛：只要求已登录在线档。三章剧情未通关也可使用（需求 8.1）。

## 2 数据表（`server/Database/schema.sql`，`user_version=2`）

| 表                 | 用途             | 关键约束                                                                                                   |
| ------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `friend_relations` | 一对账号一条关系 | `pair_key` 主键（双方 UID 排序拼接）；`status ∈ pending/accepted/rejected`；`requester_id <> addressee_id` |
| `friend_blocks`    | 屏蔽             | 主键 `(blocker_id, blocked_id)`，双向查询                                                                  |
| `friend_messages`  | 私聊消息         | `message_id` 唯一（幂等）；`id` 自增作为会话游标；索引 `(pair_key, id)`、`(sender_id, created_ms)`         |
| `friend_reads`     | 已读游标         | 主键 `(pair_key, user_id)`；`last_seq` 只增不减                                                            |

## 3 接口（全部要求会话 Cookie）

| 方法 | 路径                                | 请求                         | 说明                                                              |
| ---- | ----------------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| GET  | `/api/social/roster`                | —                            | 好友、收到/发出的申请、屏蔽名单、按会话计算未读                   |
| GET  | `/api/social/lookup?uid=`           | —                            | 申请前确认昵称                                                    |
| POST | `/api/social/apply`                 | `{targetUid, requestId}`     | 申请；同一对已 pending 时幂等返回，双方同时申请合并为同一 pending |
| POST | `/api/social/respond`               | `{peerUid, action}`          | 仅收件人可 `accept`/`reject`                                      |
| POST | `/api/social/remove`                | `{peerUid}`                  | 删除关系，保留双方历史消息                                        |
| POST | `/api/social/block`                 | `{peerUid, blocked}`         | 屏蔽/取消屏蔽；屏蔽同时作废未处理申请                             |
| GET  | `/api/social/messages?peer=&after=` | —                            | 按会话游标拉取（每次 ≤50 条），拉取即推进本人已读游标             |
| POST | `/api/social/messages`              | `{peerUid, text, messageId}` | 发送；1—200 字符、每 10 秒 ≤5 条                                  |
| POST | `/api/social/read`                  | `{peerUid, cursor}`          | 手动推进已读游标（单调递增）                                      |

错误一律返回 `{ "message": "中文说明" }`，状态码语义：400 参数非法、401 未登录、403 无权限/屏蔽/非好友、404 目标不存在、409 同 ID 异载荷、429 发送过快。

## 4 规则要点

1. **关系双向唯一**：任何方向只存一行，`requester/addressee` 表示谁是申请人。
2. **申请幂等**：重复提交同一对不新增记录；被拒绝后允许重新申请（复用同一行、申请方改为当前用户）。
3. **接受权限**：只有 `addressee` 能处理；已处理过返回 409。
4. **屏蔽优先**：任一方屏蔽后，申请、邀请与私聊全部 403；屏蔽同时把 pending 关系置为 rejected。
5. **消息校验**：按 Unicode 码点计 1—200；统一换行、拒绝 NUL；空白消息拒绝；客户端与服务端同一口径。
6. **幂等与限流**：`message_id` 唯一，同载荷返回原消息（`status=duplicate`），异载荷 409；发送方 10 秒窗口内第 6 条 429。
7. **未读与已读**：未读数由服务端用 `friend_reads.last_seq` 与消息 `id` 计算，不接受客户端自报；游标只增不减。
8. **禁用 HTML**：消息与昵称一律以纯文本渲染（客户端全部走 `textContent`）。

## 5 客户端

- `src/modules/social/social-client.ts`：接口封装 + 纯函数（`validateMessage`、`countCharacters`、`createMessageId`、本地节流）。
- `src/modules/ui/friends-panel.ts`：面板渲染与交互；切到「好友」页签时刷新，可见期间每 6 秒轮询未读。
- `src/friends.css`：沿用大厅配色（深底、细描边、小圆角，金色仅用于未读与主操作）。

## 6 验证

```powershell
# 服务端：自带临时库与随机端口，覆盖 21 项规则
npm.cmd run test:friends

# 客户端纯函数与接口封装
npx vitest run tests/unit/social-client.test.ts
```

## 7 已知限制

1. **未接 WebSocket 实时推送**：详细设计要求「WebSocket 仅推送已保存消息」，当前实现改用 6 秒轮询 + 游标拉取，离线补拉行为一致，但实时性为秒级。后续可在 `/ws` 增加按 UID 的消息投递。
2. **好友榜**（R16）未实现，属排行榜模块。
3. **入站申请提醒**只在打开面板与轮询时更新，导航角标不主动弹窗。
