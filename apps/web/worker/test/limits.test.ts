// The free plan: 3 short hosted-model questions per IP every 40 minutes on the small tool-calling model
// with short answers, long questions and long answers moved to the paid plan, a daily budget, nobody
// exempt (members included), the paid deployment unlimited, and a local run (no address) unlimited.
import { describe, expect, it } from "vitest";
import { modelGate } from "../limits";

const env = (extra: Record<string, string> = {}) => ({ SESSION_SECRET: "s".repeat(40), ANTHROPIC_API_KEY: "k", ...extra }) as never;
const from = (ip: string | null) => ({ req: { header: (n: string) => (n === "cf-connecting-ip" ? (ip ?? undefined) : undefined) } }) as never;

describe("modelGate", () => {
  it("allows 3 short questions per IP, then asks them to wait or move to the paid plan, on the small model with a short answer", async () => {
    const e = env({ UPGRADE_URL: "https://anjalai.cc/paid" });
    for (let i = 0; i < 3; i++) expect(await modelGate(from("203.0.113.5"), e, { chars: 40 })).toMatchObject({ ok: true, free: true, selection: { provider: "anthropic", model: "claude-haiku-5-5" }, brief: { maxTokens: 400, words: 160 } });
    const no = await modelGate(from("203.0.113.5"), e, { chars: 40 });
    expect(no).toMatchObject({ ok: false, status: 429 });
    expect(no.ok === false && no.retryAfterS).toBeGreaterThan(2300);
    expect(no.ok === false && no.message).toMatch(/3 AI questions every 40 minutes.*Kiosk only.*paid plan.*anjalai\.cc\/paid/s);
    // Another address is not affected.
    expect((await modelGate(from("203.0.113.6"), e, { chars: 40 })).ok).toBe(true);
  });

  it("treats everyone alike: a signed-in member is the free plan too", async () => {
    // The gate has no notion of a member any more: nothing is passed, nothing is exempt.
    const e = env();
    for (let i = 0; i < 3; i++) expect((await modelGate(from("203.0.113.7"), e, { chars: 10 })).ok).toBe(true);
    expect((await modelGate(from("203.0.113.7"), e, { chars: 10 })).ok).toBe(false);
  });

  it("asks a long question, or a long answer, to move to the paid plan, without using up the allowance", async () => {
    const e = env({ FREE_TIER_MAX_QUESTION_CHARS: "100" });
    const tooLong = await modelGate(from("203.0.113.8"), e, { chars: 101 });
    expect(tooLong).toMatchObject({ ok: false, status: 413 });
    expect(tooLong.ok === false && tooLong.message).toMatch(/up to 100 characters.*paid plan/s);
    const draft = await modelGate(from("203.0.113.8"), e, { long: true });
    expect(draft).toMatchObject({ ok: false, status: 402 });
    expect(draft.ok === false && draft.message).toMatch(/whole service.*paid plan/s);
    // Neither counted: all three short questions still go through.
    for (let i = 0; i < 3; i++) expect((await modelGate(from("203.0.113.8"), e, { chars: 100 })).ok).toBe(true);
  });

  it("is off on the paid deployment, with no address, or with no allowance set", async () => {
    const paid = env({ PLAN: "paid" });
    for (let i = 0; i < 6; i++) expect(await modelGate(from("203.0.113.9"), paid, { chars: 3000, long: true })).toEqual({ ok: true, free: false, selection: null });
    for (let i = 0; i < 6; i++) expect((await modelGate(from(null), env(), { chars: 10 })).ok).toBe(true);
    const off = env({ FREE_TIER_QUESTIONS: "0" });
    for (let i = 0; i < 6; i++) expect(await modelGate(from("203.0.113.10"), off, { chars: 10 })).toEqual({ ok: true, free: false, selection: null });
  });

  it("follows the settings: a different allowance, window, answer length and FREE_TIER_MODEL", async () => {
    const e = env({ FREE_TIER_QUESTIONS: "1", FREE_TIER_WINDOW_MINUTES: "10", FREE_TIER_MAX_TOKENS: "250", FREE_TIER_MODEL: "anthropic/claude-sonnet-5-5" });
    expect(await modelGate(from("198.51.100.1"), e)).toMatchObject({ ok: true, selection: { model: "claude-sonnet-5-5" }, brief: { maxTokens: 250, words: 100 } });
    const no = await modelGate(from("198.51.100.1"), e);
    expect(no.ok === false && no.message).toMatch(/1 AI questions every 10 minutes/);
  });

  it("stops at the daily budget for the whole deployment", async () => {
    const e = env({ FREE_TIER_DAILY: "2" });
    expect((await modelGate(from("192.0.2.1"), e)).ok).toBe(true);
    expect((await modelGate(from("192.0.2.2"), e)).ok).toBe(true);
    const out = await modelGate(from("192.0.2.3"), e);
    expect(out).toMatchObject({ ok: false, status: 503 });
    expect(out.ok === false && out.message).toMatch(/used up for today/);
  });

  it("says so when no model is configured for the free plan", async () => {
    const out = await modelGate(from("192.0.2.9"), { SESSION_SECRET: "s".repeat(40) } as never);
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
