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
  policyAllows,
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

// ---- the first release's methods: passkeys, Google, recovery codes ---------------------------------------
import { softAuthenticator } from "./soft-authenticator.js";

const RP = { id: "anjalai.cc", name: "Anjal", origins: ["https://family.anjalai.cc", "https://business.anjalai.cc"] };

for (const [name, make] of [
  ["memory", (): IdentityStore => createMemoryIdentityStore()],
  ["D1", (): IdentityStore => createD1IdentityStore(sqliteD1({ folder: "migrations-platform" }))],
] as const) {
  describe(`sign-in methods on ${name}`, () => {
    const setup = () => createIdentityService(make(), { secret: "test-secret-0123456789", issuer: "https://anjalai.cc", rp: RP });

    it("makes an account with a passkey on one edition and signs in on another (IDN-10, DOM-3)", async () => {
      const id = setup();
      const key = await softAuthenticator("anjalai.cc", "https://family.anjalai.cc");
      const reg = await id.passkeyRegisterStart({ name: "Asha" });
      const response = await key.register(reg.options);
      expect(await id.passkeyRegisterFinish({ challenge: reg.challenge, response })).toMatchObject({ consent_required: true });
      // The challenge survives asking for consent, and is used once.
      const made = await id.passkeyRegisterFinish({ challenge: reg.challenge, response, consent: true, name: "Asha" });
      if (!("session" in made)) throw new Error();
      expect(await id.verify(made.session.access)).toMatchObject({ lvl: 3, amr: ["passkey"] });
      await fails(id.passkeyRegisterFinish({ challenge: reg.challenge, response, consent: true }), 410);

      // Business's site, the same passkey (one relying party for every edition).
      const keyOnBusiness = { ...key };
      const start = await id.passkeySignInStart();
      const auth = await keyOnBusiness.authenticate(start.options);
      const signed = await id.passkeySignInFinish({ challenge: start.challenge, response: auth, device: "second phone" });
      expect(signed.account.id).toBe(made.account.id);
      // A replayed response fails: its challenge is used up.
      await fails(id.passkeySignInFinish({ challenge: start.challenge, response: auth }), 410);
    });

    it("refuses an unknown passkey and one from another site", async () => {
      const id = setup();
      const stranger = await softAuthenticator("anjalai.cc", "https://family.anjalai.cc");
      const start = await id.passkeySignInStart();
      await fails(id.passkeySignInFinish({ challenge: start.challenge, response: await stranger.authenticate(start.options) }), 401);
      const phishing = await softAuthenticator("anjalai.cc", "https://anjalai-login.example");
      const reg = await id.passkeyRegisterStart({});
      await fails(id.passkeyRegisterFinish({ challenge: reg.challenge, response: await phishing.register(reg.options), consent: true }), 401);
    });

    it("signs in with Google's verified email, keeping only a hash and a masked address (IDN-14)", async () => {
      const id = setup();
      const google = { provider: "google" as const, subject: "1093847561", email: "asha.r@gmail.com", emailVerified: true };
      expect(await id.oidcSignIn(google)).toMatchObject({ consent_required: true });
      const made = await id.oidcSignIn({ ...google, consent: true, name: "Asha" });
      if (!("session" in made)) throw new Error();
      expect(await id.verify(made.session.access)).toMatchObject({ lvl: 2, amr: ["oidc"] });
      const again = await id.oidcSignIn(google);
      expect("session" in again && again.account.id).toBe(made.account.id);
      const me = await id.me(made.account.id);
      expect(me.methods).toEqual([expect.objectContaining({ kind: "oidc", display: "Google · a•••••@gmail.com" })]);
      expect(JSON.stringify(await id.store.methods(made.account.id))).not.toContain("1093847561");
      await fails(id.oidcSignIn({ ...google, subject: "other", emailVerified: false, consent: true }), 403);
    });

    it("adds a passkey to a Google account, and keeps at least one way in (IDN-40)", async () => {
      const id = setup();
      const made = await id.oidcSignIn({ provider: "google", subject: "s1", email: "a@b.in", emailVerified: true, consent: true });
      if (!("session" in made)) throw new Error();
      const key = await softAuthenticator("anjalai.cc", "https://business.anjalai.cc");
      const reg = await id.passkeyRegisterStart({ account: made.account.id });
      expect(await id.passkeyRegisterFinish({ challenge: reg.challenge, response: await key.register(reg.options), account: made.account.id })).toEqual({ added: true });
      const methods = (await id.me(made.account.id)).methods;
      expect(methods.map((m) => m.kind).sort()).toEqual(["oidc", "passkey"]);
      await id.removeMethod(made.account.id, methods.find((m) => m.kind === "oidc")!.id);
      await fails(id.removeMethod(made.account.id, methods.find((m) => m.kind === "passkey")!.id), 409);
    });

    it("gives ten recovery codes, each signing in once at level 1 (IDN-21)", async () => {
      const id = setup();
      const made = await id.oidcSignIn({ provider: "google", subject: "s2", email: "a@b.in", emailVerified: true, consent: true });
      if (!("session" in made)) throw new Error();
      const codes = await id.newRecoveryCodes(made.account.id);
      expect(codes).toHaveLength(10);
      expect(codes[0]).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
      const r = await id.recoverySignIn({ code: codes[3]!.toLowerCase(), client: "c" });
      expect(r.account.id).toBe(made.account.id);
      expect(await id.verify(r.session.access)).toMatchObject({ lvl: 1, amr: ["recovery"] });
      await fails(id.recoverySignIn({ code: codes[3]!, client: "c" }), 401);
      // New codes replace the old ones.
      await id.newRecoveryCodes(made.account.id);
      await fails(id.recoverySignIn({ code: codes[4]!, client: "c" }), 401);
      expect((await id.auditLog(made.account.id)).map((e) => e.action)).toContain("recovery.used");
    });

    it("refuses passkeys without a relying party (DOM-5), and phone codes without a provider (IDN-11)", async () => {
      const id = createIdentityService(make(), { secret: "s".repeat(24), issuer: "https://anjalai.cc" });
      await fails(id.passkeySignInStart(), 501);
      await fails(id.startPhone({ phone: PHONE, client: "c" }), 501);
    });
  });
}

describe("starting and joining spaces (SPC-8)", () => {
  for (const [name, make] of [
    ["memory", (): IdentityStore => createMemoryIdentityStore()],
    ["D1", (): IdentityStore => createD1IdentityStore(sqliteD1({ folder: "migrations-platform" }))],
  ] as const)
    it(`limits starts and keeps waiting joins sealed on ${name}`, async () => {
      const store = make();
      const id = createIdentityService(store, { secret: "test-secret-0123456789", issuer: "https://anjalai.cc" });
      const r = await id.oidcSignIn({ provider: "google", subject: "s", email: "a@b.in", emailVerified: true, consent: true });
      if (!("session" in r)) throw new Error();
      for (let i = 0; i < 5; i++) expect(await id.mayStartSpace(r.account.id)).toBe(true);
      expect(await id.mayStartSpace(r.account.id)).toBe(false);
      await id.addPendingJoin(r.account.id, { edition: "business", tenant_id: "t1", space_name: "Shop", kind: "business", request_id: "req-1", claim: "yaxb_claim_secret" });
      expect(JSON.stringify(await store.pendingJoins(r.account.id))).not.toContain("yaxb_claim_secret");
      const waiting = await id.pendingJoins(r.account.id, "business");
      expect(waiting).toEqual([expect.objectContaining({ request_id: "req-1", claim: "yaxb_claim_secret", space_name: "Shop" })]);
      expect(await id.pendingJoins(r.account.id, "family")).toEqual([]);
      await id.removePendingJoin(waiting[0]!.id);
      expect(await id.pendingJoins(r.account.id, "business")).toEqual([]);
    });
});

describe("devices kept for one space (SPC-5)", () => {
  for (const [name, make] of [
    ["memory", (): IdentityStore => createMemoryIdentityStore()],
    ["D1", (): IdentityStore => createD1IdentityStore(sqliteD1({ folder: "migrations-platform" }))],
  ] as const)
    it(`locks, checks and releases a device on ${name}`, async () => {
      const store = make();
      const id = createIdentityService(store, { secret: "test-secret-0123456789", issuer: "https://anjalai.cc" });
      const { lock, token } = await id.lockDevice({ edition: "business", tenant_id: "t1", space_name: "Sri Ram Hardware", label: "Counter", by: null });
      expect(lock).toMatchObject({ edition: "business", tenant_id: "t1", label: "Counter", unlocked_at: null });
      expect(lock).not.toHaveProperty("secret_hash");
      // Only the secret's keyed hash is kept.
      const secret = token.split(".")[1]!;
      expect(JSON.stringify(await store.deviceLock(lock.id))).not.toContain(secret);
      expect(await id.deviceLockOf(token)).toMatchObject({ id: lock.id, space_name: "Sri Ram Hardware" });
      // A forged or malformed token holds nothing.
      expect(await id.deviceLockOf(`${lock.id}.${"A".repeat(43)}`)).toBeNull();
      expect(await id.deviceLockOf("nonsense")).toBeNull();
      expect(await id.deviceLockOf(null)).toBeNull();
      expect((await id.deviceLocks("business", "t1")).map((l) => l.id)).toEqual([lock.id]);
      expect(await id.deviceLocks("family", "t1")).toEqual([]);
      // Released only by its own space.
      await expect(id.unlockDevice(lock.id, { edition: "family", tenant_id: "t1" }, null)).rejects.toThrow(/isn't kept for this space/);
      expect((await id.unlockDevice(lock.id, { edition: "business", tenant_id: "t1" }, null)).unlocked_at).toBeTruthy();
      expect(await id.deviceLockOf(token)).toBeNull();
      expect(await id.deviceLocks("business", "t1")).toEqual([]);
    });
});

describe("a space's sign-in rules (IDN-34)", () => {
  for (const [name, make] of [
    ["memory", (): IdentityStore => createMemoryIdentityStore()],
    ["D1", (): IdentityStore => createD1IdentityStore(sqliteD1({ folder: "migrations-platform" }))],
  ] as const)
    it(`keeps a space's rules and checks a sign-in against them on ${name}`, async () => {
      const id = createIdentityService(make(), { secret: "test-secret-0123456789", issuer: "https://anjalai.cc" });
      expect(await id.spacePolicy("business", "t1")).toMatchObject({ methods: ["passkey", "oidc", "recovery"], staff_passkeys: false, session_hours: 720, updated_at: null });
      await expect(id.setSpacePolicy("business", "t1", { methods: [], staff_passkeys: false, session_hours: 24 }, null)).rejects.toThrow(/at least one/);
      await expect(id.setSpacePolicy("business", "t1", { methods: ["oidc"], staff_passkeys: true, session_hours: 24 }, null)).rejects.toThrow(/unless passkeys/);
      await expect(id.setSpacePolicy("business", "t1", { methods: ["passkey"], staff_passkeys: false, session_hours: 5 }, null)).rejects.toThrow(/how long/);
      const p = await id.setSpacePolicy("business", "t1", { methods: ["passkey", "oidc", "nonsense"], staff_passkeys: true, session_hours: 8 }, null);
      expect(p).toMatchObject({ methods: ["passkey", "oidc"], staff_passkeys: true, session_hours: 8 });
      expect(await id.spacePolicy("business", "t1")).toMatchObject({ methods: ["passkey", "oidc"], staff_passkeys: true, session_hours: 8 });
      expect((await id.spacePolicy("family", "t1")).staff_passkeys).toBe(false);

      const now = 1_800_000_000;
      const staff = { roles: ["moderator"] };
      const visitor = { roles: [] };
      const google = { amr: ["oidc"], lvl: 2, iat: now, auth_time: now - 60 };
      const passkey = { amr: ["passkey"], lvl: 3, iat: now, auth_time: now - 60 };
      expect(policyAllows(p, google, visitor, now)).toEqual({ ok: true });
      expect(policyAllows(p, google, staff, now)).toMatchObject({ ok: false, why: "passkey" });
      expect(policyAllows(p, passkey, staff, now)).toEqual({ ok: true });
      expect(policyAllows(p, { amr: ["recovery"], lvl: 1, iat: now }, visitor, now)).toMatchObject({ ok: false, why: "method", message: expect.stringContaining("a passkey or Google") });
      expect(policyAllows(p, { ...passkey, auth_time: now - 9 * 3600 }, staff, now)).toMatchObject({ ok: false, why: "expired" });
    });
});

describe("devices signed in with a code (IDN-17, 18, 41)", () => {
  for (const [name, make] of [
    ["memory", (): IdentityStore => createMemoryIdentityStore()],
    ["D1", (): IdentityStore => createD1IdentityStore(sqliteD1({ folder: "migrations-platform" }))],
  ] as const)
    it(`a device asks, a person approves, and each device is revoked on its own, on ${name}`, async () => {
      const store = make();
      const id = createIdentityService(store, { secret: "test-secret-0123456789", issuer: "https://anjalai.cc" });
      const r = await id.oidcSignIn({ provider: "google", subject: "s", email: "a@b.in", emailVerified: true, consent: true });
      if (!("session" in r)) throw new Error();
      const me = r.account.id;
      await expect(id.deviceStart({ client: "toaster" })).rejects.toThrow(/Unknown kind/);
      const laptop = await id.deviceStart({ client: "cli", name: "Meena's laptop" });
      expect(laptop.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(await id.devicePoll(laptop.device_code)).toEqual({ status: "pending" });
      expect(await id.deviceRequest(laptop.user_code.toLowerCase().replace("-", " "))).toMatchObject({ client: "cli", name: "Meena's laptop", scopes: ["chat"] });
      await expect(id.deviceApprove(me, 1, laptop.user_code, true)).rejects.toThrow(/passkey or Google/);
      await id.deviceApprove(me, 2, laptop.user_code, true);
      const got = await id.devicePoll(laptop.device_code);
      if (got.status !== "approved") throw new Error(got.status);
      expect(got.token).toMatch(/^anj_dev_/);
      // Used once: polling again gets nothing.
      expect(await id.devicePoll(laptop.device_code)).toEqual({ status: "expired" });
      expect((await id.deviceCredentialOf(got.token))?.account_id).toBe(me);
      expect(await id.deviceCredentialOf(`${got.token.split(".")[0]}.${"A".repeat(43)}`)).toBeNull();
      expect(JSON.stringify(await store.deviceCredential(got.credential.id))).not.toContain(got.token.split(".")[1]!);

      // A phone, signed in the same way; a third device turned down.
      const phone = await id.deviceStart({ client: "voice", name: "Phone" });
      await id.deviceApprove(me, 3, phone.user_code, true);
      const p = await id.devicePoll(phone.device_code);
      if (p.status !== "approved") throw new Error(p.status);
      const other = await id.deviceStart({ client: "cli" });
      await id.deviceApprove(me, 3, other.user_code, false);
      expect(await id.devicePoll(other.device_code)).toEqual({ status: "denied" });
      expect((await id.deviceCredentials(me)).map((d) => d.name).sort()).toEqual(["Meena's laptop", "Phone"]);

      // The phone is lost: only it stops working (the gate).
      await id.revokeDeviceCredential(me, p.credential.id);
      expect(await id.deviceCredentialOf(p.token)).toBeNull();
      expect((await id.deviceCredentialOf(got.token))?.id).toBe(got.credential.id);
      expect((await id.deviceCredentials(me)).map((d) => d.name)).toEqual(["Meena's laptop"]);
      await expect(id.revokeDeviceCredential("someone-else", got.credential.id)).rejects.toThrow(/isn't yours/);
      // Deleting the account ends every device.
      await id.deleteAccount(me);
      expect(await id.deviceCredentialOf(got.token)).toBeNull();
    });
});

describe("signing in on a kiosk by scanning (IDN-19)", () => {
  for (const [name, make] of [
    ["memory", (): IdentityStore => createMemoryIdentityStore()],
    ["D1", (): IdentityStore => createD1IdentityStore(sqliteD1({ folder: "migrations-platform" }))],
  ] as const)
    it(`the phone approves, the kiosk gets a short session at the phone's level, on ${name}`, async () => {
      let clock = new Date("2026-11-19T10:00:00Z");
      const id = createIdentityService(make(), { secret: "test-secret-0123456789", issuer: "https://anjalai.cc", now: () => clock });
      const r = await id.oidcSignIn({ provider: "google", subject: "s", email: "a@b.in", emailVerified: true, consent: true });
      if (!("session" in r)) throw new Error();
      const kiosk = await id.deviceStart({ client: "handoff", name: "Front desk" });
      expect(await id.handoffPoll(kiosk.device_code, "kiosk")).toEqual({ status: "pending" });
      // A credential is never minted for a scan.
      expect(await id.devicePoll(kiosk.device_code)).toEqual({ status: "expired" });
      await id.deviceApprove(r.account.id, 2, kiosk.user_code, true);
      const got = await id.handoffPoll(kiosk.device_code, "kiosk");
      if (got.status !== "approved") throw new Error(got.status);
      const claims = await id.verify(got.session.access);
      expect(claims).toMatchObject({ sub: r.account.id, lvl: 2, amr: ["handoff"] });
      expect(new Date(got.session.expires_at).getTime() - clock.getTime()).toBe(30 * 60_000);
      // Used once.
      expect(await id.handoffPoll(kiosk.device_code, "kiosk")).toEqual({ status: "expired" });
      // Renewing doesn't lengthen it, and after its end it is gone.
      clock = new Date(clock.getTime() + 20 * 60_000);
      const renewed = await id.refresh(got.session.refresh);
      expect(renewed.session.expires_at).toBe(got.session.expires_at);
      clock = new Date(clock.getTime() + 11 * 60_000);
      await expect(id.refresh(renewed.session.refresh)).rejects.toThrow(/Sign in again/);
    });
});

describe("the native app signs in through the system browser (IDN-43)", () => {
  it("gets its own refreshable session at the level the person signed in at", async () => {
    const id = createIdentityService(createMemoryIdentityStore(), { secret: "test-secret-0123456789", issuer: "https://anjalai.cc" });
    const r = await id.oidcSignIn({ provider: "google", subject: "s", email: "a@b.in", emailVerified: true, consent: true });
    if (!("session" in r)) throw new Error();
    const app = await id.deviceStart({ client: "app", name: "Anjal on a phone" });
    expect(await id.appPoll(app.device_code, "phone")).toEqual({ status: "pending" });
    // Neither a credential nor a scan's session comes from an app's grant.
    expect(await id.devicePoll(app.device_code)).toEqual({ status: "expired" });
    expect(await id.handoffPoll(app.device_code, "phone")).toEqual({ status: "expired" });
    await id.deviceApprove(r.account.id, 3, app.user_code, true);
    const got = await id.appPoll(app.device_code, "phone");
    if (got.status !== "approved") throw new Error(got.status);
    expect(await id.verify(got.session.access)).toMatchObject({ sub: r.account.id, lvl: 3, amr: ["app"] });
    // Refreshing keeps it going, like any session (30 days from now).
    const next = await id.refresh(got.session.refresh);
    expect(new Date(next.session.expires_at).getTime() - Date.now()).toBeGreaterThan(29 * 86400_000);
    expect(await id.appPoll(app.device_code, "phone")).toEqual({ status: "expired" });
  });
});

describe("a space's rules and sessions approved from another sign-in", () => {
  it("judges the app's, a scan's and a device's sessions by their level", () => {
    const now = 1_800_000_000;
    const any = { methods: ["passkey", "oidc", "recovery"] as ("passkey" | "oidc" | "recovery")[], staff_passkeys: false, session_hours: 720 };
    const passkeyOnly = { ...any, methods: ["passkey"] as ("passkey" | "oidc" | "recovery")[] };
    const app2 = { amr: ["app"], lvl: 2, iat: now, auth_time: now };
    expect(policyAllows(any, app2, { roles: [] }, now)).toEqual({ ok: true });
    expect(policyAllows(passkeyOnly, app2, { roles: [] }, now)).toMatchObject({ ok: false, why: "method" });
    expect(policyAllows(passkeyOnly, { ...app2, amr: ["handoff"], lvl: 3 }, { roles: [] }, now)).toEqual({ ok: true });
    expect(policyAllows(passkeyOnly, { ...app2, amr: ["device"], lvl: 2 }, { roles: [] }, now)).toMatchObject({ ok: false });
  });
});
