using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });

var rooms = new ConcurrentDictionary<string, Room>(StringComparer.Ordinal);
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
const int protocolVersion = 1;
const int maxMessageBytes = 4096;
const int maxRoomPlayers = 8;
const float worldWidth = 3600;
const float worldHeight = 2400;
const float playerSpeed = 400;

app.MapGet("/health", () => Results.Ok(new { status = "ok", protocol = protocolVersion }));
app.Map("/ws", async context =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    var client = new Client(socket, Guid.NewGuid().ToString("N"));
    string? joinedRoomId = null;
    var lastInputAt = Environment.TickCount64;

    try
    {
        while (socket.State == WebSocketState.Open)
        {
            var text = await ReceiveText(socket, maxMessageBytes, context.RequestAborted);
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
                    client.DisplayName = CleanName(ReadString(root, "displayName", "玩家"));
                    await Send(client, new { type = "welcome", protocol = protocolVersion, playerId = client.Id, serverTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }, json);
                    break;
                case "join-room":
                    if (joinedRoomId is not null) await LeaveRoom(client, joinedRoomId, rooms, json);
                    joinedRoomId = CleanRoom(ReadString(root, "roomId", ""));
                    if (joinedRoomId.Length == 0)
                    {
                        await SendError(client, "INVALID_ROOM", "Room ID is invalid.", json);
                        joinedRoomId = null;
                        break;
                    }
                    var room = rooms.GetOrAdd(joinedRoomId, _ => new Room());
                    lock (room.Gate)
                    {
                        if (room.Clients.Count >= maxRoomPlayers)
                        {
                            joinedRoomId = null;
                            room = null!;
                        }
                        else
                        {
                            client.Position ??= new Point(600 + Random.Shared.Next(-40, 41), 2200 + Random.Shared.Next(-40, 41));
                            room.Clients[client.Id] = client;
                            client.RoomId = joinedRoomId;
                        }
                    }
                    if (room is null)
                    {
                        await SendError(client, "ROOM_FULL", "Room is full.", json);
                        break;
                    }
                    await BroadcastRoom(joinedRoomId!, room, rooms, json);
                    break;
                case "leave-room":
                    if (joinedRoomId is not null)
                    {
                        await LeaveRoom(client, joinedRoomId, rooms, json);
                        joinedRoomId = null;
                    }
                    break;
                case "player-input":
                    if (joinedRoomId is null || !rooms.TryGetValue(joinedRoomId, out var inputRoom)) break;
                    if (!root.TryGetProperty("sequence", out var sequenceValue) || !sequenceValue.TryGetInt64(out var sequence) || sequence <= client.LastSequence) break;
                    if (!root.TryGetProperty("movement", out var movement) || movement.ValueKind != JsonValueKind.Object) break;
                    var dx = ReadFiniteProperty(movement, "x");
                    var dy = ReadFiniteProperty(movement, "y");
                    var magnitude = MathF.Sqrt(dx * dx + dy * dy);
                    if (magnitude > 1)
                    {
                        dx /= magnitude;
                        dy /= magnitude;
                    }
                    var aim = root.TryGetProperty("aim", out var aimValue) ? ReadFiniteNumber(aimValue) : 0;
                    var now = Environment.TickCount64;
                    if (now - lastInputAt < 30) break;
                    var elapsed = Math.Clamp((now - lastInputAt) / 1000f, 0, 0.1f);
                    lastInputAt = now;
                    client.LastSequence = sequence;
                    lock (inputRoom.Gate)
                    {
                        var current = client.Position ?? new Point(600, 2200);
                        client.Position = new Point(
                            Math.Clamp(current.X + dx * playerSpeed * elapsed, 25, worldWidth - 25),
                            Math.Clamp(current.Y + dy * playerSpeed * elapsed, 25, worldHeight - 25));
                        client.Aim = Math.Clamp(aim, -MathF.PI, MathF.PI);
                    }
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
    value.TryGetSingle(out var number) && float.IsFinite(number) ? Math.Clamp(number, -1, 1) : 0;

static string CleanName(string value)
{
    var clean = new string(value.Where(c => !char.IsControl(c)).Take(18).ToArray()).Trim();
    return clean.Length == 0 ? "玩家" : clean;
}

static string CleanRoom(string value) =>
    new string(value.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_').Take(32).ToArray());

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

static async Task BroadcastRoom(string roomId, Room room, ConcurrentDictionary<string, Room> rooms, JsonSerializerOptions options)
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
            players = clients.Select(client => new
            {
                playerId = client.Id,
                displayName = client.DisplayName,
                position = client.Position ?? new Point(600, 2200),
                aim = client.Aim,
                health = 100,
                connected = client.Socket.State == WebSocketState.Open,
            }).ToArray(),
        };
    }
    var payload = JsonSerializer.SerializeToUtf8Bytes(snapshot, options);
    await Task.WhenAll(clients.Select(client => SendBytes(client, payload)));
    if (clients.Length == 0) rooms.TryRemove(roomId, out _);
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

static async Task LeaveRoom(Client client, string roomId, ConcurrentDictionary<string, Room> rooms, JsonSerializerOptions options)
{
    if (!rooms.TryGetValue(roomId, out var room)) return;
    lock (room.Gate)
    {
        room.Clients.Remove(client.Id);
        client.RoomId = null;
    }
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
    public string? RoomId { get; set; }
    public SemaphoreSlim SendGate { get; } = new(1, 1);
}

sealed class Room
{
    public object Gate { get; } = new();
    public Dictionary<string, Client> Clients { get; } = new(StringComparer.Ordinal);
    public long Tick { get; set; }
}
