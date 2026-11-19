// yaxb-box's one SQLite database (node:sqlite), replicated by Litestream (deploy/litestream.yml).
//
//   records   notebooks, conversations, schedules and service data: (collection, id) -> JSON, with
//             an optional parent (a conversation's notebook) for listing. Sync v2 (SYN-1..6, after
//             Cübo's protocol): every row has a version (writes so far), a delete is a tombstone
//             (deleted = 1), and seq orders every change so a device pulls only what changed since
//             its cursor. v1 (whole lists, blind writes) is served from the same rows: a v1 write
//             bumps the version and a v1 delete leaves a tombstone, so v2 devices see both.
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

export const COLLECTIONS = ['notebooks', 'threads', 'schedule', 'service-data'];
export const PAGE_SIZE = 500;
export const encodeCursor = (seq) => `c${Number(seq || 0).toString(36)}`;
export const decodeCursor = (cursor) => (/^c[0-9a-z]+$/.test(String(cursor || '')) ? parseInt(String(cursor).slice(1), 36) : 0);
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
  `CREATE TABLE events (
     id TEXT PRIMARY KEY,
     service TEXT NOT NULL,
     at TEXT NOT NULL,
     body TEXT NOT NULL
   );
   CREATE INDEX events_service ON events (service, at);`,
  // Sync v2: versions, tombstones and a change sequence on records.
  `ALTER TABLE records ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE records ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE records ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
   UPDATE records SET seq = rowid;
   CREATE INDEX records_seq ON records (collection, seq);`,
  // Photos (MED-1): kept apart from records, by their SHA-256; replicated by Litestream with the rest.
  `CREATE TABLE media (
     hash TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     size INTEGER NOT NULL,
     data BLOB NOT NULL,
     created_at TEXT NOT NULL
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
    get: db.prepare('SELECT id, parent, data, updated_at FROM records WHERE collection = ? AND id = ? AND deleted = 0'),
    list: db.prepare('SELECT id, parent, data, updated_at FROM records WHERE collection = ? AND deleted = 0 ORDER BY updated_at DESC LIMIT ?'),
    listByParent: db.prepare('SELECT id, parent, data, updated_at FROM records WHERE collection = ? AND parent = ? AND deleted = 0 ORDER BY updated_at DESC LIMIT ?'),
    row: db.prepare('SELECT id, parent, data, updated_at, version, deleted, seq FROM records WHERE collection = ? AND id = ?'),
    nextSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM records'),
    write: db.prepare(`INSERT INTO records (collection, id, parent, data, updated_at, version, deleted, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET parent = excluded.parent, data = excluded.data, updated_at = excluded.updated_at,
        version = excluded.version, deleted = excluded.deleted, seq = excluded.seq`),
    childIds: db.prepare('SELECT id FROM records WHERE collection = ? AND parent = ? AND deleted = 0'),
    changes: db.prepare('SELECT id, parent, data, updated_at, version, deleted, seq FROM records WHERE collection = ? AND seq > ? ORDER BY seq LIMIT ?'),
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
    evPut: db.prepare('INSERT OR IGNORE INTO events (id, service, at, body) VALUES (?, ?, ?, ?)'),
    evList: db.prepare('SELECT body FROM (SELECT body, at FROM events WHERE service = ? AND at >= ? ORDER BY at DESC LIMIT ?) ORDER BY at'),
  };
  const purge = () => {
    const at = new Date().toISOString();
    s.mbPurge.run(at);
    s.bcPurge.run(at);
  };

  /** A row on the wire (sync v2): { id, version, deleted, updatedAt, data }; a tombstone has no data. */
  const envelope = (r) => {
    let data = null;
    if (!r.deleted) {
      try {
        data = JSON.parse(r.data);
      } catch {
        data = null;
      }
    }
    return { id: r.id, version: r.version, deleted: !!r.deleted, updatedAt: r.updated_at, data };
  };
  const parentOf = (collection, data) => (collection === 'threads' && data && typeof data.notebookId === 'string' ? data.notebookId : null);

  /**
   * One write (SYN-2): { ok, row } with the next version, or { conflict, row } with the box's copy
   * when baseVersion isn't the current version under 'reject-stale'; 'last-write-wins' always
   * applies. A delete leaves a tombstone; deleting a notebook tombstones its conversations.
   */
  function write(collection, { id, baseVersion = 0, data = null, deleted = false }, policy = 'reject-stale') {
    const current = s.row.get(collection, id);
    const have = current?.version || 0;
    if (policy === 'reject-stale' && Number(baseVersion || 0) !== have) return { conflict: true, row: current ? envelope(current) : null };
    if (deleted && (!current || current.deleted)) return { ok: true, row: current ? envelope(current) : null };
    const at = new Date().toISOString();
    const body = deleted ? current.data : JSON.stringify({ ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}), id });
    const parent = deleted ? current.parent : parentOf(collection, data);
    s.write.run(collection, id, parent, body, at, have + 1, deleted ? 1 : 0, s.nextSeq.get().seq);
    if (deleted && collection === 'notebooks') {
      for (const t of s.childIds.all('threads', id)) write('threads', { id: t.id, deleted: true }, 'last-write-wins');
    }
    return { ok: true, row: envelope(s.row.get(collection, id)) };
  }

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
    /** A photo by its hash (MED-1), or null. */
    media: (hash) => db.prepare('SELECT hash, type, size, data FROM media WHERE hash = ?').get(hash) ?? null,
    putMedia: (hash, type, data) =>
      void db.prepare('INSERT INTO media (hash, type, size, data, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hash) DO NOTHING').run(hash, type, data.length, data, new Date().toISOString()),
    get: (collection, id) => {
      const r = s.get.get(collection, id);
      return r ? record(r) : null;
    },
    list: (collection, { parent, limit = 500 } = {}) =>
      (parent === undefined ? s.list.all(collection, limit) : s.listByParent.all(collection, parent, limit)).map(record).filter(Boolean),
    // v1: a blind write (last write wins), still a new version, so v2 devices see it.
    put: (collection, id, parent, data) => {
      const r = write(collection, { id, data: { ...data, ...(parent ? { notebookId: parent } : {}) } }, 'last-write-wins').row;
      return { id, parent: parent ?? null, data: r.data, updatedAt: r.updatedAt };
    },
    // ── sync v2 ──
    write: (collection, op, policy) => {
      db.exec('BEGIN');
      try {
        const r = write(collection, op, policy);
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    /** Many writes in one transaction: a result per op, in order. */
    batch: (collection, ops, policy) => {
      db.exec('BEGIN');
      try {
        const results = ops.map((op) => ({ id: op.id, ...write(collection, op, policy) }));
        db.exec('COMMIT');
        return results;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    /** What changed since a cursor, oldest first, tombstones included: { rows, cursor, more }. */
    changes: (collection, cursor, limit = PAGE_SIZE) => {
      const since = decodeCursor(cursor);
      const rows = s.changes.all(collection, since, limit + 1);
      const page = rows.slice(0, limit);
      return { rows: page.map(envelope), cursor: encodeCursor(page.at(-1)?.seq ?? since), more: rows.length > limit };
    },
    /** Deleting a notebook deletes its conversations. */
    // v1: a delete leaves a tombstone (and a notebook's conversations too), so an offline v2
    // device can't push the row back unnoticed.
    delete: (collection, id) => {
      db.exec('BEGIN');
      try {
        write(collection, { id, deleted: true }, 'last-write-wins');
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
    /** A service's events (MET-2): facts about its journeys, never answers. */
    eventsAdd: (events) => {
      for (const e of events) s.evPut.run(e.id, e.service, e.at, JSON.stringify(e));
    },
    eventsList: (service, since = '', limit = 10000) => s.evList.all(service, since, limit).map((r) => JSON.parse(r.body)),
    close: () => db.close(),
  };
}
