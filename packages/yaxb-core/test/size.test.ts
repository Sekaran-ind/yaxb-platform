// Database size: the thresholds, the size D1 reports, and which businesses hold the most rows.
import { describe, expect, it } from "vitest";
import { biggestTenants, databaseBytes, sizeLevel } from "../src/stores/size.js";
import { sqliteD1 } from "./sqlite-d1.js";

describe("database size", () => {
  it("warns at 70% and is critical at 90%", () => {
    const limit = 1000;
    expect([0, 699, 700, 899, 900, 1200].map((b) => sizeLevel(b, limit))).toEqual(["ok", "ok", "warn", "warn", "critical", "critical"]);
  });

  it("reads the size from the query's meta, and is null where there is none", async () => {
    expect(await databaseBytes(sqliteD1())).toBeNull();
    const reporting = { prepare: () => ({ run: async () => ({ meta: { size_after: 4096 } }) }) } as never;
    expect(await databaseBytes(reporting)).toBe(4096);
  });

  it("lists the businesses with the most rows, largest first, as counts only", async () => {
    const db = sqliteD1();
    const add = (t: string, n: number) => db.prepare("INSERT INTO feedback (id, rating, mode, language, profile, answers, created_at, tenant_id) VALUES (?1, 'good', 'agent', 'eng_Latn', 0, 1, '2026-12-01T00:00:00.000Z', ?2)").bind(`${t}-${n}`, t).run();
    for (let i = 0; i < 3; i++) await add("acme", i);
    for (let i = 0; i < 5; i++) await add("bolt", i);
    await add("cole", 0);
    await db.prepare("INSERT INTO service_events (id, service, journey, kind, run, at, tenant_id) VALUES ('e1', 's', 'j', 'journey.started', 'r', '2026-12-01T00:00:00.000Z', 'acme')").run();
    expect(await biggestTenants(db, 2)).toEqual([{ tenant: "bolt", rows: 5 }, { tenant: "acme", rows: 4 }]);
  });
});
