using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

sealed record FriendReply(int Status, object Body);

/// <summary>
/// R15 好友与私聊（详细设计 D10.1）。
///
/// 规则要点：
///   · 好友关系双向唯一：一对账号只存一条记录，pair_key 为双方 UID 排序后拼接；
///   · 申请幂等：同一对已存在 pending 时不新增，双方同时申请合并为同一 pending，不自动成为好友；
///   · 接受仅目标用户可调用；拒绝改为 rejected；删除结束关系但保留历史消息；
///   · 屏蔽优先于好友状态：任一方屏蔽后，新申请、邀请与私聊立即停止；
///   · 私聊 1—200 字符、每 10 秒最多 5 条；重复 messageId 同载荷返回原消息、异载荷冲突；
///   · 已读游标单调递增，未读数由服务端按游标计算，不接受客户端自报。
/// </summary>
sealed partial class FriendStore(GameDatabase database)
{
    public const int MaxMessageLength = 200;
    public const int RateWindowMs = 10_000;
    public const int RateLimit = 5;
    private const int MaxPageSize = 50;

    [GeneratedRegex("^[a-f0-9]{32}$")]
    private static partial Regex UidPattern();

    [GeneratedRegex("^[A-Za-z0-9-]{8,64}$")]
    private static partial Regex MessageIdPattern();

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static string NowIso() => DateTimeOffset.UtcNow.ToString("O");

    private static string PairKey(string first, string second) =>
        string.CompareOrdinal(first, second) <= 0 ? $"{first}:{second}" : $"{second}:{first}";

    private static FriendReply Error(int status, string message) => new(status, new { message });

    // ── 名册：好友、待处理申请、已发出申请、屏蔽名单与未读数 ─────────────────
    public object Roster(AccountUser user)
    {
        using var connection = database.Open();
        var accepted = new List<(string PeerId, string PeerName, string PairKey)>();
        var incoming = new List<object>();
        var outgoing = new List<object>();

        using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                SELECT r.pair_key, r.requester_id, r.addressee_id, r.status,
                       r.updated_at, a.display_name, b.display_name
                FROM friend_relations r
                JOIN accounts a ON a.id = r.requester_id
                JOIN accounts b ON b.id = r.addressee_id
                WHERE r.requester_id=$me OR r.addressee_id=$me
                ORDER BY r.updated_at DESC;
                """;
            command.Parameters.AddWithValue("$me", user.Id);
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                var pairKey = reader.GetString(0);
                var requesterId = reader.GetString(1);
                var addresseeId = reader.GetString(2);
                var status = reader.GetString(3);
                var updatedAt = reader.GetString(4);
                var peerId = requesterId == user.Id ? addresseeId : requesterId;
                var peerName = requesterId == user.Id ? reader.GetString(6) : reader.GetString(5);
                switch (status)
                {
                    case "accepted":
                        accepted.Add((peerId, peerName, pairKey));
                        break;
                    case "pending" when addresseeId == user.Id:
                        incoming.Add(new { uid = peerId, displayName = peerName, updatedAt });
                        break;
                    case "pending":
                        outgoing.Add(new { uid = peerId, displayName = peerName, updatedAt });
                        break;
                }
            }
        }

        var unread = new Dictionary<string, long>(StringComparer.Ordinal);
        var lastMessage = new Dictionary<string, long>(StringComparer.Ordinal);
        using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                SELECT m.pair_key,
                       SUM(CASE WHEN m.recipient_id=$me AND m.id > COALESCE(fr.last_seq, 0) THEN 1 ELSE 0 END) AS unread,
                       MAX(m.created_ms) AS latest
                FROM friend_messages m
                LEFT JOIN friend_reads fr ON fr.pair_key = m.pair_key AND fr.user_id=$me
                GROUP BY m.pair_key;
                """;
            command.Parameters.AddWithValue("$me", user.Id);
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                var pairKey = reader.GetString(0);
                if (!reader.IsDBNull(1)) unread[pairKey] = reader.GetInt64(1);
                if (!reader.IsDBNull(2)) lastMessage[pairKey] = reader.GetInt64(2);
            }
        }

        var blocked = new List<object>();
        var blockedIds = new HashSet<string>(StringComparer.Ordinal);
        using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                SELECT b.blocked_id, a.display_name FROM friend_blocks b
                JOIN accounts a ON a.id = b.blocked_id WHERE b.blocker_id=$me ORDER BY b.created_at DESC;
                """;
            command.Parameters.AddWithValue("$me", user.Id);
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                blockedIds.Add(reader.GetString(0));
                blocked.Add(new { uid = reader.GetString(0), displayName = reader.GetString(1) });
            }
        }

        var friends = accepted
            .Select(friend => new
            {
                uid = friend.PeerId,
                displayName = friend.PeerName,
                unread = unread.GetValueOrDefault(friend.PairKey, 0),
                lastMessageMs = lastMessage.GetValueOrDefault(friend.PairKey, 0),
                blockedByMe = blockedIds.Contains(friend.PeerId),
            })
            .OrderByDescending(friend => friend.lastMessageMs)
            .ToArray();

        return new
        {
            self = new { uid = user.Id, displayName = user.DisplayName },
            friends,
            incoming = incoming.ToArray(),
            outgoing = outgoing.ToArray(),
            blocked = blocked.ToArray(),
        };
    }

    // ── 申请 / 处理 / 解除 / 屏蔽 ─────────────────────────────────────────
    /// <summary>按 UID 查昵称，供申请前确认对象。</summary>
    public FriendReply Lookup(string? uid)
    {
        if (uid is null || !UidPattern().IsMatch(uid)) return Error(400, "UID 需为 32 位十六进制。");
        var target = database.FindUserById(uid);
        return target is null
            ? Error(404, "该 UID 在本服务器没有对应账号。请确认对方与你在同一服务器注册（本地测试要用本地账号的 UID），且没有把列表里的短 UID 当成完整值。")
            : new(200, new { uid = target.Id, displayName = target.DisplayName });
    }

    public FriendReply Apply(AccountUser user, string? targetUid, string? requestId)
    {
        if (targetUid is null || !UidPattern().IsMatch(targetUid)) return Error(400, "UID 需为 32 位十六进制。");
        if (targetUid == user.Id) return Error(400, "不能添加自己为好友。");
        if (requestId is null || !MessageIdPattern().IsMatch(requestId)) return Error(400, "请求标识无效，请重试。");
        if (database.FindUserById(targetUid) is null) return Error(404, "该 UID 不存在，请核对后重试。");

        using var connection = database.Open();
        using var transaction = connection.BeginTransaction();
        if (IsBlocked(connection, user.Id, targetUid))
            return Error(403, "对方或你已屏蔽该用户，无法发送好友申请。");

        var pairKey = PairKey(user.Id, targetUid);
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT requester_id, addressee_id, status FROM friend_relations WHERE pair_key=$pair;";
        command.Parameters.AddWithValue("$pair", pairKey);
        string? requesterId = null;
        string? addresseeId = null;
        string? status = null;
        using (var reader = command.ExecuteReader())
        {
            if (reader.Read())
            {
                requesterId = reader.GetString(0);
                addresseeId = reader.GetString(1);
                status = reader.GetString(2);
            }
        }

        if (status == "accepted")
            return new(200, new { status, message = "你们已经是好友。" });
        if (status == "pending")
        {
            var incomingRequest = addresseeId == user.Id;
            return new(200, new
            {
                status,
                message = incomingRequest
                    ? "对方已向你发出申请，请在待处理中确认。"
                    : "申请已发送，等待对方处理。",
            });
        }

        var now = NowIso();
        if (status is null)
        {
            command.CommandText = """
                INSERT INTO friend_relations(pair_key, requester_id, addressee_id, status, request_id, created_at, updated_at)
                VALUES($pair, $me, $peer, 'pending', $request, $now, $now);
                """;
        }
        else
        {
            // 被拒绝后允许重新申请：复用同一对记录，申请方改为当前用户。
            command.CommandText = """
                UPDATE friend_relations SET requester_id=$me, addressee_id=$peer, status='pending',
                       request_id=$request, updated_at=$now WHERE pair_key=$pair;
                """;
        }
        command.Parameters.AddWithValue("$me", user.Id);
        command.Parameters.AddWithValue("$peer", targetUid);
        command.Parameters.AddWithValue("$request", requestId);
        command.Parameters.AddWithValue("$now", now);
        command.ExecuteNonQuery();
        transaction.Commit();
        return new(200, new { status = "pending", message = "申请已发送，等待对方处理。" });
    }

    public FriendReply Respond(AccountUser user, string? peerUid, string? action)
    {
        if (peerUid is null || !UidPattern().IsMatch(peerUid)) return Error(400, "UID 需为 32 位十六进制。");
        if (action is not ("accept" or "reject")) return Error(400, "请选择接受或拒绝。");

        using var connection = database.Open();
        using var transaction = connection.BeginTransaction();
        var pairKey = PairKey(user.Id, peerUid);
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT addressee_id, status FROM friend_relations WHERE pair_key=$pair;";
        command.Parameters.AddWithValue("$pair", pairKey);
        string? addresseeId = null;
        string? status = null;
        using (var reader = command.ExecuteReader())
        {
            if (reader.Read())
            {
                addresseeId = reader.GetString(0);
                status = reader.GetString(1);
            }
        }
        if (status is null) return Error(404, "没有待处理的好友申请。");
        if (addresseeId != user.Id) return Error(403, "只有收到申请的一方可以处理。");
        if (status != "pending") return Error(409, "该申请已处理，请刷新后重试。");

        command.CommandText = "UPDATE friend_relations SET status=$status, updated_at=$now WHERE pair_key=$pair;";
        command.Parameters.AddWithValue("$status", action == "accept" ? "accepted" : "rejected");
        command.Parameters.AddWithValue("$now", NowIso());
        command.ExecuteNonQuery();
        transaction.Commit();
        return new(200, new
        {
            status = action == "accept" ? "accepted" : "rejected",
            message = action == "accept" ? "已接受好友申请。" : "已拒绝该申请。",
        });
    }

    public FriendReply Remove(AccountUser user, string? peerUid)
    {
        if (peerUid is null || !UidPattern().IsMatch(peerUid)) return Error(400, "UID 需为 32 位十六进制。");
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM friend_relations WHERE pair_key=$pair AND (requester_id=$me OR addressee_id=$me);";
        command.Parameters.AddWithValue("$pair", PairKey(user.Id, peerUid));
        command.Parameters.AddWithValue("$me", user.Id);
        if (command.ExecuteNonQuery() == 0) return Error(404, "你们还不是好友。");
        return new(200, new { status = "removed", message = "已解除好友关系，历史消息仍保留在各自记录中。" });
    }

    public FriendReply SetBlocked(AccountUser user, string? peerUid, bool blocked)
    {
        if (peerUid is null || !UidPattern().IsMatch(peerUid)) return Error(400, "UID 需为 32 位十六进制。");
        if (peerUid == user.Id) return Error(400, "不能屏蔽自己。");
        using var connection = database.Open();
        using var transaction = connection.BeginTransaction();
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        if (blocked)
        {
            command.CommandText = "INSERT OR IGNORE INTO friend_blocks(blocker_id, blocked_id, created_at) VALUES($me, $peer, $now);";
            command.Parameters.AddWithValue("$now", NowIso());
        }
        else
        {
            command.CommandText = "DELETE FROM friend_blocks WHERE blocker_id=$me AND blocked_id=$peer;";
        }
        command.Parameters.AddWithValue("$me", user.Id);
        command.Parameters.AddWithValue("$peer", peerUid);
        command.ExecuteNonQuery();
        if (blocked)
        {
            // 屏蔽立即终止未处理的申请，避免对方在屏蔽后仍能接受。
            using var cancel = connection.CreateCommand();
            cancel.Transaction = transaction;
            cancel.CommandText = "UPDATE friend_relations SET status='rejected', updated_at=$now WHERE pair_key=$pair AND status='pending';";
            cancel.Parameters.AddWithValue("$now", NowIso());
            cancel.Parameters.AddWithValue("$pair", PairKey(user.Id, peerUid));
            cancel.ExecuteNonQuery();
        }
        transaction.Commit();
        return new(200, new
        {
            blocked,
            message = blocked ? "已屏蔽，对方无法再发送申请或消息。" : "已取消屏蔽。",
        });
    }

    // ── 私聊 ─────────────────────────────────────────────────────────────
    public FriendReply Messages(AccountUser user, string? peerUid, long after)
    {
        if (peerUid is null || !UidPattern().IsMatch(peerUid)) return Error(400, "UID 需为 32 位十六进制。");
        using var connection = database.Open();
        var denied = ChatPermission(connection, user.Id, peerUid, out var peer);
        if (denied is not null) return denied;

        var pairKey = PairKey(user.Id, peerUid);
        var messages = new List<object>();
        long nextCursor = after;
        using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                SELECT id, message_id, sender_id, body, created_ms FROM friend_messages
                WHERE pair_key=$pair AND id > $after ORDER BY id ASC LIMIT $limit;
                """;
            command.Parameters.AddWithValue("$pair", pairKey);
            command.Parameters.AddWithValue("$after", Math.Max(0, after));
            command.Parameters.AddWithValue("$limit", MaxPageSize);
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                var id = reader.GetInt64(0);
                nextCursor = id;
                messages.Add(new
                {
                    id,
                    messageId = reader.GetString(1),
                    senderUid = reader.GetString(2),
                    body = reader.GetString(3),
                    createdMs = reader.GetInt64(4),
                });
            }
        }
        // 拉到即视为已读：游标由服务端推进，未读数不依赖客户端自报。
        if (nextCursor > after) AdvanceRead(connection, pairKey, user.Id, nextCursor);
        return new(200, new
        {
            peer = new { uid = peer!.Id, displayName = peer.DisplayName },
            messages = messages.ToArray(),
            nextCursor,
        });
    }

    public FriendReply Send(AccountUser user, string? peerUid, string? text, string? messageId)
    {
        if (peerUid is null || !UidPattern().IsMatch(peerUid)) return Error(400, "UID 需为 32 位十六进制。");
        if (messageId is null || !MessageIdPattern().IsMatch(messageId)) return Error(400, "消息标识无效，请重试。");
        var normalized = text?.Replace("\r\n", "\n").Trim() ?? "";
        var length = normalized.EnumerateRunes().Count();
        if (length is < 1 or > MaxMessageLength)
            return Error(400, $"消息需为 1—{MaxMessageLength} 个字符。");
        if (normalized.Contains('\0')) return Error(400, "消息包含无法保存的字符。");

        using var connection = database.Open();
        using var transaction = connection.BeginTransaction();

        // 幂等：同一 messageId 重试返回原消息；载荷不同则冲突。
        using (var existing = connection.CreateCommand())
        {
            existing.Transaction = transaction;
            existing.CommandText = "SELECT sender_id, recipient_id, body, id, created_ms FROM friend_messages WHERE message_id=$mid;";
            existing.Parameters.AddWithValue("$mid", messageId);
            using var reader = existing.ExecuteReader();
            if (reader.Read())
            {
                var samePayload = reader.GetString(0) == user.Id && reader.GetString(1) == peerUid && reader.GetString(2) == normalized;
                if (!samePayload) return Error(409, "相同消息编号已被不同内容使用，请换一条消息重试。");
                return new(200, new
                {
                    status = "duplicate",
                    message = new
                    {
                        id = reader.GetInt64(3),
                        messageId,
                        senderUid = user.Id,
                        body = normalized,
                        createdMs = reader.GetInt64(4),
                    },
                });
            }
        }

        var denied = ChatPermission(connection, user.Id, peerUid, out var peer, transaction);
        if (denied is not null) return denied;

        var since = NowMs() - RateWindowMs;
        using (var rate = connection.CreateCommand())
        {
            rate.Transaction = transaction;
            rate.CommandText = "SELECT COUNT(*) FROM friend_messages WHERE sender_id=$me AND created_ms > $since;";
            rate.Parameters.AddWithValue("$me", user.Id);
            rate.Parameters.AddWithValue("$since", since);
            if (Convert.ToInt64(rate.ExecuteScalar()) >= RateLimit)
                return Error(429, "发送过快：每 10 秒最多 5 条，请稍后再试。");
        }

        var created = NowMs();
        using (var insert = connection.CreateCommand())
        {
            insert.Transaction = transaction;
            insert.CommandText = """
                INSERT INTO friend_messages(message_id, pair_key, sender_id, recipient_id, body, created_ms)
                VALUES($mid, $pair, $me, $peer, $body, $now);
                SELECT last_insert_rowid();
                """;
            insert.Parameters.AddWithValue("$mid", messageId);
            insert.Parameters.AddWithValue("$pair", PairKey(user.Id, peerUid));
            insert.Parameters.AddWithValue("$me", user.Id);
            insert.Parameters.AddWithValue("$peer", peerUid);
            insert.Parameters.AddWithValue("$body", normalized);
            insert.Parameters.AddWithValue("$now", created);
            var id = Convert.ToInt64(insert.ExecuteScalar());
            transaction.Commit();
            return new(200, new
            {
                status = "delivered",
                message = new { id, messageId, senderUid = user.Id, body = normalized, createdMs = created },
            });
        }
    }

    public FriendReply MarkRead(AccountUser user, string? peerUid, long cursor)
    {
        if (peerUid is null || !UidPattern().IsMatch(peerUid)) return Error(400, "UID 需为 32 位十六进制。");
        using var connection = database.Open();
        var peer = database.FindUserById(peerUid);
        if (peer is null) return Error(404, "该 UID 不存在。");
        AdvanceRead(connection, PairKey(user.Id, peerUid), user.Id, Math.Max(0, cursor));
        return new(200, new { ok = true });
    }

    // ── 内部工具 ─────────────────────────────────────────────────────────
    private static bool IsBlocked(SqliteConnection connection, string first, string second)
    {
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT COUNT(*) FROM friend_blocks
            WHERE (blocker_id=$a AND blocked_id=$b) OR (blocker_id=$b AND blocked_id=$a);
            """;
        command.Parameters.AddWithValue("$a", first);
        command.Parameters.AddWithValue("$b", second);
        return Convert.ToInt64(command.ExecuteScalar()) > 0;
    }

    /// <summary>私聊前置校验：必须是已接受好友，且双方都没有屏蔽。</summary>
    private FriendReply? ChatPermission(SqliteConnection connection, string me, string peerUid, out AccountUser? peer, SqliteTransaction? transaction = null)
    {
        peer = database.FindUserById(peerUid);
        if (peer is null) return Error(404, "该 UID 不存在。");
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT status FROM friend_relations WHERE pair_key=$pair;";
        command.Parameters.AddWithValue("$pair", PairKey(me, peerUid));
        var status = command.ExecuteScalar() as string;
        if (status != "accepted") return Error(403, "只有已接受的好友才能私聊。");
        if (IsBlocked(connection, me, peerUid)) return Error(403, "存在屏蔽关系，无法收发消息。");
        return null;
    }

    private static void AdvanceRead(SqliteConnection connection, string pairKey, string userId, long cursor)
    {
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO friend_reads(pair_key, user_id, last_seq, updated_at) VALUES($pair, $me, $cursor, $now)
            ON CONFLICT(pair_key, user_id) DO UPDATE SET
                last_seq = MAX(friend_reads.last_seq, excluded.last_seq),
                updated_at = excluded.updated_at;
            """;
        command.Parameters.AddWithValue("$pair", pairKey);
        command.Parameters.AddWithValue("$me", userId);
        command.Parameters.AddWithValue("$cursor", cursor);
        command.Parameters.AddWithValue("$now", NowIso());
        command.ExecuteNonQuery();
    }
}
