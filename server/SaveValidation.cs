using System.Text.Json;

// Validate the persisted snapshot boundary. Combat/loot remain client simulations in this iteration.
static class SaveValidation
{
    public static bool IsValid(JsonElement data)
    {
        if (data.ValueKind != JsonValueKind.Object || !data.TryGetProperty("schemaVersion", out var schema) || schema.ValueKind != JsonValueKind.Number || !schema.TryGetInt32(out var version) || version != 3
            || !Array(data, "warehouse", out var warehouse) || !Items(warehouse, out var warehouseIds)
            || !Strings(data, "codexIds", out _) || !Strings(data, "unlockedChapterIds", out _)
            || !Strings(data, "settledRaidIds", out var settled)
            || !data.TryGetProperty("activeRaid", out var active) || !data.TryGetProperty("lastResult", out var last)) return false;
        if (active.ValueKind != JsonValueKind.Null)
        {
            if (!Text(active, "raidId", out var raidId) || settled.Contains(raidId)
                || !Array(active, "loadout", out var loadout) || loadout.GetArrayLength() > 8 || !Items(loadout, out var loadoutIds)
                || loadoutIds.Overlaps(warehouseIds)
                || loadout.EnumerateArray().Any(item => item.GetProperty("origin").GetProperty("kind").GetString() != "carry-in")) return false;
        }
        if (last.ValueKind == JsonValueKind.Null) return true;
        if (!Text(last, "raidId", out var lastId) || !settled.Contains(lastId) || !Text(last, "outcome", out var outcome)
            || !last.TryGetProperty("reason", out var reason) || !Array(last, "items", out var items) || !Items(items, out _)
            || !last.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var amount) || amount is < 0 or > 9_007_199_254_740_991
            || (last.TryGetProperty("questComplete", out var quest) && quest.ValueKind is not (JsonValueKind.True or JsonValueKind.False))) return false;
        if (outcome == "failed") return items.GetArrayLength() == 0 && reason.ValueKind == JsonValueKind.String && reason.GetString() is "death" or "timeout" or "abandoned" or "interrupted";
        return outcome == "success" && reason.ValueKind == JsonValueKind.Null && items.EnumerateArray().All(item =>
        {
            var origin = item.GetProperty("origin");
            return origin.GetProperty("kind").GetString() == "carry-in" || origin.GetProperty("obtainedInRaidId").GetString() == lastId;
        });
    }

    private static bool Text(JsonElement parent, string key, out string value)
    {
        value = "";
        if (parent.ValueKind != JsonValueKind.Object || !parent.TryGetProperty(key, out var element) || element.ValueKind != JsonValueKind.String) return false;
        value = element.GetString()!;
        return value.Length is > 0 and <= 128 && !value.Any(char.IsControl);
    }

    private static bool Array(JsonElement parent, string key, out JsonElement value)
    {
        value = default;
        return parent.ValueKind == JsonValueKind.Object && parent.TryGetProperty(key, out value) && value.ValueKind == JsonValueKind.Array && value.GetArrayLength() <= 10_000;
    }

    private static bool Strings(JsonElement parent, string key, out HashSet<string> values)
    {
        values = new(StringComparer.Ordinal);
        if (!Array(parent, key, out var array)) return false;
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String || item.GetString() is not { Length: > 0 and <= 128 } text || text.Any(char.IsControl) || !values.Add(text)) return false;
        }
        return true;
    }

    private static bool Items(JsonElement array, out HashSet<string> ids)
    {
        ids = new(StringComparer.Ordinal);
        foreach (var item in array.EnumerateArray())
        {
            if (!Text(item, "instanceId", out var id) || !ids.Add(id) || !Text(item, "itemId", out _)
                || !item.TryGetProperty("origin", out var origin) || !Text(origin, "kind", out var kind)
                || (kind != "carry-in" && (kind != "raid-loot" || !Text(origin, "obtainedInRaidId", out _)))) return false;
        }
        return true;
    }
}
