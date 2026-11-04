using System.Security.Cryptography;

// Membership, capacity, host transfer and readiness share one short-lived lock.
// Network sends happen after releasing it.
sealed class RoomDirectory
{
    public const int Capacity = 10;
    public object Gate { get; } = new();
    private readonly Dictionary<string, Room> rooms = new(StringComparer.Ordinal);

    public bool TryGetValue(string id, out Room room)
    {
        lock (Gate) return rooms.TryGetValue(id, out room!);
    }

    public RoomAction Create(Client client)
    {
        lock (Gate)
        {
            if (client.RoomId is not null) return new("ALREADY_IN_ROOM", "请先离开当前房间。");
            if (rooms.Count >= 900_000) return new("ROOM_LIMIT", "房间数量已达上限，请稍后重试。");
            string id;
            do { id = RandomNumberGenerator.GetInt32(100_000, 1_000_000).ToString(); }
            while (rooms.ContainsKey(id));
            var room = new Room(Gate) { HostId = client.Id };
            rooms.Add(id, room);
            Add(client, id, room);
            return new(id, room);
        }
    }

    public RoomAction Join(Client client, string id)
    {
        if (id.Length != 6 || id.Any(c => c < '0' || c > '9'))
            return new("INVALID_ROOM", "房间号必须为 6 位数字。");
        lock (Gate)
        {
            if (!rooms.TryGetValue(id, out var room)) return new("ROOM_NOT_FOUND", "房间不存在或已解散，请检查房间号。");
            if (client.RoomId == id) return new(id, room);
            if (client.RoomId is not null) return new("ALREADY_IN_ROOM", "请先离开当前房间。");
            if (room.Started) return new("ROOM_STARTED", "该房间正在游戏中，请等待本局结束。");
            if (room.Clients.Count >= Capacity) return new("ROOM_FULL", "房间已满（10/10），请加入其他房间。");
            Add(client, id, room);
            return new(id, room);
        }
    }

    public RoomAction Ready(Client client, bool ready)
    {
        lock (Gate)
        {
            if (client.RoomId is null || !rooms.TryGetValue(client.RoomId, out var room)) return NotInRoom();
            if (room.Started) return new("ROOM_STARTED", "游戏已经开始，无法更改准备状态。");
            if (room.HostId == client.Id) return new("HOST_ONLY_START", "你是房主，请等待队友准备后开始游戏。");
            client.Ready = ready;
            return new(client.RoomId, room);
        }
    }

    public RoomAction Start(Client client)
    {
        lock (Gate)
        {
            if (client.RoomId is null || !rooms.TryGetValue(client.RoomId, out var room)) return NotInRoom();
            if (room.HostId != client.Id) return new("HOST_ONLY", "只有房主可以开始游戏。");
            if (room.Started) return new("ROOM_STARTED", "游戏已经开始。");
            if (room.Clients.Values.Any(peer => peer.Id != room.HostId && !peer.Ready))
                return new("NOT_ALL_READY", "还有队友未准备，请等待所有成员准备。");
            room.Started = true;
            room.RoundId = Guid.NewGuid().ToString("N");
            var seat = 0;
            foreach (var peer in room.Clients.Values)
            {
                peer.Finished = false;
                peer.Position = CampusWorld.Spawn(seat++);
                peer.Aim = -MathF.PI / 2;
                peer.LastInputAt = Environment.TickCount64;
            }
            return new(client.RoomId, room);
        }
    }

    public RoomAction Finish(Client client, string roundId)
    {
        lock (Gate)
        {
            if (client.RoomId is null || !rooms.TryGetValue(client.RoomId, out var room)) return NotInRoom();
            if (!room.Started || room.RoundId != roundId) return new("INVALID_ROUND", "本局状态已变化，请刷新房间状态。");
            client.Finished = true;
            ResetFinishedRound(room);
            return new(client.RoomId, room);
        }
    }

    public Room? Move(Client client, string roundId, long sequence, float dx, float dy, float aim)
    {
        lock (Gate)
        {
            if (client.RoomId is null || !rooms.TryGetValue(client.RoomId, out var room)
                || !room.Started || room.RoundId != roundId || client.Finished || sequence <= client.LastSequence) return null;
            var now = Environment.TickCount64;
            var elapsed = now - client.LastInputAt;
            if (elapsed < 30) return null;
            client.LastInputAt = now;
            client.LastSequence = sequence;
            client.Position = CampusWorld.Move(client.Position ?? CampusWorld.Spawn(0), dx, dy, elapsed);
            client.Aim = Math.Clamp(aim, -MathF.PI, MathF.PI);
            return room;
        }
    }

    public Room? Leave(Client client, string id)
    {
        lock (Gate)
        {
            if (!rooms.TryGetValue(id, out var room)) return null;
            room.Clients.Remove(client.Id);
            client.RoomId = null;
            client.Ready = false;
            if (room.Clients.Count == 0) rooms.Remove(id);
            else
            {
                if (room.HostId == client.Id)
                {
                    room.HostId = room.Clients.Values.First().Id;
                    room.Clients[room.HostId].Ready = false;
                }
                ResetFinishedRound(room);
            }
            return room;
        }
    }

    private static void Add(Client client, string id, Room room)
    {
        client.Position = CampusWorld.Spawn(room.Clients.Count);
        client.Ready = client.Finished = false;
        room.Clients.Add(client.Id, client);
        client.RoomId = id;
    }

    private static void ResetFinishedRound(Room room)
    {
        if (!room.Started || !room.Clients.Values.All(peer => peer.Finished)) return;
        room.Started = false;
        room.RoundId = null;
        foreach (var peer in room.Clients.Values) peer.Ready = false;
    }

    private static RoomAction NotInRoom() => new("NOT_IN_ROOM", "请先创建或加入房间。");
}

sealed record RoomAction
{
    public string? RoomId { get; }
    public Room? Room { get; }
    public string? Code { get; }
    public string? Message { get; }
    public RoomAction(string id, Room room) { RoomId = id; Room = room; }
    public RoomAction(string code, string message) { Code = code; Message = message; }
}
