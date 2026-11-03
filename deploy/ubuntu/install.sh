#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo 'Run from the extracted package: sudo bash deploy/ubuntu/install.sh' >&2
  exit 1
fi

payload=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
for path in server/OnlineHost.dll dist/index.html deploy/ubuntu/bjtu-game.service deploy/ubuntu/backup.sh; do
  if [[ ! -f "$payload/$path" ]]; then
    echo "Incomplete deployment package: $path" >&2
    exit 1
  fi
done
for command in dotnet python3 curl systemctl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing $command. Install prerequisites using the deployment guide." >&2
    exit 1
  fi
done
if ! dotnet --list-runtimes | grep -q '^Microsoft.AspNetCore.App 8\.'; then
  echo 'Install the ASP.NET Core 8 runtime: sudo apt-get install aspnetcore-runtime-8.0' >&2
  exit 1
fi

if ! id bjtu-game >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/bjtu-game --shell /usr/sbin/nologin bjtu-game
fi
install -d -o root -g root -m 755 /opt/bjtu-game /opt/bjtu-game/releases
install -d -o bjtu-game -g bjtu-game -m 750 /var/lib/bjtu-game
install -d -o root -g root -m 700 /var/backups/bjtu-game
install -m 750 "$payload/deploy/ubuntu/backup.sh" /usr/local/sbin/bjtu-game-backup

# Back up a live WAL database using the SQLite backup API before an update.
if [[ -f /var/lib/bjtu-game/game.db ]]; then
  /usr/local/sbin/bjtu-game-backup
fi

release="/opt/bjtu-game/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 755 "$release"
cp -a "$payload/server" "$payload/dist" "$release/"
if [[ -f "$payload/release.json" ]]; then
  cp "$payload/release.json" "$release/"
fi
chown -R root:root "$release"
chmod -R a+rX "$release"

previous=$(readlink -f /opt/bjtu-game/current || true)
activate() {
  ln -s "$1" "/opt/bjtu-game/current.next.$$"
  mv -Tf "/opt/bjtu-game/current.next.$$" /opt/bjtu-game/current
}
activate "$release"
install -m 644 "$payload/deploy/ubuntu/bjtu-game.service" /etc/systemd/system/bjtu-game.service
systemctl daemon-reload
systemctl enable bjtu-game.service

healthy=false
if systemctl restart bjtu-game.service; then
  for attempt in {1..30}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:5080/health >/dev/null; then
      healthy=true
      break
    fi
    sleep 1
  done
fi
if [[ "$healthy" != true ]]; then
  journalctl -u bjtu-game.service -n 30 --no-pager >&2
  if [[ -n "$previous" && -d "$previous/server" ]]; then
    activate "$previous"
    systemctl restart bjtu-game.service
    echo 'Startup failed; restored the previous code release. Database backup was retained.' >&2
  else
    systemctl stop bjtu-game.service
  fi
  exit 1
fi

echo "Installed release: $release"
echo 'Service is enabled at boot and listening on 127.0.0.1:5080.'
echo 'Database: /var/lib/bjtu-game/game.db'
echo 'Back up at any time: sudo bjtu-game-backup'
echo 'Use an SSH localhost tunnel for initial testing, then configure public HTTPS.'
