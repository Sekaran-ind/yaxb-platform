// yaxb-box's one SQLite database (node:sqlite), replicated by Litestream (deploy/litestream.yml).
//
//   records   notebooks and conversations: (collection, id) -> JSON, with an optional parent
//             (a conversation's notebook) for listing
//   kv        a LangGraph store for Deep Agents' StoreBackend: (namespace, key) -> JSON value
//   mailbox   cases on their way between devices (LIB-42..48): kept until someone with the role
//             picks one up or it expires; picking it up deletes its body
//   beacons   who holds which case, for moderators: a reference, titles, a role; never answers
//
// WAL mode is required twice over (as in clinux-box): concurrent readers alongside one writer, and
// Litestream only replicates WAL-mode databases. busy_timeout makes a second writer wait instead of
// failing while Litestream holds its read transaction during a checkpoint.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const COLLECTIONS = ['notebooks', 'threads'];
export const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const NAMESPACE = /^[A-Za-z0-9_.:-]{1,200}$/;

const MIGRATIONS = [
  `CREATE TABLE records (
     collection TEXT NOT NULL,
     id TEXT NOT NULL,
     parent TEXT,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (collection, id)
   );
   CREATE INDEX records_parent ON records (collection, parent, updated_at);
   CREATE TABLE kv (
     namespace TEXT NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (namespace, key)
   );`,
  `CREATE TABLE mailbox (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     to_roles TEXT,
     to_member TEXT,
     to_device TEXT,
     body TEXT,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     picked_by TEXT
   );
   CREATE INDEX mailbox_expires ON mailbox (expires_at);
   CREATE TABLE beacons (
     case_id TEXT PRIMARY KEY,
     body TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );`,
];

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const s = {
    get: db.prepare('SELECT id, parent, data, updated_at FROM records WHERE collection = ? AND id = ?'),
    list: db.prepare('SELECT id, parent, data, updated_at FROM records WHERE collection = ? ORDER BY updated_at DESC LIMIT ?'),
    listByParent: db.prepare('SELECT id, parent, data, updated_at FROM records WHERE collection = ? AND parent = ? ORDER BY updated_at DESC LIMIT ?'),
    put: db.prepare(`INSERT INTO records (collection, id, parent, data, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET parent = excluded.parent, data = excluded.data, updated_at = excluded.updated_at`),
    del: db.prepare('DELETE FROM records WHERE collection = ? AND id = ?'),
    delByParent: db.prepare('DELETE FROM records WHERE collection = ? AND parent = ?'),
    kvGet: db.prepare('SELECT namespace, key, value, created_at, updated_at FROM kv WHERE namespace = ? AND key = ?'),
    kvPut: db.prepare(`INSERT INTO kv (namespace, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
    kvDel: db.prepare('DELETE FROM kv WHERE namespace = ? AND key = ?'),
    kvSearch: db.prepare(`SELECT namespace, key, value, created_at, updated_at FROM kv
      WHERE namespace = ? OR substr(namespace, 1, length(?) + 1) = ? || '.' ORDER BY updated_at DESC LIMIT ? OFFSET ?`),
    kvNamespaces: db.prepare('SELECT DISTINCT namespace FROM kv ORDER BY namespace LIMIT ? OFFSET ?'),
    mbPurge: db.prepare('DELETE FROM mailbox WHERE expires_at <= ?'),
    bcPurge: db.prepare('DELETE FROM beacons WHERE expires_at <= ?'),
    mbPut: db.prepare('INSERT OR IGNORE INTO mailbox (id, kind, to_roles, to_member, to_device, body, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    mbOpen: db.prepare('SELECT id, to_roles, to_member, to_device, body FROM mailbox WHERE picked_by IS NULL ORDER BY created_at LIMIT 500'),
    mbGet: db.prepare('SELECT picked_by, expires_at FROM mailbox WHERE id = ?'),
    mbPick: db.prepare('UPDATE mailbox SET picked_by = ?, body = NULL WHERE id = ? AND picked_by IS NULL'),
    bcPut: db.prepare(`INSERT INTO beacons (case_id, body, updated_at, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, expires_at = excluded.expires_at`),
    bcList: db.prepare('SELECT body FROM beacons ORDER BY updated_at LIMIT 500'),
  };
  const purge = () => {
    const at = new Date().toISOString();
    s.mbPurge.run(at);
    s.bcPurge.run(at);
  };

  const record = (r) => {
    try {
      return { id: r.id, parent: r.parent, data: JSON.parse(r.data), updatedAt: r.updated_at };
    } catch {
      return null;
    }
  };
  const item = (r) => {
    try {
      return { namespace: r.namespace.split('.'), key: r.key, value: JSON.parse(r.value), createdAt: r.created_at, updatedAt: r.updated_at };
    } catch {
      return null;
    }
  };

  return {
    raw: db,
    get: (collection, id) => {
      const r = s.get.get(collection, id);
      return r ? record(r) : null;
    },
    list: (collection, { parent, limit = 500 } = {}) =>
      (parent === undefined ? s.list.all(collection, limit) : s.listByParent.all(collection, parent, limit)).map(record).filter(Boolean),
    put: (collection, id, parent, data) => {
      const at = new Date().toISOString();
      s.put.run(collection, id, parent ?? null, JSON.stringify(data), at);
      return { id, parent: parent ?? null, data, updatedAt: at };
    },
    /** Deleting a notebook deletes its conversations. */
    delete: (collection, id) => {
      db.exec('BEGIN');
      try {
        if (collection === 'notebooks') s.delByParent.run('threads', id);
        s.del.run(collection, id);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    kvGet: (namespace, key) => {
      const r = s.kvGet.get(namespace, key);
      return r ? item(r) : null;
    },
    kvPut: (namespace, key, value) => {
      const at = new Date().toISOString();
      if (value === null) s.kvDel.run(namespace, key);
      else s.kvPut.run(namespace, key, JSON.stringify(value), at, at);
    },
    /** Items in a namespace and every namespace below it. */
    kvSearch: (prefix, { limit = 100, offset = 0 } = {}) => s.kvSearch.all(prefix, prefix, prefix, limit, offset).map(item).filter(Boolean),
    kvNamespaces: ({ limit = 100, offset = 0 } = {}) => s.kvNamespaces.all(limit, offset).map((r) => r.namespace.split('.')),
    /** An envelope (LIB-42..48), kept until picked up or expired. */
    mailboxPost: (e) => {
      purge();
      s.mbPut.run(e.id, e.kind, e.to.roles ? JSON.stringify(e.to.roles) : null, e.to.member ?? null, e.to.device ?? null, JSON.stringify(e), e.created_at, e.expires_at);
    },
    mailboxInbox: ({ roles = [], member, device }) => {
      purge();
      return s.mbOpen
        .all()
        .filter((r) => (r.to_member && r.to_member === member) || (r.to_device && r.to_device === device) || (r.to_roles && JSON.parse(r.to_roles).some((x) => roles.includes(x))))
        .map((r) => JSON.parse(r.body));
    },
    mailboxPick: (id, by) => {
      purge();
      return s.mbPick.run(by, id).changes > 0;
    },
    mailboxStatus: (ids) => {
      const now = new Date().toISOString();
      return Object.fromEntries(
        ids.map((id) => {
          const r = s.mbGet.get(id);
          const state = !r ? 'expired' : r.picked_by ? 'delivered' : r.expires_at <= now ? 'expired' : 'waiting';
          return [id, { state, picked_by: r?.picked_by ?? null }];
        }),
      );
    },
    beaconPut: (b) => s.bcPut.run(b.case_id, JSON.stringify(b), b.updated_at, b.expires_at),
    beaconList: () => {
      purge();
      return s.bcList.all().map((r) => JSON.parse(r.body));
    },
    close: () => db.close(),
  };
}
