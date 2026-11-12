// Moderators and their keys (MOD-20..25, SEC-5), on the memory store and on the real D1 schema
// (migrations applied to node:sqlite through a small D1-shaped adapter).
import { describe, expect, it } from "vitest";
import { auditEvent, createMemoryModeratorStore, createModeratorService, hashKey, KEY_PREFIX, looksLikeKey, moderatorProfileSchema, statusOf, type ModeratorStore } from "../src/moderators/index.js";
import { createD1ModeratorStore } from "../src/stores/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

const stores: [string, () => ModeratorStore][] = [
  ["memory", createMemoryModeratorStore],
  ["D1 (SQLite)", () => createD1ModeratorStore(sqliteD1())],
];

describe.each(stores)("moderator keys: %s", (_name, makeStore) => {
  it("issues a key shown once, stores only its hash, and lets the moderator sign in with it", async () => {
    const store = makeStore();
    const svc = createModeratorService(store);
    const { moderator, key } = await svc.issue({ name: "Elizabeth John", label: "Policies", roles: ["moderator", "curator"] });
    expect(looksLikeKey(key)).toBe(true);
    expect(key.startsWith(KEY_PREFIX)).toBe(true);
    expect(moderator.key_prefix).toBe(`${key.slice(0, KEY_PREFIX.length + 4)}…`);
    expect(JSON.stringify(await store.list())).not.toContain(key);
    expect(await store.keyHashOf(moderator.id)).toBe(await hashKey(key));
    expect((await svc.signIn(key))?.name).toBe("Elizabeth John");
    expect((await store.get(moderator.id))?.last_seen_at).not.toBeNull();
    expect(await svc.signIn(`${KEY_PREFIX}${"x".repeat(43)}`)).toBeNull();
    expect(await svc.signIn("not a key")).toBeNull();
  });

  it("stops a revoked key at once, and a rotated key's old value", async () => {
    const store = makeStore();
    const svc = createModeratorService(store);
    const a = await svc.issue({ name: "A" });
    await svc.revoke(a.moderator.id);
    expect(await svc.signIn(a.key)).toBeNull();
    expect(statusOf((await store.get(a.moderator.id))!)).toBe("revoked");

    const b = await svc.issue({ name: "B" });
    const rotated = (await svc.rotate(b.moderator.id))!;
    expect(rotated.key).not.toBe(b.key);
    expect(await svc.signIn(b.key)).toBeNull();
    expect((await svc.signIn(rotated.key))?.id).toBe(b.moderator.id);
  });

  it("expires keys", async () => {
    const svc = createModeratorService(makeStore());
    const { moderator } = await svc.issue({ name: "Temp", expiresInDays: 1 });
    expect(statusOf(moderator)).toBe("active");
    expect(statusOf(moderator, new Date(Date.now() + 2 * 864e5))).toBe("expired");
  });

  it("keeps a profile per moderator, validated, with defaults until saved", async () => {
    const store = makeStore();
    const svc = createModeratorService(store);
    const { moderator } = await svc.issue({ name: "Elizabeth Kelly" });
    expect((await svc.profile(moderator)).display_name).toBe("Elizabeth Kelly");
    await svc.saveProfile(moderator, { display_name: "Liz", languages: ["eng_Latn", "tam_Taml"], sources: ["policies", "pharmacy"], preferences: { queue: "open" } });
    expect(await svc.profile(moderator)).toMatchObject({ display_name: "Liz", languages: ["eng_Latn", "tam_Taml"], sources: ["policies", "pharmacy"], preferences: { queue: "open" } });
    await expect(svc.saveProfile(moderator, { display_name: "Liz", sources: ["made-up"] })).rejects.toThrow();
    expect(moderatorProfileSchema.safeParse({ display_name: "x", extra: 1 }).success).toBe(false);
  });

  it("records who did what in the audit log, and never a key", async () => {
    const store = makeStore();
    const svc = createModeratorService(store);
    const { moderator, key } = await svc.issue({ name: "Audited" }, { name: "Admin" });
    await svc.signIn(key);
    await svc.revoke(moderator.id);
    await svc.signIn(key);
    const log = await store.auditLog();
    expect(log.map((e) => e.action)).toEqual(["moderator.sign_in_refused", "moderator.key_revoked", "moderator.signed_in", "moderator.key_issued"]);
    expect(JSON.stringify(log)).not.toContain(key);
    expect((await store.auditLog({ actorId: moderator.id })).map((e) => e.action)).toEqual(["moderator.sign_in_refused", "moderator.signed_in"]);
  });
});

describe("audit entries", () => {
  it("keep only short facts", () => {
    const e = auditEvent({ actor_type: "admin", actor_id: null, actor_name: null, action: "moderator.updated", target_id: "m1", details: { fields: ["name", "roles"], note: "x".repeat(200), nested: { a: 1 } } });
    expect(e.details).toEqual({ fields: "name, roles", note: "x".repeat(80) });
    expect(() => auditEvent({ actor_type: "admin", actor_id: null, actor_name: null, action: "made.up" as never, target_id: null })).toThrow();
  });
});
