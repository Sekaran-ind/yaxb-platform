// Runtime-data export and import: one business's rows only, matched to services by document id,
// added never overwritten, with the free plan's and the paid plan's clocks.
import { describe, expect, it } from "vitest";
import { exportRecords, importRecords, MAX_RECORD_ROWS, parseRecords, RecordsError } from "../src/records/index.js";
import { sqliteD1 } from "./sqlite-d1.js";

type Db = ReturnType<typeof sqliteD1>;
const NOW = new Date("2026-12-31T12:00:00.000Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

async function service(db: Db, tenant: string, entry: string, doc: string, retain: number | null = null) {
  await db.prepare("INSERT OR IGNORE INTO libraries (id, name, status, created_at, updated_at, tenant_id) VALUES (?1, 'L', 'active', ?2, ?2, ?3)").bind(`lib-${tenant}`, ago(400), tenant).run();
  await db.prepare("INSERT INTO library_entries (id, library_id, kind, doc_id, title, yaml, status, revision, created_at, updated_at, tenant_id, storage, retain_days) VALUES (?1, ?2, 'service', ?3, ?4, '', 'accepted', 1, ?5, ?5, ?6, 'server', ?7)").bind(entry, `lib-${tenant}`, doc, `Service ${doc}`, ago(400), tenant, retain).run();
}
async function work(db: Db, tenant: string, entry: string, n: string, days: number) {
  await db.prepare("INSERT INTO cases (id, ref, entry_id, service_id, service_title, journey_id, journey_title, revision, status, finish_roles, roles, started_by, started_by_name, created_at, updated_at, run, journey, links, tenant_id) VALUES (?1, ?2, ?3, 'doc', 'S', 'j', 'J', 1, 'waiting', '[]', '[\"clerk\"]', 'u', 'U', ?4, ?4, '{\"a\":1}', '{\"b\":2}', '{\"parent\":{}}', ?5)").bind(`c-${n}`, `R-${n}`, entry, ago(days), tenant).run();
  await db.prepare("INSERT INTO case_events (id, case_id, at, actor_id, actor_name, kind, text) VALUES (?1, ?2, ?3, 'u', 'U', 'note', 'hello')").bind(`ce-${n}`, `c-${n}`, ago(days)).run();
  await db.prepare("INSERT INTO service_events (id, service, journey, kind, run, at, ok, tenant_id) VALUES (?1, ?2, 'j', 'journey.started', 'r', ?3, 1, ?4)").bind(`se-${n}`, entry, ago(days), tenant).run();
}
const ids = async (db: Db, table: string, tenant?: string) => (await db.prepare(`SELECT id FROM ${table}${tenant ? " WHERE tenant_id = ?1" : ""} ORDER BY id`).bind(...(tenant ? [tenant] : [])).all<{ id: string }>()).results.map((r) => r.id);

describe("records export and import", () => {
  it("exports only the business's own rows, and one service when asked", async () => {
    const db = sqliteD1();
    await service(db, "acme", "acme-leave", "leave");
    await service(db, "acme", "acme-visit", "visit");
    await service(db, "bolt", "bolt-leave", "leave");
    await work(db, "acme", "acme-leave", "a1", 5);
    await work(db, "acme", "acme-visit", "a2", 5);
    await work(db, "bolt", "bolt-leave", "b1", 5);
    const all = await exportRecords(db, "acme");
    expect(all.cases.map((c) => c.id)).toEqual(["c-a1", "c-a2"]);
    expect(all.case_events.map((c) => c.id)).toEqual(["ce-a1", "ce-a2"]);
    expect(all.service_events.map((c) => c.id)).toEqual(["se-a1", "se-a2"]);
    expect(all.services.map((s) => s.doc_id).sort()).toEqual(["leave", "visit"]);
    expect(JSON.stringify(all)).not.toContain("b1");
    expect(JSON.stringify(all)).not.toContain("parent"); // links are never exported
    const one = await exportRecords(db, "acme", { service: "acme-visit" });
    expect(one.cases.map((c) => c.id)).toEqual(["c-a2"]);
    expect(one.service_events.map((c) => c.id)).toEqual(["se-a2"]);
  });

  it("imports into another deployment, matching the service by document id, and a second import adds nothing", async () => {
    const from = sqliteD1();
    await service(from, "acme", "old-leave", "leave", 365);
    await work(from, "acme", "old-leave", "x", 100);
    const file = JSON.parse(JSON.stringify(await exportRecords(from, "acme")));

    const to = sqliteD1();
    await service(to, "newco", "new-leave", "leave", 365); // another id, the same document, 365 days
    await work(to, "other", "other-entry", "o", 1); // somebody else's rows are left alone
    const first = await importRecords(to, "newco", parseRecords(file), { plan: "paid", now: NOW });
    expect(first).toMatchObject({ added: { cases: 1, case_events: 1, service_events: 1 }, already: { cases: 0 }, expired: 0, missingServices: [] });
    const c = await to.prepare("SELECT entry_id, tenant_id, created_at, links, run FROM cases WHERE id = 'c-x'").first<{ entry_id: string; tenant_id: string; created_at: string; links: string | null; run: string }>();
    expect(c).toEqual({ entry_id: "new-leave", tenant_id: "newco", created_at: ago(100), links: null, run: '{"a":1}' });
    expect((await to.prepare("SELECT service, tenant_id FROM service_events WHERE id = 'se-x'").first())).toEqual({ service: "new-leave", tenant_id: "newco" });
    const second = await importRecords(to, "newco", parseRecords(file), { plan: "paid", now: NOW });
    expect(second.added).toEqual({ cases: 0, case_events: 0, service_events: 0 });
    expect(second.already).toEqual({ cases: 1, case_events: 1, service_events: 1 });
    expect(await ids(to, "cases")).toEqual(["c-o", "c-x"]);
  });

  it("never takes over or attaches to another business's rows", async () => {
    const db = sqliteD1();
    await service(db, "acme", "acme-leave", "leave");
    await service(db, "bolt", "bolt-leave", "leave");
    await work(db, "acme", "acme-leave", "a", 5);
    const file = parseRecords(JSON.parse(JSON.stringify(await exportRecords(db, "acme"))));
    // Bolt imports Acme's file: the ids already exist under Acme, so nothing is written for Bolt.
    const r = await importRecords(db, "bolt", file, { plan: "paid", now: NOW });
    expect(r.added).toEqual({ cases: 0, case_events: 0, service_events: 0 });
    expect(await ids(db, "cases", "bolt")).toEqual([]);
    expect(await ids(db, "service_events", "bolt")).toEqual([]);
    // And an event for a case that is somebody else's is not attached to it.
    const forged = { ...file, cases: [], case_events: [{ ...file.case_events[0]!, id: "forged" }] };
    expect((await importRecords(db, "bolt", forged, { plan: "paid", now: NOW })).added.case_events).toBe(0);
    expect(await ids(db, "case_events")).toEqual(["ce-a"]);
  });

  it("says which services this business doesn't have", async () => {
    const from = sqliteD1();
    await service(from, "acme", "e1", "leave");
    await work(from, "acme", "e1", "a", 5);
    const to = sqliteD1();
    const r = await importRecords(to, "newco", parseRecords(JSON.parse(JSON.stringify(await exportRecords(from, "acme")))), { plan: "paid", now: NOW });
    expect(r.missingServices).toEqual(["Service leave"]);
    expect(r.added).toEqual({ cases: 0, case_events: 0, service_events: 0 });
  });

  it("on the free plan starts a case's 30 days again, and skips what is past 30 days", async () => {
    const from = sqliteD1();
    await service(from, "acme", "e1", "leave");
    await work(from, "acme", "e1", "old", 80);
    const to = sqliteD1();
    await service(to, "newco", "n1", "leave");
    const r = await importRecords(to, "newco", parseRecords(JSON.parse(JSON.stringify(await exportRecords(from, "acme")))), { plan: "free", now: NOW });
    expect(r.added.cases).toBe(1);
    expect(r.expired).toBe(1); // the 80-day-old service event
    expect((await to.prepare("SELECT created_at FROM cases WHERE id = 'c-old'").first<{ created_at: string }>())!.created_at).toBe(NOW.toISOString());
  });

  it("on the paid plan skips rows past the service's retention, and keeps the rest with their own times", async () => {
    const from = sqliteD1();
    await service(from, "acme", "e1", "leave");
    await work(from, "acme", "e1", "a", 100);
    await work(from, "acme", "e1", "b", 500);
    const file = parseRecords(JSON.parse(JSON.stringify(await exportRecords(from, "acme"))));
    const to = sqliteD1();
    await service(to, "newco", "n1", "leave", 365);
    const r = await importRecords(to, "newco", file, { plan: "paid", now: NOW });
    expect(r.added.cases).toBe(1);
    expect(r.expired).toBe(2); // the 500-day-old case and service event
    expect(await ids(to, "cases")).toEqual(["c-a"]);
    expect(await ids(to, "case_events")).toEqual(["ce-a"]); // the expired case's event is not left behind
  });

  it("refuses a file it can't read, naming the problem", async () => {
    expect(() => parseRecords({ format: "other" })).toThrow(RecordsError);
    expect(() => parseRecords({ format: "yaxb-records", version: 2 })).toThrow(/version/);
    const db = sqliteD1();
    await service(db, "acme", "e1", "leave");
    const good = JSON.parse(JSON.stringify(await exportRecords(db, "acme")));
    expect(() => parseRecords({ ...good, cases: [{ id: "x" }] })).toThrow(/cases/);
    expect(() => parseRecords({ ...good, extra: 1 })).toThrow(RecordsError);
    const tooMany = { ...good, service_events: Array.from({ length: MAX_RECORD_ROWS + 1 }, (_, i) => ({ id: `s${i}`, service: "e1", journey: "j", kind: "journey.started", step: null, role: null, run: "r", at: ago(1), ms: null, ok: null, actor: null, outcome: null })) };
    expect(() => parseRecords(tooMany)).toThrow(/at most/);
  });

  it("puts a large file in through a few statements, not one per row", async () => {
    const from = sqliteD1();
    await service(from, "acme", "e1", "leave");
    for (let i = 0; i < 600; i++) await from.prepare("INSERT INTO service_events (id, service, journey, kind, run, at, tenant_id) VALUES (?1, 'e1', 'j', 'journey.started', 'r', ?2, 'acme')").bind(`s${i}`, ago(1)).run();
    const to = sqliteD1();
    await service(to, "newco", "n1", "leave");
    let statements = 0;
    const counting = { prepare: (sql: string) => (/INSERT OR IGNORE INTO service_events/.test(sql) && statements++, to.prepare(sql)) } as typeof to;
    const r = await importRecords(counting, "newco", parseRecords(JSON.parse(JSON.stringify(await exportRecords(from, "acme")))), { plan: "paid", now: NOW });
    expect(r.added.service_events).toBe(600);
    expect(statements).toBe(3);
  });
});
