using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.StaticFiles;
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
// R15 好友与私聊：关系、屏蔽、消息与已读游标都由服务端维护。
var friends = new FriendStore(database);
SocialApi.Map(app, sessions, friends);
var leaderboard = new LeaderboardStore(database);
LeaderboardApi.Map(app, sessions, leaderboard);
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

app.MapGet("/api/profile/self", (HttpContext context) => WithAccount(context, session => Results.Ok(database.GetSelfProfile(session.User.Id))));
app.MapPost("/api/profile/privacy", (HttpContext context, ProfilePrivacyRequest input) => WithAccount(context, session =>
{
    database.SetProfilePrivacy(session.User.Id, input.PublicCollections);
    return Results.Ok(new { publicCollections = input.PublicCollections });
}));
app.MapGet("/api/profile/{uid}/public", (HttpContext context, string uid) => WithAccount(context, session =>
{
    var profile = database.GetPublicProfile(session.User.Id, uid);
    return profile is null ? Results.NotFound(new { message = "该公开档案不可用。" }) : Results.Ok(profile);
}));
app.MapGet("/api/friends", (HttpContext context) => WithAccount(context, session => Results.Ok(new { friends = database.ListFriends(session.User.Id), unread = database.GetUnreadCount(session.User.Id) })));
app.MapPost("/api/friends/request", (HttpContext context, SocialRequest input) => WithSocial(context, session =>
    Results.Ok(new { status = database.RequestFriend(session.User.Id, input.TargetUid ?? "") })));
app.MapPost("/api/friends/respond", (HttpContext context, FriendResponseRequest input) => WithSocial(context, session =>
{
    database.RespondFriend(session.User.Id, input.TargetUid ?? "", input.Accept);
    return Results.Ok(new { status = input.Accept ? "accepted" : "rejected" });
}));
app.MapPost("/api/friends/action", (HttpContext context, FriendActionRequest input) => WithSocial(context, session =>
{
    database.FriendAction(session.User.Id, input.TargetUid ?? "", input.Action ?? "");
    return Results.NoContent();
}));
app.MapGet("/api/messages", (HttpContext context, string with, long after = 0) => WithSocial(context, session =>
    Results.Ok(new { messages = database.GetMessages(session.User.Id, with, after), unread = database.GetUnreadCount(session.User.Id) })));
app.MapPost("/api/messages", (HttpContext context, MessageRequest input) => WithSocial(context, session =>
    Results.Ok(database.SendDirectMessage(session.User.Id, input.MessageId ?? "", input.ToUid ?? "", input.Text ?? ""))));
app.MapPost("/api/messages/read", (HttpContext context, MessageReadRequest input) => WithSocial(context, session =>
    Results.Ok(database.MarkMessagesRead(session.User.Id, input.PartnerUid ?? "", input.Sequence))));

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
IResult WithAccount(HttpContext context, Func<LoginSession, IResult> action)
{
    var session = sessions.Find(context);
    return session is null ? Results.Unauthorized() : action(session);
}
IResult WithSocial(HttpContext context, Func<LoginSession, IResult> action)
{
    var session = sessions.Find(context);
    if (session is null) return Results.Unauthorized();
    try { return action(session); }
    catch (SocialException error) { return Results.Json(new { code = error.Code, message = error.Message }, statusCode: error.Status); }
    catch (SqliteException) { return Results.Json(new { message = "社交服务暂时不可用，请重试。" }, statusCode: 503); }
}

var rooms = new RoomDirectory();
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
const int protocolVersion = 2;
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
    var client = new Client(socket, Guid.NewGuid().ToString("N")) { DisplayName = session.User.DisplayName, AccountId = session.User.Id };
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
                case "player-death":
                case "room-settings":
                case "transfer-host":
                    // 章节完成度暂不作为联机入口门槛，保留存档校验供后续重新启用。
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
                    try
                    {
                        if (type is "create-room" or "join-room")
                            client.SkinId = database.GetEquippedSkinId(session.User.Id);
                        action = type switch
                        {
                            "create-room" => rooms.Create(client),
                            "join-room" => rooms.Join(client, ReadString(root, "roomId", "")),
                            "set-ready" => rooms.Ready(client, root.GetProperty("ready").GetBoolean()),
                            "start-game" => rooms.Start(client, database.GetEquippedSkinId),
                            "room-settings" => rooms.Settings(client, root.GetProperty("maxPlayers").GetInt32(), root.GetProperty("admissionOpen").GetBoolean()),
                            "transfer-host" => rooms.TransferHost(client, ReadString(root, "playerId", "")),
                            "player-death" => ReadRelics(root) is { } relics
                                ? rooms.Die(client, ReadString(root, "roundId", ""), relics)
                                : new RoomAction("INVALID_MESSAGE", "遗物箱物品无效。"),
                            _ => rooms.Finish(client, ReadString(root, "roundId", "")),
                        };
                    }
                    catch (SqliteException)
                    {
                        await SendError(client, "SAVE_UNAVAILABLE", "暂时无法读取通关进度，请稍后重试。", json);
                        break;
                    }
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
                case "room-chat":
                    var chatText = ReadString(root, "text", "").Trim();
                    if (chatText.Length is 0 or > 160)
                    {
                        await SendError(client, "INVALID_MESSAGE", "聊天消息须为 1 至 160 个字符。", json);
                        break;
                    }
                    if (joinedRoomId is null || !rooms.TryGetValue(joinedRoomId, out var chatRoom)) break;
                    Client[] chatRecipients;
                    lock (chatRoom.Gate)
                    {
                        if (!chatRoom.Clients.TryGetValue(client.Id, out var member) || member != client) break;
                        chatRecipients = chatRoom.Clients.Values.ToArray();
                    }
                    var chatMessage = new
                    {
                        type = "room-chat",
                        roomId = joinedRoomId,
                        playerId = client.Id,
                        displayName = client.DisplayName,
                        text = chatText,
                    };
                    await Task.WhenAll(chatRecipients.Select(peer => Send(peer, chatMessage, json)));
                    break;
                case "player-input":
                    if (joinedRoomId is null) break;
                    if (!root.TryGetProperty("sequence", out var sequenceValue) || !sequenceValue.TryGetInt64(out var sequence) || sequence <= client.LastSequence) break;
                    if (!root.TryGetProperty("movement", out var movement) || movement.ValueKind != JsonValueKind.Object) break;
                    var dx = ReadFiniteProperty(movement, "x");
                    var dy = ReadFiniteProperty(movement, "y");
                    var aim = root.TryGetProperty("aim", out var aimValue) ? ReadFiniteNumber(aimValue) : 0;
                    var interacting = root.TryGetProperty("actions", out var actions) && actions.ValueKind == JsonValueKind.Array
                        && actions.EnumerateArray().Any(a => a.ValueKind == JsonValueKind.String && a.GetString() == "interact")
                        && !actions.EnumerateArray().Any(a => a.ValueKind == JsonValueKind.String && a.GetString() == "attack");
                    var camera = root.TryGetProperty("camera", out var cameraValue) ? ReadCamera(cameraValue) : null;
                    var inputRoom = rooms.Move(client, ReadString(root, "roundId", ""), sequence, dx, dy, aim, interacting, camera);
                    if (inputRoom is null) break;
                    await BroadcastRoom(joinedRoomId!, inputRoom, rooms, json);
                    break;
                case "loot-search":
                case "loot-ack":
                    var lootRound = ReadString(root, "roundId", "");
                    var requestId = ReadString(root, "requestId", "");
                    var chestId = ReadString(root, "chestId", "");
                    var stage = ReadString(root, "stage", "");
                    if (requestId.Length is < 1 or > 64 || (type == "loot-search" && (chestId.Length is < 1 or > 64 || stage is not ("hold" or "claim" or "cancel" or "take")))
                        || (type == "loot-ack" && (!root.TryGetProperty("accepted", out var acceptedValue) || acceptedValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False))))
                    {
                        await SendError(client, "INVALID_MESSAGE", "搜索请求无效。", json);
                        break;
                    }
                    Room? lootRoom = null;
                    LootReply? lootReply = null;
                    lock (rooms.Gate)
                    {
                        if (joinedRoomId is not null && rooms.TryGetValue(joinedRoomId, out var currentRoom)
                            && currentRoom.Started && currentRoom.RoundId == lootRound && !client.Finished && currentRoom.Loot is not null)
                        {
                            lootRoom = currentRoom;
                            if (type == "loot-search") lootReply = currentRoom.Loot.Handle(client, lootRound, requestId, chestId, stage);
                            else currentRoom.Loot.Acknowledge(client, requestId, root.GetProperty("accepted").GetBoolean());
                        }
                    }
                    if (lootRoom is null) await SendError(client, "INVALID_ROUND", "本局状态已变化，无法搜索。", json);
                    else
                    {
                        if (lootReply is not null) await Send(client, lootReply, json);
                        if (type == "loot-ack") await BroadcastRoom(joinedRoomId!, lootRoom, rooms, json);
                    }
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
    var contentTypes = new FileExtensionContentTypeProvider();
    contentTypes.Mappings[".glb"] = "model/gltf-binary";
    contentTypes.Mappings[".gltf"] = "model/gltf+json";
    // public/ 资产同名换图时 URL 不变，浏览器 heuristic 缓存会顶掉新图（2026-11-26 右上角交子徽章）。
    // no-cache 只要求每次 revalidate：内容没变走 304，带宽几乎为零，但永远拿得到最新字节。
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = files,
        ContentTypeProvider = contentTypes,
        OnPrepareResponse = context => context.Context.Response.Headers.CacheControl = "no-cache",
    });
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

static string[]? ReadRelics(JsonElement root)
{
    if (!root.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array || items.GetArrayLength() > 6)
        return null;
    var result = new List<string>();
    var slots = 0;
    foreach (var item in items.EnumerateArray())
    {
        if (item.ValueKind != JsonValueKind.String || item.GetString() is not { } id || !RelicItems.Allowed.Contains(id))
            return null;
        slots += id == "yellow-bike" ? 2 : 1;
        if (slots > 6) return null;
        result.Add(id);
    }
    return result.ToArray();
}

static float ReadFiniteProperty(JsonElement root, string name) =>
    root.TryGetProperty(name, out var value) ? ReadFiniteNumber(value) : 0;

static RoomCamera? ReadCamera(JsonElement value)
{
    if (value.ValueKind != JsonValueKind.Object
        || !ReadBounded("distance", 48, out var distance) || distance < 5
        || !ReadBounded("yaw", 3.142f, out var yaw) || !ReadBounded("pitch", 1.571f, out var pitch)
        || !value.TryGetProperty("overview", out var overview) || overview.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
        || !value.TryGetProperty("flashlight", out var flashlight) || flashlight.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        return null;
    return new(distance, yaw, pitch, overview.GetBoolean(), flashlight.GetBoolean());

    bool ReadBounded(string name, float limit, out float number)
    {
        number = 0;
        return value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Number
            && property.TryGetSingle(out number) && float.IsFinite(number) && MathF.Abs(number) <= limit;
    }
}

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
            chests = room.Loot?.Chests.Select(chest => new { chest.Id, chest.X, chest.Y, chest.ZoneId, chest.ItemId, chest.ClaimedBy }).ToArray() ?? [],
            relics = room.Loot?.Relics.Select(relic => new
            {
                relic.OwnerId, relic.X, relic.Y,
                slots = relic.Slots.Select(slot => new { slot.Id, slot.ItemId, slot.ClaimedBy }).ToArray(),
            }).ToArray() ?? [],
            players = clients.Select(client => new
            {
                playerId = client.Id,
                displayName = client.DisplayName,
                position = client.Position ?? CampusWorld.Spawn(0),
                aim = client.Aim,
                camera = client.Camera,
                health = client.Dead ? 0 : 100,
                skinId = client.SkinId,
                connected = client.Socket.State == WebSocketState.Open,
                ready = client.Ready,
                finished = client.Finished,
                dead = client.Dead,
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

static class RelicItems
{
    public static readonly HashSet<string> Allowed = new(StringComparer.Ordinal)
    {
        "scratch-paper", "half-eraser", "portable-medkit", "torn-notebook", "window-seat", "morning-coffee",
        "school-badge", "anomalous-feather", "gpa-charm", "library-reward-ticket", "siyuan-key",
        "strange-veined-ginkgo-leaf", "hunter-binoculars", "roller-skates", "quick-note-card", "simple-detector",
        "star-compass", "silent-cloak", "reflective-filter", "marked-campus-map", "soothe-charm",
        "complete-record", "electric-bike-helmet", "david-head-statue", "silver-watch", "training-bat",
        "stun-baton", "folding-ruler", "long-broom", "window-breaker", "night-watch-spear", "bandage",
        "yellow-bike", "thick-down-jacket",
    };
}

sealed class Client(WebSocket socket, string id)
{
    public WebSocket Socket { get; } = socket;
    public string Id { get; } = id;
    public string DisplayName { get; set; } = "玩家";
    public string AccountId { get; set; } = "";
    public Point? Position { get; set; }
    public float Aim { get; set; }
    public RoomCamera? Camera { get; set; }
    public long LastSequence { get; set; } = -1;
    public long LastInputAt { get; set; }
    public string? RoomId { get; set; }
    public bool Ready { get; set; }
    public bool Finished { get; set; }
    public bool Dead { get; set; }
    public string SkinId { get; set; } = "school-uniform";
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
    public RoomLoot? Loot { get; set; }
}
