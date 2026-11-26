CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_saves (
    user_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    data TEXT CHECK(data IS NULL OR json_valid(data)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
    updated_at TEXT NOT NULL,
    lease_token TEXT,
    lease_session TEXT,
    lease_client TEXT,
    lease_expires_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS legacy_imports (
    source TEXT PRIMARY KEY,
    imported_at TEXT NOT NULL
);

-- R15 好友与聊天：一对账号只保留一条关系，pair_key 为双方 UID 排序后拼接。
-- status：pending（待接受）/ accepted（已是好友）/ rejected（被拒绝，可再次申请）。
CREATE TABLE IF NOT EXISTS friend_relations (
    pair_key TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    addressee_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
    request_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (requester_id <> addressee_id)
);

CREATE INDEX IF NOT EXISTS friend_relations_requester ON friend_relations(requester_id, status);
CREATE INDEX IF NOT EXISTS friend_relations_addressee ON friend_relations(addressee_id, status);

-- 屏蔽优先于好友关系：任一方屏蔽后，新申请、邀请与私聊立即停止。
CREATE TABLE IF NOT EXISTS friend_blocks (
    blocker_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

-- 私聊消息：message_id 由客户端生成，用于「同 ID 同载荷返回原消息」的幂等重试。
CREATE TABLE IF NOT EXISTS friend_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    pair_key TEXT NOT NULL,
    sender_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (length(body) > 0),
    created_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS friend_messages_pair ON friend_messages(pair_key, id);
CREATE INDEX IF NOT EXISTS friend_messages_recipient ON friend_messages(recipient_id, id);
CREATE INDEX IF NOT EXISTS friend_messages_rate ON friend_messages(sender_id, created_ms);

-- 已读游标单调递增，未读数由服务端按游标计算，不接受客户端自报。
CREATE TABLE IF NOT EXISTS friend_reads (
    pair_key TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (pair_key, user_id)
);

-- R16 排行榜成绩只在已认证账号的新结算云存档事务中追加一次，不可更新。
CREATE TABLE IF NOT EXISTS raid_results (
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    raid_id TEXT NOT NULL,
    settled_at_ms INTEGER NOT NULL CHECK (settled_at_ms >= 0),
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failed')),
    value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY (user_id, raid_id)
);

CREATE INDEX IF NOT EXISTS raid_results_window ON raid_results(outcome, settled_at_ms, user_id);
CREATE TRIGGER IF NOT EXISTS raid_results_immutable
BEFORE UPDATE ON raid_results
BEGIN
    SELECT RAISE(ABORT, 'raid result records are immutable');
END;

-- 快照在创建后固定窗口、昵称和聚合分数。好友资格在读取每一页时重新校验。
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('friends', 'global')),
    window_start_ms INTEGER NOT NULL,
    window_end_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > updated_at_ms)
);

CREATE INDEX IF NOT EXISTS leaderboard_snapshots_expiry ON leaderboard_snapshots(expires_at_ms);

CREATE TABLE IF NOT EXISTS leaderboard_snapshot_entries (
    snapshot_id TEXT NOT NULL REFERENCES leaderboard_snapshots(snapshot_id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    total_value INTEGER NOT NULL CHECK (total_value >= 0),
    best_value INTEGER NOT NULL CHECK (best_value >= 0),
    successful_raids INTEGER NOT NULL CHECK (successful_raids > 0),
    ordinal INTEGER NOT NULL CHECK (ordinal > 0),
    rank INTEGER NOT NULL CHECK (rank > 0),
    PRIMARY KEY (snapshot_id, player_id),
    UNIQUE (snapshot_id, ordinal)
);

CREATE INDEX IF NOT EXISTS leaderboard_snapshot_page ON leaderboard_snapshot_entries(snapshot_id, ordinal);

-- 游标使用随机不透明令牌；排序尾键保留在服务端，避免把内部账号 ID 编码到 URL。
CREATE TABLE IF NOT EXISTS leaderboard_cursors (
    cursor_id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL REFERENCES leaderboard_snapshots(snapshot_id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('friends', 'global')),
    after_ordinal INTEGER NOT NULL CHECK (after_ordinal > 0),
    after_player_id TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS leaderboard_cursors_expiry ON leaderboard_cursors(expires_at_ms);

CREATE TABLE IF NOT EXISTS raid_history (
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    raid_id TEXT NOT NULL,
    result TEXT NOT NULL CHECK(json_valid(result)),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY(user_id, raid_id)
);

CREATE TABLE IF NOT EXISTS profile_preferences (
    user_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    public_collections INTEGER NOT NULL DEFAULT 0 CHECK(public_collections IN (0, 1))
);

CREATE TABLE IF NOT EXISTS friendships (
    user_low TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_high TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    requester_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_low, user_high),
    CHECK(user_low < user_high)
);

CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(blocker_id, blocked_id),
    CHECK(blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS direct_messages (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    sender_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(sender_id, message_id)
);

CREATE INDEX IF NOT EXISTS direct_messages_pair_sequence
    ON direct_messages(sender_id, recipient_id, sequence);

CREATE TABLE IF NOT EXISTS message_reads (
    reader_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    partner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    last_read_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_read_sequence >= 0),
    PRIMARY KEY(reader_id, partner_id),
    CHECK(reader_id <> partner_id)
);

PRAGMA user_version=3;
