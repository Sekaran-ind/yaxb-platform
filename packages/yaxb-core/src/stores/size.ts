// Database size (docs/architecture/hardening.md, step 5): how full an edition's D1 database is, and
// which businesses fill it, so someone is told before a database reaches its limit and there is a
// rule for moving a big business to its own database. D1 reports the size in each query's meta.
import type { D1Like } from "./d1.js";

/** D1's per-database limits: 500 MB on the free plan, 10 GB on a paid Workers plan. Overridable (D1_LIMIT_MB). */
export const D1_LIMIT_MB = { free: 500, paid: 10_240 } as const;
export const SIZE_WARN = 0.7;
export const SIZE_CRITICAL = 0.9;

export type SizeLevel = "ok" | "warn" | "critical";
export const sizeLevel = (bytes: number, limitBytes: number): SizeLevel => {
  const used = bytes / limitBytes;
  return used >= SIZE_CRITICAL ? "critical" : used >= SIZE_WARN ? "warn" : "ok";
};

/** The database's size in bytes (from the query's meta), or null where the database doesn't report one. */
export async function databaseBytes(db: D1Like): Promise<number | null> {
  const r = (await db.prepare("SELECT 1").run()) as { meta?: { size_after?: number } } | null;
  const n = r?.meta?.size_after;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** The tables that hold most of the rows, and the column that says whose they are. */
const BIG = ["cases", "service_events", "moderation", "review_answers", "design_messages", "feedback"] as const;

/** The businesses holding the most rows in the big tables, largest first. Counts only; never content. */
export async function biggestTenants(db: D1Like, top = 5): Promise<{ tenant: string; rows: number }[]> {
  const union = BIG.map((t) => `SELECT tenant_id, COUNT(*) AS n FROM ${t} GROUP BY tenant_id`).join(" UNION ALL ");
  const { results } = await db.prepare(`SELECT tenant_id AS tenant, SUM(n) AS rows FROM (${union}) GROUP BY tenant_id ORDER BY rows DESC LIMIT ?1`).bind(top).all<{ tenant: string; rows: number }>();
  return results;
}
