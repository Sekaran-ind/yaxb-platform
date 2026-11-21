// The Worker's sync allowance: the free plan's limit, none on paid, and the status route.
import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../packages/yaxb-core/test/sqlite-d1";
import { syncAllowance, syncLimit, takeSync } from "../sync-allowance";

const env = (plan: "free" | "paid", extra: Record<string, unknown> = {}) => ({ SESSION_SECRET: "x".repeat(40), PLAN: plan, PLATFORM_DB: sqliteD1({ folder: "migrations-platform" }), ...extra }) as never;

describe("the sync allowance", () => {
  it("is 5 a year on the free plan, counted on the platform database", async () => {
    const e = env("free");
    expect(syncLimit(e)).toBe(5);
    for (let i = 0; i < 5; i++) expect((await takeSync(e, "acct-1")).ok).toBe(true);
    expect(await takeSync(e, "acct-1")).toMatchObject({ ok: false, left: 0 });
    expect(await syncAllowance(e).status("acct-1")).toMatchObject({ limit: 5, used: 5, left: 0 });
  });
  it("follows SYNC_PER_YEAR, where 0 is no limit", async () => {
    expect(syncLimit(env("free", { SYNC_PER_YEAR: "2" }))).toBe(2);
    expect(syncLimit(env("free", { SYNC_PER_YEAR: "0" }))).toBeNull();
  });
  it("has no limit on the paid plan", async () => {
    const e = env("paid");
    expect(syncLimit(e)).toBeNull();
    for (let i = 0; i < 8; i++) expect((await takeSync(e, "acct-1")).ok).toBe(true);
    expect(await syncAllowance(e).status("acct-1")).toMatchObject({ limit: null, left: null });
  });
});
