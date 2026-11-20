// Data lifetime: every table declares a class (so a new table can't be added without deciding), the
// purge's column is indexed, and the purge deletes what is past 30 days and nothing else.
import { describe, expect, it } from "vitest";
import { AUDIT_GENESIS, auditHash, verifyAuditChain, type AuditEvent } from "../src/moderators/index.js";
import { createD1ModerationStore } from "../src/stores/d1.js";
import { purgeExpired, TABLE_LIFETIME } from "../src/stores/lifetime.js";
import { sqliteD1 } from "./sqlite-d1.js";

const INTERNAL = /^(sqlite_|_cf_|d1_migrations)/;
const NOW = new Date("2026-12-31T12:00:00.000Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const count = async (db: ReturnType<typeof sqliteD1>, table: string) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe("data lifetime", () => {
  for (const folder of ["migrations", "migrations-platform"] as const) {
    it(`every table in ${folder} has a class`, async () => {
      const db = sqliteD1({ folder });
      const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()).results.map((t) => t.name).filter((n) => !INTERNAL.test(n));
      expect(tables.filter((n) => !(n in TABLE_LIFETIME)), "Tables with no class: add them to TABLE_LIFETIME (stores/lifetime.ts)").toEqual([]);
    });
  }

  it("every class names real columns, and a purged column has an index starting with it", async () => {
    const db = sqliteD1();
    const bad: string[] = [];
    for (const [table, t] of Object.entries(TABLE_LIFETIME)) {
      const info = (await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map((c) => c.name);
      if (!info.length) continue; // a platform table
      if (t.class === "identity") continue;
      if (!t.by && !t.via) bad.push(`${table}: transient/service needs "by" or "via"`);
      const column = t.by ?? t.via!.fk;
      if (!info.includes(column)) bad.push(`${table}: no column ${column}`);
      if (t.via) {
        const parent = TABLE_LIFETIME[t.via.parent];
        if (!parent?.by) bad.push(`${table}: parent ${t.via.parent} has no "by"`);
        continue; // a child is found through its parent's index and its own fk index, checked below
      }
      const indexes = (await db.prepare(`PRAGMA index_list(${table})`).all<{ name: string }>()).results;
      let indexed = false;
      for (const i of indexes) if (((await db.prepare(`PRAGMA index_info(${i.name})`).all<{ name: string }>()).results[0]?.name) === column) indexed = true;
      if (!indexed) bad.push(`${table}: no index starting with ${column} (the purge would scan the table)`);
    }
    // A child's foreign key leads an index too, so removing a parent's children is not a scan.
    for (const [table, t] of Object.entries(TABLE_LIFETIME)) {
      if (!t.via) continue;
      let indexed = false;
      for (const i of (await db.prepare(`PRAGMA index_list(${table})`).all<{ name: string }>()).results) if (((await db.prepare(`PRAGMA index_info(${i.name})`).all<{ name: string }>()).results[0]?.name) === t.via.fk) indexed = true;
      if (!indexed) bad.push(`${table}: no index starting with ${t.via.fk}`);
    }
    expect(bad).toEqual([]);
  });

  async function seed(db: ReturnType<typeof sqliteD1>) {
    const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
    for (const [id, at] of [["old", ago(31)], ["new", ago(5)]] as const) {
      await run("INSERT INTO moderation (id, question, reason, created_at, tenant_id) VALUES (?1, 'q', 'r', ?2, ?3)", `m-${id}`, at, id === "old" ? "acme" : "bolt");
      await run("INSERT INTO feedback (id, rating, mode, language, profile, answers, created_at) VALUES (?1, 'good', 'agent', 'eng_Latn', 0, 1, ?2)", `f-${id}`, at);
      await run("INSERT INTO review_answers (id, created_at, origin, question, answer, refs, mode, language, state) VALUES (?1, ?2, 'kiosk', 'q', 'a', '[]', 'agent', 'eng_Latn', 'open')", `a-${id}`, at);
      await run("INSERT INTO reviews (id, answer_id, at, moderator_id, moderator_name, rating, marks, missing, context) VALUES (?1, ?2, ?3, 'm', 'M', 'good', '[]', '[]', '')", `r-${id}`, `a-${id}`, ago(1));
      await run("INSERT INTO cases (id, ref, entry_id, service_id, service_title, journey_id, journey_title, status, finish_roles, roles, started_by, started_by_name, created_at, updated_at, run, journey) VALUES (?1, ?1, 'e', 's', 'S', 'j', 'J', 'waiting', '[]', '[]', 'u', 'U', ?2, ?3, '{}', '{}')", `c-${id}`, at, ago(1));
      await run("INSERT INTO case_events (id, case_id, at, actor_id, actor_name, kind) VALUES (?1, ?2, ?3, 'u', 'U', 'note')", `ce-${id}`, `c-${id}`, ago(1));
      await run("INSERT INTO service_events (id, service, journey, kind, run, at) VALUES (?1, 's', 'j', 'journey.started', 'r', ?2)", `se-${id}`, at);
      await run("INSERT INTO kv (namespace, key, value, created_at, updated_at) VALUES ('n', ?1, '{}', ?2, ?3)", id, at, ago(1));
      await run("INSERT INTO threads (id, state, updated_at) VALUES (?1, '{}', ?2)", `t-${id}`, new Date(at).getTime());
    }
    await run("INSERT INTO tenants (id, slug, name, kind, status, created_at) VALUES ('t1', 'acme', 'Acme', 'business', 'active', ?1)", ago(400));
  }

  it("deletes records past 30 days, with their children, and keeps the rest and the identity tables", async () => {
    const db = sqliteD1();
    await seed(db);
    const tenants = await count(db, "tenants");
    const done = await purgeExpired(db, NOW);
    expect(done).toMatchObject({ moderation: 1, feedback: 1, review_answers: 1, reviews: 1, cases: 1, case_events: 1, service_events: 1, kv: 1, threads: 1 });
    for (const t of ["moderation", "feedback", "review_answers", "reviews", "cases", "case_events", "service_events", "kv", "threads"]) expect(await count(db, t), t).toBe(1);
    expect((await db.prepare("SELECT id FROM cases").first<{ id: string }>())!.id).toBe("c-new");
    expect((await db.prepare("SELECT id FROM case_events").first<{ id: string }>())!.id).toBe("ce-new");
    expect(await count(db, "tenants")).toBe(tenants);
    expect(await purgeExpired(db, NOW)).toEqual({}); // and a second run has nothing to do
  });

  it("counts from creation, not from activity", async () => {
    const db = sqliteD1();
    await db.prepare("INSERT INTO kv (namespace, key, value, created_at, updated_at) VALUES ('n', 'k', '{}', ?1, ?2)").bind(ago(40), ago(0)).run();
    expect(await purgeExpired(db, NOW)).toEqual({ kv: 1 });
  });

  it("on the paid plan keeps a service's records for its retain_days, and 30 days for one that sets none", async () => {
    const db = sqliteD1();
    await db.prepare("INSERT INTO libraries (id, name, status, created_at, updated_at, tenant_id) VALUES ('l', 'L', 'active', ?1, ?1, 'acme')").bind(ago(400)).run();
    await db.prepare("INSERT INTO library_entries (id, library_id, kind, doc_id, title, yaml, status, revision, created_at, updated_at, tenant_id, storage, retain_days) VALUES ('kept', 'l', 'service', 'kept', 'Kept', '', 'accepted', 1, ?1, ?1, 'acme', 'server', 365)").bind(ago(400)).run();
    await db.prepare("INSERT INTO library_entries (id, library_id, kind, doc_id, title, yaml, status, revision, created_at, updated_at, tenant_id, storage) VALUES ('plain', 'l', 'service', 'plain', 'Plain', '', 'accepted', 1, ?1, ?1, 'acme', 'server')").bind(ago(400)).run();
    const add = async (entry: string, days: number) => {
      await db.prepare("INSERT INTO cases (id, ref, entry_id, service_id, service_title, journey_id, journey_title, status, finish_roles, roles, started_by, started_by_name, created_at, updated_at, run, journey) VALUES (?1, ?1, ?2, 's', 'S', 'j', 'J', 'waiting', '[]', '[]', 'u', 'U', ?3, ?3, '{}', '{}')").bind(`case-${entry}-${days}`, entry, ago(days)).run();
      await db.prepare("INSERT INTO case_events (id, case_id, at, actor_id, actor_name, kind) VALUES (?1, ?2, ?3, 'u', 'U', 'note')").bind(`ev-${entry}-${days}`, `case-${entry}-${days}`, ago(days)).run();
      await db.prepare("INSERT INTO service_events (id, service, journey, kind, run, at) VALUES (?1, ?2, 'j', 'journey.started', 'r', ?3)").bind(`se-${entry}-${days}`, entry, ago(days)).run();
    };
    for (const e of ["kept", "plain"]) for (const d of [20, 100, 400]) await add(e, d);
    const done = await purgeExpired(db, NOW, { retain: true });
    expect(done).toMatchObject({ cases: 3, case_events: 3, service_events: 3 });
    const left = async (t: string) => (await db.prepare(`SELECT id FROM ${t} ORDER BY id`).all<{ id: string }>()).results.map((r) => r.id);
    // "kept" (365 days): the 20- and 100-day-old stay, the 400-day-old goes. "plain" (30 days): only the 20-day-old stays.
    expect(await left("cases")).toEqual(["case-kept-100", "case-kept-20", "case-plain-20"]);
    expect(await left("case_events")).toEqual(["ev-kept-100", "ev-kept-20", "ev-plain-20"]);
    expect(await left("service_events")).toEqual(["se-kept-100", "se-kept-20", "se-plain-20"]);
  });

  it("on the free plan every service's records go at 30 days, whatever retain_days says", async () => {
    const db = sqliteD1();
    await db.prepare("INSERT INTO libraries (id, name, status, created_at, updated_at, tenant_id) VALUES ('l', 'L', 'active', ?1, ?1, 'acme')").bind(ago(400)).run();
    await db.prepare("INSERT INTO library_entries (id, library_id, kind, doc_id, title, yaml, status, revision, created_at, updated_at, tenant_id, storage, retain_days) VALUES ('kept', 'l', 'service', 'kept', 'Kept', '', 'accepted', 1, ?1, ?1, 'acme', 'server', 365)").bind(ago(400)).run();
    await db.prepare("INSERT INTO service_events (id, service, journey, kind, run, at) VALUES ('s1', 'kept', 'j', 'journey.started', 'r', ?1)").bind(ago(100)).run();
    expect(await purgeExpired(db, NOW)).toEqual({ service_events: 1 });
  });

  it("keeps the agent's memory and conversations on the paid plan, and purges them on the free plan", async () => {
    const db = sqliteD1();
    await db.prepare("INSERT INTO threads (id, state, updated_at) VALUES ('t', '{}', ?1)").bind(NOW.getTime() - 90 * DAY).run();
    await db.prepare("INSERT INTO kv (namespace, key, value, created_at, updated_at) VALUES ('n', 'k', '{}', ?1, ?1)").bind(ago(90)).run();
    expect(await purgeExpired(db, NOW, { paid: true })).toEqual({});
    expect(await purgeExpired(db, NOW)).toEqual({ kv: 1, threads: 1 });
  });

  it("works through a large backlog in chunks, and leaves the rest for the next run", async () => {
    const db = sqliteD1();
    for (let i = 0; i < 25; i++) await db.prepare("INSERT INTO feedback (id, rating, mode, language, profile, answers, created_at) VALUES (?1, 'good', 'agent', 'eng_Latn', 0, 1, ?2)").bind(`f${i}`, ago(40)).run();
    expect(await purgeExpired(db, NOW, { chunk: 10, maxChunks: 2 })).toEqual({ feedback: 20 });
    expect(await count(db, "feedback")).toBe(5);
    expect(await purgeExpired(db, NOW, { chunk: 10, maxChunks: 2 })).toEqual({ feedback: 5 });
  });

  it("prunes the audit chain from its oldest end, and what is left still verifies", async () => {
    const db = sqliteD1();
    const events: AuditEvent[] = [];
    let prev = AUDIT_GENESIS;
    for (const [i, days] of [40, 35, 10, 2].entries()) {
      const e = { id: `a${i}`, at: ago(days), actor_type: "admin", actor_id: "x", actor_name: "X", action: "moderator.create", target_id: null, details: null } as unknown as AuditEvent;
      const hash = await auditHash(e, prev);
      events.push({ ...e, prev_hash: prev, hash });
      await db.prepare("INSERT INTO audit (id, at, actor_type, actor_id, actor_name, action, target_id, details, tenant_id, prev_hash, hash) VALUES (?1, ?2, 'admin', 'x', 'X', 'moderator.create', NULL, NULL, 'default', ?3, ?4)").bind(e.id, e.at, prev, hash).run();
      prev = hash;
    }
    expect(await purgeExpired(db, NOW)).toEqual({ audit: 2 });
    const rest = (await db.prepare("SELECT id, at, actor_type, actor_id, actor_name, action, target_id, details, prev_hash, hash FROM audit ORDER BY rowid").all<AuditEvent>()).results;
    expect(rest.map((r) => r.id)).toEqual(["a2", "a3"]);
    expect(rest[0]!.prev_hash).toBe(events[1]!.hash); // the checkpoint for the removed prefix
    expect(await verifyAuditChain(rest)).toMatchObject({ ok: true, checked: 2 });
    expect((await db.prepare("SELECT hash, n FROM audit_heads WHERE tenant_id = 'default'").first<{ hash: string; n: number }>())).toEqual({ hash: events[3]!.hash, n: 4 });
  });

  it("does not touch a business's own store behaviour", async () => {
    const db = sqliteD1();
    const mod = createD1ModerationStore(db, { tenant: "acme" });
    await mod.add("Is this serious?", "red-flag");
    expect(await purgeExpired(db)).toEqual({}); // now, not the fixed NOW
    expect(await mod.list()).toHaveLength(1);
  });
});
