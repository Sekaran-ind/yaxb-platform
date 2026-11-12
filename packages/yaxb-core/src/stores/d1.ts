// Stores on Cloudflare D1. Schema: migrations/0001_init.sql, 0002_kv.sql and 0003_feedback.sql (apply with `wrangler d1 migrations apply`).
// Typed against the subset of D1's API used here, so the core doesn't depend on Workers types.
import {
  newModerationItem,
  type ModerationItem,
  type ModerationStore,
  type ThreadState,
  type ThreadStore,
} from "./index.js";
import { feedbackSchema, newFeedbackItem, type FeedbackItem, type FeedbackStore } from "../feedback/index.js";
import type { AuditEvent, Moderator, ModeratorStore } from "../moderators/index.js";
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

/** Session feedback on D1 (migrations/0003_feedback.sql). */
export function createD1FeedbackStore(db: D1Like): FeedbackStore {
  type Row = { id: string; rating: FeedbackItem["rating"]; comment: string | null; mode: FeedbackItem["mode"]; language: FeedbackItem["language"]; profile: number; answers: number; created_at: string };
  return {
    async add(input) {
      const item = newFeedbackItem(feedbackSchema.parse(input));
      await db
        .prepare("INSERT INTO feedback (id, rating, comment, mode, language, profile, answers, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
        .bind(item.id, item.rating, item.comment ?? null, item.mode, item.language, item.profile ? 1 : 0, item.answers, item.created_at)
        .run();
      return item;
    },
    async list(limit = 500) {
      const { results } = await db
        .prepare("SELECT id, rating, comment, mode, language, profile, answers, created_at FROM feedback ORDER BY created_at DESC LIMIT ?1")
        .bind(Math.min(Math.max(limit, 1), 2000))
        .all<Row>();
      return results.map(({ comment, profile, ...r }) => ({ ...r, profile: profile === 1, ...(comment ? { comment } : {}) }));
    },
  };
}

/** Moderators, profiles and the audit log on D1 (migrations/0004_moderators.sql). */
export function createD1ModeratorStore(db: D1Like): ModeratorStore {
  type Row = Omit<Moderator, "roles"> & { roles: string };
  const COLS = "id, name, label, roles, status, key_prefix, created_at, expires_at, last_seen_at, reviews";
  const mod = (r: Row | null): Moderator | null => (r ? { ...r, roles: JSON.parse(r.roles) as Moderator["roles"] } : null);
  return {
    async list() {
      const { results } = await db.prepare(`SELECT ${COLS} FROM moderators ORDER BY name`).all<Row>();
      return results.map((r) => mod(r)!);
    },
    async get(id) {
      return mod(await db.prepare(`SELECT ${COLS} FROM moderators WHERE id = ?1`).bind(id).first<Row>());
    },
    async byKeyHash(hash) {
      return mod(await db.prepare(`SELECT ${COLS} FROM moderators WHERE key_hash = ?1`).bind(hash).first<Row>());
    },
    async keyHashOf(id) {
      return (await db.prepare("SELECT key_hash FROM moderators WHERE id = ?1").bind(id).first<{ key_hash: string }>())?.key_hash ?? null;
    },
    async create(m, keyHash) {
      await db
        .prepare("INSERT INTO moderators (id, name, label, roles, status, key_hash, key_prefix, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
        .bind(m.id, m.name, m.label, JSON.stringify(m.roles), m.status, keyHash, m.key_prefix, m.created_at, m.expires_at)
        .run();
      return { ...m, last_seen_at: null, reviews: 0 };
    },
    async update(id, patch, keyHash) {
      const sets: string[] = [];
      const values: unknown[] = [];
      const put = (col: string, v: unknown) => {
        values.push(v);
        sets.push(`${col} = ?${values.length}`);
      };
      for (const [k, v] of Object.entries(patch)) put(k, k === "roles" ? JSON.stringify(v) : v);
      if (keyHash) put("key_hash", keyHash);
      if (sets.length) {
        values.push(id);
        await db.prepare(`UPDATE moderators SET ${sets.join(", ")} WHERE id = ?${values.length}`).bind(...values).run();
      }
      return this.get(id);
    },
    async getProfile(id) {
      const r = await db.prepare("SELECT moderator_id, display_name, languages, sources, preferences, updated_at FROM moderator_profiles WHERE moderator_id = ?1").bind(id).first<{ moderator_id: string; display_name: string; languages: string; sources: string; preferences: string; updated_at: string }>();
      return r ? { ...r, languages: JSON.parse(r.languages), sources: JSON.parse(r.sources), preferences: JSON.parse(r.preferences) } : null;
    },
    async putProfile(p) {
      await db
        .prepare(
          "INSERT INTO moderator_profiles (moderator_id, display_name, languages, sources, preferences, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (moderator_id) DO UPDATE SET display_name = ?2, languages = ?3, sources = ?4, preferences = ?5, updated_at = ?6",
        )
        .bind(p.moderator_id, p.display_name, JSON.stringify(p.languages), JSON.stringify(p.sources), JSON.stringify(p.preferences), p.updated_at)
        .run();
    },
    async audit(e) {
      await db
        .prepare("INSERT INTO audit (id, at, actor_type, actor_id, actor_name, action, target_id, details) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
        .bind(e.id, e.at, e.actor_type, e.actor_id, e.actor_name, e.action, e.target_id, e.details ? JSON.stringify(e.details) : null)
        .run();
    },
    async auditLog({ limit = 100, actorId, before } = {}) {
      const where: string[] = [];
      const values: unknown[] = [];
      if (actorId) where.push(`actor_id = ?${values.push(actorId)}`);
      if (before) where.push(`at < ?${values.push(before)}`);
      values.push(Math.min(Math.max(limit, 1), 500));
      const { results } = await db
        .prepare(`SELECT id, at, actor_type, actor_id, actor_name, action, target_id, details FROM audit ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY at DESC LIMIT ?${values.length}`)
        .bind(...values)
        .all<Omit<AuditEvent, "details"> & { details: string | null }>();
      return results.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
    },
  };
}
