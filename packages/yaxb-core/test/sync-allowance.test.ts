// The free plan's yearly sync allowance: 5 a year per account, a rolling year, no limit on paid.
import { describe, expect, it } from "vitest";
import { createD1SyncUseStore, createMemorySyncUseStore, createSyncAllowance, SYNC_WINDOW_MS, type SyncUseStore } from "../src/quota/sync-allowance.js";
import { sqliteD1 } from "./sqlite-d1.js";

const DAY = 86_400_000;
const stores: [string, () => SyncUseStore][] = [
  ["memory", () => createMemorySyncUseStore()],
  ["D1", () => createD1SyncUseStore(sqliteD1({ folder: "migrations-platform" }))],
];

describe.each(stores)("sync allowance (%s)", (_, make) => {
  it("allows 5 a year per account and refuses the sixth, saying when one frees up", async () => {
    let t = Date.UTC(2026, 0, 1);
    const a = createSyncAllowance(make(), { perYear: 5, now: () => t });
    expect(await a.status("ann")).toEqual({ limit: 5, used: 0, left: 5, freeAgainAt: null });
    const first = t;
    for (let i = 0; i < 5; i++, t += DAY) expect((await a.take("ann")).ok).toBe(true);
    expect(await a.status("ann")).toMatchObject({ used: 5, left: 0, freeAgainAt: new Date(first + SYNC_WINDOW_MS).toISOString() });
    const refused = await a.take("ann");
    expect(refused).toMatchObject({ ok: false, used: 5, left: 0 }); // a refusal counts nothing
    expect((await a.status("ann")).used).toBe(5);
    expect((await a.take("bob")).left).toBe(4); // another account has its own
  });

  it("frees one a year after it was used, so syncing every 30 days is not possible", async () => {
    let t = Date.UTC(2026, 0, 1);
    const a = createSyncAllowance(make(), { perYear: 5, now: () => t });
    let ok = 0;
    for (let month = 0; month < 12; month++, t += 30 * DAY) if ((await a.take("ann")).ok) ok++;
    expect(ok).toBe(5);
    t = Date.UTC(2026, 0, 1) + SYNC_WINDOW_MS + 1; // the first one has left the year
    expect(await a.status("ann")).toMatchObject({ left: 1 });
    expect((await a.take("ann")).ok).toBe(true);
  });

  it("has no limit when perYear is null (the paid plan), but still counts", async () => {
    const a = createSyncAllowance(make(), { perYear: null });
    for (let i = 0; i < 20; i++) expect((await a.take("ann")).ok).toBe(true);
    expect(await a.status("ann")).toEqual({ limit: null, used: 20, left: null, freeAgainAt: null });
  });

  it("two at once can't both take the last one", async () => {
    const a = createSyncAllowance(make(), { perYear: 1 });
    const both = await Promise.all([a.take("ann"), a.take("ann")]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
  });
});
