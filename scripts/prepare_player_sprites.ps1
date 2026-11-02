param(
  [string]$Source = "$PSScriptRoot\..\public\assets\characters\player\player-source.png",
  [string]$Output = "$PSScriptRoot\..\public\assets\characters\player"
)

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Collections.Generic;

public static class PlayerSpriteBuilder
{
    private const int CellWidth = 384;
    private const int CellHeight = 256;
    private const int FrameWidth = 128;
    private const int FrameHeight = 160;
    private const int FramesPerDirection = 5;

    private static bool BackgroundCandidate(Color color)
    {
        int max = Math.Max(color.R, Math.Max(color.G, color.B));
        int min = Math.Min(color.R, Math.Min(color.G, color.B));
        int average = (color.R + color.G + color.B) / 3;
        return max - min <= 22 && average >= 25 && average <= 245;
    }

    private static bool[,] FindBackground(Bitmap cell)
    {
        var background = new bool[CellWidth, CellHeight];
        var visited = new bool[CellWidth, CellHeight];
        var queue = new Queue<Point>();
        for (int x = 0; x < CellWidth; x++)
        {
            TrySeed(cell, x, 0, visited, queue);
            TrySeed(cell, x, CellHeight - 1, visited, queue);
        }
        for (int y = 0; y < CellHeight; y++)
        {
            TrySeed(cell, 0, y, visited, queue);
            TrySeed(cell, CellWidth - 1, y, visited, queue);
        }
        int[] dx = { -1, 1, 0, 0 };
        int[] dy = { 0, 0, -1, 1 };
        while (queue.Count > 0)
        {
            Point point = queue.Dequeue();
            background[point.X, point.Y] = true;
            for (int i = 0; i < 4; i++)
            {
                int nx = point.X + dx[i];
                int ny = point.Y + dy[i];
                if (nx < 0 || nx >= CellWidth || ny < 0 || ny >= CellHeight || visited[nx, ny]) continue;
                visited[nx, ny] = true;
                if (BackgroundCandidate(cell.GetPixel(nx, ny))) queue.Enqueue(new Point(nx, ny));
            }
        }
        return background;
    }

    private static void TrySeed(Bitmap cell, int x, int y, bool[,] visited, Queue<Point> queue)
    {
        if (visited[x, y]) return;
        visited[x, y] = true;
        if (BackgroundCandidate(cell.GetPixel(x, y))) queue.Enqueue(new Point(x, y));
    }

    private static Bitmap CleanCell(Bitmap cell, bool[,] background, out Rectangle bounds)
    {
        var cleaned = new Bitmap(CellWidth, CellHeight, PixelFormat.Format32bppArgb);
        int minX = CellWidth, minY = CellHeight, maxX = -1, maxY = -1;
        for (int y = 0; y < CellHeight; y++)
        {
            for (int x = 0; x < CellWidth; x++)
            {
                Color color = cell.GetPixel(x, y);
                if (background[x, y])
                {
                    cleaned.SetPixel(x, y, Color.Transparent);
                    continue;
                }
                cleaned.SetPixel(x, y, color);
                minX = Math.Min(minX, x);
                minY = Math.Min(minY, y);
                maxX = Math.Max(maxX, x);
                maxY = Math.Max(maxY, y);
            }
        }
        bounds = maxX < 0
            ? new Rectangle(0, 0, CellWidth, CellHeight)
            : Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
        return cleaned;
    }

    public static void Build(string sourcePath, string outputDirectory)
    {
        Directory.CreateDirectory(outputDirectory);
        using (var source = new Bitmap(sourcePath))
        {
        if (source.Width != 1536 || source.Height != 1024)
            throw new InvalidOperationException("Expected 1536x1024 player source image.");

        string[] states = { "idle", "walk", "hurt", "death", "attack" };
        // The supplied sheet has no attack row; attack reuses the hurt pose as feedback.
        int[] sourceRows = { 0, 1, 2, 3, 2 };
        int[] sourceColumnsForDirection = { 1, 0, 2, 3 }; // up, down, left, right

        for (int stateIndex = 0; stateIndex < states.Length; stateIndex++)
        {
            using (var strip = new Bitmap(FrameWidth * FramesPerDirection * 4, FrameHeight, PixelFormat.Format32bppArgb))
            using (var graphics = Graphics.FromImage(strip))
            {
            graphics.Clear(Color.Transparent);
            graphics.CompositingMode = CompositingMode.SourceCopy;
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            int row = sourceRows[stateIndex];

            for (int direction = 0; direction < 4; direction++)
            {
                int column = sourceColumnsForDirection[direction];
                using (var cell = source.Clone(
                    new Rectangle(column * CellWidth, row * CellHeight, CellWidth, CellHeight),
                    PixelFormat.Format32bppArgb))
                {
                bool[,] background = FindBackground(cell);
                Rectangle bounds;
                using (var cleaned = CleanCell(cell, background, out bounds))
                {
                double scale = Math.Min(116.0 / Math.Max(bounds.Width, 1), 150.0 / Math.Max(bounds.Height, 1));
                int drawWidth = Math.Max(1, (int)Math.Round(bounds.Width * scale));
                int drawHeight = Math.Max(1, (int)Math.Round(bounds.Height * scale));
                for (int frame = 0; frame < FramesPerDirection; frame++)
                {
                    int x = direction * FramesPerDirection * FrameWidth + frame * FrameWidth + (FrameWidth - drawWidth) / 2;
                    int y = FrameHeight - 4 - drawHeight;
                    graphics.DrawImage(cleaned, new Rectangle(x, y, drawWidth, drawHeight), bounds, GraphicsUnit.Pixel);
                }
                }
                }
            }
            strip.Save(Path.Combine(outputDirectory, "player-" + states[stateIndex] + ".png"), ImageFormat.Png);
            }
        }
        }
    }
}
'@

[PlayerSpriteBuilder]::Build((Resolve-Path $Source).Path, (Resolve-Path $Output).Path)
Write-Host "Generated player sprites in $Output"
