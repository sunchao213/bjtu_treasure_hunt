import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(process.env.Auth__DataDirectory ?? resolve(project, 'server/data'));
const backups = resolve(project, 'server/backups');
await mkdir(backups, { recursive: true });
const target = resolve(backups, `game-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.db`);
const database = new DatabaseSync(resolve(directory, 'game.db'), { readOnly: true });
try {
  await backup(database, target);
  console.log(`数据库一致性备份已保存：${target}`);
} finally {
  database.close();
}
