using Microsoft.Data.Sqlite;

sealed record LeaderboardReply(int Status, object Body);

/// <summary>R16: fixed-window score snapshots with owner-scoped, keyset-style cursors.</summary>
sealed class LeaderboardStore(GameDatabase database)
{
    private const long WindowMs = 7L * 24 * 60 * 60 * 1000;
    private const long SnapshotLifetimeMs = 24L * 60 * 60 * 1000;
    private const int PageSize = 20;
    private const int ScanSize = 100;
    private sealed record Entry(long Ordinal, long Rank, string PlayerId, string DisplayName, long TotalValue, long BestValue, long SuccessfulRaids);

    private static LeaderboardReply Error(int status, string message) => new(status, new { message });

    public LeaderboardReply Read(AccountUser user, string? scope, string? cursorText)
    {
        if (scope is not ("friends" or "global")) return Error(400, "榜单范围无效。");
        using var connection = database.Open();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        string snapshotId;
        long windowStart;
        long windowEnd;
        long updatedAt;
        long afterOrdinal = 0;
        string? afterPlayerId = null;

        if (string.IsNullOrEmpty(cursorText))
        {
            (snapshotId, windowStart, windowEnd, updatedAt) = CreateSnapshot(connection, user, scope, now);
        }
        else
        {
            if (cursorText.Length != 32 || !cursorText.All(char.IsAsciiHexDigit))
                return Error(400, "榜单分页游标无效，请刷新榜单。");
            using var snapshot = connection.CreateCommand();
            snapshot.CommandText = """
                SELECT s.snapshot_id, s.window_start_ms, s.window_end_ms, s.updated_at_ms, s.expires_at_ms,
                       c.after_ordinal, c.after_player_id
                FROM leaderboard_cursors c JOIN leaderboard_snapshots s ON s.snapshot_id=c.snapshot_id
                WHERE c.cursor_id=$cursor AND c.owner_id=$owner AND c.scope=$scope;
                """;
            snapshot.Parameters.AddWithValue("$cursor", cursorText);
            snapshot.Parameters.AddWithValue("$owner", user.Id);
            snapshot.Parameters.AddWithValue("$scope", scope);
            using (var reader = snapshot.ExecuteReader())
            {
                if (!reader.Read()) return Error(410, "榜单快照已失效，请刷新后重试。");
                snapshotId = reader.GetString(0);
                windowStart = reader.GetInt64(1);
                windowEnd = reader.GetInt64(2);
                updatedAt = reader.GetInt64(3);
                var expiresAt = reader.GetInt64(4);
                if (expiresAt <= now) return Error(410, "榜单快照已过期，请刷新后重试。");
                afterOrdinal = reader.GetInt64(5);
                afterPlayerId = reader.GetString(6);
            }
            if (afterOrdinal < 1) return Error(400, "榜单分页游标无效，请刷新榜单。");
            using var tail = connection.CreateCommand();
            tail.CommandText = "SELECT player_id FROM leaderboard_snapshot_entries WHERE snapshot_id=$snapshot AND ordinal=$ordinal;";
            tail.Parameters.AddWithValue("$snapshot", snapshotId);
            tail.Parameters.AddWithValue("$ordinal", afterOrdinal);
            var currentTail = tail.ExecuteScalar() as string;
            if (currentTail is not null && currentTail != afterPlayerId)
                return Error(400, "榜单分页游标无效，请刷新榜单。");
        }

        var entries = ReadPage(connection, user.Id, scope, snapshotId, afterOrdinal, out var hasMore);
        var nextCursor = hasMore && entries.Count > 0
            ? CreateCursor(connection, user, scope, snapshotId, entries[^1])
            : null;
        return new(200, new
        {
            scope,
            windowStartMs = windowStart,
            windowEndMs = windowEnd,
            updatedAtMs = updatedAt,
            entries = entries.Select(entry => new
            {
                rank = entry.Rank,
                displayName = entry.DisplayName,
                totalValue = entry.TotalValue,
                bestValue = entry.BestValue,
                successfulRaids = entry.SuccessfulRaids,
            }).ToArray(),
            nextCursor,
            hasMore,
        });
    }

    private static (string Id, long Start, long End, long Updated) CreateSnapshot(SqliteConnection connection, AccountUser owner, string scope, long now)
    {
        using var transaction = connection.BeginTransaction();
        using (var cleanup = connection.CreateCommand())
        {
            cleanup.Transaction = transaction;
            cleanup.CommandText = "DELETE FROM leaderboard_cursors WHERE expires_at_ms <= $now; DELETE FROM leaderboard_snapshots WHERE expires_at_ms <= $now OR (owner_id=$owner AND scope=$scope);";
            cleanup.Parameters.AddWithValue("$now", now);
            cleanup.Parameters.AddWithValue("$owner", owner.Id);
            cleanup.Parameters.AddWithValue("$scope", scope);
            cleanup.ExecuteNonQuery();
        }

        var snapshotId = Guid.NewGuid().ToString("N");
        var windowStart = now - WindowMs;
        using (var create = connection.CreateCommand())
        {
            create.Transaction = transaction;
            create.CommandText = "INSERT INTO leaderboard_snapshots(snapshot_id, owner_id, scope, window_start_ms, window_end_ms, updated_at_ms, expires_at_ms) VALUES($id, $owner, $scope, $start, $end, $updated, $expires);";
            create.Parameters.AddWithValue("$id", snapshotId);
            create.Parameters.AddWithValue("$owner", owner.Id);
            create.Parameters.AddWithValue("$scope", scope);
            create.Parameters.AddWithValue("$start", windowStart);
            create.Parameters.AddWithValue("$end", now);
            create.Parameters.AddWithValue("$updated", now);
            create.Parameters.AddWithValue("$expires", now + SnapshotLifetimeMs);
            create.ExecuteNonQuery();
        }

        HashSet<string>? friendIds = null;
        if (scope == "friends")
        {
            friendIds = new(StringComparer.Ordinal);
            using var friends = connection.CreateCommand();
            friends.Transaction = transaction;
            friends.CommandText = """
                SELECT CASE WHEN r.requester_id=$owner THEN r.addressee_id ELSE r.requester_id END
                FROM friend_relations r
                WHERE r.status='accepted' AND (r.requester_id=$owner OR r.addressee_id=$owner)
                  AND NOT EXISTS (SELECT 1 FROM friend_blocks b WHERE
                    (b.blocker_id=$owner AND b.blocked_id=CASE WHEN r.requester_id=$owner THEN r.addressee_id ELSE r.requester_id END)
                    OR (b.blocker_id=CASE WHEN r.requester_id=$owner THEN r.addressee_id ELSE r.requester_id END AND b.blocked_id=$owner));
                """;
            friends.Parameters.AddWithValue("$owner", owner.Id);
            using var reader = friends.ExecuteReader();
            while (reader.Read()) friendIds.Add(reader.GetString(0));
        }

        var rows = new List<(string Id, string Name, long Total, long Best, long Count)>();
        using (var aggregate = connection.CreateCommand())
        {
            aggregate.Transaction = transaction;
            aggregate.CommandText = """
                SELECT a.id, a.display_name, SUM(r.value), MAX(r.value), COUNT(*)
                FROM raid_results r JOIN accounts a ON a.id=r.user_id
                WHERE r.outcome='success' AND r.settled_at_ms >= $start AND r.settled_at_ms < $end
                GROUP BY a.id, a.display_name;
                """;
            aggregate.Parameters.AddWithValue("$start", windowStart);
            aggregate.Parameters.AddWithValue("$end", now);
            using var reader = aggregate.ExecuteReader();
            while (reader.Read())
            {
                var id = reader.GetString(0);
                if (scope == "friends" && (id == owner.Id || !friendIds!.Contains(id))) continue;
                rows.Add((id, reader.GetString(1), reader.GetInt64(2), reader.GetInt64(3), reader.GetInt64(4)));
            }
        }

        rows.Sort((left, right) =>
        {
            var order = right.Total.CompareTo(left.Total);
            if (order != 0) return order;
            order = right.Best.CompareTo(left.Best);
            return order != 0 ? order : string.CompareOrdinal(left.Id, right.Id);
        });
        using (var insert = connection.CreateCommand())
        {
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO leaderboard_snapshot_entries(snapshot_id, player_id, display_name, total_value, best_value, successful_raids, ordinal, rank) VALUES($snapshot, $player, $name, $total, $best, $count, $ordinal, $rank);";
            var snapshotParameter = insert.Parameters.Add("$snapshot", SqliteType.Text);
            var player = insert.Parameters.Add("$player", SqliteType.Text);
            var name = insert.Parameters.Add("$name", SqliteType.Text);
            var total = insert.Parameters.Add("$total", SqliteType.Integer);
            var best = insert.Parameters.Add("$best", SqliteType.Integer);
            var count = insert.Parameters.Add("$count", SqliteType.Integer);
            var ordinal = insert.Parameters.Add("$ordinal", SqliteType.Integer);
            var rank = insert.Parameters.Add("$rank", SqliteType.Integer);
            snapshotParameter.Value = snapshotId;
            long currentRank = 0;
            (long Total, long Best)? previous = null;
            for (var index = 0; index < rows.Count; index++)
            {
                var row = rows[index];
                if (previous is null || previous.Value != (row.Total, row.Best)) currentRank = index + 1;
                previous = (row.Total, row.Best);
                player.Value = row.Id;
                name.Value = row.Name;
                total.Value = row.Total;
                best.Value = row.Best;
                count.Value = row.Count;
                ordinal.Value = index + 1;
                rank.Value = currentRank;
                insert.ExecuteNonQuery();
            }
        }
        transaction.Commit();
        return (snapshotId, windowStart, now, now);
    }

    private static List<Entry> ReadPage(SqliteConnection connection, string ownerId, string scope, string snapshotId, long afterOrdinal, out bool hasMore)
    {
        var entries = new List<Entry>(PageSize);
        var scannedOrdinal = afterOrdinal;
        hasMore = false;
        while (entries.Count <= PageSize)
        {
            var batch = new List<Entry>(ScanSize);
            using (var command = connection.CreateCommand())
            {
                command.CommandText = "SELECT ordinal, rank, player_id, display_name, total_value, best_value, successful_raids FROM leaderboard_snapshot_entries WHERE snapshot_id=$snapshot AND ordinal>$after ORDER BY ordinal LIMIT $limit;";
                command.Parameters.AddWithValue("$snapshot", snapshotId);
                command.Parameters.AddWithValue("$after", scannedOrdinal);
                command.Parameters.AddWithValue("$limit", ScanSize);
                using var reader = command.ExecuteReader();
                while (reader.Read())
                    batch.Add(new Entry(reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetInt64(4), reader.GetInt64(5), reader.GetInt64(6)));
            }
            if (batch.Count == 0) break;
            foreach (var entry in batch)
            {
                scannedOrdinal = entry.Ordinal;
                if (scope == "friends" && !IsCurrentFriend(connection, ownerId, entry.PlayerId)) continue;
                entries.Add(entry);
                if (entries.Count > PageSize) break;
            }
            if (entries.Count > PageSize || batch.Count < ScanSize) break;
        }
        if (entries.Count > PageSize)
        {
            entries.RemoveAt(entries.Count - 1);
            hasMore = true;
        }
        return entries;
    }

    private static bool IsCurrentFriend(SqliteConnection connection, string ownerId, string playerId)
    {
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT EXISTS(SELECT 1 FROM friend_relations r WHERE r.status='accepted'
              AND ((r.requester_id=$owner AND r.addressee_id=$player) OR (r.requester_id=$player AND r.addressee_id=$owner)))
              AND NOT EXISTS(SELECT 1 FROM friend_blocks b WHERE
                (b.blocker_id=$owner AND b.blocked_id=$player) OR (b.blocker_id=$player AND b.blocked_id=$owner));
            """;
        command.Parameters.AddWithValue("$owner", ownerId);
        command.Parameters.AddWithValue("$player", playerId);
        return Convert.ToInt32(command.ExecuteScalar()) == 1;
    }

    private static string CreateCursor(SqliteConnection connection, AccountUser owner, string scope, string snapshotId, Entry tail)
    {
        var cursor = Guid.NewGuid().ToString("N");
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO leaderboard_cursors(cursor_id, snapshot_id, owner_id, scope, after_ordinal, after_player_id, expires_at_ms) SELECT $cursor, snapshot_id, $owner, $scope, $ordinal, $player, expires_at_ms FROM leaderboard_snapshots WHERE snapshot_id=$snapshot;";
        command.Parameters.AddWithValue("$cursor", cursor);
        command.Parameters.AddWithValue("$snapshot", snapshotId);
        command.Parameters.AddWithValue("$owner", owner.Id);
        command.Parameters.AddWithValue("$scope", scope);
        command.Parameters.AddWithValue("$ordinal", tail.Ordinal);
        command.Parameters.AddWithValue("$player", tail.PlayerId);
        command.ExecuteNonQuery();
        return cursor;
    }
}

static class LeaderboardApi
{
    public static void Map(WebApplication app, LoginSessions sessions, LeaderboardStore leaderboard)
    {
        app.MapGet("/api/leaderboard", (HttpContext context, string? scope, string? cursor) =>
        {
            var session = sessions.Find(context);
            if (session is null) return Results.Unauthorized();
            var reply = leaderboard.Read(session.User, scope, cursor);
            return Results.Json(reply.Body, statusCode: reply.Status);
        });
    }
}
