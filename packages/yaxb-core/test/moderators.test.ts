// Moderators and their keys (MOD-20..25, SEC-5), on the memory store and on the real D1 schema
// (migrations applied to node:sqlite through a small D1-shaped adapter).
import { describe, expect, it } from "vitest";
import { AUDIT_GENESIS, auditEvent, verifyAuditChain, createMemoryModeratorStore, createModeratorService, hashKey, KEY_PREFIX, looksLikeKey, moderatorProfileSchema, statusOf, type ModeratorStore } from "../src/moderators/index.js";
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
    await svc.saveProfile(moderator, { display_name: "Liz", languages: ["eng_Latn", "tam_Taml"], sources: ["work", "health"], preferences: { queue: "open" } });
    expect(await svc.profile(moderator)).toMatchObject({ display_name: "Liz", languages: ["eng_Latn", "tam_Taml"], sources: ["work", "health"], preferences: { queue: "open" } });
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

describe("the audit chain (AUD-2)", () => {
  const event = (n: number) => auditEvent({ actor_type: "admin", actor_id: null, actor_name: "Administrator", action: "admin.signed_in", target_id: null, details: { n } });

  it.each(stores)("links each record to the one before it, and the head moves with it: %s", async (_n, make) => {
    const store = make();
    for (let i = 0; i < 5; i++) await store.audit(event(i));
    const chain = await store.auditChain();
    expect(chain).toHaveLength(5);
    expect(chain[0]!.prev_hash).toBe(AUDIT_GENESIS);
    for (let i = 1; i < 5; i++) expect(chain[i]!.prev_hash).toBe(chain[i - 1]!.hash);
    expect(await verifyAuditChain(chain)).toMatchObject({ ok: true, checked: 5 });
    expect(await store.auditHead()).toEqual({ hash: chain[4]!.hash, count: 5 });
    expect((await store.auditLog({ limit: 1 }))[0]!.hash).toBe(chain[4]!.hash);
  });

  it.each(stores)("stays one chain when records are written at the same time: %s", async (_n, make) => {
    const store = make();
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.audit(event(i))));
    const chain = await store.auditChain();
    expect(chain).toHaveLength(12);
    expect(await verifyAuditChain(chain)).toMatchObject({ ok: true, checked: 12 });
  });

  it("refuses, in the database, a second record after the same one (no fork across instances)", async () => {
    const db = sqliteD1();
    const store = createD1ModeratorStore(db);
    await store.audit(event(0));
    const [first] = await store.auditChain();
    const fork = () =>
      db
        .prepare("INSERT INTO audit (id, at, actor_type, action, tenant_id, prev_hash, hash) VALUES (?1, ?2, 'admin', 'admin.signed_in', 'default', ?3, ?4)")
        .bind(crypto.randomUUID(), new Date().toISOString(), first!.prev_hash, "f".repeat(64))
        .run();
    await expect(fork()).rejects.toThrow(/UNIQUE/);
    // A write that lost a race (its head moved) is not inserted: the store reads the new head and retries.
    await store.audit(event(1));
    expect(await verifyAuditChain(await store.auditChain())).toMatchObject({ ok: true, checked: 2 });
  });

  it("finds a record changed after it was written, and one taken out", async () => {
    const db = sqliteD1();
    const store = createD1ModeratorStore(db);
    for (let i = 0; i < 4; i++) await store.audit(event(i));
    const chain = await store.auditChain();
    await db.prepare("UPDATE audit SET details = ?1 WHERE id = ?2").bind(JSON.stringify({ n: 99 }), chain[1]!.id).run();
    expect(await verifyAuditChain(await store.auditChain())).toMatchObject({ ok: false, brokenAt: chain[1]!.id, reason: expect.stringMatching(/changed/) });
    await db.prepare("UPDATE audit SET details = ?1 WHERE id = ?2").bind(JSON.stringify({ n: 1 }), chain[1]!.id).run();
    await db.prepare("DELETE FROM audit WHERE id = ?1").bind(chain[2]!.id).run();
    expect(await verifyAuditChain(await store.auditChain())).toMatchObject({ ok: false, brokenAt: chain[3]!.id, reason: expect.stringMatching(/missing/) });
  });
});
