using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

sealed record SocialRequest(string? TargetUid, string? RequestId);
sealed record FriendResponseRequest(string? TargetUid, bool Accept);
sealed record FriendActionRequest(string? TargetUid, string? Action);
sealed record ProfilePrivacyRequest(bool PublicCollections);
sealed record MessageRequest(string? MessageId, string? ToUid, string? Text);
sealed record MessageReadRequest(string? PartnerUid, long Sequence);
sealed record StoredMessage(long Sequence, string MessageId, string SenderId, string RecipientId, string Text, string CreatedAt);
sealed class SocialException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

sealed partial class GameDatabase
{
    private static void CaptureRaidHistory(SqliteConnection connection, SqliteTransaction transaction, string userId, JsonElement data)
    {
        if (!data.TryGetProperty("lastResult", out var result) || result.ValueKind != JsonValueKind.Object
            || !result.TryGetProperty("raidId", out var raidIdValue) || raidIdValue.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(raidIdValue.GetString())) return;
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT OR IGNORE INTO raid_history(user_id, raid_id, result, recorded_at) VALUES($user, $raid, $result, $now);";
        command.Parameters.AddWithValue("$user", userId);
        command.Parameters.AddWithValue("$raid", raidIdValue.GetString()!);
        command.Parameters.AddWithValue("$result", result.GetRawText());
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.ExecuteNonQuery();
    }

    public object GetSelfProfile(string userId)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT a.display_name, s.data, p.public_collections FROM accounts a LEFT JOIN player_saves s ON s.user_id=a.id LEFT JOIN profile_preferences p ON p.user_id=a.id WHERE a.id=$user;";
        command.Parameters.AddWithValue("$user", userId);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) throw new SocialException(404, "ACCOUNT_NOT_FOUND", "账号不存在。");
        var displayName = reader.GetString(0);
        var save = reader.IsDBNull(1) ? (JsonElement?)null : JsonDocument.Parse(reader.GetString(1)).RootElement.Clone();
        var isPublic = !reader.IsDBNull(2) && reader.GetInt32(2) == 1;
        reader.Close();
        return new { uid = userId, displayName, publicCollections = isPublic, save, raids = ReadRaidHistory(connection, userId, null, false) };
    }

    public bool SetProfilePrivacy(string userId, bool publicCollections)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO profile_preferences(user_id, public_collections) VALUES($user, $public) ON CONFLICT(user_id) DO UPDATE SET public_collections=excluded.public_collections;";
        command.Parameters.AddWithValue("$user", userId);
        command.Parameters.AddWithValue("$public", publicCollections ? 1 : 0);
        return command.ExecuteNonQuery() == 1;
    }

    public object? GetPublicProfile(string viewerId, string targetId)
    {
        if (viewerId == targetId || !AreFriends(viewerId, targetId)) return null;
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT a.display_name, p.public_collections, s.data FROM accounts a LEFT JOIN profile_preferences p ON p.user_id=a.id LEFT JOIN player_saves s ON s.user_id=a.id WHERE a.id=$user;";
        command.Parameters.AddWithValue("$user", targetId);
        using var reader = command.ExecuteReader();
        if (!reader.Read() || reader.IsDBNull(1) || reader.GetInt32(1) != 1) return null;
        var displayName = reader.GetString(0);
        var save = reader.IsDBNull(2) ? (JsonElement?)null : JsonDocument.Parse(reader.GetString(2)).RootElement.Clone();
        var collections = save is { ValueKind: JsonValueKind.Object } json && json.TryGetProperty("codexIds", out var codex)
            && codex.ValueKind == JsonValueKind.Array
            ? codex.EnumerateArray().Where(value => value.ValueKind == JsonValueKind.String).Select(value => value.GetString()).Take(6).ToArray()
            : [];
        reader.Close();
        return new { uid = targetId, displayName, collections, recentRaids = ReadRaidHistory(connection, targetId, 20, true) };
    }

    private static object[] ReadRaidHistory(SqliteConnection connection, string userId, int? limit, bool summaryOnly)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT result, recorded_at FROM raid_history WHERE user_id=$user ORDER BY recorded_at DESC, raid_id DESC" + (limit.HasValue ? " LIMIT $limit" : "") + ";";
        command.Parameters.AddWithValue("$user", userId);
        if (limit.HasValue) command.Parameters.AddWithValue("$limit", limit.Value);
        var results = new List<object>();
        using (var reader = command.ExecuteReader())
        {
            while (reader.Read())
            {
                using var document = JsonDocument.Parse(reader.GetString(0));
                var result = document.RootElement;
                if (summaryOnly)
                {
                    results.Add(new
                    {
                        recordedAt = reader.GetString(1),
                        result = new
                        {
                            raidId = StringField(result, "raidId"),
                            outcome = StringField(result, "outcome"),
                            reason = StringField(result, "reason"),
                            value = NumberField(result, "value"),
                        },
                    });
                }
                else results.Add(new { recordedAt = reader.GetString(1), result = result.Clone() });
            }
        }
        return results.ToArray();
    }

    private static string? StringField(JsonElement value, string key) =>
        value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.String ? field.GetString() : null;

    private static long? NumberField(JsonElement value, string key) =>
        value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.Number && field.TryGetInt64(out var number) ? number : null;

    public object[] ListFriends(string userId)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT f.requester_id, f.status, f.updated_at, a.id, a.display_name FROM friendships f JOIN accounts a ON a.id=CASE WHEN f.user_low=$user THEN f.user_high ELSE f.user_low END WHERE f.user_low=$user OR f.user_high=$user ORDER BY f.updated_at DESC;";
        command.Parameters.AddWithValue("$user", userId);
        var rows = new List<object>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            var status = reader.GetString(1);
            if (status == "pending" && reader.GetString(0) == userId) continue;
            rows.Add(new { uid = reader.GetString(3), displayName = reader.GetString(4), status, incoming = status == "pending" });
        }
        return rows.ToArray();
    }

    public string RequestFriend(string userId, string targetId)
    {
        if (userId == targetId || !AccountExists(targetId)) throw new SocialException(400, "INVALID_TARGET", "请选择有效的其他账号。");
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        if (IsBlocked(connection, transaction, userId, targetId)) throw new SocialException(403, "BLOCKED", "该账号当前不可建立好友关系。");
        var (low, high) = Pair(userId, targetId);
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT status FROM friendships WHERE user_low=$low AND user_high=$high;";
        command.Parameters.AddWithValue("$low", low);
        command.Parameters.AddWithValue("$high", high);
        var status = command.ExecuteScalar() as string;
        if (status == "accepted" || status == "pending") return status;
        command.Parameters.AddWithValue("$requester", userId);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.CommandText = "INSERT INTO friendships(user_low,user_high,requester_id,status,updated_at) VALUES($low,$high,$requester,'pending',$now) ON CONFLICT(user_low,user_high) DO UPDATE SET requester_id=excluded.requester_id,status='pending',updated_at=excluded.updated_at;";
        command.ExecuteNonQuery();
        transaction.Commit();
        return "pending";
    }

    public void RespondFriend(string userId, string targetId, bool accept)
    {
        var (low, high) = Pair(userId, targetId);
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE friendships SET status=$status, updated_at=$now WHERE user_low=$low AND user_high=$high AND requester_id=$target AND status='pending';";
        command.Parameters.AddWithValue("$status", accept ? "accepted" : "rejected");
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$low", low);
        command.Parameters.AddWithValue("$high", high);
        command.Parameters.AddWithValue("$target", targetId);
        if (command.ExecuteNonQuery() != 1) throw new SocialException(409, "REQUEST_NOT_FOUND", "没有来自该账号的待处理申请。");
    }

    public void FriendAction(string userId, string targetId, string action)
    {
        if (userId == targetId) throw new SocialException(400, "INVALID_TARGET", "不能对自己执行此操作。");
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        if (action == "delete")
        {
            var (low, high) = Pair(userId, targetId);
            command.CommandText = "DELETE FROM friendships WHERE user_low=$low AND user_high=$high;";
            command.Parameters.AddWithValue("$low", low);
            command.Parameters.AddWithValue("$high", high);
            command.ExecuteNonQuery();
        }
        else if (action is "block" or "unblock")
        {
            command.CommandText = action == "block"
                ? "INSERT OR IGNORE INTO blocks(blocker_id,blocked_id,created_at) VALUES($user,$target,$now); DELETE FROM friendships WHERE (user_low=$user AND user_high=$target) OR (user_low=$target AND user_high=$user);"
                : "DELETE FROM blocks WHERE blocker_id=$user AND blocked_id=$target;";
            command.Parameters.AddWithValue("$user", userId);
            command.Parameters.AddWithValue("$target", targetId);
            command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            command.ExecuteNonQuery();
        }
        else throw new SocialException(400, "INVALID_ACTION", "操作类型无效。");
        transaction.Commit();
    }

    public StoredMessage SendDirectMessage(string senderId, string messageId, string recipientId, string text)
    {
        if (messageId.Length is < 1 or > 64 || !Regex.IsMatch(messageId, "^[A-Za-z0-9_-]+$") || text.EnumerateRunes().Count() is < 1 or > 200 || text.Any(char.IsControl))
            throw new SocialException(400, "INVALID_MESSAGE", "消息长度须为 1–200 个可见字符。");
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT sequence, recipient_id, text, created_at FROM direct_messages WHERE sender_id=$sender AND message_id=$id;";
        command.Parameters.AddWithValue("$sender", senderId);
        command.Parameters.AddWithValue("$id", messageId);
        using (var reader = command.ExecuteReader())
        {
            if (reader.Read())
            {
                if (reader.GetString(1) != recipientId || reader.GetString(2) != text) throw new SocialException(409, "IDEMPOTENCY_CONFLICT", "消息请求编号已用于其他内容。");
                var replay = new StoredMessage(reader.GetInt64(0), messageId, senderId, recipientId, text, reader.GetString(3));
                transaction.Commit();
                return replay;
            }
        }
        if (!AreFriends(connection, transaction, senderId, recipientId) || IsBlocked(connection, transaction, senderId, recipientId))
            throw new SocialException(403, "CHAT_FORBIDDEN", "只有互为好友且未屏蔽的账号可以私聊。");
        command.Parameters.Clear();
        command.CommandText = "SELECT COUNT(*) FROM direct_messages WHERE sender_id=$sender AND created_at >= $since;";
        command.Parameters.AddWithValue("$sender", senderId);
        command.Parameters.AddWithValue("$since", DateTimeOffset.UtcNow.AddSeconds(-10).ToString("O"));
        if (Convert.ToInt32(command.ExecuteScalar()) >= 5) throw new SocialException(429, "MESSAGE_RATE_LIMIT", "每 10 秒最多发送 5 条消息。");
        var now = DateTimeOffset.UtcNow.ToString("O");
        command.Parameters.Clear();
        command.CommandText = "INSERT INTO direct_messages(message_id,sender_id,recipient_id,text,created_at) VALUES($id,$sender,$recipient,$text,$now); SELECT last_insert_rowid();";
        command.Parameters.AddWithValue("$id", messageId);
        command.Parameters.AddWithValue("$sender", senderId);
        command.Parameters.AddWithValue("$recipient", recipientId);
        command.Parameters.AddWithValue("$text", text);
        command.Parameters.AddWithValue("$now", now);
        var sequence = Convert.ToInt64(command.ExecuteScalar());
        transaction.Commit();
        return new StoredMessage(sequence, messageId, senderId, recipientId, text, now);
    }

    public object[] GetMessages(string userId, string partnerId, long after)
    {
        if (!AreFriends(userId, partnerId) || IsBlockedForMessages(userId, partnerId)) throw new SocialException(403, "CHAT_FORBIDDEN", "该私聊当前不可读取。");
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT sequence,message_id,sender_id,recipient_id,text,created_at FROM direct_messages WHERE sequence>$after AND ((sender_id=$user AND recipient_id=$partner) OR (sender_id=$partner AND recipient_id=$user)) ORDER BY sequence LIMIT 100;";
        command.Parameters.AddWithValue("$after", Math.Max(0, after));
        command.Parameters.AddWithValue("$user", userId);
        command.Parameters.AddWithValue("$partner", partnerId);
        var values = new List<object>();
        using var reader = command.ExecuteReader();
        while (reader.Read()) values.Add(new { sequence = reader.GetInt64(0), messageId = reader.GetString(1), senderId = reader.GetString(2), recipientId = reader.GetString(3), text = reader.GetString(4), createdAt = reader.GetString(5) });
        return values.ToArray();
    }

    public object MarkMessagesRead(string userId, string partnerId, long sequence)
    {
        if (!AreFriends(userId, partnerId) || IsBlockedForMessages(userId, partnerId)) throw new SocialException(403, "CHAT_FORBIDDEN", "该私聊当前不可读取。");
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT COALESCE(MAX(sequence),0) FROM direct_messages WHERE sender_id=$partner AND recipient_id=$user;";
        command.Parameters.AddWithValue("$partner", partnerId);
        command.Parameters.AddWithValue("$user", userId);
        var latest = Convert.ToInt64(command.ExecuteScalar());
        var cursor = Math.Clamp(sequence, 0, latest);
        command.Parameters.Clear();
        command.CommandText = "INSERT INTO message_reads(reader_id,partner_id,last_read_sequence) VALUES($user,$partner,$cursor) ON CONFLICT(reader_id,partner_id) DO UPDATE SET last_read_sequence=MAX(last_read_sequence,excluded.last_read_sequence);";
        command.Parameters.AddWithValue("$user", userId);
        command.Parameters.AddWithValue("$partner", partnerId);
        command.Parameters.AddWithValue("$cursor", cursor);
        command.ExecuteNonQuery();
        command.Parameters.Clear();
        command.CommandText = "SELECT COUNT(*) FROM direct_messages m LEFT JOIN message_reads r ON r.reader_id=m.recipient_id AND r.partner_id=m.sender_id WHERE m.recipient_id=$user AND m.sender_id=$partner AND m.sequence>COALESCE(r.last_read_sequence,0);";
        command.Parameters.AddWithValue("$user", userId);
        command.Parameters.AddWithValue("$partner", partnerId);
        var unread = Convert.ToInt32(command.ExecuteScalar());
        transaction.Commit();
        return new { lastReadSequence = cursor, unread };
    }

    public int GetUnreadCount(string userId)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM direct_messages m LEFT JOIN message_reads r ON r.reader_id=m.recipient_id AND r.partner_id=m.sender_id WHERE m.recipient_id=$user AND m.sequence>COALESCE(r.last_read_sequence,0);";
        command.Parameters.AddWithValue("$user", userId);
        return Convert.ToInt32(command.ExecuteScalar());
    }

    private bool AccountExists(string uid)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT 1 FROM accounts WHERE id=$id;";
        command.Parameters.AddWithValue("$id", uid);
        return command.ExecuteScalar() is not null;
    }

    private bool AreFriends(string first, string second)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        return AreFriends(connection, transaction, first, second);
    }

    private static bool AreFriends(SqliteConnection connection, SqliteTransaction transaction, string first, string second)
    {
        var (low, high) = Pair(first, second);
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT 1 FROM friendships WHERE user_low=$low AND user_high=$high AND status='accepted';";
        command.Parameters.AddWithValue("$low", low);
        command.Parameters.AddWithValue("$high", high);
        return command.ExecuteScalar() is not null;
    }

    private bool IsBlockedForMessages(string first, string second)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT 1 FROM blocks WHERE (blocker_id=$first AND blocked_id=$second) OR (blocker_id=$second AND blocked_id=$first) LIMIT 1;";
        command.Parameters.AddWithValue("$first", first);
        command.Parameters.AddWithValue("$second", second);
        return command.ExecuteScalar() is not null;
    }

    private static bool IsBlocked(SqliteConnection connection, SqliteTransaction transaction, string first, string second)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT 1 FROM blocks WHERE (blocker_id=$first AND blocked_id=$second) OR (blocker_id=$second AND blocked_id=$first) LIMIT 1;";
        command.Parameters.AddWithValue("$first", first);
        command.Parameters.AddWithValue("$second", second);
        return command.ExecuteScalar() is not null;
    }

    private static (string Low, string High) Pair(string first, string second) => string.CompareOrdinal(first, second) < 0 ? (first, second) : (second, first);
}
