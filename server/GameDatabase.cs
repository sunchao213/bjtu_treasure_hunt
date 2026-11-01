using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;

sealed record CloudSaveReply(JsonElement? Data, long Revision, string LeaseToken, long LeaseExpiresAt);
sealed record SaveWriteRequest(string? LeaseToken, long Revision, JsonElement Data);
sealed record SaveOpenRequest(string? ClientId);
sealed record SaveLeaseRequest(string? LeaseToken);
sealed class SaveConflictException(string message) : Exception(message);

// One game host owns this database. SQLite transactions also protect concurrent HTTP requests.
sealed class GameDatabase
{
    private const long LeaseDurationMs = 90_000;
    private readonly string connectionString;

    public GameDatabase(string directory)
    {
        Directory.CreateDirectory(directory);
        connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(directory, "game.db"),
            Mode = SqliteOpenMode.ReadWriteCreate,
            ForeignKeys = true,
            DefaultTimeout = 5,
        }.ToString();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA journal_mode=WAL;";
        command.ExecuteScalar();
        command.CommandText = "PRAGMA user_version;";
        if (Convert.ToInt32(command.ExecuteScalar()) > 1) throw new InvalidDataException("Database schema is newer than this game host.");
        using (var transaction = connection.BeginTransaction())
        {
            command.Transaction = transaction;
            using var resource = typeof(GameDatabase).Assembly.GetManifestResourceStream("OnlineHost.Database.schema.sql")
                ?? throw new InvalidOperationException("Database schema resource is missing.");
            using var schema = new StreamReader(resource);
            command.CommandText = schema.ReadToEnd();
            command.ExecuteNonQuery();
            transaction.Commit();
        }
        command.Transaction = null;
        ImportLegacyAccounts(connection, Path.Combine(directory, "accounts.json"));
        // Sessions are intentionally revoked on restart; their old leases must be released too.
        command.CommandText = "UPDATE player_saves SET lease_token=NULL, lease_session=NULL, lease_client=NULL, lease_expires_at=0;";
        command.ExecuteNonQuery();
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        return connection;
    }

    private static void ImportLegacyAccounts(SqliteConnection connection, string path)
    {
        if (!File.Exists(path)) return;
        using var transaction = connection.BeginTransaction();
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT COUNT(*) FROM legacy_imports WHERE source='accounts.json';";
        if (Convert.ToInt32(command.ExecuteScalar()) != 0) return;
        var records = JsonSerializer.Deserialize<AccountRecord[]>(File.ReadAllText(path)) ?? throw new InvalidDataException("Invalid legacy account data; original file was preserved.");
        foreach (var record in records)
        {
            if (!Guid.TryParseExact(record.Id, "N", out _) || AccountStore.Validate(new Credentials(record.Username, "migration-placeholder", record.DisplayName), true) is not null
                || Convert.FromBase64String(record.Salt).Length != 16 || Convert.FromBase64String(record.PasswordHash).Length != 32)
                throw new InvalidDataException("Invalid legacy account record; database import was rolled back.");
            InsertAccount(connection, transaction, record, false);
        }
        command.CommandText = "INSERT INTO legacy_imports(source, imported_at) VALUES('accounts.json', $now);";
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.ExecuteNonQuery();
        transaction.Commit();
    }

    private static bool InsertAccount(SqliteConnection connection, SqliteTransaction? transaction, AccountRecord account, bool allowDuplicateName)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO accounts(id, username, display_name, password_salt, password_hash, created_at)
            VALUES($id, $username, $name, $salt, $hash, $now)
            """ + (allowDuplicateName ? " ON CONFLICT(username) DO NOTHING;" : ";");
        command.Parameters.AddWithValue("$id", account.Id);
        command.Parameters.AddWithValue("$username", account.Username);
        command.Parameters.AddWithValue("$name", account.DisplayName);
        command.Parameters.AddWithValue("$salt", account.Salt);
        command.Parameters.AddWithValue("$hash", account.PasswordHash);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        return command.ExecuteNonQuery() == 1;
    }

    public bool AddAccount(AccountRecord account)
    {
        using var connection = Open();
        return InsertAccount(connection, null, account, true);
    }

    public AccountRecord? FindAccount(string username)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, username, display_name, password_salt, password_hash FROM accounts WHERE username=$username;";
        command.Parameters.AddWithValue("$username", username);
        using var reader = command.ExecuteReader();
        return reader.Read() ? new AccountRecord(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4)) : null;
    }

    public CloudSaveReply OpenSave(LoginSession session, string clientId)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.Parameters.AddWithValue("$user", session.User.Id);
        command.CommandText = "INSERT INTO player_saves(user_id, updated_at) VALUES($user, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(user_id) DO NOTHING;";
        command.ExecuteNonQuery();
        command.CommandText = "SELECT data, revision, lease_session, lease_client, lease_expires_at FROM player_saves WHERE user_id=$user;";
        string? raw;
        long revision;
        using (var reader = command.ExecuteReader())
        {
            reader.Read();
            raw = reader.IsDBNull(0) ? null : reader.GetString(0);
            revision = reader.GetInt64(1);
            if (reader.GetInt64(4) > now && (reader.IsDBNull(2) || reader.GetString(2) != session.Id || reader.IsDBNull(3) || reader.GetString(3) != clientId))
                throw new SaveConflictException("此账号已在其他窗口或设备中运行，请先退出该处游戏后再重试。");
        }
        // Rotate even for a reload: a late release from the old page cannot unlock the new page.
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var expires = now + LeaseDurationMs;
        command.CommandText = "UPDATE player_saves SET lease_token=$token, lease_session=$session, lease_client=$client, lease_expires_at=$expires WHERE user_id=$user;";
        command.Parameters.AddWithValue("$token", token);
        command.Parameters.AddWithValue("$session", session.Id);
        command.Parameters.AddWithValue("$client", clientId);
        command.Parameters.AddWithValue("$expires", expires);
        command.ExecuteNonQuery();
        transaction.Commit();
        JsonElement? data = raw is null ? null : JsonSerializer.Deserialize<JsonElement>(raw);
        return new CloudSaveReply(data, revision, token, expires);
    }

    public object WriteSave(LoginSession session, SaveWriteRequest input)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using var command = LeaseCommand(connection, session, input.LeaseToken!);
        command.Transaction = transaction;
        var raw = input.Data.GetRawText();
        var expires = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + LeaseDurationMs;
        command.CommandText = "SELECT revision, data FROM player_saves WHERE " + LeaseWhere;
        long revision;
        string? current;
        using (var reader = command.ExecuteReader())
        {
            if (!reader.Read()) throw new SaveConflictException("云存档占用已失效，请刷新并重新登录。");
            revision = reader.GetInt64(0);
            current = reader.IsDBNull(1) ? null : reader.GetString(1);
        }
        // A lost HTTP response can be retried without duplicating a revision or a settlement.
        var replay = revision == input.Revision + 1 && current == raw;
        if (revision != input.Revision && !replay) throw new SaveConflictException("云存档已更新，请刷新后读取最新进度，避免覆盖。");
        var nextRevision = replay ? revision : revision + 1;
        command.CommandText = "UPDATE player_saves SET data=$data, revision=$revision, updated_at=$updated, lease_expires_at=$expires WHERE " + LeaseWhere;
        command.Parameters.AddWithValue("$data", raw);
        command.Parameters.AddWithValue("$revision", nextRevision);
        command.Parameters.AddWithValue("$updated", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$expires", expires);
        if (command.ExecuteNonQuery() != 1) throw new SaveConflictException("云存档占用已失效，请刷新重试。");
        transaction.Commit();
        return new { revision = nextRevision, leaseExpiresAt = expires };
    }

    public object Heartbeat(LoginSession session, string token)
    {
        using var connection = Open();
        using var command = LeaseCommand(connection, session, token);
        var expires = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + LeaseDurationMs;
        command.CommandText = "UPDATE player_saves SET lease_expires_at=$expires WHERE " + LeaseWhere;
        command.Parameters.AddWithValue("$expires", expires);
        if (command.ExecuteNonQuery() != 1) throw new SaveConflictException("云存档占用已失效，请刷新重试。");
        return new { leaseExpiresAt = expires };
    }

    private const string LeaseWhere = "user_id=$user AND lease_token=$token AND lease_session=$session AND lease_expires_at>$now";
    private static SqliteCommand LeaseCommand(SqliteConnection connection, LoginSession session, string token)
    {
        var command = connection.CreateCommand();
        command.Parameters.AddWithValue("$user", session.User.Id);
        command.Parameters.AddWithValue("$session", session.Id);
        command.Parameters.AddWithValue("$token", token);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        return command;
    }

    public void Release(LoginSession session, string token)
    {
        using var connection = Open();
        using var command = LeaseCommand(connection, session, token);
        command.CommandText = "UPDATE player_saves SET lease_token=NULL, lease_session=NULL, lease_client=NULL, lease_expires_at=0 WHERE " + LeaseWhere;
        command.ExecuteNonQuery();
    }

    public void ReleaseSession(string sessionId)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE player_saves SET lease_token=NULL, lease_session=NULL, lease_client=NULL, lease_expires_at=0 WHERE lease_session=$session;";
        command.Parameters.AddWithValue("$session", sessionId);
        command.ExecuteNonQuery();
    }
}
