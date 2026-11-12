// Stores on Cloudflare D1. Schema: migrations/0001_init.sql and 0002_kv.sql (apply with `wrangler d1 migrations apply`).
// Typed against the subset of D1's API used here, so the core doesn't depend on Workers types.
import {
  newModerationItem,
  type ModerationItem,
  type ModerationStore,
  type ThreadState,
  type ThreadStore,
} from "./index.js";
import type { Kv, KvItem } from "./kv.js";

export interface D1Like {
  prepare(sql: string): D1StatementLike;
}
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

/** Threads untouched for this long are removed lazily, on writes. */
const THREAD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createD1ThreadStore(db: D1Like): ThreadStore {
  return {
    async get(id) {
      const row = await db.prepare("SELECT state FROM threads WHERE id = ?1").bind(id).first<{ state: string }>();
      return row ? (JSON.parse(row.state) as ThreadState) : null;
    },
    async put(id, state) {
      const now = Date.now();
      await db
        .prepare(
          "INSERT INTO threads (id, state, updated_at) VALUES (?1, ?2, ?3) " +
            "ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
        )
        .bind(id, JSON.stringify(state), now)
        .run();
      if (Math.random() < 0.02) {
        await db.prepare("DELETE FROM threads WHERE updated_at < ?1").bind(now - THREAD_TTL_MS).run();
      }
    },
    async delete(id) {
      await db.prepare("DELETE FROM threads WHERE id = ?1").bind(id).run();
    },
  };
}

export function createD1ModerationStore(db: D1Like): ModerationStore {
  return {
    async add(question, reason) {
      const item = newModerationItem(question, reason);
      await db
        .prepare("INSERT INTO moderation (id, question, reason, created_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(item.id, item.question, item.reason, item.created_at)
        .run();
      return item;
    },
    async list(limit = 100) {
      const { results } = await db
        .prepare("SELECT id, question, reason, created_at FROM moderation ORDER BY created_at DESC LIMIT ?1")
        .bind(Math.min(Math.max(limit, 1), 500))
        .all<ModerationItem>();
      return results;
    },
  };
}

/** The agent's long-term store on D1 (migrations/0002_kv.sql), for KvStore and Deep Agents' StoreBackend. */
export function createD1Kv(db: D1Like): Kv {
  type Row = { namespace: string; key: string; value: string; created_at: string; updated_at: string };
  const item = (r: Row): KvItem => ({ namespace: r.namespace.split("."), key: r.key, value: JSON.parse(r.value) as Record<string, unknown>, createdAt: r.created_at, updatedAt: r.updated_at });
  return {
    async get(namespace, key) {
      const r = await db.prepare("SELECT namespace, key, value, created_at, updated_at FROM kv WHERE namespace = ?1 AND key = ?2").bind(namespace, key).first<Row>();
      return r ? item(r) : null;
    },
    async put(namespace, key, value) {
      if (value === null) {
        await db.prepare("DELETE FROM kv WHERE namespace = ?1 AND key = ?2").bind(namespace, key).run();
        return;
      }
      const at = new Date().toISOString();
      await db
        .prepare("INSERT INTO kv (namespace, key, value, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(namespace, key, JSON.stringify(value), at)
        .run();
    },
    async search(prefix, { limit, offset }) {
      const { results } = await db
        .prepare("SELECT namespace, key, value, created_at, updated_at FROM kv WHERE namespace = ?1 OR substr(namespace, 1, length(?1) + 1) = ?1 || '.' ORDER BY updated_at DESC LIMIT ?2 OFFSET ?3")
        .bind(prefix, Math.min(limit, 500), offset)
        .all<Row>();
      return results.map(item);
    },
    async namespaces({ limit, offset }) {
      const { results } = await db.prepare("SELECT DISTINCT namespace FROM kv ORDER BY namespace LIMIT ?1 OFFSET ?2").bind(Math.min(limit, 1000), offset).all<{ namespace: string }>();
      return results.map((r) => r.namespace.split("."));
    },
  };
}
