// The daily purge (docs/architecture/hardening.md "Data lifetime and trust"): records older than 30 days
// go, in every edition's database, by created_at in small chunks. It does not loop over businesses.
// On the paid plan a service's records (cases, their events, service events) live for its `retain_days`
// (30 when it sets none); on the free plan every service's live 30 days. The agent's memory and
// conversations (Server storage, the paid plan's) are kept on paid; everything else is transient on both.
import { purgeExpired } from "@sekaran-ind/yaxb-core/stores/lifetime";
import type { D1Like } from "@sekaran-ind/yaxb-core/stores/d1";
import { dbFor, EDITIONS } from "./edition";
import { settings, type Bindings } from "./env";

/** Runs the purge on every bound edition database; one failing never stops the rest. Returns rows deleted per table. */
export async function purgeAll(env: Bindings, now = new Date()): Promise<Record<string, number>> {
  const total: Record<string, number> = {};
  const free = settings(env).PLAN === "free";
  for (const edition of EDITIONS) {
    let database: D1Database;
    try {
      database = dbFor(env as unknown as Record<string, unknown>, edition);
    } catch {
      continue;
    }
    try {
      const done = await purgeExpired(database as unknown as D1Like, now, { retain: !free, paid: !free });
      for (const [table, n] of Object.entries(done)) total[table] = (total[table] ?? 0) + n;
    } catch (e) {
      console.error(JSON.stringify({ msg: "purge failed", edition, error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : "unknown" }));
    }
  }
  return total;
}
