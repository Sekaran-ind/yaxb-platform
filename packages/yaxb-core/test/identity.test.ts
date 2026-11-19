// Identity and spaces (IDN-1..6, 11, 50..53; SPC-1, 3, 4, 7, 10) on the memory store and on the
// platform database (node:sqlite with migrations-platform applied).
import { describe, expect, it } from "vitest";
import {
  ACCESS_SECONDS,
  createIdentityService,
  createMemoryIdentityStore,
  createMemorySender,
  IdentityError,
  maskPhone,
  normalizePhone,
  OTP_ATTEMPTS,
  OTP_SENDS_PER_HOUR,
  verifyJwt,
  type IdentityStore,
  type SignedIn,
} from "../src/identity/index.js";
import { createD1IdentityStore } from "../src/identity/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

const PHONE = "98765 43210";
const E164 = "+919876543210";

describe("phone numbers", () => {
  it("normalises Indian and international numbers, and masks them", () => {
    expect(normalizePhone(PHONE)).toBe(E164);
    expect(normalizePhone("09876543210")).toBe(E164);
    expect(normalizePhone("+91 98765-43210")).toBe(E164);
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("+91 1234567890")).toBeNull();
    expect(maskPhone(E164)).toBe("+91 •••••• 3210");
  });
});

const fails = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(IdentityError);
  expect((e as IdentityError).status).toBe(status);
};

for (const [name, make] of [
  ["memory", (): IdentityStore => createMemoryIdentityStore()],
  ["D1", (): IdentityStore => createD1IdentityStore(sqliteD1({ folder: "migrations-platform" }))],
] as const) {
  describe(`identity on ${name}`, () => {
    let clock = new Date("2026-11-19T10:00:00Z");
    const setup = () => {
      clock = new Date("2026-11-19T10:00:00Z");
      const sender = createMemorySender();
      const store = make();
      const id = createIdentityService(store, { sender, secret: "test-secret-0123456789", issuer: "https://anjalai.cc", now: () => clock });
      return { id, sender, store };
    };
    const signIn = async (s: ReturnType<typeof setup>, phone = PHONE, device = "web"): Promise<SignedIn> => {
      const c = await s.id.startPhone({ phone, client: "1.2.3.4" });
      const r = await s.id.verifyPhone({ challenge: c.challenge, phone, code: s.sender.codeFor(normalizePhone(phone)!)!, consent: true, device });
      if (!("session" in r)) throw new Error("not signed in");
      return r;
    };

    it("signs up after the consent notice, then signs in to the same account (IDN-1, IDN-11, IDN-52)", async () => {
      const s = setup();
      const c = await s.id.startPhone({ phone: PHONE, client: "1.2.3.4" });
      expect(c.to).toBe("+91 •••••• 3210");
      const code = s.sender.codeFor(E164)!;
      expect(code).toMatch(/^\d{6}$/);
      const first = await s.id.verifyPhone({ challenge: c.challenge, phone: PHONE, code });
      expect(first).toEqual({ consent_required: true, notice: expect.stringContaining("delete your account") });
      const made = await s.id.verifyPhone({ challenge: c.challenge, phone: PHONE, code, consent: true, name: "Asha" });
      if (!("session" in made)) throw new Error();
      expect(made.account.display_name).toBe("Asha");
      // The code is used up.
      await fails(s.id.verifyPhone({ challenge: c.challenge, phone: PHONE, code, consent: true }), 410);
      const again = await signIn(s);
      expect(again.account.id).toBe(made.account.id);
      const me = await s.id.me(made.account.id);
      expect(me.methods).toEqual([expect.objectContaining({ kind: "phone", display: "+91 •••••• 3210" })]);
      // Nothing stored holds the number itself.
      expect(JSON.stringify(await s.store.methods(made.account.id))).not.toContain("9876543210");
    });

    it("caps wrong codes and sends (IDN-51)", async () => {
      const s = setup();
      const c = await s.id.startPhone({ phone: PHONE, client: "1.2.3.4" });
      for (let i = 0; i < OTP_ATTEMPTS; i++) await fails(s.id.verifyPhone({ challenge: c.challenge, phone: PHONE, code: "000000" }), 401);
      // Ended, even with the right code.
      await fails(s.id.verifyPhone({ challenge: c.challenge, phone: PHONE, code: s.sender.codeFor(E164)!, consent: true }), 410);
      for (let i = 1; i < OTP_SENDS_PER_HOUR; i++) await s.id.startPhone({ phone: PHONE, client: "1.2.3.4" });
      await fails(s.id.startPhone({ phone: PHONE, client: "1.2.3.4" }), 429);
      // Another hour: allowed again.
      clock = new Date("2026-11-19T11:05:00Z");
      await s.id.startPhone({ phone: PHONE, client: "1.2.3.4" });
    });

    it("issues ES256 tokens every Worker can verify from the JWKS, and rotates refresh tokens (IDN-50)", async () => {
      const s = setup();
      const r = await signIn(s);
      const claims = await s.id.verify(r.session.access);
      expect(claims).toMatchObject({ sub: r.account.id, sid: r.session.id, lvl: 2, amr: ["phone"] });
      // Another Worker, with only the public keys.
      const { keys } = await s.id.jwks();
      expect(keys[0]).not.toHaveProperty("d");
      expect(await verifyJwt(r.session.access, keys, { issuer: "https://anjalai.cc", now: Math.floor(clock.getTime() / 1000) })).not.toBeNull();
      expect(await verifyJwt(r.session.access, keys, { issuer: "https://evil.example", now: Math.floor(clock.getTime() / 1000) })).toBeNull();
      // Short-lived.
      clock = new Date(clock.getTime() + (ACCESS_SECONDS + 1) * 1000);
      expect(await s.id.verify(r.session.access)).toBeNull();

      const next = await s.id.refresh(r.session.refresh);
      expect(next.session.refresh).not.toBe(r.session.refresh);
      expect(await s.id.verify(next.session.access)).not.toBeNull();
      // The old refresh token presented again: someone has a copy, so the session ends.
      await fails(s.id.refresh(r.session.refresh), 401);
      await fails(s.id.refresh(next.session.refresh), 401);
    });

    it("signs out one session or every other one (IDN-40)", async () => {
      const s = setup();
      const web = await signIn(s, PHONE, "web");
      const phone = await signIn(s, PHONE, "second phone");
      expect((await s.id.sessions(web.account.id)).map((x) => x.device).sort()).toEqual(["second phone", "web"]);
      expect(await s.id.signOut(web.account.id, { allBut: web.session.id })).toBe(1);
      await fails(s.id.refresh(phone.session.refresh), 401);
      await s.id.refresh(web.session.refresh);
    });

    it("holds spaces, and answers only for the right edition and tenant (SPC-1, SPC-3, SPC-7)", async () => {
      const s = setup();
      const r = await signIn(s);
      await s.id.addMembership(r.account.id, { edition: "family", tenant_id: "home-1", space_name: "Our home", kind: "family", roles: ["guardian"] }, { created: true });
      await s.id.addMembership(r.account.id, { edition: "business", tenant_id: "shop-7", space_name: "Sri Ram Hardware", kind: "business", roles: ["counter-head"], member_id: "m-42" });
      await fails(s.id.addMembership(r.account.id, { edition: "business", tenant_id: "x", space_name: "X", kind: "family", roles: [] }), 422);

      // Signing in again on another device brings both spaces: no second sign-in to switch.
      const second = await signIn(s, PHONE, "second phone");
      expect(second.memberships.map((m) => m.space_name)).toEqual(["Our home", "Sri Ram Hardware"]);
      expect((await s.id.spacesFor(r.account.id, "family")).map((m) => m.tenant_id)).toEqual(["home-1"]);
      expect(await s.id.spacesFor(r.account.id, "all")).toHaveLength(2);

      // The server's check: the right edition and tenant, nothing else.
      expect(await s.id.spaceOf(r.account.id, "business", "shop-7")).toMatchObject({ roles: ["counter-head"], member_id: "m-42" });
      expect(await s.id.spaceOf(r.account.id, "family", "shop-7")).toBeNull();
      expect(await s.id.spaceOf(r.account.id, "business", "home-1")).toBeNull();
      // Someone else has no way in.
      const other = await signIn(s, "+91 91234 56789");
      expect(await s.id.spaceOf(other.account.id, "business", "shop-7")).toBeNull();

      expect(await s.id.removeMembership(r.account.id, "family", "home-1")).toBe(true);
      expect((await s.id.auditLog(r.account.id)).map((e) => e.action)).toEqual(expect.arrayContaining(["space.created", "membership.added", "membership.removed", "signed_in", "account.created"]));
    });

    it("deletes an account: methods, sessions and spaces go (IDN-52)", async () => {
      const s = setup();
      const r = await signIn(s);
      await s.id.addMembership(r.account.id, { edition: "family", tenant_id: "home-1", space_name: "Our home", kind: "family", roles: [] });
      await s.id.deleteAccount(r.account.id);
      await fails(s.id.me(r.account.id), 404);
      await fails(s.id.refresh(r.session.refresh), 401);
      expect(await s.store.memberships(r.account.id)).toEqual([]);
      // The same number makes a new account afterwards.
      const fresh = await signIn(s);
      expect(fresh.account.id).not.toBe(r.account.id);
    });

    it("keeps the audit to facts (IDN-53)", async () => {
      const s = setup();
      const r = await signIn(s);
      const details = JSON.stringify((await s.id.auditLog(r.account.id)).map((e) => e.details));
      expect(details).not.toMatch(/9876|3210/);
      expect(details).not.toContain(s.sender.codeFor(E164)!);
    });
  });
}
