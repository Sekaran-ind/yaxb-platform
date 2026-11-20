// Data lifetime (docs/architecture/hardening.md "Data lifetime and trust"): every table declares how
// long its rows live, and the daily purge enforces it. A test (test/lifetime.test.ts) fails for a
// table that has no class, so a new table can't be added without deciding.
//
//   transient: a record, deleted 30 days after it was created (not after its last activity).
//   service:   a record a service captured (cases, their events, service events). 30 days, or on the
//              paid plan the service's own `retain_days` (library_entries; its author sets it).
//   identity:  who and what exists (accounts, businesses, members, keys, the service catalogue and
//              its configuration, counters). Never purged here; it goes with its own lifecycle.
//
// The purge works on the whole database by created_at in small chunks; it does not loop over
// businesses. The audit chain is pruned from its oldest end (see pruneAudit).
import type { D1Like } from "./d1.js";

export const TRANSIENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TableClass = "transient" | "service" | "identity";

export interface TableLifetime {
  class: TableClass;
  /** Why this class. For identity tables, what keeps it. */
  reason: string;
  /** The column the age is counted from: ISO text, or epoch milliseconds when `epoch` is set. */
  by?: string;
  epoch?: boolean;
  /** A child table with no age of its own: deleted with its parent (`fk` holds the parent's `key`). */
  via?: { parent: string; fk: string; key: string };
  /** For service records: the column holding the service's library entry id, whose `retain_days` the paid plan honours. */
  entry?: string;
  /** Kept, not purged, on the paid plan (`paid` option): what the person chose to keep in the cloud. */
  keepOnPaid?: boolean;
}

export const TABLE_LIFETIME: Record<string, TableLifetime> = {
  // — transient —
  threads: { class: "transient", reason: "agent conversations in Server storage mode, which is the paid plan's: kept there, 30 days after the last write otherwise", by: "updated_at", epoch: true, keepOnPaid: true },
  kv: { class: "transient", reason: "the agent's memory in Server storage mode, which is the paid plan's: kept there, 30 days otherwise", by: "created_at", keepOnPaid: true },
  moderation: { class: "transient", reason: "questions escalated for human review", by: "created_at" },
  review_answers: { class: "transient", reason: "answers sent for review", by: "created_at" },
  reviews: { class: "transient", reason: "a moderator's review of an answer", via: { parent: "review_answers", fk: "answer_id", key: "id" } },
  feedback: { class: "transient", reason: "session feedback", by: "created_at" },
  design_messages: { class: "transient", reason: "Service Designer threads", by: "created_at" },
  design_runs: { class: "transient", reason: "Service Designer runs", by: "created_at" },
  relay_envelopes: { class: "transient", reason: "relayed items, gone on pickup or sooner", by: "created_at" },
  relay_beacons: { class: "transient", reason: "relay beacons, gone sooner", by: "updated_at" },
  routine_notices: { class: "transient", reason: "notices a routine left for a role", by: "created_at" },
  routine_approvals: { class: "transient", reason: "routine actions waiting for approval, and their decisions", by: "created_at" },
  // — service records —
  cases: { class: "service", reason: "cases handed between roles", by: "created_at", entry: "entry_id" },
  case_events: { class: "service", reason: "a case's history", via: { parent: "cases", fk: "case_id", key: "id" } },
  service_events: { class: "service", reason: "what a service's journeys did (metrics, routines' triggers)", by: "at", entry: "service" },
  // — identity: kept —
  audit: { class: "identity", reason: "the audit chain: pruned from its oldest end past 30 days, never row by row (pruneAudit)" },
  audit_heads: { class: "identity", reason: "each business's newest audit hash and count" },
  tenants: { class: "identity", reason: "the directory of businesses" },
  business_links: { class: "identity", reason: "links between two businesses, until ended" },
  join_tokens: { class: "identity", reason: "join links, until they expire or are revoked" },
  join_requests: { class: "identity", reason: "who asked to join, until decided" },
  moderators: { class: "identity", reason: "members and their keys" },
  moderator_profiles: { class: "identity", reason: "one per member" },
  libraries: { class: "identity", reason: "the service catalogue (a service's configuration expiry is a later step)" },
  library_entries: { class: "identity", reason: "services and routines as designed" },
  library_revisions: { class: "identity", reason: "a service's revisions" },
  library_roles: { class: "identity", reason: "a business's roles" },
  design_lessons: { class: "identity", reason: "what the Service Designer was taught: configuration, not a record" },
  connector_secrets: { class: "identity", reason: "sealed connector secrets" },
  routine_settings: { class: "identity", reason: "a business's routine limits" },
  routine_usage: { class: "identity", reason: "daily counters for limits" },
  // the platform database (migrations-platform): accounts and sessions, each with its own expiry
  account_methods: { class: "identity", reason: "how an account signs in" },
  accounts: { class: "identity", reason: "accounts" },
  approved_sites: { class: "identity", reason: "approved sites" },
  device_credentials: { class: "identity", reason: "a terminal's credential, until revoked or expired" },
  device_grants: { class: "identity", reason: "device sign-in grants, short-lived by their own expiry" },
  device_locks: { class: "identity", reason: "child locks" },
  identity_audit: { class: "identity", reason: "sign-in audit" },
  identity_counters: { class: "identity", reason: "rate-limit windows" },
  memberships: { class: "identity", reason: "which account is in which space" },
  otp_challenges: { class: "identity", reason: "one-time codes, short-lived by their own expiry" },
  pending_joins: { class: "identity", reason: "joins waiting to be claimed" },
  platform_meta: { class: "identity", reason: "platform settings" },
  quota_hits: { class: "identity", reason: "free-plan quota counters" },
  sync_uses: { class: "identity", reason: "the free plan's syncs per account, deleted by the allowance itself after a year" },
  sessions: { class: "identity", reason: "sign-in sessions, with their own expiry" },
  signing_keys: { class: "identity", reason: "signing keys" },
  site_audit: { class: "identity", reason: "approved-sites audit" },
  site_requests: { class: "identity", reason: "requests to approve a site" },
  space_oidc: { class: "identity", reason: "a space's OIDC settings" },
  space_policies: { class: "identity", reason: "a space's sign-in policy" },
};

export interface PurgeOptions {
  /** Rows deleted per statement. */
  chunk?: number;
  /** Statements per table per run; what is left goes the next day. */
  maxChunks?: number;
  /** Days a transient record lives. */
  days?: number;
  /** The paid plan: a service's records live for its `retain_days` (30 when it sets none). Off: 30 days for every service. */
  retain?: boolean;
  /** The paid plan: tables marked `keepOnPaid` (the agent's memory) are not purged. */
  paid?: boolean;
}

type Changes = { meta?: { changes?: number }; changes?: number | bigint } | null;
const changed = (r: unknown) => (r as Changes)?.meta?.changes ?? Number((r as Changes)?.changes ?? 0);

/** Deletes in chunks until a chunk comes back short, or the run's limit is reached. */
async function chunked(db: D1Like, sql: string, args: unknown[], chunk: number, maxChunks: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxChunks; i++) {
    const n = changed(await db.prepare(sql).bind(...args, chunk).run());
    total += n;
    if (n < chunk) break;
  }
  return total;
}

const cutoff = (t: TableLifetime, now: Date, days: number) => (t.epoch ? now.getTime() - days * DAY_MS : new Date(now.getTime() - days * DAY_MS).toISOString());

/**
 * Whether a row of `t` (as `alias`) is past its lifetime, and the values it binds from ?1 on. A service
 * record on the paid plan is past it when it is older than its service's `retain_days` (30 when the
 * service sets none, or no longer exists); the plain 30-day test comes first so the index finds the candidates.
 */
function expired(t: TableLifetime, alias: string, now: Date, days: number, retain: boolean): { sql: string; args: unknown[] } {
  const col = `${alias}.${t.by}`;
  const base = cutoff(t, now, days);
  if (!(retain && t.entry)) return { sql: `${col} < ?1`, args: [base] };
  return {
    sql: `${col} < ?1 AND ${col} < strftime('%Y-%m-%dT%H:%M:%fZ', ?2, '-' || COALESCE((SELECT retain_days FROM library_entries WHERE id = ${alias}.${t.entry}), ?3) || ' days')`,
    args: [base, now.toISOString(), days],
  };
}

/**
 * The daily purge. Children go before their parents (a case's events, a review answer's reviews), so
 * none is left behind. Returns the rows deleted per table (tables with none are left out).
 */
export async function purgeExpired(db: D1Like, now = new Date(), opts: PurgeOptions = {}): Promise<Record<string, number>> {
  const { chunk = 500, maxChunks = 40, days = TRANSIENT_DAYS, retain = false, paid = false } = opts;
  const out: Record<string, number> = {};
  const live = (t: TableLifetime) => (t.keepOnPaid && paid ? null : t.class === "transient" || t.class === "service" ? days : null);
  const add = (table: string, n: number) => void (n && (out[table] = (out[table] ?? 0) + n));
  const entries = Object.entries(TABLE_LIFETIME);

  // Children first.
  for (const [table, t] of entries) {
    if (!t.via) continue;
    const p = TABLE_LIFETIME[t.via.parent]!;
    if (live(p) === null || !p.by) continue;
    const e = expired(p, "p", now, days, retain);
    add(table, await chunked(db, `DELETE FROM ${table} WHERE rowid IN (SELECT c.rowid FROM ${table} c JOIN ${t.via.parent} p ON p.${t.via.key} = c.${t.via.fk} WHERE ${e.sql} LIMIT ?${e.args.length + 1})`, e.args, chunk, maxChunks));
  }
  for (const [table, t] of entries) {
    if (live(t) === null || !t.by) continue;
    const e = expired(t, "t", now, days, retain);
    add(table, await chunked(db, `DELETE FROM ${table} WHERE rowid IN (SELECT t.rowid FROM ${table} t WHERE ${e.sql} LIMIT ?${e.args.length + 1})`, e.args, chunk, maxChunks));
  }
  add("audit", await pruneAudit(db, now, { chunk, maxChunks, days }));
  return out;
}

/**
 * The audit chain, pruned from its oldest end (AUD-2). Each remaining record still carries the hash of
 * the one before it, so the oldest remaining record's prev_hash is the checkpoint for the removed
 * prefix and verifyAuditChain checks the rest from there. audit_heads (newest hash, count) is left
 * alone, so new records still chain on. Records from before the chain (no hash) are pruned the same.
 */
export async function pruneAudit(db: D1Like, now = new Date(), { chunk = 500, maxChunks = 40, days = TRANSIENT_DAYS } = {}): Promise<number> {
  const at = new Date(now.getTime() - days * DAY_MS).toISOString();
  return chunked(db, "DELETE FROM audit WHERE rowid IN (SELECT rowid FROM audit WHERE at < ?1 ORDER BY rowid LIMIT ?2)", [at], chunk, maxChunks);
}
