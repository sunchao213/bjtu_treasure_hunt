using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

sealed record AccountUser(string Id, string Username, string DisplayName);
sealed record AccountRecord(string Id, string Username, string DisplayName, string Salt, string PasswordHash);
sealed record Credentials(string? Username, string? Password, string? DisplayName);

// Persist only salted password hashes; SQL parameters and the database unique key protect account writes.
sealed class AccountStore(GameDatabase database)
{
    private const int Iterations = 210_000;

    public static string? Validate(Credentials input, bool registration)
    {
        if (!Regex.IsMatch(input.Username?.Trim() ?? "", "^[A-Za-z0-9_]{3,24}$"))
            return "用户名需为 3–24 位字母、数字或下划线。";
        if (input.Password is null || input.Password.Length is < 8 or > 128)
            return "密码长度需为 8–128 位。";
        if (registration && (string.IsNullOrWhiteSpace(input.DisplayName) || input.DisplayName.Trim().Length > 18 || input.DisplayName.Any(char.IsControl)))
            return "昵称需为 1–18 个可见字符。";
        return null;
    }

    public Task<AccountUser?> Register(Credentials input)
    {
        var username = input.Username!.Trim();
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Hash(input.Password!, salt);
        var account = new AccountRecord(Guid.NewGuid().ToString("N"), username, input.DisplayName!.Trim(), Convert.ToBase64String(salt), Convert.ToBase64String(hash));
        return Task.FromResult(database.AddAccount(account) ? PublicUser(account) : null);
    }

    public Task<AccountUser?> Login(Credentials input)
    {
        var account = database.FindAccount(input.Username!.Trim());
        // Do equal work for unknown usernames to avoid a cheap account-existence timing probe.
        var salt = account is null ? new byte[16] : Convert.FromBase64String(account.Salt);
        var actual = Hash(input.Password!, salt);
        var expected = account is null ? new byte[32] : Convert.FromBase64String(account.PasswordHash);
        return Task.FromResult(CryptographicOperations.FixedTimeEquals(actual, expected) && account is not null ? PublicUser(account) : null);
    }

    private static byte[] Hash(string password, byte[] salt) => Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
    private static AccountUser PublicUser(AccountRecord account) => new(account.Id, account.Username, account.DisplayName);
}

sealed class LoginSession(AccountUser user)
{
    public string Id { get; } = Guid.NewGuid().ToString("N");
    public AccountUser User { get; } = user;
    public DateTimeOffset ExpiresAt { get; } = DateTimeOffset.UtcNow.AddHours(12);
    public CancellationTokenSource Lifetime { get; } = new(TimeSpan.FromHours(12));
}

sealed class LoginSessions
{
    public const string CookieName = "bjtu_session";
    private readonly ConcurrentDictionary<string, LoginSession> sessions = new(StringComparer.Ordinal);

    public LoginSession? Find(HttpContext context)
    {
        var token = context.Request.Cookies[CookieName];
        if (token is null || !sessions.TryGetValue(token, out var session)) return null;
        if (!session.Lifetime.IsCancellationRequested && session.ExpiresAt > DateTimeOffset.UtcNow) return session;
        sessions.TryRemove(token, out _);
        session.Lifetime.Cancel();
        return null;
    }

    public LoginSession Create(HttpContext context, AccountUser user)
    {
        Revoke(context);
        foreach (var pair in sessions)
        {
            if (pair.Value.Lifetime.IsCancellationRequested) sessions.TryRemove(pair.Key, out _);
        }
        var session = new LoginSession(user);
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        sessions[token] = session;
        context.Response.Cookies.Append(CookieName, token, CookieOptions(context, session.ExpiresAt));
        return session;
    }

    public void Revoke(HttpContext context)
    {
        var token = context.Request.Cookies[CookieName];
        if (token is not null && sessions.TryRemove(token, out var session)) session.Lifetime.Cancel();
        context.Response.Cookies.Delete(CookieName, CookieOptions(context, null));
    }

    private static CookieOptions CookieOptions(HttpContext context, DateTimeOffset? expires) => new()
    {
        HttpOnly = true, Secure = context.Request.IsHttps, SameSite = SameSiteMode.Strict,
        Path = "/", Expires = expires, IsEssential = true,
    };
}
