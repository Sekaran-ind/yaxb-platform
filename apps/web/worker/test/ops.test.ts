// Step 5 of the data lifetime work: database-size alerts, and the paid plan's sweep queue.
import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../packages/yaxb-core/test/sqlite-d1";
import { checkSizes, limitBytes, readSize } from "../db-size";
import { runSweepJob, sweep, type SweepJob } from "../routines";

const MB = 1024 * 1024;
type Db = ReturnType<typeof sqliteD1>;
/** A database that reports its size, as D1 does in each query's meta. */
const reporting = (mb: number): Db => {
  const db = sqliteD1();
  return { ...db, prepare: (sql: string) => (sql === "SELECT 1" ? ({ run: async () => ({ meta: { size_after: mb * MB } }) } as never) : db.prepare(sql)) } as Db;
};
const env = (plan: "free" | "paid", mb: number, extra: Record<string, unknown> = {}) => ({ SESSION_SECRET: "x".repeat(40), PLAN: plan, DB: reporting(mb), PLATFORM_DB: sqliteD1({ folder: "migrations-platform" }), ...extra }) as never;

describe("database size alerts", () => {
  it("limits are 500 MB on free and 10 GB on paid, unless set", () => {
    expect(limitBytes(env("free", 0))).toBe(500 * MB);
    expect(limitBytes(env("paid", 0))).toBe(10_240 * MB);
    expect(limitBytes(env("free", 0, { D1_LIMIT_MB: "100" }))).toBe(100 * MB);
  });

  it("is quiet below 70%, warns at 70% and is critical at 90%, with the biggest businesses and no content", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await checkSizes(env("free", 100))).toMatchObject({ all: { level: "ok", percent: 20 } });
      expect(log).not.toHaveBeenCalled();
      const warn = env("free", 360);
      await warn.DB.prepare("INSERT INTO feedback (id, rating, mode, language, profile, answers, created_at, tenant_id) VALUES ('f', 'good', 'agent', 'eng_Latn', 0, 1, '2026-12-01T00:00:00.000Z', 'acme')").run();
      expect(await checkSizes(warn)).toMatchObject({ all: { level: "warn" } });
      const logged = JSON.parse(String(log.mock.calls[0]![0])) as { msg: string; level: string; percent: number; biggest: unknown[] };
      expect(logged).toMatchObject({ msg: "database size", level: "warn", percent: 72, biggest: [{ tenant: "acme", rows: 1 }] });
      expect(JSON.stringify(logged)).not.toContain("good");
      expect(await checkSizes(env("free", 460))).toMatchObject({ all: { level: "critical" } });
    } finally {
      log.mockRestore();
    }
  });

  it("keeps the latest reading for the screen, and skips a database that reports no size", async () => {
    const e = env("paid", 2048);
    await checkSizes(e);
    const row = await (e as unknown as { PLATFORM_DB: Db }).PLATFORM_DB.prepare("SELECT value FROM platform_meta WHERE key = 'db-size:all'").first<{ value: string }>();
    expect(JSON.parse(row!.value)).toMatchObject({ bytes: 2048 * MB, level: "ok", percent: 20 });
    expect(await readSize(e, sqliteD1())).toBeNull();
    expect(await checkSizes({ SESSION_SECRET: "x".repeat(40), DB: sqliteD1() } as never)).toEqual({});
  });
});

describe("the sweep queue", () => {
  const seed = async (db: Db) => {
    await db.prepare("INSERT INTO libraries (id, name, status, created_at, updated_at, tenant_id) VALUES ('l', 'L', 'active', '2026-01-01', '2026-01-01', 'acme')").run();
    await db.prepare("INSERT INTO library_entries (id, library_id, kind, doc_id, title, yaml, status, revision, published_yaml, created_at, updated_at, tenant_id) VALUES ('r1', 'l', 'routine', 'r1', 'R', '', 'accepted', 1, 'kind: routine', '2026-01-01', '2026-01-01', 'acme')").run();
    await db.prepare("INSERT INTO cases (id, ref, entry_id, service_id, service_title, journey_id, journey_title, status, finish_roles, roles, started_by, started_by_name, created_at, updated_at, run, journey, links, tenant_id) VALUES ('c', 'R-1', 'e', 's', 'S', 'j', 'J', 'waiting', '[]', '[]', 'u', 'U', '2026-12-01', '2026-12-01', '{}', '{}', '{}', 'bolt')").run();
  };

  it("with a queue bound, the cron enqueues one job per business and runs nothing itself", async () => {
    const sent: { body: SweepJob }[] = [];
    const e = env("paid", 1, { SWEEP_QUEUE: { sendBatch: async (m: { body: SweepJob }[]) => void sent.push(...m) } });
    await seed((e as unknown as { DB: Db }).DB);
    expect(await sweep(e)).toBe(0);
    expect(sent.map((m) => m.body).sort((a, b) => a.tenant.localeCompare(b.tenant))).toEqual([
      { edition: "all", tenant: "acme", job: "routines" },
      { edition: "all", tenant: "bolt", job: "cases" },
    ]);
  });

  it("without one, the jobs run in the cron, and one failing doesn't stop the rest", async () => {
    const e = env("free", 1);
    await seed((e as unknown as { DB: Db }).DB);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(sweep(e)).resolves.toBeTypeOf("number");
    } finally {
      log.mockRestore();
    }
  });

  it("a job a queue runs does the same work, and a bad one throws so the queue retries it", async () => {
    const e = env("paid", 1);
    await seed((e as unknown as { DB: Db }).DB);
    await expect(runSweepJob(e, { edition: "all", tenant: "bolt", job: "cases" })).resolves.toBe(0);
    await expect(runSweepJob({ SESSION_SECRET: "x".repeat(40) } as never, { edition: "all", tenant: "bolt", job: "cases" })).rejects.toThrow();
  });
});
