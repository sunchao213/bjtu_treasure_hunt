import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { test } from 'node:test';

const schema = await readFile(new URL('../../server/Database/schema.sql', import.meta.url), 'utf8');
const open = (path = ':memory:') => {
  const db = new DatabaseSync(path);
  db.exec(schema);
  return db;
};
const addAccount = (db, id, username) =>
  db
    .prepare(
      'INSERT INTO accounts(id, username, display_name, password_salt, password_hash, created_at) VALUES(?,?,?,?,?,?)',
    )
    .run(id, username, username, 'salt', 'hash', new Date().toISOString());

test('the actual service schema enforces account uniqueness and save ownership', () => {
  const db = open();
  try {
    addAccount(db, 'alice-id', 'Alice');
    assert.throws(() => addAccount(db, 'other-id', 'ALICE'), /UNIQUE/);
    const save = db.prepare('INSERT INTO player_saves(user_id, data, updated_at) VALUES(?,?,?)');
    assert.throws(() => save.run('missing-account', '{}', 'now'), /FOREIGN KEY/);
    assert.throws(() => save.run('alice-id', 'broken-json', 'now'), /CHECK/);
    save.run('alice-id', '{}', 'now');
    assert.throws(() => db.prepare('UPDATE player_saves SET revision=-1').run(), /CHECK/);
    db.prepare('DELETE FROM accounts WHERE id=?').run('alice-id');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM player_saves').get().count, 0);
  } finally {
    db.close();
  }
});

test('a failed migration transaction rolls back every inserted account', () => {
  const db = open();
  try {
    db.exec('BEGIN IMMEDIATE');
    addAccount(db, 'first', 'explorer');
    assert.throws(() => addAccount(db, 'second', 'EXPLORER'), /UNIQUE/);
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM legacy_imports').get().count, 0);
  } finally {
    db.close();
  }
});

test('schema initialization is repeatable and an online SQLite backup preserves committed progress', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bjtu-database-test-'));
  let db;
  try {
    db = open(join(directory, 'original.db'));
    db.exec('PRAGMA journal_mode=WAL');
    addAccount(db, 'alice-id', 'Alice');
    db.prepare('INSERT INTO player_saves(user_id, data, revision, updated_at) VALUES(?,?,?,?)').run(
      'alice-id',
      '{"codexIds":["school-badge"]}',
      7,
      'now',
    );
    db.exec(schema);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    await backup(db, join(directory, 'backup.db'));
    const restored = new DatabaseSync(join(directory, 'backup.db'), { readOnly: true });
    try {
      assert.equal(restored.prepare('SELECT revision FROM player_saves').get().revision, 7);
      assert.equal(
        JSON.parse(restored.prepare('SELECT data FROM player_saves').get().data).codexIds[0],
        'school-badge',
      );
      assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally {
      restored.close();
    }
  } finally {
    db?.close();
    assert(directory.startsWith(join(tmpdir(), 'bjtu-database-test-')));
    await rm(directory, { recursive: true, force: true });
  }
});
