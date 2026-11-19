// Identity and spaces (docs/specs/15-identity.md IDN-1..6, 11, 50..54; SPC-1..10). One account per
// person, kept in the platform database (PLA-2) and shared by every edition:
//
//   account      a person id and a name they chose to show; never their profile's passphrase or
//                contents (IDN-4), which stay sealed on their devices
//   methods      how they sign in: a phone (a one-time code, IDN-11) now; passkeys, email, OIDC and
//                member keys arrive with their steps. Numbers and addresses are kept as keyed hashes
//                with a masked form for the screen (IDN-52)
//   memberships  their spaces (SPC-1): a family, business or community on an edition, with their
//                roles there. The server serves a space's data only to a session holding one (SPC-7)
//   sessions     a short ES256 access token (verifiable by every Worker and the box from the JWKS)
//                and a refresh token that rotates on every use; a copied refresh token ends the
//                session (IDN-50)
//
// Rate limits and lockout on every method (IDN-51); facts-only audit (IDN-53, SPC-10).
import { methodsApi, type RelyingParty } from "./methods.js";
import { keyedHash, newSigningKey, randomCode, randomToken, sameText, seal, signJwt, unseal, verifyJwt, type Jwk, type PublicJwk } from "./crypto.js";

export { b64url, fromB64url, keyedHash, randomToken, seal, unseal, verifyJwt, type PublicJwk } from "./crypto.js";

// ---- records -------------------------------------------------------------------------------------

export const METHOD_KINDS = ["passkey", "oidc", "recovery", "phone", "email", "member_key"] as const;
export type MethodKind = (typeof METHOD_KINDS)[number];
export const SPACE_KINDS = ["family", "business", "community"] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];
/** The edition a space lives on: its own site, or the combined one ("all"). */
export type Edition = SpaceKind | "all";

export type Account = { id: string; display_name: string | null; created_at: string; updated_at: string; deleted_at: string | null };
export type Method = {
  id: string;
  account_id: string;
  kind: MethodKind;
  subject_hash: string;
  /** What the screen shows: a masked number ("+91 •••••• 3210"), a passkey's name. */
  display: string;
  public_key: string | null;
  counter: number | null;
  verified_at: string | null;
  created_at: string;
  last_used_at: string | null;
};
/** A space the person belongs to (SPC-1). */
export type Membership = { account_id: string; edition: Edition; tenant_id: string; space_name: string; kind: SpaceKind; roles: string[]; member_id: string | null; created_at: string };
export type Session = {
  id: string;
  account_id: string;
  refresh_hash: string;
  prev_hash: string | null;
  method: MethodKind;
  /** The assurance level reached (IDN-30): 2 a verified contact, 3 a strong sign-in. */
  level: number;
  device: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
};
export type Challenge = { id: string; channel: "sms" | "whatsapp" | "email" | "passkey"; subject_hash: string; code_hash: string; attempts: number; created_at: string; expires_at: string; consumed_at: string | null };
/** A join request waiting for a space's administrator (SPC-8); the claim is sealed. */
export type PendingJoin = { id: string; account_id: string; edition: Edition; tenant_id: string; space_name: string; kind: SpaceKind; request_id: string; sealed_claim: string; created_at: string };
export type SigningKey = { kid: string; public_jwk: string; sealed_private: string; created_at: string; retired_at: string | null };

export const IDENTITY_ACTIONS = [
  "account.created",
  "signed_in",
  "sign_in.failed",
  "session.revoked",
  "method.linked",
  "method.removed",
  "account.deleted",
  "recovery.used",
  "space.created",
  "membership.added",
  "membership.removed",
] as const;
export type IdentityAction = (typeof IDENTITY_ACTIONS)[number];
export type IdentityAuditEvent = { id: string; at: string; account_id: string | null; action: IdentityAction; details: Record<string, string | number | boolean> | null };

export interface IdentityStore {
  account(id: string): Promise<Account | null>;
  putAccount(a: Account): Promise<void>;
  methodBySubject(kind: MethodKind, subjectHash: string): Promise<Method | null>;
  methods(accountId: string): Promise<Method[]>;
  putMethod(m: Method): Promise<void>;
  removeMethod(id: string): Promise<void>;
  memberships(accountId: string): Promise<Membership[]>;
  putMembership(m: Membership): Promise<void>;
  removeMembership(accountId: string, edition: Edition, tenantId: string): Promise<boolean>;
  session(id: string): Promise<Session | null>;
  /** The session whose current or previous refresh token has this hash. */
  sessionByRefresh(hash: string): Promise<Session | null>;
  sessions(accountId: string): Promise<Session[]>;
  putSession(s: Session): Promise<void>;
  challenge(id: string): Promise<Challenge | null>;
  putChallenge(c: Challenge): Promise<void>;
  keys(): Promise<SigningKey[]>;
  putKey(k: SigningKey): Promise<void>;
  /** Add one to a counter and return the new count. */
  hit(key: string, windowStart: string): Promise<number>;
  count(key: string, windowStart: string): Promise<number>;
  audit(e: IdentityAuditEvent): Promise<void>;
  auditLog(accountId: string, limit: number): Promise<IdentityAuditEvent[]>;
  pendingJoins(accountId: string): Promise<PendingJoin[]>;
  putPendingJoin(p: PendingJoin): Promise<void>;
  removePendingJoin(id: string): Promise<void>;
  /** Erase an account's methods, sessions and memberships (IDN-52), keeping the account row as a tombstone. */
  eraseAccount(accountId: string): Promise<void>;
}

export class IdentityError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

// ---- limits ----------------------------------------------------------------------------------------

export const ACCESS_SECONDS = 15 * 60;
export const REFRESH_DAYS = 30;
export const KEY_ROTATE_DAYS = 30;
export const OTP_DIGITS = 6;
export const OTP_MINUTES = 10;
/** Wrong codes per challenge before it ends. */
export const OTP_ATTEMPTS = 5;
/** Codes sent to one number per hour, and from one address per hour. */
export const OTP_SENDS_PER_HOUR = 5;
export const OTP_SENDS_PER_CLIENT_HOUR = 20;
/** Wrong codes for one number per day before it is locked until the next day. */
export const OTP_FAILURES_PER_DAY = 10;
export const MAX_SESSIONS = 20;
export const MAX_MEMBERSHIPS = 50;
/** Spaces one account may start in a day (SPC-8). */
export const SPACES_PER_DAY = 5;
export const MAX_PENDING_JOINS = 10;

/** What the person reads before an account is made (IDN-52). */
export const CONSENT_NOTICE =
  "Anjal keeps only what it needs to know it's you: your passkey's public key, or your Google account's id with your email shown partly hidden, and the spaces you belong to. Your profile's contents stay on your devices. You can delete your account at any time.";

// ---- phone numbers ---------------------------------------------------------------------------------

/** A phone number in E.164 ("+919876543210"), with India's +91 when none is given, or null. */
export function normalizePhone(input: string, defaultCountry = "91"): string | null {
  const raw = input.replace(/[\s().-]/g, "");
  let digits: string;
  if (raw.startsWith("+")) digits = raw.slice(1);
  else if (raw.startsWith("00")) digits = raw.slice(2);
  else if (/^0?\d{10}$/.test(raw)) digits = defaultCountry + raw.replace(/^0/, "");
  else digits = raw;
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  // An Indian mobile number has ten digits starting 6 to 9.
  if (digits.startsWith("91") && !/^91[6-9]\d{9}$/.test(digits)) return null;
  return `+${digits}`;
}

/** The number as the screen shows it: the country code and the last four digits (IDN-52). */
export function maskPhone(e164: string): string {
  const m = /^\+(1|7|\d{2,3}?)(\d+)$/.exec(e164);
  const cc = e164.startsWith("+91") ? "91" : (m?.[1] ?? "");
  const rest = e164.slice(1 + cc.length);
  return `+${cc} ${"•".repeat(Math.max(0, rest.length - 4))} ${rest.slice(-4)}`;
}

// ---- the service -----------------------------------------------------------------------------------

/** Sends a one-time code. A real provider is a connector (IDN-11); tests and local runs use another. */
export type OtpSender = { send(to: { channel: Challenge["channel"]; address: string }, code: string): Promise<void> };

export type IdentityOptions = {
  /** Phone and email codes: a later release (IDN-11, IDN-12). Without one, those methods are refused. */
  sender?: OtpSender;
  /** Passkeys' relying party (DOM-3); without it (a workers.dev address, DOM-5) passkeys are refused. */
  rp?: RelyingParty | null;
  /** The Worker's IDENTITY_SECRET: keys the hashes and seals the signing keys. */
  secret: string;
  /** Who signs the tokens (the `iss` claim), e.g. "https://anjalai.cc". */
  issuer: string;
  now?: () => Date;
};

export type TokenClaims = { iss: string; sub: string; sid: string; lvl: number; amr: string[]; iat: number; exp: number };
export type SignedIn = { account: Account; session: { id: string; access: string; refresh: string; access_expires_at: string; expires_at: string }; memberships: Membership[] };

const iso = (d: Date) => d.toISOString();
const hourOf = (d: Date) => iso(d).slice(0, 13);
const dayOf = (d: Date) => iso(d).slice(0, 10);

export function createIdentityService(store: IdentityStore, options: IdentityOptions) {
  const now = () => options.now?.() ?? new Date();
  const h = (purpose: string, value: string) => keyedHash(options.secret, purpose, value);
  const audit = (account_id: string | null, action: IdentityAction, details: IdentityAuditEvent["details"] = null) =>
    store.audit({ id: crypto.randomUUID(), at: iso(now()), account_id, action, details });

  // ---- signing keys ---------------------------------------------------------------------------------

  /** The key that signs now, made or rotated when it is due; older ones stay to verify until their tokens end. */
  async function signingKey(): Promise<{ kid: string; privateJwk: Jwk }> {
    const keys = await store.keys();
    const live = keys.filter((k) => !k.retired_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const current = live[0];
    const due = !current || now().getTime() - new Date(current.created_at).getTime() > KEY_ROTATE_DAYS * 86400_000;
    if (!due) return { kid: current.kid, privateJwk: JSON.parse(await unseal(options.secret, current.sealed_private)) as Jwk };
    const k = await newSigningKey();
    await store.putKey({ kid: k.kid, public_jwk: JSON.stringify(k.publicJwk), sealed_private: await seal(options.secret, JSON.stringify(k.privateJwk)), created_at: iso(now()), retired_at: null });
    for (const old of live) await store.putKey({ ...old, retired_at: iso(now()) });
    return { kid: k.kid, privateJwk: k.privateJwk };
  }

  /** The public keys that verify sessions (IDN-50): the current one and those retired within a token's life. */
  async function jwks(): Promise<{ keys: PublicJwk[] }> {
    const cutoff = now().getTime() - 2 * ACCESS_SECONDS * 1000;
    const keys = (await store.keys()).filter((k) => !k.retired_at || new Date(k.retired_at).getTime() > cutoff);
    return { keys: keys.map((k) => JSON.parse(k.public_jwk) as PublicJwk) };
  }

  async function issue(account: Account, session: Session, refresh: string): Promise<SignedIn> {
    const t = Math.floor(now().getTime() / 1000);
    const k = await signingKey();
    const claims: TokenClaims = { iss: options.issuer, sub: account.id, sid: session.id, lvl: session.level, amr: [session.method], iat: t, exp: t + ACCESS_SECONDS };
    return {
      account,
      session: { id: session.id, access: await signJwt(claims, k.kid, k.privateJwk), refresh: `${session.id}.${refresh}`, access_expires_at: iso(new Date((t + ACCESS_SECONDS) * 1000)), expires_at: session.expires_at },
      memberships: await store.memberships(account.id),
    };
  }

  async function newSession(account: Account, method: MethodKind, level: number, device: string | null): Promise<SignedIn> {
    // Keep the newest sessions; a person with too many loses the oldest.
    const open = (await store.sessions(account.id)).filter((s) => !s.revoked_at && s.expires_at > iso(now())).sort((a, b) => a.last_used_at.localeCompare(b.last_used_at));
    for (const s of open.slice(0, Math.max(0, open.length - MAX_SESSIONS + 1))) await store.putSession({ ...s, revoked_at: iso(now()) });
    const refresh = randomToken();
    const t = iso(now());
    const s: Session = {
      id: crypto.randomUUID(),
      account_id: account.id,
      refresh_hash: await h("refresh", refresh),
      prev_hash: null,
      method,
      level,
      device: device?.slice(0, 80) ?? null,
      created_at: t,
      last_used_at: t,
      expires_at: iso(new Date(now().getTime() + REFRESH_DAYS * 86400_000)),
      revoked_at: null,
    };
    await store.putSession(s);
    await audit(account.id, "signed_in", { method, level });
    return issue(account, s, refresh);
  }

  async function liveAccount(id: string): Promise<Account> {
    const a = await store.account(id);
    if (!a || a.deleted_at) throw new IdentityError("There is no such account.", 404);
    return a;
  }

  const api = {
    store,
    jwks,
    ...methodsApi({ store, secret: options.secret, rp: options.rp ?? null, now, audit: (a, action, details) => audit(a, action, details ?? null), newSession, liveAccount }, CONSENT_NOTICE),

    // ---- phone sign-in (IDN-11) ------------------------------------------------------------------

    /**
     * Send a code to a phone number. Limited per number and per client (IDN-51); the answer is the
     * same whether or not the number has an account, so it can't be used to find out who has one.
     */
    async startPhone(input: { phone: string; channel?: "sms" | "whatsapp"; client: string }): Promise<{ challenge: string; to: string; expires_at: string }> {
      const phone = normalizePhone(input.phone);
      if (!phone) throw new IdentityError("That doesn't look like a mobile number. Type it with its country code, or ten digits for India.");
      const subject = await h("phone", phone);
      const hour = hourOf(now());
      if ((await store.count(`fail:${subject}`, dayOf(now()))) >= OTP_FAILURES_PER_DAY) throw new IdentityError("Too many wrong codes for this number today. Try again tomorrow.", 429);
      if ((await store.hit(`send:${subject}`, hour)) > OTP_SENDS_PER_HOUR) throw new IdentityError("Too many codes sent to this number. Wait an hour and try again.", 429);
      if ((await store.hit(`client:${await h("client", input.client)}`, hour)) > OTP_SENDS_PER_CLIENT_HOUR) throw new IdentityError("Too many codes from here. Wait an hour and try again.", 429);
      const code = randomCode(OTP_DIGITS);
      const c: Challenge = {
        id: crypto.randomUUID(),
        channel: input.channel ?? "sms",
        subject_hash: subject,
        code_hash: "",
        attempts: 0,
        created_at: iso(now()),
        expires_at: iso(new Date(now().getTime() + OTP_MINUTES * 60_000)),
        consumed_at: null,
      };
      c.code_hash = await h("otp", `${c.id}:${code}`);
      await store.putChallenge(c);
      if (!options.sender) throw new IdentityError("Signing in with a phone code isn't available yet.", 501);
      await options.sender.send({ channel: c.channel, address: phone }, code);
      return { challenge: c.id, to: maskPhone(phone), expires_at: c.expires_at };
    },

    /**
     * Check the code. A number with an account signs in; a new number needs the consent notice
     * accepted first (`consent_required`, the code stays valid) and then gets an account.
     */
    async verifyPhone(input: { challenge: string; phone: string; code: string; consent?: boolean; name?: string; device?: string }): Promise<SignedIn | { consent_required: true; notice: string }> {
      const phone = normalizePhone(input.phone);
      const c = await store.challenge(input.challenge);
      const t = now();
      if (!phone || !c || c.consumed_at || c.expires_at <= iso(t) || c.attempts >= OTP_ATTEMPTS) throw new IdentityError("That code has ended. Ask for a new one.", 410);
      const subject = await h("phone", phone);
      if (!sameText(subject, c.subject_hash)) throw new IdentityError("That code has ended. Ask for a new one.", 410);
      const right = sameText(await h("otp", `${c.id}:${input.code.replace(/\D/g, "")}`), c.code_hash);
      if (!right) {
        await store.putChallenge({ ...c, attempts: c.attempts + 1 });
        const fails = await store.hit(`fail:${subject}`, dayOf(t));
        await audit(null, "sign_in.failed", { method: "phone", count: fails });
        throw new IdentityError(c.attempts + 1 >= OTP_ATTEMPTS ? "That code isn't right, and it has ended. Ask for a new one." : "That code isn't right.", 401);
      }
      const method = await store.methodBySubject("phone", subject);
      if (!method && !input.consent) return { consent_required: true, notice: CONSENT_NOTICE };
      await store.putChallenge({ ...c, consumed_at: iso(t) });
      let account: Account;
      if (method) {
        account = await liveAccount(method.account_id);
        await store.putMethod({ ...method, last_used_at: iso(t) });
      } else {
        account = { id: crypto.randomUUID(), display_name: input.name?.trim().slice(0, 40) || null, created_at: iso(t), updated_at: iso(t), deleted_at: null };
        await store.putAccount(account);
        await store.putMethod({ id: crypto.randomUUID(), account_id: account.id, kind: "phone", subject_hash: subject, display: maskPhone(phone), public_key: null, counter: null, verified_at: iso(t), created_at: iso(t), last_used_at: iso(t) });
        await audit(account.id, "account.created", { method: "phone" });
        await audit(account.id, "method.linked", { kind: "phone" });
      }
      // A verified contact is level 2 (IDN-30); a phone code is never more on its own (IDN-11).
      return newSession(account, "phone", 2, input.device ?? null);
    },

    // ---- sessions (IDN-50) ---------------------------------------------------------------------------

    /** The claims of a valid access token, or null. */
    async verify(access: string): Promise<TokenClaims | null> {
      return verifyJwt<TokenClaims>(access, (await jwks()).keys, { issuer: options.issuer, now: Math.floor(now().getTime() / 1000) });
    },

    /**
     * A new access token and a new refresh token for a refresh token. The old one stops working; if
     * it is ever presented again the session ends, since someone else has a copy.
     */
    async refresh(token: string): Promise<SignedIn> {
      const [, secret] = token.split(".");
      if (!secret) throw new IdentityError("Sign in again.", 401);
      const hash = await h("refresh", secret);
      const s = await store.sessionByRefresh(hash);
      if (!s || s.revoked_at || s.expires_at <= iso(now())) throw new IdentityError("Sign in again.", 401);
      if (s.prev_hash && sameText(s.prev_hash, hash)) {
        await store.putSession({ ...s, revoked_at: iso(now()) });
        await audit(s.account_id, "session.revoked", { reason: "reused" });
        throw new IdentityError("Sign in again.", 401);
      }
      const account = await liveAccount(s.account_id);
      const next = randomToken();
      const updated: Session = { ...s, prev_hash: s.refresh_hash, refresh_hash: await h("refresh", next), last_used_at: iso(now()), expires_at: iso(new Date(now().getTime() + REFRESH_DAYS * 86400_000)) };
      await store.putSession(updated);
      return issue(account, updated, next);
    },

    /** The person's sessions, for "devices and sessions" (IDN-40): no tokens. */
    async sessions(accountId: string) {
      return (await store.sessions(accountId))
        .filter((s) => !s.revoked_at && s.expires_at > iso(now()))
        .map(({ id, method, level, device, created_at, last_used_at }) => ({ id, method, level, device, created_at, last_used_at }));
    },

    /** Sign out one session (theirs), or every one but `keep` (sign out everywhere else). */
    async signOut(accountId: string, which: { session: string } | { allBut?: string }) {
      const list = (await store.sessions(accountId)).filter((s) => !s.revoked_at);
      const ends = "session" in which ? list.filter((s) => s.id === which.session) : list.filter((s) => s.id !== which.allBut);
      for (const s of ends) await store.putSession({ ...s, revoked_at: iso(now()) });
      if (ends.length) await audit(accountId, "session.revoked", { count: ends.length });
      return ends.length;
    },

    // ---- the account ---------------------------------------------------------------------------------

    /** The account, its methods as the screen shows them, and its spaces. */
    async me(accountId: string) {
      const account = await liveAccount(accountId);
      const methods = (await store.methods(accountId)).map(({ id, kind, display, created_at, last_used_at }) => ({ id, kind, display, created_at, last_used_at }));
      return { account, methods, memberships: await store.memberships(accountId) };
    },

    async rename(accountId: string, name: string) {
      const a = await liveAccount(accountId);
      const next = { ...a, display_name: name.trim().slice(0, 40) || null, updated_at: iso(now()) };
      await store.putAccount(next);
      return next;
    },

    /** Delete the account: its methods, sessions and memberships go; a tombstone stays for the audit (IDN-52). */
    async deleteAccount(accountId: string) {
      const a = await liveAccount(accountId);
      await store.eraseAccount(accountId);
      await store.putAccount({ ...a, display_name: null, deleted_at: iso(now()), updated_at: iso(now()) });
      await audit(accountId, "account.deleted");
    },

    // ---- spaces (SPC-1..10) ----------------------------------------------------------------------------

    /** Add (or update) a space for the person: when they start one, or join through a link (SPC-8). */
    async addMembership(accountId: string, m: { edition: Edition; tenant_id: string; space_name: string; kind: SpaceKind; roles: string[]; member_id?: string | null }, { created = false } = {}) {
      await liveAccount(accountId);
      if (!SPACE_KINDS.includes(m.kind)) throw new IdentityError("A space is a family, a business or a community.");
      if (m.edition !== "all" && m.edition !== m.kind) throw new IdentityError("A space lives on its own kind of edition.");
      const all = await store.memberships(accountId);
      const existing = all.find((x) => x.edition === m.edition && x.tenant_id === m.tenant_id);
      if (!existing && all.length >= MAX_MEMBERSHIPS) throw new IdentityError(`You belong to ${MAX_MEMBERSHIPS} spaces already.`, 409);
      const row: Membership = {
        account_id: accountId,
        edition: m.edition,
        tenant_id: m.tenant_id,
        space_name: m.space_name.trim().slice(0, 80) || m.tenant_id,
        kind: m.kind,
        roles: [...new Set(m.roles)].slice(0, 20),
        member_id: m.member_id ?? null,
        created_at: existing?.created_at ?? iso(now()),
      };
      await store.putMembership(row);
      if (created) await audit(accountId, "space.created", { kind: m.kind, edition: m.edition });
      if (!existing) await audit(accountId, "membership.added", { kind: m.kind, edition: m.edition });
      return row;
    },

    async removeMembership(accountId: string, edition: Edition, tenantId: string) {
      const ok = await store.removeMembership(accountId, edition, tenantId);
      if (ok) await audit(accountId, "membership.removed", { edition });
      return ok;
    },

    /**
     * The person's membership in a space, or null (SPC-7): the server serves a space's data only
     * when this says yes. Spaces of other editions are never matched.
     */
    async spaceOf(accountId: string, edition: Edition, tenantId: string): Promise<Membership | null> {
      return (await store.memberships(accountId)).find((m) => m.edition === edition && m.tenant_id === tenantId) ?? null;
    },

    /** The spaces this edition's site offers (SPC-3): its own kind; the combined site offers every one. */
    async spacesFor(accountId: string, edition: Edition): Promise<Membership[]> {
      return (await store.memberships(accountId)).filter((m) => edition === "all" || m.edition === edition);
    },

    /** May this account start another space today (SPC-8)? Counts the attempt. */
    async mayStartSpace(accountId: string): Promise<boolean> {
      return (await store.hit(`start:${accountId}`, dayOf(now()))) <= SPACES_PER_DAY;
    },

    /** Keep a join request that waits for the space's administrator (SPC-8). */
    async addPendingJoin(accountId: string, p: { edition: Edition; tenant_id: string; space_name: string; kind: SpaceKind; request_id: string; claim: string }) {
      await liveAccount(accountId);
      const mine = await store.pendingJoins(accountId);
      if (mine.length >= MAX_PENDING_JOINS) throw new IdentityError("You have too many requests to join waiting already.", 409);
      const { claim, ...rest } = p;
      await store.putPendingJoin({ id: crypto.randomUUID(), account_id: accountId, ...rest, space_name: rest.space_name.slice(0, 80), sealed_claim: await seal(options.secret, claim), created_at: iso(now()) });
    },
    /** The account's waiting join requests on an edition, with their claims (the Worker checks each). */
    async pendingJoins(accountId: string, edition: Edition) {
      const list = (await store.pendingJoins(accountId)).filter((p) => edition === "all" || p.edition === edition);
      return Promise.all(list.map(async ({ sealed_claim, ...p }) => ({ ...p, claim: await unseal(options.secret, sealed_claim) })));
    },
    removePendingJoin: (id: string) => store.removePendingJoin(id),

    async auditLog(accountId: string, limit = 50) {
      return store.auditLog(accountId, Math.min(limit, 200));
    },
  };
  return api;
}
export type IdentityService = ReturnType<typeof createIdentityService>;

// ---- senders -----------------------------------------------------------------------------------------

/**
 * Keeps the last code per address in memory, for tests and local runs (`IDENTITY_OTP=dev`): the code
 * is never logged or sent anywhere. A real SMS or WhatsApp provider is a connector, chosen per site.
 */
export function createMemorySender() {
  const last = new Map<string, string>();
  return {
    async send(to: { address: string }, code: string) {
      last.set(to.address, code);
    },
    /** The last code sent to an address (tests, and the local "show the code" panel). */
    codeFor: (address: string) => last.get(address) ?? null,
  };
}

// ---- the memory store (tests) ------------------------------------------------------------------------

export function createMemoryIdentityStore(): IdentityStore {
  const accounts = new Map<string, Account>();
  const methods = new Map<string, Method>();
  const memberships = new Map<string, Membership>();
  const sessions = new Map<string, Session>();
  const challenges = new Map<string, Challenge>();
  const keys = new Map<string, SigningKey>();
  const counters = new Map<string, number>();
  const events: IdentityAuditEvent[] = [];
  const pending = new Map<string, PendingJoin>();
  const copy = <T>(x: T): T => structuredClone(x);
  const mkey = (a: string, e: string, t: string) => `${a}|${e}|${t}`;
  return {
    account: async (id) => copy(accounts.get(id) ?? null),
    putAccount: async (a) => void accounts.set(a.id, copy(a)),
    methodBySubject: async (kind, hash) => copy([...methods.values()].find((m) => m.kind === kind && m.subject_hash === hash) ?? null),
    methods: async (id) => [...methods.values()].filter((m) => m.account_id === id).map(copy),
    putMethod: async (m) => {
      const clash = [...methods.values()].find((x) => x.id !== m.id && x.kind === m.kind && x.subject_hash === m.subject_hash);
      if (clash) throw new Error("UNIQUE constraint failed: account_methods.kind, account_methods.subject_hash");
      methods.set(m.id, copy(m));
    },
    removeMethod: async (id) => void methods.delete(id),
    memberships: async (id) => [...memberships.values()].filter((m) => m.account_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(copy),
    putMembership: async (m) => void memberships.set(mkey(m.account_id, m.edition, m.tenant_id), copy(m)),
    removeMembership: async (a, e, t) => memberships.delete(mkey(a, e, t)),
    session: async (id) => copy(sessions.get(id) ?? null),
    sessionByRefresh: async (hash) => copy([...sessions.values()].find((s) => s.refresh_hash === hash || s.prev_hash === hash) ?? null),
    sessions: async (id) => [...sessions.values()].filter((s) => s.account_id === id).map(copy),
    putSession: async (s) => void sessions.set(s.id, copy(s)),
    challenge: async (id) => copy(challenges.get(id) ?? null),
    putChallenge: async (c) => void challenges.set(c.id, copy(c)),
    keys: async () => [...keys.values()].map(copy),
    putKey: async (k) => void keys.set(k.kid, copy(k)),
    hit: async (key, w) => {
      const k = `${key}|${w}`;
      const n = (counters.get(k) ?? 0) + 1;
      counters.set(k, n);
      return n;
    },
    count: async (key, w) => counters.get(`${key}|${w}`) ?? 0,
    audit: async (e) => void events.push(copy(e)),
    auditLog: async (id, limit) => events.filter((e) => e.account_id === id).reverse().slice(0, limit).map(copy),
    pendingJoins: async (id) => [...pending.values()].filter((p) => p.account_id === id).map(copy),
    putPendingJoin: async (p) => void pending.set(p.id, copy(p)),
    removePendingJoin: async (id) => void pending.delete(id),
    eraseAccount: async (id) => {
      for (const [k, p] of pending) if (p.account_id === id) pending.delete(k);
      for (const [k, m] of methods) if (m.account_id === id) methods.delete(k);
      for (const [k, m] of memberships) if (m.account_id === id) memberships.delete(k);
      for (const [k, s] of sessions) if (s.account_id === id) sessions.set(k, { ...s, revoked_at: s.revoked_at ?? new Date().toISOString() });
    },
  };
}

export { createD1IdentityStore } from "./d1.js";
export { maskEmail, PASSKEY_MINUTES, RECOVERY_CODES, type RelyingParty } from "./methods.js";
export { GOOGLE_ISSUER, OIDC_MINUTES, oidcFinish, oidcStart, type OidcPending, type OidcProvider, type OidcResult } from "./oidc.js";
