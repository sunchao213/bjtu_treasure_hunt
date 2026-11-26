using System.Security.Cryptography;
using System.Text.Json;

// Called only while holding RoomDirectory.Gate. Offers reserve a chest until the
// recipient confirms local insertion; a rejected receipt or disconnect releases it.
sealed class RoomLoot
{
    public static LootRules Rules { get; } = LoadRules();
    public List<RoomChest> Chests { get; } = Generate();
    private readonly Dictionary<string, Search> searches = new();
    private readonly Dictionary<string, Offer> offers = new();
    private readonly HashSet<string> usedRequests = new();

    private static LootRules LoadRules()
    {
        using var stream = typeof(RoomLoot).Assembly.GetManifestResourceStream("room-loot.json")!;
        return JsonSerializer.Deserialize<LootRules>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }

    private static List<RoomChest> Generate()
    {
        var result = new List<RoomChest>();
        var geometry = CampusWorld.Geometry;
        foreach (var zone in Rules.Zones)
        {
            var candidates = new List<Point>();
            for (var x = zone.X + 25; x < zone.X + zone.Width - 20; x += 50)
                for (var y = zone.Y + 25; y < zone.Y + zone.Height - 20; y += 50)
                {
                    var p = new Point(x, y);
                    if (x - 35 < geometry.Bounds.X || x + 35 > geometry.Bounds.X + geometry.Bounds.Width
                        || y - 35 < geometry.Bounds.Y || y + 35 > geometry.Bounds.Y + geometry.Bounds.Height) continue;
                    if (geometry.Obstacles.Concat(Rules.Occlusion).Any(w => x + 35 > w.X && x - 35 < w.X + w.Width && y + 35 > w.Y && y - 35 < w.Y + w.Height)) continue;
                    if (Rules.Fixed.Any(q => Distance(p, new Point(q.X, q.Y)) < 90) || result.Any(q => Distance(p, new Point(q.X, q.Y)) < 120)) continue;
                    candidates.Add(p);
                }
            var shuffled = candidates.ToArray();
            Random.Shared.Shuffle(shuffled);
            var selected = Choose(shuffled, zone.Id == "lake" ? 1 : 3)
                ?? throw new InvalidOperationException($"No accessible room loot positions in {zone.Id}");
            for (var i = 0; i < selected.Count; i++)
                result.Add(new RoomChest($"{zone.Id}-{i}", selected[i].X, selected[i].Y, zone.Id, Rules.Pool[RandomNumberGenerator.GetInt32(Rules.Pool.Length)]));
        }
        return result;
    }

    private static List<Point>? Choose(Point[] candidates, int count)
    {
        if (count == 0) return new();
        for (var i = 0; i < candidates.Length; i++)
        {
            var p = candidates[i];
            var rest = Choose(candidates.Skip(i + 1).Where(other => Distance(p, other) >= 120).ToArray(), count - 1);
            if (rest is not null) { rest.Insert(0, p); return rest; }
        }
        return null;
    }

    private static float Distance(Point a, Point b) => MathF.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));
    private static string Key(Client client, string requestId) => client.Id + ":" + requestId;
    private static LootReply Reply(string roundId, string requestId, string chestId, string status, string? itemId = null, string? reason = null) =>
        new("loot-result", roundId, requestId, chestId, status, itemId, reason);

    public LootReply? Handle(Client client, string roundId, string requestId, string chestId, string stage)
    {
        var key = Key(client, requestId);
        var now = Environment.TickCount64;
        if (stage == "cancel")
        {
            if (searches.TryGetValue(client.Id, out var current) && current.RequestId == requestId) Cancel(client);
            return null;
        }
        if (offers.TryGetValue(key, out var pending)) return Reply(roundId, requestId, chestId, "offered", pending.Chest.ItemId);
        if (usedRequests.Contains(key) || usedRequests.Count >= 4096)
            return Reply(roundId, requestId, chestId, "rejected", reason: "REQUEST_EXPIRED");
        var chest = Chests.Find(q => q.Id == chestId);
        if (chest is null || client.Position is null || Distance(client.Position, new Point(chest.X, chest.Y)) >= Rules.Range
            || !CampusWorld.LineOfSight(client.Position, new Point(chest.X, chest.Y)))
        {
            Cancel(client);
            usedRequests.Add(key);
            return Reply(roundId, requestId, chestId, "rejected", reason: "OUT_OF_RANGE");
        }
        if (chest.ClaimedBy is not null || offers.Values.Any(offer => offer.Chest == chest))
        {
            Cancel(client);
            usedRequests.Add(key);
            return Reply(roundId, requestId, chestId, "rejected", reason: "CHEST_UNAVAILABLE");
        }
        if (!searches.TryGetValue(client.Id, out var search) || search.RequestId != requestId || search.ChestId != chestId)
        {
            if (stage != "hold") return Reply(roundId, requestId, chestId, "rejected", reason: "SEARCH_CANCELLED");
            Cancel(client);
            search = new(requestId, chestId, now, now);
        }
        if (now - search.LastAt > Rules.HeartbeatTimeoutMs)
        {
            Cancel(client);
            usedRequests.Add(key);
            return Reply(roundId, requestId, chestId, "rejected", reason: "SEARCH_CANCELLED");
        }
        searches[client.Id] = search with { LastAt = now };
        if (stage != "claim") return null;
        if (now - search.StartedAt < Rules.SearchDurationMs)
            return Reply(roundId, requestId, chestId, "rejected", reason: "SEARCH_INCOMPLETE");
        searches.Remove(client.Id);
        usedRequests.Add(key);
        offers.Add(key, new(client.Id, chest));
        return Reply(roundId, requestId, chestId, "offered", chest.ItemId);
    }

    public void Acknowledge(Client client, string requestId, bool accepted)
    {
        // An offer belongs to this live connection until acknowledged or disconnected.
        // Expiring it silently could award the same chest to a second player while
        // the original recipient is inserting a delayed offer.
        if (!offers.Remove(Key(client, requestId), out var offer)) return;
        if (accepted) offer.Chest.ClaimedBy = client.Id;
    }

    public void Cancel(Client client)
    {
        if (searches.Remove(client.Id, out var search)) usedRequests.Add(Key(client, search.RequestId));
    }

    public void Leave(Client client)
    {
        Cancel(client);
        foreach (var key in offers.Where(entry => entry.Value.PlayerId == client.Id).Select(entry => entry.Key).ToArray()) offers.Remove(key);
    }

    private sealed record Search(string RequestId, string ChestId, long StartedAt, long LastAt);
    private sealed record Offer(string PlayerId, RoomChest Chest);
}

sealed record LootRules(int SearchDurationMs, int HeartbeatTimeoutMs, float Range, string[] Pool, LootZone[] Zones, WorldRect[] Occlusion, FixedLootPoint[] Fixed);
sealed record LootZone(string Id, float X, float Y, float Width, float Height);
sealed record FixedLootPoint(float X, float Y);
sealed record RoomChest(string Id, float X, float Y, string ZoneId, string ItemId)
{
    public string? ClaimedBy { get; set; }
}
sealed record LootReply(string Type, string RoundId, string RequestId, string ChestId, string Status, string? ItemId = null, string? Reason = null);
