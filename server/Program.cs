using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Data.Sqlite;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 4096);
builder.Services.Configure<ForwardedHeadersOptions>(options => options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("credentials", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
var database = new GameDatabase(builder.Configuration["Auth:DataDirectory"] ?? Path.Combine(builder.Environment.ContentRootPath, "data"));
var accounts = new AccountStore(database);
var sessions = new LoginSessions();
var app = builder.Build();
app.UseForwardedHeaders();
app.UseRateLimiter();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api") || context.Request.Path.StartsWithSegments("/ws"))
    {
        if (context.Request.Path.StartsWithSegments("/api/save") && context.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } size)
            size.MaxRequestBodySize = 1_048_576;
        context.Response.Headers.CacheControl = "no-store";
        var origin = context.Request.Headers.Origin.ToString();
        var sameOrigin = origin.Length == 0 || (Uri.TryCreate(origin, UriKind.Absolute, out var uri)
            && string.Equals(uri.GetLeftPart(UriPartial.Authority), $"{context.Request.Scheme}://{context.Request.Host}", StringComparison.OrdinalIgnoreCase));
        if (!sameOrigin || (HttpMethods.IsPost(context.Request.Method) && context.Request.Headers["X-Game-Request"] != "1"))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { message = "请求来源校验失败，请从游戏页面操作。" });
            return;
        }
    }
    await next(context);
});

app.MapGet("/api/auth/me", (HttpContext context) =>
{
    var session = sessions.Find(context);
    return session is null ? Results.Unauthorized() : Results.Ok(new { user = session.User, expiresAt = session.ExpiresAt });
});
app.MapPost("/api/auth/register", (HttpContext context, Credentials input) => Authenticate(context, input, true)).RequireRateLimiting("credentials");
app.MapPost("/api/auth/login", (HttpContext context, Credentials input) => Authenticate(context, input, false)).RequireRateLimiting("credentials");
app.MapPost("/api/auth/logout", (HttpContext context) =>
{
    sessions.Revoke(context);
    return Results.NoContent();
});

async Task<IResult> Authenticate(HttpContext context, Credentials input, bool registration)
{
    var error = AccountStore.Validate(input, registration);
    if (error is not null) return Results.BadRequest(new { message = error });
    try
    {
        var user = registration ? await accounts.Register(input) : await accounts.Login(input);
        if (user is null)
            return Results.Json(new { message = registration ? "该用户名已注册，请更换用户名或登录。" : "用户名或密码不正确。" }, statusCode: registration ? 409 : 401);
        var session = sessions.Create(context, user);
        session.Lifetime.Token.Register(() =>
        {
            try { database.ReleaseSession(session.Id); }
            catch (SqliteException) { app.Logger.LogWarning("Save lease cleanup deferred until expiry."); }
        });
        return Results.Ok(new { user, expiresAt = session.ExpiresAt });
    }
    catch (Exception errorOnDisk) when (errorOnDisk is IOException or UnauthorizedAccessException or SqliteException)
    {
        app.Logger.LogError("Account storage is unavailable ({ErrorType}).", errorOnDisk.GetType().Name);
        return Results.Json(new { message = "账号服务暂时无法保存数据，请稍后重试。" }, statusCode: 503);
    }
}

app.MapPost("/api/save/open", (HttpContext context, SaveOpenRequest input) => WithSave(context, session =>
    Guid.TryParse(input.ClientId, out var clientId)
        ? Results.Ok(database.OpenSave(session, clientId.ToString("N")))
        : Results.BadRequest(new { message = "游戏窗口标识无效，请刷新重试。" })));
app.MapPost("/api/save", (HttpContext context, SaveWriteRequest input) => WithSave(context, session =>
    ValidToken(input.LeaseToken) && input.Revision is >= 0 and < 9_007_199_254_740_991 && SaveValidation.IsValid(input.Data)
        ? Results.Ok(database.WriteSave(session, input))
        : Results.BadRequest(new { message = "存档格式无效，云端原有进度未被覆盖。" })));
app.MapPost("/api/save/heartbeat", (HttpContext context, SaveLeaseRequest input) => WithSave(context, session =>
    ValidToken(input.LeaseToken) ? Results.Ok(database.Heartbeat(session, input.LeaseToken!)) : Results.BadRequest()));
app.MapPost("/api/save/release", (HttpContext context, SaveLeaseRequest input) => WithSave(context, session =>
{
    if (!ValidToken(input.LeaseToken)) return Results.BadRequest();
    database.Release(session, input.LeaseToken!);
    return Results.NoContent();
}));

static bool ValidToken(string? token) => token is { Length: 64 } && token.All(char.IsAsciiHexDigit);
IResult WithSave(HttpContext context, Func<LoginSession, IResult> action)
{
    var session = sessions.Find(context);
    if (session is null) return Results.Unauthorized();
    try { return action(session); }
    catch (SaveConflictException error) { return Results.Conflict(new { message = error.Message }); }
    catch (SqliteException error)
    {
        app.Logger.LogError("Cloud save database unavailable (SQLite code {Code}).", error.SqliteErrorCode);
        return Results.Json(new { message = "云存档暂时不可用，请稍后重试；原进度已保留。" }, statusCode: 503);
    }
}

var rooms = new RoomDirectory();
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
const int protocolVersion = 1;
const int maxMessageBytes = 4096;

app.MapGet("/health", () => Results.Ok(new { status = "ok", protocol = protocolVersion }));
app.Map("/ws", async context =>
{
    var session = sessions.Find(context);
    if (session is null)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, session.Lifetime.Token);
    // Aborting interrupts both receives and blocked sends when logout/expiry revokes access.
    using var revoked = lifetime.Token.Register(socket.Abort);
    var client = new Client(socket, Guid.NewGuid().ToString("N")) { DisplayName = session.User.DisplayName };
    string? joinedRoomId = null;

    try
    {
        while (socket.State == WebSocketState.Open)
        {
            var text = await ReceiveText(socket, maxMessageBytes, lifetime.Token);
            if (text is null) break;
            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;
            if (!root.TryGetProperty("type", out var typeValue) || typeValue.ValueKind != JsonValueKind.String)
            {
                await SendError(client, "INVALID_MESSAGE", "Message type is required.", json);
                continue;
            }

            var type = typeValue.GetString();
            switch (type)
            {
                case "hello":
                    if (!root.TryGetProperty("protocol", out var protocol) || protocol.GetInt32() != protocolVersion)
                    {
                        await SendError(client, "PROTOCOL_MISMATCH", "Unsupported protocol version.", json);
                        return;
                    }
                    await Send(client, new { type = "welcome", protocol = protocolVersion, playerId = client.Id, serverTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }, json);
                    break;
                case "create-room":
                case "join-room":
                case "set-ready":
                case "start-game":
                case "finish-game":
                case "room-settings":
                case "transfer-host":
                    RoomAction action;
                    if (type == "set-ready" && (!root.TryGetProperty("ready", out var readyValue)
                        || readyValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False)))
                    {
                        await SendError(client, "INVALID_MESSAGE", "准备状态无效。", json);
                        break;
                    }
                    if (type == "room-settings" && (!root.TryGetProperty("maxPlayers", out var capacityValue)
                        || capacityValue.ValueKind != JsonValueKind.Number || !capacityValue.TryGetInt32(out _) || !root.TryGetProperty("admissionOpen", out var admissionValue)
                        || admissionValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False)))
                    {
                        await SendError(client, "INVALID_MESSAGE", "房间规则无效。", json);
                        break;
                    }
                    action = type switch
                    {
                        "create-room" => rooms.Create(client),
                        "join-room" => rooms.Join(client, ReadString(root, "roomId", "")),
                        "set-ready" => rooms.Ready(client, root.GetProperty("ready").GetBoolean()),
                        "start-game" => rooms.Start(client),
                        "room-settings" => rooms.Settings(client, root.GetProperty("maxPlayers").GetInt32(), root.GetProperty("admissionOpen").GetBoolean()),
                        "transfer-host" => rooms.TransferHost(client, ReadString(root, "playerId", "")),
                        _ => rooms.Finish(client, ReadString(root, "roundId", "")),
                    };
                    if (action.Code is not null)
                    {
                        await SendError(client, action.Code, action.Message!, json);
                        break;
                    }
                    joinedRoomId = action.RoomId;
                    await BroadcastRoom(joinedRoomId!, action.Room!, rooms, json);
                    break;
                case "leave-room":
                    if (joinedRoomId is not null)
                    {
                        await LeaveRoom(client, joinedRoomId, rooms, json);
                        joinedRoomId = null;
                    }
                    break;
                case "player-input":
                    if (joinedRoomId is null) break;
                    if (!root.TryGetProperty("sequence", out var sequenceValue) || !sequenceValue.TryGetInt64(out var sequence) || sequence <= client.LastSequence) break;
                    if (!root.TryGetProperty("movement", out var movement) || movement.ValueKind != JsonValueKind.Object) break;
                    var dx = ReadFiniteProperty(movement, "x");
                    var dy = ReadFiniteProperty(movement, "y");
                    var aim = root.TryGetProperty("aim", out var aimValue) ? ReadFiniteNumber(aimValue) : 0;
                    var inputRoom = rooms.Move(client, ReadString(root, "roundId", ""), sequence, dx, dy, aim);
                    if (inputRoom is null) break;
                    await BroadcastRoom(joinedRoomId!, inputRoom, rooms, json);
                    break;
                case "ping":
                    var sentAt = root.TryGetProperty("sentAt", out var sentAtValue) ? sentAtValue.GetInt64() : 0;
                    await Send(client, new { type = "pong", sentAt, serverTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }, json);
                    break;
                default:
                    await SendError(client, "UNKNOWN_MESSAGE", "Message type is not supported.", json);
                    break;
            }
        }
    }
    catch (OperationCanceledException) { }
    catch (WebSocketException) { }
    catch (JsonException)
    {
        await SendError(client, "INVALID_JSON", "Message must contain valid JSON.", json);
    }
    finally
    {
        if (joinedRoomId is not null) await LeaveRoom(client, joinedRoomId, rooms, json);
        if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
        {
            try { await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "closed", CancellationToken.None); }
            catch (WebSocketException) { }
        }
    }
});

// A production build can be served by the same host, keeping HTTP and WebSocket cookies same-origin.
var frontendPath = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "../dist"));
if (Directory.Exists(frontendPath))
{
    var files = new PhysicalFileProvider(frontendPath);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
}
app.Run();

static async Task<string?> ReceiveText(WebSocket socket, int limit, CancellationToken cancellationToken)
{
    var buffer = new byte[1024];
    using var output = new MemoryStream();
    WebSocketReceiveResult result;
    do
    {
        result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
        if (result.MessageType == WebSocketMessageType.Close) return null;
        if (result.MessageType != WebSocketMessageType.Text || output.Length + result.Count > limit)
        {
            await socket.CloseAsync(WebSocketCloseStatus.MessageTooBig, "message limit", cancellationToken);
            return null;
        }
        output.Write(buffer, 0, result.Count);
    } while (!result.EndOfMessage);
    return Encoding.UTF8.GetString(output.ToArray());
}

static string ReadString(JsonElement root, string name, string fallback) =>
    root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
        ? value.GetString() ?? fallback
        : fallback;

static float ReadFiniteProperty(JsonElement root, string name) =>
    root.TryGetProperty(name, out var value) ? ReadFiniteNumber(value) : 0;

static float ReadFiniteNumber(JsonElement value) =>
    value.ValueKind == JsonValueKind.Number && value.TryGetSingle(out var number) && float.IsFinite(number) ? Math.Clamp(number, -10, 10) : 0;

static async Task SendError(Client client, string code, string message, JsonSerializerOptions options) =>
    await Send(client, new { type = "error", code, message }, options);

static async Task Send(Client client, object message, JsonSerializerOptions options)
{
    if (client.Socket.State != WebSocketState.Open) return;
    var payload = JsonSerializer.SerializeToUtf8Bytes(message, options);
    await client.SendGate.WaitAsync();
    try
    {
        if (client.Socket.State == WebSocketState.Open)
            await client.Socket.SendAsync(payload, WebSocketMessageType.Text, true, CancellationToken.None);
    }
    catch (WebSocketException) { }
    finally { client.SendGate.Release(); }
}

static async Task BroadcastRoom(string roomId, Room room, RoomDirectory rooms, JsonSerializerOptions options)
{
    Client[] clients;
    object snapshot;
    lock (room.Gate)
    {
        clients = room.Clients.Values.ToArray();
        room.Tick++;
        snapshot = new
        {
            type = "room-state",
            roomId,
            tick = room.Tick,
            hostId = room.HostId,
            maxPlayers = room.MaxPlayers,
            admissionOpen = room.AdmissionOpen,
            started = room.Started,
            roundId = room.RoundId,
            players = clients.Select(client => new
            {
                playerId = client.Id,
                displayName = client.DisplayName,
                position = client.Position ?? CampusWorld.Spawn(0),
                aim = client.Aim,
                health = 100,
                connected = client.Socket.State == WebSocketState.Open,
                ready = client.Ready,
                finished = client.Finished,
            }).ToArray(),
        };
    }
    var payload = JsonSerializer.SerializeToUtf8Bytes(snapshot, options);
    await Task.WhenAll(clients.Select(client => SendBytes(client, payload)));
}

static async Task SendBytes(Client client, byte[] payload)
{
    if (client.Socket.State != WebSocketState.Open) return;
    await client.SendGate.WaitAsync();
    try
    {
        if (client.Socket.State == WebSocketState.Open)
            await client.Socket.SendAsync(payload, WebSocketMessageType.Text, true, CancellationToken.None);
    }
    catch (WebSocketException) { }
    finally { client.SendGate.Release(); }
}

static async Task LeaveRoom(Client client, string roomId, RoomDirectory rooms, JsonSerializerOptions options)
{
    var room = rooms.Leave(client, roomId);
    if (room is null) return;
    Client[] remaining;
    lock (room.Gate) remaining = room.Clients.Values.ToArray();
    await Task.WhenAll(remaining.Select(peer => Send(peer, new { type = "player-left", playerId = client.Id }, options)));
    await BroadcastRoom(roomId, room, rooms, options);
}

sealed class Point(float x, float y)
{
    public float X { get; } = x;
    public float Y { get; } = y;
}

sealed class Client(WebSocket socket, string id)
{
    public WebSocket Socket { get; } = socket;
    public string Id { get; } = id;
    public string DisplayName { get; set; } = "玩家";
    public Point? Position { get; set; }
    public float Aim { get; set; }
    public long LastSequence { get; set; } = -1;
    public long LastInputAt { get; set; }
    public string? RoomId { get; set; }
    public bool Ready { get; set; }
    public bool Finished { get; set; }
    public SemaphoreSlim SendGate { get; } = new(1, 1);
}

sealed class Room(object gate)
{
    public object Gate { get; } = gate;
    public Dictionary<string, Client> Clients { get; } = new(StringComparer.Ordinal);
    public long Tick { get; set; }
    public string HostId { get; set; } = "";
    public int MaxPlayers { get; set; } = RoomDirectory.Capacity;
    public bool AdmissionOpen { get; set; } = true;
    public bool Started { get; set; }
    public string? RoundId { get; set; }
}
