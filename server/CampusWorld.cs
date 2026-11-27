using System.Text.Json;

static class CampusWorld
{
    public static CampusGeometry Geometry { get; } = Load();

    private static CampusGeometry Load()
    {
        using var stream = typeof(CampusWorld).Assembly.GetManifestResourceStream("campus-geometry.json")
            ?? throw new InvalidOperationException("Shared campus geometry is missing.");
        return JsonSerializer.Deserialize<CampusGeometry>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("Shared campus geometry is invalid.");
    }

    public static Point Spawn(int seat) => Geometry.SpawnPositions[Math.Clamp(seat, 0, Geometry.SpawnPositions.Length - 1)];

    // Mirrors movePlayer: normalized input, bounded timesteps, substeps and axis sliding.
    public static Point Move(Point position, float dx, float dy, float elapsedMs)
    {
        var magnitude = MathF.Sqrt(dx * dx + dy * dy);
        if (magnitude <= 0 || elapsedMs <= 0) return position;
        var distance = Geometry.PlayerSpeed * Math.Min(elapsedMs, 100) / 1000;
        var steps = Math.Max(1, (int)Math.Ceiling(distance / Math.Max(Geometry.PlayerRadius, 1)));
        var stepX = dx / magnitude * distance / steps;
        var stepY = dy / magnitude * distance / steps;
        var result = position;
        var radius = Geometry.PlayerRadius;
        var bounds = Geometry.Bounds;
        for (var i = 0; i < steps; i++)
        {
            var x = new Point(Math.Clamp(result.X + stepX, bounds.X + radius, bounds.X + bounds.Width - radius), result.Y);
            if (Clear(x)) result = x;
            var y = new Point(result.X, Math.Clamp(result.Y + stepY, bounds.Y + radius, bounds.Y + bounds.Height - radius));
            if (Clear(y)) result = y;
        }
        return result;
    }

    public static bool LineOfSight(Point a, Point b)
    {
        var steps = Math.Max(1, (int)Math.Ceiling(Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y)) / 4));
        for (var i = 0; i <= steps; i++)
        {
            var x = a.X + (b.X - a.X) * i / steps;
            var y = a.Y + (b.Y - a.Y) * i / steps;
            if (Geometry.Obstacles.Any(w => x > w.X && x < w.X + w.Width && y > w.Y && y < w.Y + w.Height)) return false;
        }
        return true;
    }

    private static bool Clear(Point point) =>
        !Geometry.Obstacles.Any(wall =>
            point.X + Geometry.PlayerRadius > wall.X && point.X - Geometry.PlayerRadius < wall.X + wall.Width &&
            point.Y + Geometry.PlayerRadius > wall.Y && point.Y - Geometry.PlayerRadius < wall.Y + wall.Height);
}

sealed record CampusGeometry(float Width, float Height, float PlayerRadius, float PlayerSpeed, Point Spawn, WorldRect Bounds, WorldRect[] Buildings, WorldRect Lake, WorldRect[] Obstacles, Point[] SpawnPositions, LootZone[] LootZones);
sealed record WorldRect(float X, float Y, float Width, float Height);
