// The free tier's limits (3 questions in 40 minutes per IP), the daily budget, and how an address is
// keyed: a sliding log, so a use frees up exactly one window after it was made.
import { describe, expect, it } from "vitest";
import { createD1QuotaStore, createMemoryQuotaStore, createQuota, ipKey, type QuotaStore } from "../src/quota/index.js";
import { freeTierSelection } from "../src/providers/index.js";
import { sqliteD1 } from "./sqlite-d1.js";

const FREE = { limit: 3, windowMs: 40 * 60_000 };
for (const [name, make] of [
  ["memory", () => createMemoryQuotaStore()],
  ["D1", () => createD1QuotaStore(sqliteD1({ folder: "migrations-platform" }))],
] as [string, () => QuotaStore][]) {
  describe(`quota on ${name}`, () => {
    it("allows 3 in 40 minutes, then says when the next is free", async () => {
      let t = 1_000_000;
      const q = createQuota(make(), { now: () => t });
      expect((await q.take("ip:a", FREE)).remaining).toBe(2);
      t += 60_000;
      expect((await q.take("ip:a", FREE)).remaining).toBe(1);
      t += 60_000;
      expect((await q.take("ip:a", FREE)).remaining).toBe(0);
      t += 60_000;
      const no = await q.take("ip:a", FREE);
      expect(no).toMatchObject({ ok: false, remaining: 0 });
      // The oldest use was 3 minutes ago: free again 37 minutes from now.
      expect(no.retryAfterMs).toBe(37 * 60_000);
      // A refusal counts nothing; another address is untouched.
      expect((await q.take("ip:b", FREE)).ok).toBe(true);
      t += 37 * 60_000 + 1;
      expect((await q.take("ip:a", FREE)).ok).toBe(true);
      expect((await q.take("ip:a", FREE)).ok).toBe(false);
    });

    it("counts a big budget without listing it, and 0 means no limit", async () => {
      const q = createQuota(make(), { now: () => 5_000_000 });
      const day = { limit: 150, windowMs: 86_400_000 };
      for (let i = 0; i < 150; i++) expect((await q.take("day", day)).ok).toBe(true);
      expect((await q.take("day", day)).ok).toBe(false);
      expect((await q.take("anything", { limit: 0, windowMs: 1 })).ok).toBe(true);
      expect(await q.allows("day", day)).toBe(false);
    });

    it("forgets what is older than the longest window", async () => {
      let t = 100_000_000;
      const store = make();
      const q = createQuota(store, { now: () => t, pruneEvery: 1 });
      await q.take("old", FREE);
      t += 26 * 3_600_000;
      await q.take("new", FREE);
      expect(await store.count("old", 0)).toBe(0);
    });
  });
}

describe("ipKey", () => {
  it("hashes an address, keys IPv6 by its /64, and leaves no address when there is none", async () => {
    const a = await ipKey("203.0.113.9", "s");
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toContain("203");
    expect(await ipKey("2001:db8:1:2:aaaa::1", "s")).toBe(await ipKey("2001:db8:1:2:bbbb:cccc:dddd:eeee", "s"));
    expect(await ipKey("2001:db8:1:3::1", "s")).not.toBe(await ipKey("2001:db8:1:2::1", "s"));
    expect(await ipKey("203.0.113.9", "other")).not.toBe(a);
    expect(await ipKey(undefined, "s")).toBeNull();
  });
});

describe("the free tier's model", () => {
  it("is a small tool-calling model from a configured provider, or the one FREE_TIER_MODEL names", () => {
    expect(freeTierSelection({})).toBeNull();
    expect(freeTierSelection({ ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k" })).toEqual({ provider: "anthropic", model: "claude-haiku-5-5" });
    expect(freeTierSelection({ OPENAI_API_KEY: "k" })).toEqual({ provider: "openai", model: "gpt-5.5-mini" });
    expect(freeTierSelection({ ANTHROPIC_API_KEY: "k", FREE_TIER_MODEL: "anthropic/claude-sonnet-5-5" })).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
    // A model that isn't on the allowlist, or whose provider isn't configured, is not used.
    expect(freeTierSelection({ ANTHROPIC_API_KEY: "k", FREE_TIER_MODEL: "anthropic/not-a-model" })).toBeNull();
    expect(freeTierSelection({ FREE_TIER_MODEL: "openai/gpt-5.5-mini" })).toBeNull();
  });
});

describe("sealing keys are separate per purpose", () => {
  it("opens what it sealed, refuses another purpose, and still opens the original format", async () => {
    const { seal, unseal } = await import("../src/identity/crypto.js");
    const secret = "s".repeat(40);
    const a = await seal(secret, "hunter2", "connector");
    expect(a).toMatch(/^v2\.connector\./);
    expect(await unseal(secret, a)).toBe("hunter2");
    expect(await unseal(secret, a, "connector")).toBe("hunter2");
    await expect(unseal(secret, a, "signing-key")).rejects.toThrow();
    // Re-labelling the purpose in the text doesn't open it under another key.
    await expect(unseal(secret, a.replace("v2.connector", "v2.signing-key"))).rejects.toThrow();
    await expect(unseal("t".repeat(40), a)).rejects.toThrow();
  });
});
