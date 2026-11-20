// Stores on Cloudflare D1. Schema: migrations/0001..0005 (apply with `wrangler d1 migrations apply`).
// Typed against the subset of D1's API used here, so the core doesn't depend on Workers types.
import type { Review, ReviewAnswer, ReviewStore } from "../reviews/index.js";
import {
  MODERATION_NOTE_MAX,
  newModerationItem,
  type ModerationItem,
  type ModerationStore,
  type ThreadState,
  type ThreadStore,
} from "./index.js";
import { feedbackSchema, newFeedbackItem, type FeedbackItem, type FeedbackStore } from "../feedback/index.js";
import { AUDIT_GENESIS, auditHash, serially, type AuditEvent, type Moderator, type ModeratorStore } from "../moderators/index.js";
import type { CustomRole, EntryRevision, Library, LibraryEntry, LibraryStore } from "../library/index.js";
import type { Beacon, Case, CaseEvent, CaseStore, CaseSummary, Envelope, Mailbox } from "../cases/index.js";
import type { EventStore, ServiceEvent } from "../metrics/index.js";
import { MAX_LESSONS, MAX_THREAD, type DesignerStore, type DesignLesson, type DesignMessage, type DesignRun } from "../designer/index.js";
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
        .prepare("INSERT INTO moderation (id, question, reason, created_at, state) VALUES (?1, ?2, ?3, ?4, 'open')")
        .bind(item.id, item.question, item.reason, item.created_at)
        .run();
      return item;
    },
    async list(limit = 100) {
      const { results } = await db
        .prepare(`SELECT ${MOD_COLS} FROM moderation ORDER BY created_at DESC LIMIT ?1`)
        .bind(Math.min(Math.max(limit, 1), 500))
        .all<ModerationItem>();
      return results;
    },
    async handle(id, note, by) {
      await db
        .prepare("UPDATE moderation SET state = 'handled', note = ?2, handled_by = ?3, handled_at = ?4 WHERE id = ?1")
        .bind(id, note.slice(0, MODERATION_NOTE_MAX), by, new Date().toISOString())
        .run();
      return db.prepare(`SELECT ${MOD_COLS} FROM moderation WHERE id = ?1`).bind(id).first<ModerationItem>();
    },
  };
}
const MOD_COLS = "id, question, reason, created_at, state, note, handled_by, handled_at";

/** Answers sent for review and moderators' reviews on D1 (migrations/0005_reviews.sql). */
export function createD1ReviewStore(db: D1Like): ReviewStore {
  type ARow = Omit<ReviewAnswer, "refs" | "notebook"> & { refs: string; notebook_id: string | null; notebook_title: string | null };
  type RRow = Omit<Review, "marks" | "missing" | "proposal"> & { marks: string; missing: string; proposal: string | null };
  const A = "a.id, a.created_at, a.origin, a.question, a.answer, a.refs, a.notebook_id, a.notebook_title, a.mode, a.language, a.state";
  const R = "id, answer_id, at, moderator_id, moderator_name, rating, marks, missing, context, proposal, replaces";
  const toAnswer = ({ refs, notebook_id, notebook_title, ...r }: ARow): ReviewAnswer => ({ ...r, refs: JSON.parse(refs), notebook: notebook_id ? { id: notebook_id, title: notebook_title ?? "" } : null });
  const toReview = (r: RRow | null): Review | null => (r ? { ...r, marks: JSON.parse(r.marks), missing: JSON.parse(r.missing), proposal: r.proposal ? JSON.parse(r.proposal) : null } : null);
  // The latest review of an answer is the one no other review replaces.
  const LATEST = `SELECT ${R} FROM reviews r WHERE r.answer_id = ?1 AND NOT EXISTS (SELECT 1 FROM reviews n WHERE n.replaces = r.id) ORDER BY r.at DESC, r.id DESC LIMIT 1`;
  const getAnswer = async (id: string) => {
    const r = await db.prepare(`SELECT ${A} FROM review_answers a WHERE a.id = ?1`).bind(id).first<ARow>();
    return r ? toAnswer(r) : null;
  };
  const latest = async (id: string) => toReview(await db.prepare(LATEST).bind(id).first<RRow>());
  return {
    async addAnswer(a) {
      await db
        .prepare("INSERT INTO review_answers (id, created_at, origin, question, answer, refs, notebook_id, notebook_title, mode, language, state) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
        .bind(a.id, a.created_at, a.origin, a.question, a.answer, JSON.stringify(a.refs), a.notebook?.id ?? null, a.notebook?.title ?? null, a.mode, a.language, a.state)
        .run();
    },
    getAnswer,
    async listAnswers({ state, notebook, limit = 100 } = {}) {
      const where: string[] = [];
      const values: unknown[] = [];
      if (state) where.push(`a.state = ?${values.push(state)}`);
      if (notebook) where.push(`a.notebook_id = ?${values.push(notebook)}`);
      values.push(Math.min(Math.max(limit, 1), 500));
      const { results } = await db
        .prepare(`SELECT ${A} FROM review_answers a ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.created_at DESC, a.id DESC LIMIT ?${values.length}`)
        .bind(...values)
        .all<ARow>();
      return Promise.all(results.map(async (r) => ({ answer: toAnswer(r), review: await latest(r.id) })));
    },
    async addReview(r) {
      await db
        .prepare(`INSERT INTO reviews (${R}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
        .bind(r.id, r.answer_id, r.at, r.moderator_id, r.moderator_name, r.rating, JSON.stringify(r.marks), JSON.stringify(r.missing), r.context, r.proposal ? JSON.stringify(r.proposal) : null, r.replaces)
        .run();
      await db.prepare("UPDATE review_answers SET state = 'reviewed' WHERE id = ?1").bind(r.answer_id).run();
    },
    async history(id) {
      const { results } = await db.prepare(`SELECT ${R} FROM reviews WHERE answer_id = ?1 ORDER BY at DESC, id DESC`).bind(id).all<RRow>();
      return results.map((r) => toReview(r)!);
    },
    async reviewed({ since } = {}) {
      const { results } = await db
        .prepare(
          `SELECT ${A}, r.id AS r_id, r.at AS r_at, r.moderator_id, r.moderator_name, r.rating, r.marks, r.missing, r.context, r.proposal, r.replaces
           FROM review_answers a JOIN reviews r ON r.answer_id = a.id
           WHERE a.state = 'reviewed' AND NOT EXISTS (SELECT 1 FROM reviews n WHERE n.replaces = r.id)${since ? " AND a.created_at >= ?1" : ""}
           ORDER BY a.created_at, a.id LIMIT 5000`,
        )
        .bind(...(since ? [since] : []))
        .all<ARow & Omit<RRow, "id" | "at" | "answer_id"> & { r_id: string; r_at: string }>();
      return results.map(({ r_id, r_at, moderator_id, moderator_name, rating, marks, missing, context, proposal, replaces, ...a }) => ({
        answer: toAnswer(a),
        review: toReview({ id: r_id, answer_id: a.id, at: r_at, moderator_id, moderator_name, rating, marks, missing, context, proposal, replaces })!,
      }));
    },
    async proposals(limit = 50) {
      const { results } = await db
        .prepare(`SELECT ${R} FROM reviews r WHERE r.proposal IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reviews n WHERE n.replaces = r.id) ORDER BY r.at DESC LIMIT ?1`)
        .bind(Math.min(Math.max(limit, 1), 200))
        .all<RRow>();
      const out: { answer: ReviewAnswer; review: Review }[] = [];
      for (const r of results) {
        const a = await getAnswer(r.answer_id);
        if (a) out.push({ answer: a, review: toReview(r)! });
      }
      return out;
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
/**
 * Members on D1, scoped to one tenant (TEN-2): every query keeps to `tenant`, except finding a
 * member by their key hash, which looks across tenants (signing in tells the Worker the tenant).
 */
/** One audit queue per tenant in this instance, whichever request's store writes (AUD-2). */
const auditQueues = new Map<string, ReturnType<typeof serially>>();

export function createD1ModeratorStore(db: D1Like, { tenant = "default" }: { tenant?: string } = {}): ModeratorStore {
  let inOrder = auditQueues.get(tenant);
  if (!inOrder) auditQueues.set(tenant, (inOrder = serially()));
  type Row = Omit<Moderator, "roles" | "scopes"> & { roles: string; scopes: string | null };
  const COLS = "id, name, label, roles, status, key_prefix, created_at, expires_at, last_seen_at, reviews, tenant_id AS tenant, kind, scopes, linked_at";
  const mod = (r: Row | null): Moderator | null => (r ? { ...r, roles: JSON.parse(r.roles) as Moderator["roles"], scopes: r.scopes ? (JSON.parse(r.scopes) as string[]) : null } : null);
  return {
    async list() {
      const { results } = await db.prepare(`SELECT ${COLS} FROM moderators WHERE tenant_id = ?1 ORDER BY name`).bind(tenant).all<Row>();
      return results.map((r) => mod(r)!);
    },
    async get(id) {
      return mod(await db.prepare(`SELECT ${COLS} FROM moderators WHERE id = ?1 AND tenant_id = ?2`).bind(id, tenant).first<Row>());
    },
    async byKeyHash(hash) {
      return mod(await db.prepare(`SELECT ${COLS} FROM moderators WHERE key_hash = ?1`).bind(hash).first<Row>());
    },
    async keyHashOf(id) {
      return (await db.prepare("SELECT key_hash FROM moderators WHERE id = ?1 AND tenant_id = ?2").bind(id, tenant).first<{ key_hash: string }>())?.key_hash ?? null;
    },
    async create(m, keyHash) {
      await db
        .prepare("INSERT INTO moderators (id, name, label, roles, status, key_hash, key_prefix, created_at, expires_at, tenant_id, kind, scopes, linked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)")
        .bind(m.id, m.name, m.label, JSON.stringify(m.roles), m.status, keyHash, m.key_prefix, m.created_at, m.expires_at, tenant, m.kind ?? "person", m.scopes ? JSON.stringify(m.scopes) : null, m.linked_at ?? null)
        .run();
      return { ...m, kind: m.kind ?? "person", scopes: m.scopes ?? null, linked_at: m.linked_at ?? null, last_seen_at: null, reviews: 0, tenant };
    },
    async update(id, patch, keyHash) {
      const sets: string[] = [];
      const values: unknown[] = [];
      const put = (col: string, v: unknown) => {
        values.push(v);
        sets.push(`${col} = ?${values.length}`);
      };
      for (const [k, v] of Object.entries(patch)) if (k !== "tenant") put(k, k === "roles" ? JSON.stringify(v) : v);
      if (keyHash) put("key_hash", keyHash);
      if (sets.length) {
        values.push(id, tenant);
        await db.prepare(`UPDATE moderators SET ${sets.join(", ")} WHERE id = ?${values.length - 1} AND tenant_id = ?${values.length}`).bind(...values).run();
      }
      return this.get(id);
    },
    async getProfile(id) {
      const r = await db.prepare("SELECT moderator_id, display_name, languages, sources, preferences, updated_at FROM moderator_profiles WHERE moderator_id = ?1").bind(id).first<{ moderator_id: string; display_name: string; languages: string; sources: string; preferences: string; updated_at: string }>();
      return r ? { ...r, languages: JSON.parse(r.languages), sources: JSON.parse(r.sources), preferences: JSON.parse(r.preferences) } : null;
    },
    async remove(id) {
      const had = await db.prepare("SELECT id FROM moderators WHERE id = ?1 AND tenant_id = ?2").bind(id, tenant).first();
      if (!had) return false;
      await db.prepare("DELETE FROM moderator_profiles WHERE moderator_id = ?1").bind(id).run();
      await db.prepare("DELETE FROM moderators WHERE id = ?1 AND tenant_id = ?2").bind(id, tenant).run();
      return Boolean(had);
    },
    async putProfile(p) {
      await db
        .prepare(
          "INSERT INTO moderator_profiles (moderator_id, display_name, languages, sources, preferences, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (moderator_id) DO UPDATE SET display_name = ?2, languages = ?3, sources = ?4, preferences = ?5, updated_at = ?6",
        )
        .bind(p.moderator_id, p.display_name, JSON.stringify(p.languages), JSON.stringify(p.sources), JSON.stringify(p.preferences), p.updated_at)
        .run();
    },
    /**
     * The hash chain (AUD-2, migration 0015): the insert only happens while the tenant's head is
     * still the one the hash was made from (one statement; a trigger moves the head), so two writes
     * at once can't fork the chain. The one that lost reads the new head and tries again.
     */
    audit: (e) =>
      inOrder(async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, Math.random() * 20 * Math.min(attempt, 5)));
        const head = await db.prepare("SELECT hash FROM audit_heads WHERE tenant_id = ?1").bind(tenant).first<{ hash: string }>();
        const prev = head?.hash ?? AUDIT_GENESIS;
        const hash = await auditHash(e, prev);
        const r = await db
          .prepare(
            "INSERT INTO audit (id, at, actor_type, actor_id, actor_name, action, target_id, details, tenant_id, prev_hash, hash) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE COALESCE((SELECT hash FROM audit_heads WHERE tenant_id = ?9), ?12) = ?10",
          )
          .bind(e.id, e.at, e.actor_type, e.actor_id, e.actor_name, e.action, e.target_id, e.details ? JSON.stringify(e.details) : null, tenant, prev, hash, AUDIT_GENESIS)
          .run();
        const changes = (r as { meta?: { changes?: number }; changes?: number | bigint } | null)?.meta?.changes ?? Number((r as { changes?: number | bigint } | null)?.changes ?? 0);
        if (changes > 0) return;
      }
      throw new Error("The audit log is busy. Try again.");
      }),
    async auditHead() {
      const r = await db.prepare("SELECT hash, n FROM audit_heads WHERE tenant_id = ?1").bind(tenant).first<{ hash: string; n: number }>();
      return { hash: r?.hash ?? AUDIT_GENESIS, count: r?.n ?? 0 };
    },
    async auditChain(limit = 5000) {
      const { results } = await db
        .prepare("SELECT id, at, actor_type, actor_id, actor_name, action, target_id, details, prev_hash, hash FROM audit WHERE tenant_id = ?1 AND hash IS NOT NULL ORDER BY rowid DESC LIMIT ?2")
        .bind(tenant, Math.min(Math.max(limit, 1), 20000))
        .all<Omit<AuditEvent, "details"> & { details: string | null }>();
      return results.reverse().map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
    },
    async auditLog({ limit = 100, actorId, targetId, before } = {}) {
      const where: string[] = [];
      const values: unknown[] = [];
      where.push(`tenant_id = ?${values.push(tenant)}`);
      if (actorId) where.push(`actor_id = ?${values.push(actorId)}`);
      if (targetId) where.push(`target_id = ?${values.push(targetId)}`);
      if (before) where.push(`at < ?${values.push(before)}`);
      values.push(Math.min(Math.max(limit, 1), 500));
      const { results } = await db
        .prepare(`SELECT id, at, actor_type, actor_id, actor_name, action, target_id, details, prev_hash, hash FROM audit ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY at DESC LIMIT ?${values.length}`)
        .bind(...values)
        .all<Omit<AuditEvent, "details"> & { details: string | null }>();
      return results.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
    },
  };
}

/** The journey library on D1 (migrations/0006_library.sql), scoped to one tenant (TEN-3). */
export function createD1LibraryStore(db: D1Like, { tenant = "default" }: { tenant?: string } = {}): LibraryStore {
  const ENTRY_COLS =
    "id, library_id, kind, doc_id, title, yaml, status, revision, published_yaml, published_revision, owner_id, owner_name, submitted_by, submitted_by_name, submitted_at, reviewed_by, reviewed_by_name, reviewed_at, review_note, created_at, updated_at, updated_by_name, storage";
  const role = (r: { id: string; label: string; description: string | null; created_at: string }): CustomRole => ({ id: r.id, label: r.label, created_at: r.created_at, ...(r.description ? { description: r.description } : {}) });
  return {
    async roles() {
      const { results } = await db.prepare("SELECT id, label, description, created_at FROM library_roles WHERE tenant_id = ?1 ORDER BY label").bind(tenant).all<{ id: string; label: string; description: string | null; created_at: string }>();
      return results.map(role);
    },
    async putRole(r) {
      await db
        .prepare("INSERT INTO library_roles (id, label, description, created_at, tenant_id) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (tenant_id, id) DO UPDATE SET label = ?2, description = ?3")
        .bind(r.id, r.label, r.description ?? null, r.created_at, tenant)
        .run();
    },
    async removeRole(id) {
      const had = await db.prepare("SELECT id FROM library_roles WHERE id = ?1 AND tenant_id = ?2").bind(id, tenant).first();
      await db.prepare("DELETE FROM library_roles WHERE id = ?1 AND tenant_id = ?2").bind(id, tenant).run();
      return Boolean(had);
    },
    async libraries() {
      return (await db.prepare("SELECT id, name, description, status, created_by, created_at, updated_at FROM libraries WHERE tenant_id = ?1 ORDER BY name").bind(tenant).all<Library>()).results;
    },
    async library(id) {
      return db.prepare("SELECT id, name, description, status, created_by, created_at, updated_at FROM libraries WHERE id = ?1 AND tenant_id = ?2").bind(id, tenant).first<Library>();
    },
    async putLibrary(l) {
      await db
        .prepare(
          "INSERT INTO libraries (id, name, description, status, created_by, created_at, updated_at, tenant_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (id) DO UPDATE SET name = ?2, description = ?3, status = ?4, updated_at = ?7 WHERE libraries.tenant_id = ?8",
        )
        .bind(l.id, l.name, l.description, l.status, l.created_by, l.created_at, l.updated_at, tenant)
        .run();
    },
    async entries(libraryId) {
      const sql = `SELECT ${ENTRY_COLS} FROM library_entries WHERE tenant_id = ?1 ${libraryId ? "AND library_id = ?2 " : ""}ORDER BY kind, title`;
      const stmt = db.prepare(sql);
      return (await (libraryId ? stmt.bind(tenant, libraryId) : stmt.bind(tenant)).all<LibraryEntry>()).results;
    },
    async entry(id) {
      return db.prepare(`SELECT ${ENTRY_COLS} FROM library_entries WHERE id = ?1 AND tenant_id = ?2`).bind(id, tenant).first<LibraryEntry>();
    },
    async putEntry(e) {
      const cols = ENTRY_COLS.split(", ");
      const updates = cols.slice(1).map((c, i) => `${c} = ?${i + 2}`).join(", ");
      const t = cols.length + 1;
      // An id another tenant owns is never taken over.
      await db
        .prepare(`INSERT INTO library_entries (${ENTRY_COLS}, tenant_id) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")}, ?${t}) ON CONFLICT (id) DO UPDATE SET ${updates} WHERE library_entries.tenant_id = ?${t}`)
        .bind(...cols.map((c) => (e as Record<string, unknown>)[c] ?? null), tenant)
        .run();
    },
    async revisions(entryId) {
      return (await db.prepare("SELECT entry_id, revision, yaml, at, by_id, by_name, note FROM library_revisions WHERE entry_id = ?1 ORDER BY revision DESC").bind(entryId).all<EntryRevision>()).results;
    },
    async addRevision(r) {
      await db
        .prepare("INSERT INTO library_revisions (entry_id, revision, yaml, at, by_id, by_name, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
        .bind(r.entry_id, r.revision, r.yaml, r.at, r.by_id, r.by_name, r.note)
        .run();
    },
  };
}

/** The Service Designer's drafts and lessons (migration 0008). */
export function createD1DesignerStore(db: D1Like): DesignerStore {
  const RUN_COLS = "id, owner_id, title, draft_yaml, ok, entry_id, outcome, created_at";
  const LESSON_COLS = "id, text, source, decision, entry_id, run_id, created_at, created_by_name";
  const run = (r: (Omit<DesignRun, "ok"> & { ok: number }) | null): DesignRun | null => (r ? { ...r, ok: Boolean(r.ok) } : null);
  const MSG_COLS = "id, thread_id, entry_id, author_id, author_name, role, text, yaml, ok, run_id, created_at";
  type MsgRow = Omit<DesignMessage, "ok"> & { ok: number | null };
  return {
    async addMessage(m) {
      await db
        .prepare(`INSERT INTO design_messages (${MSG_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
        .bind(m.id, m.thread_id, m.entry_id, m.author_id, m.author_name, m.role, m.text, m.yaml, m.ok === null ? null : m.ok ? 1 : 0, m.run_id, m.created_at)
        .run();
    },
    async messages(id) {
      // In the order written (two messages can share a millisecond), the newest MAX_THREAD.
      const rows = await db.prepare(`SELECT ${MSG_COLS} FROM design_messages WHERE thread_id = ?1 ORDER BY created_at, rowid`).bind(id).all<MsgRow>();
      return rows.results.slice(-MAX_THREAD).map((r) => ({ ...r, ok: r.ok === null ? null : Boolean(r.ok) }));
    },
    threadOfEntry: async (entryId) => (await db.prepare("SELECT thread_id FROM design_messages WHERE entry_id = ?1 ORDER BY created_at LIMIT 1").bind(entryId).first<{ thread_id: string }>())?.thread_id ?? null,
    async threadInfo(id) {
      const r = await db
        .prepare("SELECT (SELECT author_id FROM design_messages WHERE thread_id = ?1 ORDER BY created_at LIMIT 1) AS owner_id, (SELECT entry_id FROM design_messages WHERE thread_id = ?1 AND entry_id IS NOT NULL LIMIT 1) AS entry_id")
        .bind(id)
        .first<{ owner_id: string | null; entry_id: string | null }>();
      return r?.owner_id ? { owner_id: r.owner_id, entry_id: r.entry_id } : null;
    },
    async linkThread(id, entryId) {
      await db.prepare("UPDATE design_messages SET entry_id = ?2 WHERE thread_id = ?1").bind(id, entryId).run();
    },
    async putRun(r) {
      await db
        .prepare(
          `INSERT INTO design_runs (${RUN_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (id) DO UPDATE SET title = ?3, draft_yaml = ?4, ok = ?5, entry_id = ?6, outcome = ?7`,
        )
        .bind(r.id, r.owner_id, r.title, r.draft_yaml, r.ok ? 1 : 0, r.entry_id, r.outcome, r.created_at)
        .run();
    },
    run: async (id) => run(await db.prepare(`SELECT ${RUN_COLS} FROM design_runs WHERE id = ?1`).bind(id).first()),
    runForEntry: async (entryId) => run(await db.prepare(`SELECT ${RUN_COLS} FROM design_runs WHERE entry_id = ?1 ORDER BY created_at DESC LIMIT 1`).bind(entryId).first()),
    async lessons(limit = MAX_LESSONS) {
      return (await db.prepare(`SELECT ${LESSON_COLS} FROM design_lessons ORDER BY created_at DESC LIMIT ?1`).bind(limit).all<DesignLesson>()).results;
    },
    async putLesson(l) {
      await db
        .prepare(`INSERT INTO design_lessons (${LESSON_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (id) DO UPDATE SET text = ?2`)
        .bind(l.id, l.text, l.source, l.decision, l.entry_id, l.run_id, l.created_at, l.created_by_name)
        .run();
      // Keep the newest MAX_LESSONS.
      await db.prepare("DELETE FROM design_lessons WHERE id NOT IN (SELECT id FROM design_lessons ORDER BY created_at DESC LIMIT ?1)").bind(MAX_LESSONS).run();
    },
    async removeLesson(id) {
      const had = await db.prepare("SELECT id FROM design_lessons WHERE id = ?1").bind(id).first();
      await db.prepare("DELETE FROM design_lessons WHERE id = ?1").bind(id).run();
      return Boolean(had);
    },
  };
}

/** Cases and their threads (migration 0009). */
export function createD1CaseStore(db: D1Like): CaseStore {
  const SUMMARY =
    "id, ref, entry_id, service_id, service_title, journey_id, journey_title, revision, status, waiting_step, waiting_role, finish_roles, roles, started_by, started_by_name, created_at, updated_at, closed_at, result, starter_device, assignee, assignee_name, links";
  type Row = Omit<Case, "finish_roles" | "roles" | "result" | "run" | "journey" | "links"> & { finish_roles: string; roles: string; result: string | null; run?: string; journey?: string; links: string | null };
  const linksOf = (r: Row, pins: boolean) => {
    if (!r.links) return null;
    const l = JSON.parse(r.links) as NonNullable<Case["links"]>;
    if (!pins) delete l.pins;
    return l;
  };
  const summary = (r: Row): CaseSummary => {
    const { run: _r, journey: _j, ...rest } = r;
    return { ...rest, finish_roles: JSON.parse(r.finish_roles), roles: JSON.parse(r.roles), result: r.result ? JSON.parse(r.result) : null, links: linksOf(r, false) };
  };
  const full = (r: Row | null): Case | null => (r ? { ...summary(r), links: linksOf(r, true), run: JSON.parse(r.run!), journey: JSON.parse(r.journey!) } : null);
  return {
    async put(c) {
      await db
        .prepare(
          `INSERT INTO cases (${SUMMARY}, run, journey) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?22, ?23, ?24, ?25, ?20, ?21)
           ON CONFLICT (id) DO UPDATE SET status = ?9, waiting_step = ?10, waiting_role = ?11, updated_at = ?17, closed_at = ?18, result = ?19, run = ?20, assignee = ?23, assignee_name = ?24, links = ?25`,
        )
        .bind(
          c.id,
          c.ref,
          c.entry_id,
          c.service_id,
          c.service_title,
          c.journey_id,
          c.journey_title,
          c.revision,
          c.status,
          c.waiting_step,
          c.waiting_role,
          JSON.stringify(c.finish_roles),
          JSON.stringify(c.roles),
          c.started_by,
          c.started_by_name,
          c.created_at,
          c.updated_at,
          c.closed_at,
          c.result ? JSON.stringify(c.result) : null,
          JSON.stringify(c.run),
          JSON.stringify(c.journey),
          c.starter_device ?? null,
          c.assignee ?? null,
          c.assignee_name ?? null,
          c.links ? JSON.stringify(c.links) : null,
        )
        .run();
    },
    get: async (id) => full(await db.prepare(`SELECT ${SUMMARY}, run, journey FROM cases WHERE id = ?1`).bind(id).first<Row>()),
    byRef: async (ref) => full(await db.prepare(`SELECT ${SUMMARY}, run, journey FROM cases WHERE ref = ?1`).bind(ref).first<Row>()),
    async list({ open, startedBy, limit }) {
      const where = [open ? "status IN ('waiting', 'to_finish')" : null, startedBy !== undefined ? "started_by = ?2" : null].filter(Boolean).join(" AND ") || "1 = 1";
      const q = db.prepare(`SELECT ${SUMMARY} FROM cases WHERE ${where} ORDER BY updated_at DESC LIMIT ?1`);
      const rows = await (startedBy !== undefined ? q.bind(limit, startedBy) : q.bind(limit)).all<Row>();
      return rows.results.map(summary);
    },
    async addEvent(e) {
      await db
        .prepare("INSERT INTO case_events (id, case_id, at, actor_id, actor_name, kind, step, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
        .bind(e.id, e.case_id, e.at, e.actor_id, e.actor_name, e.kind, e.step, e.text)
        .run();
    },
    events: async (caseId) => (await db.prepare("SELECT id, case_id, at, actor_id, actor_name, kind, step, text FROM case_events WHERE case_id = ?1 ORDER BY at, rowid").bind(caseId).all<CaseEvent>()).results,
  };
}

/**
 * The cloud relay (migration 0011), transient: an envelope stays only until it is picked up or
 * expires. Every call first deletes what has expired; picking one up deletes its body at once,
 * keeping a stub (who took it) only until it would have expired, so its sender can see it arrived.
 */
export function createD1Relay(db: D1Like, now = () => new Date()): Mailbox {
  const purge = async () => {
    const t = now().toISOString();
    await db.prepare("DELETE FROM relay_envelopes WHERE expires_at <= ?1").bind(t).run();
    await db.prepare("DELETE FROM relay_beacons WHERE expires_at <= ?1").bind(t).run();
  };
  type Row = { id: string; kind: string; to_roles: string | null; to_member: string | null; to_device: string | null; body: string | null; picked_by: string | null; expires_at: string };
  return {
    async post(e) {
      await purge();
      await db
        .prepare("INSERT INTO relay_envelopes (id, kind, to_roles, to_member, to_device, from_id, case_id, body, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
        .bind(e.id, e.kind, e.to.roles ? JSON.stringify(e.to.roles) : null, e.to.member ?? null, e.to.device ?? null, e.from.id, e.case_id, JSON.stringify(e), e.created_at, e.expires_at)
        .run();
    },
    async inbox(to) {
      await purge();
      const rows = await db.prepare("SELECT id, kind, to_roles, to_member, to_device, body, picked_by, expires_at FROM relay_envelopes WHERE picked_by IS NULL ORDER BY created_at LIMIT 200").all<Row>();
      return rows.results
        .filter((r) => (r.to_member && r.to_member === to.member) || (r.to_device && r.to_device === to.device) || (r.to_roles && (JSON.parse(r.to_roles) as string[]).some((x) => to.roles.includes(x))))
        .map((r) => JSON.parse(r.body!) as Envelope);
    },
    async pick(id, by) {
      await purge();
      const r = await db.prepare("SELECT picked_by FROM relay_envelopes WHERE id = ?1").bind(id).first<{ picked_by: string | null }>();
      if (!r || r.picked_by) return false;
      await db.prepare("UPDATE relay_envelopes SET picked_by = ?2, body = NULL WHERE id = ?1 AND picked_by IS NULL").bind(id, by).run();
      return true;
    },
    async status(ids) {
      const out: Record<string, { state: "waiting" | "delivered" | "expired"; picked_by: string | null }> = {};
      for (const id of ids.slice(0, 100)) {
        const r = await db.prepare("SELECT picked_by, expires_at FROM relay_envelopes WHERE id = ?1").bind(id).first<{ picked_by: string | null; expires_at: string }>();
        out[id] = !r ? { state: "expired", picked_by: null } : r.picked_by ? { state: "delivered", picked_by: r.picked_by } : r.expires_at <= now().toISOString() ? { state: "expired", picked_by: null } : { state: "waiting", picked_by: null };
      }
      return out;
    },
    async putBeacon(b) {
      await db
        .prepare("INSERT INTO relay_beacons (case_id, body, updated_at, expires_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (case_id) DO UPDATE SET body = ?2, updated_at = ?3, expires_at = ?4")
        .bind(b.case_id, JSON.stringify(b), b.updated_at, b.expires_at)
        .run();
    },
    async beacons() {
      await purge();
      return (await db.prepare("SELECT body FROM relay_beacons ORDER BY updated_at LIMIT 500").all<{ body: string }>()).results.map((r) => JSON.parse(r.body) as Beacon);
    },
  };
}

/** A service's events on the server (MET-2, migration 0012): the paid plan's storage. */
export function createD1EventStore(db: D1Like): EventStore {
  const COLS = "id, service, journey, kind, step, role, run, at, ms, ok, actor, outcome";
  type Row = Omit<ServiceEvent, "ok"> & { ok: number | null };
  return {
    async add(events) {
      for (const e of events)
        await db
          .prepare(`INSERT OR IGNORE INTO service_events (${COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
          .bind(e.id, e.service, e.journey, e.kind, e.step, e.role, e.run, e.at, e.ms, e.ok === null ? null : e.ok ? 1 : 0, e.actor, e.outcome ?? null)
          .run();
    },
    async list(service, { since, limit = 10_000 } = {}) {
      const rows = await db
        .prepare(`SELECT ${COLS} FROM (SELECT ${COLS} FROM service_events WHERE service = ?1 AND at >= ?2 ORDER BY at DESC LIMIT ?3) ORDER BY at`)
        .bind(service, since ?? "", limit)
        .all<Row>();
      return rows.results.map((r) => ({ ...r, ok: r.ok === null ? null : Boolean(r.ok), outcome: r.outcome ?? null }));
    },
  };
}

/** Routines' notices, settings and daily usage (RTN-1, RTN-5) on D1 (migration 0019). */
export function createD1RoutineStore(db: D1Like): import("../routines/index.js").RoutineStore {
  type Notice = import("../routines/index.js").RoutineNotice;
  const DEFAULTS: import("../routines/index.js").RoutineSettings = { paused: false, limits: { runsPerDay: 200, messagesPerDay: 100, connectorCallsPerDay: 200 } };
  const COLS = "id, tenant_id, routine_id, role, text, created_at, done_at, done_by";
  type Approval = import("../routines/index.js").RoutineApproval;
  type ApprovalRow = Omit<Approval, "payload"> & { payload: string };
  const ACOLS = "id, tenant_id, routine_id, routine_title, run_id, action, type, role, summary, payload, created_at, decision, decided_by, decided_at";
  const approval = (r: ApprovalRow): Approval => ({ ...r, payload: JSON.parse(r.payload) as Approval["payload"] });
  return {
    async addApproval(a) {
      await db
        .prepare(`INSERT INTO routine_approvals (${ACOLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, NULL, NULL)`)
        .bind(a.id, a.tenant_id, a.routine_id, a.routine_title, a.run_id, a.action, a.type, a.role, a.summary, JSON.stringify(a.payload), a.created_at)
        .run();
    },
    async approvals(tenant, roles, { limit = 100 } = {}) {
      if (!roles.length) return [];
      const marks = roles.map((_, n) => `?${n + 3}`).join(", ");
      // Undecided ones older than APPROVAL_DAYS are dropped.
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
      await db.prepare("DELETE FROM routine_approvals WHERE decision IS NULL AND created_at < ?1").bind(since).run();
      const rows = await db
        .prepare(`SELECT ${ACOLS} FROM routine_approvals WHERE tenant_id = ?1 AND decision IS NULL AND role IN (${marks}) ORDER BY created_at DESC LIMIT ?2`)
        .bind(tenant, limit, ...roles)
        .all<ApprovalRow>();
      return rows.results.map(approval);
    },
    async decideApproval(tenant, id, decision, by, at) {
      const row = await db.prepare(`SELECT ${ACOLS} FROM routine_approvals WHERE tenant_id = ?1 AND id = ?2 AND decision IS NULL`).bind(tenant, id).first<ApprovalRow>();
      if (!row) return null;
      const res = (await db
        .prepare("UPDATE routine_approvals SET decision = ?3, decided_by = ?4, decided_at = ?5 WHERE tenant_id = ?1 AND id = ?2 AND decision IS NULL")
        .bind(tenant, id, decision, by, at)
        .run()) as { meta?: { changes?: number }; changes?: number };
      // Two people deciding at once: only the first counts.
      return (res.meta?.changes ?? res.changes ?? 0) > 0 ? approval(row) : null;
    },
    addNotice: async (n) =>
      void (await db.prepare(`INSERT INTO routine_notices (${COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`).bind(n.id, n.tenant_id, n.routine_id, n.role, n.text, n.created_at, n.done_at, n.done_by).run()),
    async notices(tenant, roles, { all = false, limit = 100 } = {}) {
      if (!roles.length) return [];
      const marks = roles.map((_, i) => `?${i + 3}`).join(", ");
      const rows = await db
        .prepare(`SELECT ${COLS} FROM routine_notices WHERE tenant_id = ?1 AND role IN (${marks}) ${all ? "" : "AND done_at IS NULL"} ORDER BY created_at DESC LIMIT ?2`)
        .bind(tenant, limit, ...roles)
        .all<Notice>();
      return rows.results;
    },
    async doneNotice(tenant, id, by, at) {
      const r = await db.prepare("UPDATE routine_notices SET done_at = ?3, done_by = ?4 WHERE tenant_id = ?1 AND id = ?2 AND done_at IS NULL").bind(tenant, id, at, by).run();
      return ((r as { meta?: { changes?: number }; changes?: number | bigint } | null)?.meta?.changes ?? Number((r as { changes?: number | bigint } | null)?.changes ?? 0)) > 0;
    },
    async settings(tenant) {
      const r = await db.prepare("SELECT paused, limits FROM routine_settings WHERE tenant_id = ?1").bind(tenant).first<{ paused: number; limits: string }>();
      if (!r) return structuredClone(DEFAULTS);
      let limits = DEFAULTS.limits;
      try {
        limits = { ...DEFAULTS.limits, ...(JSON.parse(r.limits) as object) };
      } catch {
        /* the defaults */
      }
      return { paused: Boolean(r.paused), limits };
    },
    putSettings: async (tenant, s) =>
      void (await db
        .prepare("INSERT INTO routine_settings (tenant_id, paused, limits) VALUES (?1, ?2, ?3) ON CONFLICT (tenant_id) DO UPDATE SET paused = ?2, limits = ?3")
        .bind(tenant, s.paused ? 1 : 0, JSON.stringify(s.limits))
        .run()),
    async usage(tenant, day) {
      const r = await db.prepare("SELECT runs, messages, connector_calls FROM routine_usage WHERE tenant_id = ?1 AND day = ?2").bind(tenant, day).first<{ runs: number; messages: number; connector_calls: number }>();
      return { day, runs: r?.runs ?? 0, messages: r?.messages ?? 0, connector_calls: r?.connector_calls ?? 0 };
    },
    async use(tenant, day, what) {
      const col = what === "runs" ? "runs" : what === "messages" ? "messages" : "connector_calls";
      await db.prepare(`INSERT INTO routine_usage (tenant_id, day, ${col}) VALUES (?1, ?2, 1) ON CONFLICT (tenant_id, day) DO UPDATE SET ${col} = ${col} + 1`).bind(tenant, day).run();
    },
  };
}

/** Connector secrets (CNX-3) on D1 (migration 0018): sealed values, by tenant, connector and name. */
export function createD1ConnectorSecretStore(db: D1Like): import("../connectors/index.js").ConnectorSecretStore {
  type Row = import("../connectors/index.js").ConnectorSecretRow;
  return {
    list: async (t, c) => (await db.prepare("SELECT tenant_id, connector_id, name, sealed, set_at, set_by FROM connector_secrets WHERE tenant_id = ?1 AND connector_id = ?2 ORDER BY name").bind(t, c).all<Row>()).results,
    put: async (r) =>
      void (await db
        .prepare("INSERT INTO connector_secrets (tenant_id, connector_id, name, sealed, set_at, set_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (tenant_id, connector_id, name) DO UPDATE SET sealed = ?4, set_at = ?5, set_by = ?6")
        .bind(r.tenant_id, r.connector_id, r.name, r.sealed, r.set_at, r.set_by)
        .run()),
    remove: async (t, c, n) =>
      void (n
        ? await db.prepare("DELETE FROM connector_secrets WHERE tenant_id = ?1 AND connector_id = ?2 AND name = ?3").bind(t, c, n).run()
        : await db.prepare("DELETE FROM connector_secrets WHERE tenant_id = ?1 AND connector_id = ?2").bind(t, c).run()),
  };
}
