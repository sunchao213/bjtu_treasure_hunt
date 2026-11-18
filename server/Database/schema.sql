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

PRAGMA user_version=1;
