// The daily purge on the Worker: it runs on every bound edition database, and the paid plan keeps
// service records until services can declare retention.
import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../packages/yaxb-core/test/sqlite-d1";
import { purgeAll } from "../purge";

const env = (plan: "free" | "paid") => ({ SESSION_SECRET: "x".repeat(40), PLAN: plan, DB: sqliteD1(), DB_BUSINESS: sqliteD1() }) as never;
const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
async function seed(e: { DB: ReturnType<typeof sqliteD1>; DB_BUSINESS: ReturnType<typeof sqliteD1> }) {
  for (const db of [e.DB, e.DB_BUSINESS]) {
    await db.prepare("INSERT INTO feedback (id, rating, mode, language, profile, answers, created_at) VALUES ('f', 'good', 'agent', 'eng_Latn', 0, 1, ?1)").bind(old).run();
    await db.prepare("INSERT INTO service_events (id, service, journey, kind, run, at) VALUES ('s', 'svc', 'j', 'journey.started', 'r', ?1)").bind(old).run();
  }
}

describe("the daily purge", () => {
  it("clears old records in every bound database (an unbound edition is skipped)", async () => {
    const e = env("free") as never as { DB: ReturnType<typeof sqliteD1>; DB_BUSINESS: ReturnType<typeof sqliteD1> };
    await seed(e);
    expect(await purgeAll(e as never)).toEqual({ feedback: 2, service_events: 2 });
  });
  it("on the paid plan keeps a service's records for its retain_days, and 30 days for one that sets none", async () => {
    const e = env("paid") as never as { DB: ReturnType<typeof sqliteD1>; DB_BUSINESS: ReturnType<typeof sqliteD1> };
    await seed(e);
    await e.DB.prepare("INSERT INTO libraries (id, name, status, created_at, updated_at, tenant_id) VALUES ('l', 'L', 'active', ?1, ?1, 'default')").bind(old).run();
    await e.DB.prepare("INSERT INTO library_entries (id, library_id, kind, doc_id, title, yaml, status, revision, created_at, updated_at, tenant_id, storage, retain_days) VALUES ('svc', 'l', 'service', 'svc', 'S', '', 'accepted', 1, ?1, ?1, 'default', 'server', 365)").bind(old).run();
    // 'svc' keeps its 40-day-old event in the first database; the second database has no such service, so its event goes.
    expect(await purgeAll(e as never)).toEqual({ feedback: 2, service_events: 1 });
  });
});
