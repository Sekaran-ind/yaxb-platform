// Database-size alerts (docs/architecture/hardening.md, step 5): once a day, after the purge, each bound
// edition database's size is read and compared with its limit. At 70% it is a warning and at 90%
// critical, logged (Workers Logs) with the businesses holding the most rows, counts only. The latest
// reading is kept in the platform database for the Administration screen. Nothing here deletes anything.
import { D1_LIMIT_MB, biggestTenants, databaseBytes, sizeLevel, type SizeLevel } from "@sekaran-ind/yaxb-core/stores/size";
import type { D1Like } from "@sekaran-ind/yaxb-core/stores/d1";
import { dbFor, EDITIONS, type Edition } from "./edition";
import { settings, type Bindings } from "./env";

export type SizeReading = { bytes: number; limitBytes: number; percent: number; level: SizeLevel; at: string };

export const limitBytes = (env: Bindings) => (settings(env).D1_LIMIT_MB ?? D1_LIMIT_MB[settings(env).PLAN]) * 1024 * 1024;

export async function readSize(env: Bindings, database: D1Like, now = new Date()): Promise<SizeReading | null> {
  const bytes = await databaseBytes(database);
  if (bytes === null) return null;
  const limit = limitBytes(env);
  return { bytes, limitBytes: limit, percent: Math.round((bytes / limit) * 1000) / 10, level: sizeLevel(bytes, limit), at: now.toISOString() };
}

/** Reads every bound edition database; warns and criticals are logged, and each reading is kept for the screen. */
export async function checkSizes(env: Bindings, now = new Date()): Promise<Partial<Record<Edition, SizeReading>>> {
  const out: Partial<Record<Edition, SizeReading>> = {};
  for (const edition of EDITIONS) {
    let database: D1Like;
    try {
      database = dbFor(env as unknown as Record<string, unknown>, edition) as unknown as D1Like;
    } catch {
      continue;
    }
    try {
      const r = await readSize(env, database, now);
      if (!r) continue;
      out[edition] = r;
      if (r.level !== "ok") console.error(JSON.stringify({ msg: "database size", edition, level: r.level, mb: Math.round(r.bytes / 1048576), limit_mb: Math.round(r.limitBytes / 1048576), percent: r.percent, biggest: await biggestTenants(database).catch(() => []) }));
      if (env.PLATFORM_DB) await (env.PLATFORM_DB as unknown as D1Like).prepare("INSERT INTO platform_meta (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = ?3").bind(`db-size:${edition}`, JSON.stringify(r), r.at).run();
    } catch (e) {
      console.error(JSON.stringify({ msg: "size check failed", edition, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
    }
  }
  return out;
}
