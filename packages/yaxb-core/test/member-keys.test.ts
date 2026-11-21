import { describe, expect, it } from "vitest";
import { generateKeyPair } from "../src/seal/index.js";
import { checkPublicKey, createD1MemberKeys, MAX_DEVICE_KEYS } from "../src/stores/keys.js";
import { sqliteD1 } from "./sqlite-d1.js";

const member = (db: ReturnType<typeof sqliteD1>, id: string, tenant: string, roles: string[], status = "active") =>
  db.prepare("INSERT INTO moderators (id, name, label, roles, status, key_hash, key_prefix, created_at, tenant_id) VALUES (?1, ?1, '', ?2, ?3, ?1, ?1, '2026-01-01', ?4)").bind(id, JSON.stringify(roles), status, tenant).run();
const pub = async (id: string) => {
  const k = await generateKeyPair(id);
  return { id: k.id, jwk: k.jwk };
};

describe("the member key directory", () => {
  it("finds the devices of active members with a role, in that business only", async () => {
    const db = sqliteD1();
    await member(db, "nurse-1", "acme", ["nurse"]);
    await member(db, "nurse-2", "acme", ["nurse", "doctor"]);
    await member(db, "gone", "acme", ["nurse"], "revoked");
    await member(db, "other", "bolt", ["nurse"]);
    const acme = createD1MemberKeys(db, { tenant: "acme" });
    const bolt = createD1MemberKeys(db, { tenant: "bolt" });
    await acme.register("nurse-1", await pub("device-n1-a"));
    await acme.register("nurse-1", await pub("device-n1-b"));
    await acme.register("nurse-2", await pub("device-n2-a"));
    await acme.register("gone", await pub("device-gone-"));
    await bolt.register("other", await pub("device-other"));
    expect((await acme.forRoles(["nurse"])).map((k) => k.id).sort()).toEqual(["device-n1-a", "device-n1-b", "device-n2-a"]);
    expect((await acme.forRoles(["doctor"])).map((k) => k.id)).toEqual(["device-n2-a"]);
    expect(await acme.forRoles([])).toEqual([]);
    expect((await bolt.forRoles(["nurse"])).map((k) => k.id)).toEqual(["device-other"]);
    await acme.remove("nurse-1", "device-n1-a");
    expect((await acme.forRoles(["nurse"])).map((k) => k.id).sort()).toEqual(["device-n1-b", "device-n2-a"]);
  });

  it("lists the administrator's devices apart from the members'", async () => {
    const db = sqliteD1();
    const keys = createD1MemberKeys(db, { tenant: "acme" });
    await keys.register("admin", await pub("admin-device"));
    expect((await keys.admins()).map((k) => k.id)).toEqual(["admin-device"]);
    expect(await keys.forRoles(["administrator"])).toEqual([]);
  });

  it("keeps a member's newest devices, and refuses anything that isn't a public key", async () => {
    const db = sqliteD1();
    await member(db, "m", "acme", ["nurse"]);
    const keys = createD1MemberKeys(db, { tenant: "acme" });
    for (let i = 0; i < MAX_DEVICE_KEYS + 2; i++) await keys.register("m", await pub(`device-${String(i).padStart(2, "0")}`), new Date(2026, 0, 1, 0, i));
    const ids = (await keys.forRoles(["nurse"])).map((k) => k.id).sort();
    expect(ids).toHaveLength(MAX_DEVICE_KEYS);
    expect(ids).not.toContain("device-00");
    const good = await pub("device-xx-ok");
    expect(() => checkPublicKey({ ...good, jwk: { ...good.jwk, d: "private" } })).toThrow(/private/);
    expect(() => checkPublicKey({ id: "short", jwk: good.jwk })).toThrow(/id/);
    expect(() => checkPublicKey({ id: "device-bad-1", jwk: { kty: "RSA" } })).toThrow(/P-256/);
    expect(checkPublicKey({ ...good, jwk: { ...good.jwk, extra: 1 } }).jwk).not.toHaveProperty("extra");
  });
});
