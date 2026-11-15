param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Get-SourceFingerprint {
  $paths = @('src', 'public', 'server', 'deploy/ubuntu', 'scripts/package-ubuntu.ps1',
    'docs/ubuntu-deployment.md', 'package.json', 'package-lock.json', 'index.html',
    'vite.config.ts', 'tsconfig.json')
  $records = foreach ($path in $paths) {
    $absolute = Join-Path $projectRoot $path
    $files = if (Test-Path -LiteralPath $absolute -PathType Container) {
      Get-ChildItem -LiteralPath $absolute -Recurse -File -Force
    } else {
      Get-Item -LiteralPath $absolute
    }
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
      if ($relative -match '^server/(bin|obj|data|backups)/') { continue }
      '{0} {1}' -f $relative, (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
  }
  return (($records | Sort-Object) -join "`n")
}

$before = Get-SourceFingerprint
$releaseName = 'bjtu-game-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$artifactRoot = Join-Path $projectRoot 'artifacts/ubuntu'
$releaseRoot = Join-Path $artifactRoot $releaseName
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null

& npm.cmd run check
if ($LASTEXITCODE -ne 0) { throw 'Frontend checks or build failed; no deployment archive was created.' }
& dotnet publish server/OnlineHost.csproj --configuration Release --no-self-contained '-p:UseAppHost=false' '-p:DebugType=None' --output (Join-Path $releaseRoot 'server')
if ($LASTEXITCODE -ne 0) { throw 'Server publish failed; no deployment archive was created.' }

Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination (Join-Path $releaseRoot 'dist') -Recurse
New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'deploy') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy/ubuntu') -Destination (Join-Path $releaseRoot 'deploy/ubuntu') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/ubuntu-deployment.md') -Destination (Join-Path $releaseRoot 'DEPLOYMENT.md')

$after = Get-SourceFingerprint
if ($before -cne $after) {
  throw 'Source files changed during packaging. Finish the edits and run again; no deployment archive was created.'
}

# Published Web SDK content must never contain local accounts, saves or backups.
$unsafeFiles = Get-ChildItem -LiteralPath (Join-Path $releaseRoot 'server') -Recurse -File -Force | Where-Object {
  $relative = $_.FullName.Substring($releaseRoot.Length + 1).Replace('\', '/')
  $relative -match '^server/(data|backups)/' -or $_.Name -match '(?i)(\.db($|-)|^accounts\.json$|^\.env)'
}
if ($unsafeFiles) { throw 'Publish output contains player data or environment files; no archive was created.' }
if (!(Test-Path -LiteralPath (Join-Path $releaseRoot 'server/runtimes/linux-x64/native/libe_sqlite3.so'))) {
  throw 'Linux x64 SQLite native library is missing.'
}

$commit = & git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify the source commit.' }
$stream = [System.IO.MemoryStream]::new([System.Text.Encoding]::UTF8.GetBytes($after))
try { $fingerprint = (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash } finally { $stream.Dispose() }
$metadata = [ordered]@{
  release = $releaseName
  builtAtUtc = [DateTime]::UtcNow.ToString('o')
  baseCommit = $commit.Trim()
  sourceFingerprint = $fingerprint
  source = 'Current working files; uncommitted edits are included.'
  runtime = 'ASP.NET Core 8; Ubuntu 24.04 x86_64'
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $releaseRoot 'release.json') -Encoding UTF8
$archive = Join-Path $artifactRoot ($releaseName + '.zip')
Compress-Archive -Path (Join-Path $releaseRoot '*') -DestinationPath $archive -CompressionLevel Optimal
$checksum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($archive + '.sha256', "$checksum  $releaseName.zip`n", [System.Text.Encoding]::ASCII)
Write-Output "Deployment archive: $archive"
Write-Output "SHA256: $checksum"
