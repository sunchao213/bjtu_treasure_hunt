import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(process.env.Auth__DataDirectory ?? resolve(project, 'server/data'));
await mkdir(directory, { recursive: true });
const path = resolve(directory, 'game.db');
const database = new DatabaseSync(path);
try {
  const version = database.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) throw new Error('数据库版本高于当前程序，已停止初始化以保护原有数据。');
  const schema = await readFile(resolve(project, 'server/Database/schema.sql'), 'utf8');
  database.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE;');
  try {
    database.exec(schema);
    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
  console.log(`SQLite 数据库已就绪：${path}`);
  console.log('账号和云存档由游戏服务维护，旧账号文件会在服务启动时自动迁移。');
} finally {
  database.close();
}
