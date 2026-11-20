// The free tier (Phase 0): 3 hosted-model questions per IP every 40 minutes on the small tool-calling
// model, a daily budget for the deployment, members exempt, and a local run (no address) unlimited.
import { describe, expect, it } from "vitest";
import { modelGate } from "../limits";

const env = (extra: Record<string, string> = {}) => ({ SESSION_SECRET: "s".repeat(40), ANTHROPIC_API_KEY: "k", ...extra }) as never;
const from = (ip: string | null) => ({ req: { header: (n: string) => (n === "cf-connecting-ip" ? (ip ?? undefined) : undefined) } }) as never;

describe("modelGate", () => {
  it("allows 3 questions per IP, then asks them to wait, on the free tier's small model", async () => {
    const e = env();
    for (let i = 0; i < 3; i++) expect(await modelGate(from("203.0.113.5"), e, false)).toMatchObject({ ok: true, free: true, selection: { provider: "anthropic", model: "claude-haiku-5-5" } });
    const no = await modelGate(from("203.0.113.5"), e, false);
    expect(no).toMatchObject({ ok: false, status: 429 });
    expect(no.ok === false && no.retryAfterS).toBeGreaterThan(2300);
    expect(no.ok === false && no.message).toMatch(/3 AI questions every 40 minutes.*Kiosk only/s);
    // Another address is not affected.
    expect((await modelGate(from("203.0.113.6"), e, false)).ok).toBe(true);
  });

  it("exempts members, and a run with no address, and can be turned off", async () => {
    const e = env();
    for (let i = 0; i < 6; i++) expect(await modelGate(from("203.0.113.7"), e, true)).toEqual({ ok: true, free: false, selection: null });
    for (let i = 0; i < 6; i++) expect((await modelGate(from(null), e, false)).ok).toBe(true);
    const off = env({ FREE_TIER_QUESTIONS: "0" });
    for (let i = 0; i < 6; i++) expect(await modelGate(from("203.0.113.8"), off, false)).toEqual({ ok: true, free: false, selection: null });
  });

  it("follows the settings: a different allowance and window, and FREE_TIER_MODEL", async () => {
    const e = env({ FREE_TIER_QUESTIONS: "1", FREE_TIER_WINDOW_MINUTES: "10", FREE_TIER_MODEL: "anthropic/claude-sonnet-5-5" });
    expect(await modelGate(from("198.51.100.1"), e, false)).toMatchObject({ ok: true, selection: { model: "claude-sonnet-5-5" } });
    const no = await modelGate(from("198.51.100.1"), e, false);
    expect(no.ok === false && no.message).toMatch(/1 AI questions every 10 minutes/);
  });

  it("stops at the daily budget for the whole deployment", async () => {
    const e = env({ FREE_TIER_DAILY: "2" });
    expect((await modelGate(from("192.0.2.1"), e, false)).ok).toBe(true);
    expect((await modelGate(from("192.0.2.2"), e, false)).ok).toBe(true);
    const out = await modelGate(from("192.0.2.3"), e, false);
    expect(out).toMatchObject({ ok: false, status: 503 });
    expect(out.ok === false && out.message).toMatch(/used up for today/);
    // Members aren't counted against it.
    expect((await modelGate(from("192.0.2.4"), e, true)).ok).toBe(true);
  });

  it("says so when no model is configured for the free tier", async () => {
    const out = await modelGate(from("192.0.2.9"), { SESSION_SECRET: "s".repeat(40) } as never, false);
    expect(out).toMatchObject({ ok: false, status: 503 });
  });
});

describe("guessing case references", () => {
  it("is cut off per IP address after a few wrong ones, whatever session each guess uses", async () => {
    const { app } = await import("../index");
    const { sqliteD1 } = await import("../../../../packages/yaxb-core/test/sqlite-d1");
    const e = { SESSION_SECRET: "s".repeat(40), CASES_CENTRAL: "on", CASE_REF_MISSES: "3", DB: sqliteD1(), DB_BUSINESS: sqliteD1(), DB_FAMILY: sqliteD1(), DB_COMMUNITY: sqliteD1() } as never;
    const guess = (ref: string, ip: string) => app.request(`https://business.anjalai.cc/api/cases/${ref}`, { headers: { host: "business.anjalai.cc", origin: "https://business.anjalai.cc", "cf-connecting-ip": ip } }, e);
    // Each guess has no cookie, so each is a new session: the per-session limit never trips.
    expect((await guess("R-AAAAAA", "198.51.100.20")).status).toBe(404);
    expect((await guess("R-BBBBBB", "198.51.100.20")).status).toBe(404);
    expect((await guess("R-CCCCCC", "198.51.100.20")).status).toBe(404);
    expect((await guess("R-DDDDDD", "198.51.100.20")).status).toBe(429);
    // Someone else, or a case id rather than a reference, is not affected.
    expect((await guess("R-DDDDDD", "198.51.100.21")).status).toBe(404);
    expect((await guess("not-a-reference", "198.51.100.20")).status).toBe(404);
  });
});
