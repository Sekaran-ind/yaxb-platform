// The free plan's sync allowance: a device may push its copy of a business's services and
// configuration to the server a few times a year (5 by default), counted per account on the server, so
// keeping data alive by syncing every 30 days (12 a year) isn't possible. The paid plan has no limit.
// A rolling year: a sync counts for 365 days, and the person is told when the next one frees up.
// Nothing here moves data; whatever performs a sync calls `take` first.
import type { D1Like } from "../stores/d1.js";

export const SYNC_WINDOW_MS = 365 * 86_400_000;

export interface SyncUseStore {
  /** Record a use of `account` at `at` only while fewer than `limit` fall after `since`. Returns whether it was recorded. */
  addWithin(account: string, at: number, since: number, limit: number): Promise<boolean>;
  /** The times of `account`'s uses after `since`, oldest first. */
  uses(account: string, since: number): Promise<number[]>;
  /** Forget `account`'s uses before `before`. */
  prune(account: string, before: number): Promise<void>;
}

export type SyncAllowance = {
  /** The syncs allowed a year, or null for no limit. */
  limit: number | null;
  /** Syncs used in the last year. */
  used: number;
  /** Syncs left (null with no limit). */
  left: number | null;
  /** When the oldest use falls out of the year and one is free again (only when none is left). */
  freeAgainAt: string | null;
};

export function createSyncAllowance(store: SyncUseStore, { perYear, now = () => Date.now() }: { perYear: number | null; now?: () => number }) {
  const state = async (account: string): Promise<SyncAllowance> => {
    const times = await store.uses(account, now() - SYNC_WINDOW_MS);
    if (perYear === null) return { limit: null, used: times.length, left: null, freeAgainAt: null };
    const left = Math.max(0, perYear - times.length);
    return { limit: perYear, used: times.length, left, freeAgainAt: left === 0 && times[0] !== undefined ? new Date(times[0] + SYNC_WINDOW_MS).toISOString() : null };
  };
  return {
    status: state,
    /** Count one sync if the allowance has one left. A refusal counts nothing. */
    async take(account: string): Promise<{ ok: boolean } & SyncAllowance> {
      const t = now();
      if (!(await store.addWithin(account, t, t - SYNC_WINDOW_MS, perYear ?? Number.MAX_SAFE_INTEGER))) return { ok: false, ...(await state(account)) };
      await store.prune(account, t - SYNC_WINDOW_MS);
      return { ok: true, ...(await state(account)) };
    },
  };
}

export function createMemorySyncUseStore(): SyncUseStore {
  const rows = new Map<string, number[]>();
  return {
    async addWithin(account, at, since, limit) {
      const mine = rows.get(account) ?? [];
      if (mine.filter((t) => t > since).length >= limit) return false;
      rows.set(account, [...mine, at]);
      return true;
    },
    uses: async (account, since) => (rows.get(account) ?? []).filter((t) => t > since).sort((a, b) => a - b),
    prune: async (account, before) => void rows.set(account, (rows.get(account) ?? []).filter((t) => t >= before)),
  };
}

type Changes = { meta?: { changes?: number }; changes?: number | bigint } | null;

/** On the platform database (migrations-platform 0011), shared by every edition. */
export function createD1SyncUseStore(db: D1Like): SyncUseStore {
  return {
    async addWithin(account, at, since, limit) {
      // One statement, so two syncs at once can't both take the last one.
      const r = await db
        .prepare("INSERT INTO sync_uses (account_id, at) SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM sync_uses WHERE account_id = ?1 AND at > ?3) < ?4")
        .bind(account, at, since, limit)
        .run();
      return ((r as Changes)?.meta?.changes ?? Number((r as Changes)?.changes ?? 0)) > 0;
    },
    uses: async (account, since) => (await db.prepare("SELECT at FROM sync_uses WHERE account_id = ?1 AND at > ?2 ORDER BY at").bind(account, since).all<{ at: number }>()).results.map((r) => r.at),
    prune: async (account, before) => void (await db.prepare("DELETE FROM sync_uses WHERE account_id = ?1 AND at < ?2").bind(account, before).run()),
  };
}
