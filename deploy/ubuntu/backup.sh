#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo 'Run with sudo: sudo bjtu-game-backup' >&2
  exit 1
fi

python3 - <<'PY'
import datetime
import os
import pathlib
import sqlite3

os.umask(0o077)
source = pathlib.Path('/var/lib/bjtu-game/game.db')
if not source.is_file():
    raise SystemExit('No database exists yet; start the game service first.')
directory = pathlib.Path('/var/backups/bjtu-game')
directory.mkdir(parents=True, exist_ok=True)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
target = directory / f'game-{stamp}.db'
with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as database:
    with sqlite3.connect(target) as output:
        database.backup(output)
        if output.execute('PRAGMA quick_check').fetchone() != ('ok',):
            raise SystemExit('Backup integrity check failed.')
print(f'Database backup: {target}')
PY
