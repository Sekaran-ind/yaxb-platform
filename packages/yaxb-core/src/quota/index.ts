// Usage limits that Cloudflare's rate-limit binding can't express (its windows are 10 or 60 seconds):
// the free tier's few questions per IP in a long window (3 in 40 minutes), a daily budget for the
// hosted model, and a cap on failed case-reference guesses. A sliding log: each use is a row (key,
// time); a key is allowed while fewer than `limit` rows fall inside the window. Facts only: an IP's
// address is hashed before it is kept, and rows are deleted once they fall out of the longest window.
import type { D1Like } from "../stores/d1.js";

export type QuotaRule = { limit: number; windowMs: number };
export type QuotaResult = { ok: boolean; /** Uses left in this window after this one (0 when refused). */ remaining: number; /** When refused: how long until one is free again. */ retryAfterMs: number };

export interface QuotaStore {
  /** The times of the newest `limit` uses of `key` after `since`, newest first. */
  recent(key: string, since: number, limit: number): Promise<number[]>;
  /** How many uses of `key` fall after `since`. */
  count(key: string, since: number): Promise<number>;
  add(key: string, at: number): Promise<void>;
  /** Drop everything older than `before`. */
  prune(before: number): Promise<void>;
}

/** The longest window any rule uses, so pruning never drops a row a rule still needs. */
export const QUOTA_KEEP_MS = 25 * 3_600_000;

export function createQuota(store: QuotaStore, { now = () => Date.now(), pruneEvery = 25 }: { now?: () => number; pruneEvery?: number } = {}) {
  let calls = 0;
  const api = {
    /** Count one use of `key` if the rule allows it. A refusal counts nothing. */
    async take(key: string, rule: QuotaRule): Promise<QuotaResult> {
      if (rule.limit <= 0) return { ok: true, remaining: Number.POSITIVE_INFINITY, retryAfterMs: 0 };
      const t = now();
      const since = t - rule.windowMs;
      if (rule.limit > 100) {
        // A big budget: count rather than list.
        const n = await store.count(key, since);
        if (n >= rule.limit) return { ok: false, remaining: 0, retryAfterMs: rule.windowMs };
        await store.add(key, t);
        await api.maybePrune(t);
        return { ok: true, remaining: rule.limit - n - 1, retryAfterMs: 0 };
      }
      const rows = await store.recent(key, since, rule.limit);
      if (rows.length >= rule.limit) return { ok: false, remaining: 0, retryAfterMs: Math.max(1000, rows[rule.limit - 1]! + rule.windowMs - t) };
      await store.add(key, t);
      await api.maybePrune(t);
      return { ok: true, remaining: rule.limit - rows.length - 1, retryAfterMs: 0 };
    },
    /** Would `take` allow it? Counts nothing. */
    async allows(key: string, rule: QuotaRule): Promise<boolean> {
      return rule.limit <= 0 || (await store.count(key, now() - rule.windowMs)) < rule.limit;
    },
    /** Count a use without checking (a failure to be limited later, such as a wrong guess). */
    async note(key: string): Promise<void> {
      await store.add(key, now());
    },
    async maybePrune(t: number) {
      if (++calls % pruneEvery === 0) await store.prune(t - QUOTA_KEEP_MS);
    },
  };
  return api;
}
export type Quota = ReturnType<typeof createQuota>;

/**
 * The key for an address: an IPv4 address as it is, an IPv6 one by its /64 (one household or one
 * machine's whole range), hashed so no address is kept. Null when there's no address (a local run),
 * which is not limited.
 */
export async function ipKey(ip: string | null | undefined, salt: string): Promise<string | null> {
  const a = (ip ?? "").trim().toLowerCase();
  if (!a) return null;
  let net = a;
  if (a.includes(":")) {
    const [head = "", tail = ""] = a.split("::");
    const h = head ? head.split(":") : [];
    const t = a.includes("::") && tail ? tail.split(":") : [];
    const full = a.includes("::") ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : a.split(":");
    net = `v6:${full.slice(0, 4).map((x) => x.padStart(4, "0")).join(":")}`;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${net}`)));
  return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createMemoryQuotaStore(): QuotaStore {
  const rows = new Map<string, number[]>();
  return {
    recent: async (key, since, limit) => (rows.get(key) ?? []).filter((t) => t > since).sort((a, b) => b - a).slice(0, limit),
    count: async (key, since) => (rows.get(key) ?? []).filter((t) => t > since).length,
    add: async (key, at) => void rows.set(key, [...(rows.get(key) ?? []), at]),
    prune: async (before) => {
      for (const [k, v] of rows) rows.set(k, v.filter((t) => t >= before));
    },
  };
}

/** The sliding log on the platform database (migrations-platform 0010), shared by every edition. */
export function createD1QuotaStore(db: D1Like): QuotaStore {
  return {
    recent: async (key, since, limit) => (await db.prepare("SELECT at FROM quota_hits WHERE key = ?1 AND at > ?2 ORDER BY at DESC LIMIT ?3").bind(key, since, limit).all<{ at: number }>()).results.map((r) => r.at),
    count: async (key, since) => (await db.prepare("SELECT COUNT(*) AS n FROM quota_hits WHERE key = ?1 AND at > ?2").bind(key, since).first<{ n: number }>())?.n ?? 0,
    add: async (key, at) => void (await db.prepare("INSERT INTO quota_hits (key, at) VALUES (?1, ?2)").bind(key, at).run()),
    prune: async (before) => void (await db.prepare("DELETE FROM quota_hits WHERE at < ?1").bind(before).run()),
  };
}
