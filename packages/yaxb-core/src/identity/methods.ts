// The first release's sign-in methods (docs/specs/15-identity.md step 1): passkeys (IDN-10, the
// default and the strongest), Google (IDN-14, a verified email) and recovery codes (IDN-21, the way
// back in). Phone codes wait for a provider (IDN-11).
//
// Passkeys use SimpleWebAuthn for the protocol (IDN-54). The relying party is the site's registrable
// domain (`anjalai.cc`, DOM-3), so a passkey made on one edition works on all of them. Challenges are
// kept as keyed hashes in otp_challenges (channel "passkey") and used once.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { b64url, fromB64url, keyedHash, randomToken, sameText } from "./crypto.js";
import { IdentityError, type Account, type Challenge, type IdentityAction, type IdentityAuditEvent, type IdentityStore, type Method, type MethodKind, type SignedIn } from "./index.js";

export const PASSKEY_MINUTES = 5;
export const RECOVERY_CODES = 10;
/** Recovery-code attempts per client per hour (IDN-51). */
export const RECOVERY_TRIES_PER_HOUR = 10;
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Where passkeys belong: `id` the registrable domain (DOM-3), and the page origins allowed to use it. */
export type RelyingParty = { id: string; name: string; origins: readonly string[] };

export type MethodsContext = {
  store: IdentityStore;
  secret: string;
  rp: RelyingParty | null;
  now: () => Date;
  audit: (account: string | null, action: IdentityAction, details?: IdentityAuditEvent["details"]) => Promise<void>;
  newSession: (account: Account, method: MethodKind, level: number, device: string | null) => Promise<SignedIn>;
  liveAccount: (id: string) => Promise<Account>;
};

const iso = (d: Date) => d.toISOString();
type ConsentNeeded = { consent_required: true; notice: string };

/** Mask an email address for the screen: "a•••@gmail.com". */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}${"•".repeat(Math.min(5, Math.max(1, user.length - 1)))}@${domain}`;
}

export function methodsApi(ctx: MethodsContext, notice: string) {
  const { store } = ctx;
  const h = (purpose: string, value: string) => keyedHash(ctx.secret, purpose, value);
  const rp = () => {
    if (!ctx.rp) throw new IdentityError("Passkeys aren't available on this address. Use the site's own address.", 501);
    return ctx.rp;
  };

  /** Keep a passkey challenge: its id goes to the browser, the challenge itself only as a hash. */
  async function keepChallenge(subject: string, challenge: string): Promise<string> {
    const c: Challenge = {
      id: crypto.randomUUID(),
      channel: "passkey",
      subject_hash: subject,
      code_hash: await h("passkey-challenge", challenge),
      attempts: 0,
      created_at: iso(ctx.now()),
      expires_at: iso(new Date(ctx.now().getTime() + PASSKEY_MINUTES * 60_000)),
      consumed_at: null,
    };
    await store.putChallenge(c);
    return c.id;
  }
  /** Use a challenge once: its subject, and a checker for the response's challenge. */
  async function takeChallenge(id: string) {
    const c = await store.challenge(id);
    if (!c || c.channel !== "passkey" || c.consumed_at || c.expires_at <= iso(ctx.now())) throw new IdentityError("That took too long. Try again.", 410);
    await store.putChallenge({ ...c, consumed_at: iso(ctx.now()) });
    const expected = async (challenge: string) => sameText(await h("passkey-challenge", challenge), c.code_hash);
    return { subject: c.subject_hash, expected };
  }

  async function addMethod(account: Account, kind: MethodKind, subject_hash: string, display: string, extra: Partial<Method> = {}) {
    const t = iso(ctx.now());
    const m: Method = { id: crypto.randomUUID(), account_id: account.id, kind, subject_hash, display, public_key: null, counter: null, verified_at: t, created_at: t, last_used_at: t, ...extra };
    await store.putMethod(m);
    await ctx.audit(account.id, "method.linked", { kind });
    return m;
  }
  async function newAccount(name: string | undefined, id: string = crypto.randomUUID(), via: MethodKind): Promise<Account> {
    const t = iso(ctx.now());
    const a: Account = { id, display_name: name?.trim().slice(0, 40) || null, created_at: t, updated_at: t, deleted_at: null };
    await store.putAccount(a);
    await ctx.audit(a.id, "account.created", { method: via });
    return a;
  }

  return {
    // ---- passkeys (IDN-10) ---------------------------------------------------------------------------

    /**
     * Options to make a passkey: for a new account (`account` absent) or to add one to the signed-in
     * account. The new account's id is chosen now and becomes the passkey's user handle.
     */
    async passkeyRegisterStart(input: { account?: string; name?: string }) {
      const party = rp();
      const existing = input.account ? await ctx.liveAccount(input.account) : null;
      const accountId = existing?.id ?? crypto.randomUUID();
      const mine = existing ? (await store.methods(existing.id)).filter((m) => m.kind === "passkey" && m.public_key) : [];
      const options = await generateRegistrationOptions({
        rpName: party.name,
        rpID: party.id,
        userID: new TextEncoder().encode(accountId),
        userName: existing?.display_name ?? input.name?.trim() ?? "Anjal",
        userDisplayName: existing?.display_name ?? input.name?.trim() ?? "",
        attestationType: "none",
        excludeCredentials: mine.map((m) => ({ id: (JSON.parse(m.public_key!) as { id: string }).id })),
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      });
      const challenge = await keepChallenge(`${existing ? "add" : "new"}:${accountId}`, options.challenge);
      return { challenge, options };
    },

    /** Check the new passkey; a new account needs the consent notice accepted (IDN-52). */
    async passkeyRegisterFinish(input: { challenge: string; response: RegistrationResponseJSON; account?: string; consent?: boolean; name?: string; device?: string; label?: string }): Promise<SignedIn | ConsentNeeded | { added: true }> {
      const party = rp();
      const c = await store.challenge(input.challenge);
      const isNew = Boolean(c?.subject_hash.startsWith("new:"));
      if (isNew && !input.consent) return { consent_required: true, notice };
      const { subject, expected } = await takeChallenge(input.challenge);
      const [mode, accountId] = subject.split(":") as ["new" | "add", string];
      if (mode === "add" && accountId !== input.account) throw new IdentityError("Sign in first.", 401);
      const r = await verifyRegistrationResponse({ response: input.response, expectedChallenge: expected, expectedOrigin: [...party.origins], expectedRPID: party.id, requireUserVerification: false }).catch(() => null);
      if (!r?.verified) throw new IdentityError("That passkey couldn't be checked. Try again.", 401);
      const cred = r.registrationInfo.credential;
      const account = mode === "add" ? await ctx.liveAccount(accountId) : await newAccount(input.name, accountId, "passkey");
      const label = input.label?.trim().slice(0, 40) || (r.registrationInfo.credentialBackedUp ? "Synced passkey" : "Passkey on this device");
      await addMethod(account, "passkey", await h("passkey", cred.id), label, {
        public_key: JSON.stringify({ id: cred.id, key: b64url(cred.publicKey), transports: cred.transports ?? [] }),
        counter: cred.counter,
      });
      if (mode === "add") return { added: true };
      return ctx.newSession(account, "passkey", 3, input.device ?? null);
    },

    /** Options to sign in with a passkey: any passkey for this site (the browser offers the person's). */
    async passkeySignInStart() {
      const party = rp();
      const options = await generateAuthenticationOptions({ rpID: party.id, userVerification: "preferred" });
      return { challenge: await keepChallenge("signin", options.challenge), options };
    },

    async passkeySignInFinish(input: { challenge: string; response: AuthenticationResponseJSON; device?: string }): Promise<SignedIn> {
      const party = rp();
      const { subject, expected } = await takeChallenge(input.challenge);
      if (subject !== "signin") throw new IdentityError("That took too long. Try again.", 410);
      const method = await store.methodBySubject("passkey", await h("passkey", input.response.id));
      const fail = async () => {
        await ctx.audit(null, "sign_in.failed", { method: "passkey" });
        return new IdentityError("That passkey isn't known here. Make an account first, or use another way to sign in.", 401);
      };
      if (!method?.public_key) throw await fail();
      const saved = JSON.parse(method.public_key) as { id: string; key: string; transports: string[] };
      const r = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: expected,
        expectedOrigin: [...party.origins],
        expectedRPID: party.id,
        credential: { id: saved.id, publicKey: fromB64url(saved.key) as Uint8Array<ArrayBuffer>, counter: method.counter ?? 0, transports: saved.transports as never },
        requireUserVerification: false,
      }).catch(() => null);
      if (!r?.verified) throw await fail();
      const account = await ctx.liveAccount(method.account_id);
      await store.putMethod({ ...method, counter: r.authenticationInfo.newCounter, last_used_at: iso(ctx.now()) });
      return ctx.newSession(account, "passkey", 3, input.device ?? null);
    },

    // ---- Google and other OIDC providers (IDN-14) -------------------------------------------------------

    /**
     * Sign in with a provider's verified identity. Only the provider's subject id is kept (as a keyed
     * hash) and the email masked for the screen; an unverified email is refused (IDN-14, IDN-52).
     */
    async oidcSignIn(input: { provider: "google"; subject: string; email: string | null; emailVerified: boolean; consent?: boolean; name?: string; device?: string; account?: string }): Promise<SignedIn | ConsentNeeded | { added: true }> {
      if (!input.emailVerified || !input.email) throw new IdentityError("That account's email isn't verified. Verify it with the provider first.", 403);
      const subject = await h("oidc", `${input.provider}:${input.subject}`);
      const display = `Google · ${maskEmail(input.email)}`;
      const method = await store.methodBySubject("oidc", subject);
      if (input.account) {
        // Adding Google to the signed-in account.
        const account = await ctx.liveAccount(input.account);
        if (method && method.account_id !== account.id) throw new IdentityError("That Google account is linked to another Anjal account.", 409);
        if (!method) await addMethod(account, "oidc", subject, display);
        return { added: true };
      }
      if (method) {
        const account = await ctx.liveAccount(method.account_id);
        await store.putMethod({ ...method, display, last_used_at: iso(ctx.now()) });
        return ctx.newSession(account, "oidc", 2, input.device ?? null);
      }
      if (!input.consent) return { consent_required: true, notice };
      const account = await newAccount(input.name, undefined, "oidc");
      await addMethod(account, "oidc", subject, display);
      return ctx.newSession(account, "oidc", 2, input.device ?? null);
    },

    // ---- recovery codes (IDN-21) --------------------------------------------------------------------------

    /** Ten new recovery codes, shown once; the old ones stop working. */
    async newRecoveryCodes(accountId: string): Promise<string[]> {
      const account = await ctx.liveAccount(accountId);
      for (const m of await store.methods(accountId)) if (m.kind === "recovery") await store.removeMethod(m.id);
      const codes: string[] = [];
      for (let i = 0; i < RECOVERY_CODES; i++) {
        const raw = [...crypto.getRandomValues(new Uint8Array(10))].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
        const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
        codes.push(code);
        const t = iso(ctx.now());
        await store.putMethod({ id: crypto.randomUUID(), account_id: account.id, kind: "recovery", subject_hash: await h("recovery", raw), display: `Recovery code ${i + 1}`, public_key: null, counter: null, verified_at: t, created_at: t, last_used_at: null });
      }
      await ctx.audit(accountId, "method.linked", { kind: "recovery", count: RECOVERY_CODES });
      return codes;
    },

    /** Sign in once with a recovery code, at level 1: enough to add a new way to sign in. */
    async recoverySignIn(input: { code: string; client: string; device?: string }): Promise<SignedIn> {
      const hour = iso(ctx.now()).slice(0, 13);
      if ((await store.hit(`recovery:${await h("client", input.client)}`, hour)) > RECOVERY_TRIES_PER_HOUR) throw new IdentityError("Too many tries. Wait an hour and try again.", 429);
      const raw = input.code.toUpperCase().replace(/[^0-9A-Z]/g, "");
      const method = raw.length === 10 ? await store.methodBySubject("recovery", await h("recovery", raw)) : null;
      if (!method) {
        await ctx.audit(null, "sign_in.failed", { method: "recovery" });
        throw new IdentityError("That recovery code isn't right, or it was used already.", 401);
      }
      await store.removeMethod(method.id);
      const account = await ctx.liveAccount(method.account_id);
      await ctx.audit(account.id, "recovery.used");
      return ctx.newSession(account, "recovery", 1, input.device ?? null);
    },

    /** Remove a way to sign in, keeping at least one that isn't a recovery code (IDN-40). */
    async removeMethod(accountId: string, methodId: string) {
      const all = await store.methods(accountId);
      const m = all.find((x) => x.id === methodId);
      if (!m) throw new IdentityError("No such method.", 404);
      const others = all.filter((x) => x.id !== m.id && x.kind !== "recovery");
      if (m.kind !== "recovery" && !others.length) throw new IdentityError("Add another way to sign in first: this is your last one.", 409);
      await store.removeMethod(m.id);
      await ctx.audit(accountId, "method.removed", { kind: m.kind });
    },
  };
}

/** A one-time random state value (tests and the OIDC flow). */
export const newState = () => randomToken(24);
