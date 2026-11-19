// Accounts and spaces on the Worker (docs/specs/15-identity.md step 1; SPC-1..4, 6, 7, 10).
//
// Session (IDN-50, DOM-2): `anj_at` is the short ES256 access token, `anj_rt` the rotating refresh
// token (sent only to /api/identity). On anjalai.cc both are scoped to `.anjalai.cc`, so one sign-in
// works on every edition; elsewhere they are host-only. HttpOnly, Secure (except on localhost), Lax.
// Passkeys use the relying party `anjalai.cc` there (DOM-3) and `localhost` locally; other addresses
// (workers.dev, yaxb.ai) offer no passkeys (DOM-5).
//
// The open space (SPC-7) is `anj_space`, host-only, naming an edition and a tenant there
// (`business:<tenant>`; a plain tenant, from before one address served every edition, is the
// address's edition). Every request checks it against the account's memberships before the edition
// and the tenant context use it; a membership linked to a member record makes that member signed in
// (the account stands in for their key), so the person switches spaces, of any edition, on the same
// address without signing in again (SPC-4, SUR-14).
import { Hono, type Context, type Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  createD1IdentityStore,
  createIdentityService,
  GOOGLE_ISSUER,
  IdentityError,
  oidcFinish,
  oidcStart,
  policyAllows,
  POLICY_METHODS,
  seal,
  SESSION_HOURS,
  unseal,
  type DeviceLockView,
  type Edition,
  type IdentityService,
  type Membership,
  type OidcPending,
  type RelyingParty,
  type SignedIn,
  type SpaceKind,
  type TokenClaims,
} from "@sekaran-ind/yaxb-core/identity";
import { surfaceOfHost } from "@sekaran-ind/yaxb-core/context";
import { settings, type Bindings } from "./env";
import { currentEdition, EDITIONS, withEdition } from "./edition";
import type { AppEnv } from "./index";

export const ACCESS_COOKIE = "anj_at";
export const REFRESH_COOKIE = "anj_rt";
export const SPACE_COOKIE = "anj_space";
/** The native app's open space (IDN-43): it has no cookies, so it says which space in a header. */
export const SPACE_HEADER = "X-Yaxb-Space";
/** A device kept for one space (SPC-5): `<id>.<secret>`, host-only. */
export const LOCK_COOKIE = "anj_lock";
const OIDC_COOKIE = "anj_oidc";
const SHARED_DOMAIN = "anjalai.cc";
const EDITION_ORIGINS = ["", "family.", "business.", "community."].map((s) => `https://${s}${SHARED_DOMAIN}`);

const hostOf = (c: Context) => new URL(c.req.url).hostname;
const onShared = (c: Context) => hostOf(c) === SHARED_DOMAIN || hostOf(c).endsWith(`.${SHARED_DOMAIN}`);
const local = (c: Context) => hostOf(c) === "localhost" || hostOf(c).endsWith(".localhost") || hostOf(c) === "127.0.0.1";

/** Passkeys' relying party for this address (DOM-3, DOM-5), or null where none is offered. */
export function relyingParty(c: Context): RelyingParty | null {
  if (onShared(c)) return { id: SHARED_DOMAIN, name: "Anjal", origins: EDITION_ORIGINS };
  // Locally, `localhost`; an edition's local address (family.localhost, …) is its own relying party,
  // since browsers don't take `localhost` as a parent domain.
  if (hostOf(c) === "localhost" || hostOf(c).endsWith(".localhost")) return { id: hostOf(c), name: "Anjal (local)", origins: [new URL(c.req.url).origin] };
  return null;
}

/** The open space a cookie names: its edition and tenant (a plain tenant is the address's edition). */
export function spaceCookie(c: Context, value = getCookie(c, SPACE_COOKIE) ?? c.req.header(SPACE_HEADER)): { edition: Edition; tenant: string } | null {
  if (!value) return null;
  const at = value.indexOf(":");
  const named = at > 0 ? value.slice(0, at) : null;
  if (named && (EDITIONS as readonly string[]).includes(named)) return { edition: named as Edition, tenant: value.slice(at + 1) };
  return { edition: surfaceOfHost(hostOf(c)) ?? settings(c.env as Bindings).SURFACE ?? "all", tenant: value };
}
const sameSpace = (a: { edition: string; tenant_id: string }, b: { edition: string; tenant: string } | null) => Boolean(b) && a.edition === b!.edition && a.tenant_id === b!.tenant;

const services = new WeakMap<object, Map<string, IdentityService>>();
/** The identity service for this request (one per relying party), or null when IDENTITY_SECRET is unset. */
export function identity(c: Context<AppEnv>): IdentityService | null {
  const { IDENTITY_SECRET, IDENTITY_ISSUER } = settings(c.env);
  if (!IDENTITY_SECRET || !c.env.PLATFORM_DB) return null;
  const rp = relyingParty(c);
  let byRp = services.get(c.env);
  if (!byRp) services.set(c.env, (byRp = new Map()));
  const key = rp?.id ?? "none";
  let svc = byRp.get(key);
  if (!svc) byRp.set(key, (svc = createIdentityService(createD1IdentityStore(c.env.PLATFORM_DB as never), { secret: IDENTITY_SECRET, issuer: IDENTITY_ISSUER, rp })));
  return svc;
}

// ---- cookies -----------------------------------------------------------------------------------------

function cookieBase(c: Context) {
  return { httpOnly: true, secure: !local(c), sameSite: "Lax" as const, ...(onShared(c) ? { domain: `.${SHARED_DOMAIN}` } : {}) };
}
function setSession(c: Context, s: SignedIn["session"] | null) {
  setCookie(c, ACCESS_COOKIE, s?.access ?? "", { ...cookieBase(c), path: "/", maxAge: s ? 15 * 60 : 0 });
  setCookie(c, REFRESH_COOKIE, s?.refresh ?? "", { ...cookieBase(c), path: "/api/identity", maxAge: s ? 30 * 86400 : 0 });
}
function setSpace(c: Context, m: { edition: Edition; tenant_id: string } | null) {
  setCookie(c, SPACE_COOKIE, m ? `${m.edition}:${m.tenant_id}` : "", { httpOnly: true, secure: !local(c), sameSite: "Lax", path: "/", maxAge: m ? 365 * 86400 : 0 });
}

function setLock(c: Context, token: string | null) {
  // Kept for as long as browsers allow (400 days); a device in use is seen again long before that.
  setCookie(c, LOCK_COOKIE, token ?? "", { httpOnly: true, secure: !local(c), sameSite: "Lax", path: "/", maxAge: token ? 400 * 86400 : 0 });
}

/** A device's lock, checked at most once a minute per isolate (releasing it ends it within a minute everywhere). */
const lockChecks = new Map<string, { lock: DeviceLockView | null; until: number }>();
async function lockOf(c: Context<AppEnv>, svc: IdentityService): Promise<DeviceLockView | null> {
  const token = getCookie(c, LOCK_COOKIE);
  if (!token) return null;
  const hit = lockChecks.get(token);
  if (hit && hit.until > Date.now()) return hit.lock;
  const lock = await svc.deviceLockOf(token).catch(() => null);
  if (lockChecks.size > 1000) lockChecks.clear();
  lockChecks.set(token, { lock, until: Date.now() + 60_000 });
  return lock;
}

/** A space's sign-in rules (IDN-34), read at most once a minute per isolate. */
const policies = new Map<string, { policy: Awaited<ReturnType<IdentityService["spacePolicy"]>>; until: number }>();
async function policyOf(svc: IdentityService, edition: Edition, tenant: string) {
  const key = `${edition}|${tenant}`;
  const hit = policies.get(key);
  if (hit && hit.until > Date.now()) return hit.policy;
  const policy = await svc.spacePolicy(edition, tenant);
  if (policies.size > 1000) policies.clear();
  policies.set(key, { policy, until: Date.now() + 60_000 });
  return policy;
}

// ---- every request: who is signed in, and in which space (SPC-7) ----------------------------------------

/**
 * Reads the account session and the open space, and checks the membership. Sets `account` and
 * `space` for the routes and the tenant context. A space the account doesn't belong to is ignored.
 */
/**
 * What a device signed in with a code may call (IDN-18): its scopes' routes, and its own sign-out.
 * Anything else answers 403.
 */
const DEVICE_ROUTES: Record<string, [method: string, path: RegExp][]> = {
  chat: [
    ["POST", /^\/api\/agent\/chat$/],
    ["GET", /^\/api\/agent\/(providers|capabilities|sources|curated|moderation)$/],
    ["POST", /^\/api\/identity\/box\/token$/],
  ],
  // The box fetches its owner's trust (IDN-42).
  box: [["GET", /^\/api\/identity\/box\/trust$/]],
};
const DEVICE_ALWAYS: [string, RegExp][] = [
  ["GET", /^\/api\/identity\/me$/],
  ["DELETE", /^\/api\/identity\/devices\/self$/],
];
const deviceMay = (scopes: readonly string[], method: string, path: string) =>
  [...DEVICE_ALWAYS, ...scopes.flatMap((s) => DEVICE_ROUTES[s] ?? [])].some(([m, re]) => m === method && re.test(path));

export async function accountContext(c: Context<AppEnv>, next: Next) {
  const svc = identity(c);
  // A device signed in with a code (IDN-17, 18): its credential is the account's, for its scopes only.
  const bearer = /^Bearer\s+(anj_dev_\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
  if (bearer) {
    const device = svc ? await svc.deviceCredentialOf(bearer) : null;
    if (!device) return c.json({ error: "This device is signed out. Sign it in again (yaxb login)." }, 401);
    if (!deviceMay(device.scopes, c.req.method, new URL(c.req.url).pathname)) return c.json({ error: "This device may not do that." }, 403);
    const t = Math.floor(Date.now() / 1000);
    c.set("device", device);
    c.set("account", { iss: "device", sub: device.account_id, sid: `dev:${device.id}`, lvl: 2, amr: ["device"], iat: t, exp: t + 60, auth_time: Math.floor(new Date(device.created_at).getTime() / 1000) });
    return next();
  }
  // A device kept for one space (SPC-5) acts in that space whoever uses it; its visitors stay anonymous.
  const lock = svc ? await lockOf(c, svc) : null;
  if (lock) c.set("lock", lock);
  // The native app (IDN-43) sends its access token as a bearer token; the web keeps it in a cookie.
  const appToken = /^Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)$/.exec(c.req.header("authorization") ?? "")?.[1];
  const token = appToken ?? getCookie(c, ACCESS_COOKIE);
  if (svc && token) {
    const claims = await svc.verify(token).catch(() => null);
    if (claims) {
      c.set("account", claims);
      // On a kept device only the account's membership in that space counts (staff at the desk).
      const open = lock ? { edition: lock.edition, tenant: lock.tenant_id } : spaceCookie(c);
      if (open) {
        const m = await svc.spaceOf(claims.sub, open.edition, open.tenant).catch(() => null);
        // The space's own rules (IDN-34): a sign-in it doesn't accept doesn't open it.
        const verdict = m ? policyAllows(await policyOf(svc, m.edition, m.tenant_id), claims, m) : null;
        if (m && verdict?.ok) c.set("space", m);
        else if (m && verdict && !verdict.ok) c.set("spaceRefused", { space_name: m.space_name, why: verdict.why, message: verdict.message });
      }
    }
  }
  await next();
}

// ---- routes ---------------------------------------------------------------------------------------------

type Deps = {
  sameOrigin: (c: Context<AppEnv>) => boolean;
  limited: (c: Context<AppEnv>, key: string) => Promise<boolean>;
  /** A looser limit for a device waiting for its code to be approved (a poll every few seconds). */
  polled: (c: Context<AppEnv>, key: string) => Promise<boolean>;
  ip: (c: Context<AppEnv>) => string;
  /** The space's name and kind on this edition (its tenant). */
  spaceInfo: (env: Bindings, tenant: string) => Promise<{ name: string; kind: SpaceKind }>;
  /** Make (or find) the member record that a membership stands for, in that tenant. */
  memberFor: (c: Context<AppEnv>, input: { name: string; roles: string[] }) => Promise<{ id: string; roles: string[] }>;
  /** The signed-in member (their key) and whether the administrator token is signed in, for linking. */
  signedInMember: (c: Context<AppEnv>) => Promise<{ id: string; roles: string[] } | null>;
  isAdmin: (c: Context<AppEnv>) => Promise<boolean>;
  /** A space (edition and tenant) by its short name in the directory, for a business's own sign-in (IDN-15). */
  findSpace: (c: Context<AppEnv>, slug: string) => Promise<{ edition: Edition; tenant_id: string; name: string } | null>;
  /** Make a staff member in a space for someone its own provider vouched for, linked to their account. */
  joinAsStaff: (c: Context<AppEnv>, edition: Edition, tenant: string, input: { name: string; role: string }) => Promise<{ member_id: string; roles: string[]; space_name: string; kind: SpaceKind }>;
  /** Whether the person is this space's administrator (their member key, the open space's membership, or ADMIN_TOKEN). */
  spaceAdministrator: (c: Context<AppEnv>) => Promise<boolean>;
  /** The tenant this request acts in (the tenant context). */
  tenant: () => string;
  /** Start a space (SPC-8): a new tenant, with the person as its administrator. Runs in the space's own edition. */
  startSpace: (c: Context<AppEnv>, input: { kind: SpaceKind; name: string; person: string }) => Promise<{ tenant_id: string; name: string; kind: SpaceKind; member_id: string; roles: string[] }>;
  /** Use a join code (IDN-40): accepted at once (a new space's first administrator), or waiting for the administrator. */
  joinSpace: (c: Context<AppEnv>, token: string, person: string) => Promise<{ edition: Edition; tenant_id: string; space_name: string; kind: SpaceKind; request_id: string; claim: string; accepted: boolean }>;
  /** Where a waiting join stands; accepted ones are collected into a member. Runs in the join's edition. */
  collectJoin: (c: Context<AppEnv>, requestId: string, claim: string) => Promise<{ status: "collected"; member_id: string; roles: string[] } | { status: "pending" | "declined" | "gone" }>;
};

const json = (c: Context, status: number, error: string) => c.json({ error }, status as 400);
const device = (c: Context) => (c.req.header("user-agent") ?? "").replace(/\s*\(.*?\)\s*/g, " ").trim().slice(0, 60) || null;
const PASSKEY_BODY = 16 * 1024;

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T | null> {
  const raw = await c.req.text();
  if (raw.length > PASSKEY_BODY) return null;
  try {
    const r = schema.safeParse(JSON.parse(raw || "{}"));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function identityRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  // Changes are same origin, and identity must be configured.
  r.use("*", async (c, next) => {
    if (c.req.method !== "GET" && !deps.sameOrigin(c)) return json(c, 403, "Forbidden");
    if (!identity(c) && !c.req.path.endsWith("/config")) return json(c, 503, "Accounts aren't set up on this site yet (IDENTITY_SECRET).");
    // A kept device opens no other space (SPC-5).
    const lock = c.get("lock");
    if (lock && c.req.method !== "GET" && /\/(space|spaces\/(start|join|link))$/.test(c.req.path)) return json(c, 409, `This device is kept for ${lock.space_name}.`);
    await next();
  });
  /** What a screen shows of the device's lock. */
  const lockedView = (c: Context<AppEnv>) => {
    const l = c.get("lock");
    return l ? { space_name: l.space_name, label: l.label, edition: l.edition, created_at: l.created_at } : null;
  };

  const svc = (c: Context<AppEnv>) => identity(c)!;
  /** Run a call, turning the service's refusals into JSON errors. */
  const call = async (c: Context<AppEnv>, fn: () => Promise<unknown>) => {
    try {
      return c.json((await fn()) ?? { ok: true });
    } catch (e) {
      if (e instanceof IdentityError) return json(c, e.status, e.message);
      throw e;
    }
  };
  /** A sign-in finished: the cookies, and what the app shows. */
  const signedIn = (c: Context<AppEnv>, s: SignedIn) => {
    setSession(c, s.session);
    // Every space, of every edition: one address serves them all (SUR-14).
    return { account: s.account, memberships: s.memberships };
  };
  const mustSignIn = (c: Context<AppEnv>) => {
    const a = c.get("account");
    if (!a) throw new IdentityError("Sign in first.", 401);
    return a;
  };
  const limit = async (c: Context<AppEnv>, what: string) => {
    if (!(await deps.limited(c, `${what}:${deps.ip(c)}`))) throw new IdentityError("Too many tries. Please wait a minute.", 429);
  };

  r.get("/config", (c) => {
    const s = settings(c.env);
    return c.json({
      enabled: Boolean(identity(c)),
      passkeys: Boolean(relyingParty(c)),
      google: Boolean(s.GOOGLE_CLIENT_ID && s.GOOGLE_CLIENT_SECRET),
      edition: currentEdition(),
      locked: lockedView(c),
      notice: "Anjal keeps only what it needs to know it's you: your passkey's public key, or your Google account's id with your email shown partly hidden, and the spaces you belong to. Your profile's contents stay on your devices. You can delete your account at any time.",
    });
  });
  r.get("/jwks", async (c) => c.json(await svc(c).jwks(), 200, { "cache-control": "public, max-age=300" }));

  // ---- passkeys ----
  r.post("/passkey/register/start", (c) =>
    call(c, async () => {
      await limit(c, "passkey");
      const b = await body(c, z.object({ name: z.string().max(40).optional() }));
      return svc(c).passkeyRegisterStart({ account: c.get("account")?.sub, name: b?.name });
    }),
  );
  r.post("/passkey/register/finish", (c) =>
    call(c, async () => {
      const b = await body(c, z.object({ challenge: z.string().max(64), response: z.any(), consent: z.boolean().optional(), name: z.string().max(40).optional(), label: z.string().max(40).optional() }));
      if (!b) throw new IdentityError("Check the details.");
      const out = await svc(c).passkeyRegisterFinish({ challenge: b.challenge, response: b.response, account: c.get("account")?.sub, consent: b.consent, name: b.name, label: b.label, device: device(c) ?? undefined });
      return "session" in out ? signedIn(c, out) : out;
    }),
  );
  r.post("/passkey/signin/start", (c) =>
    call(c, async () => {
      await limit(c, "passkey");
      return svc(c).passkeySignInStart();
    }),
  );
  r.post("/passkey/signin/finish", (c) =>
    call(c, async () => {
      const b = await body(c, z.object({ challenge: z.string().max(64), response: z.any() }));
      if (!b) throw new IdentityError("Check the details.");
      return signedIn(c, await svc(c).passkeySignInFinish({ challenge: b.challenge, response: b.response, device: device(c) ?? undefined }));
    }),
  );

  // ---- Google (IDN-14) ----
  const google = (c: Context<AppEnv>) => {
    const s = settings(c.env);
    if (!s.GOOGLE_CLIENT_ID || !s.GOOGLE_CLIENT_SECRET) throw new IdentityError("Sign in with Google isn't set up on this site.", 501);
    return { id: "google" as const, issuer: GOOGLE_ISSUER, clientId: s.GOOGLE_CLIENT_ID, clientSecret: s.GOOGLE_CLIENT_SECRET, redirectUri: `${new URL(c.req.url).origin}/api/identity/google/callback` };
  };
  /** Only a path on this site to come back to. */
  const backTo = (v: string | undefined) => (v && /^\/(?!\/)[\w\-/?=&.%]*$/.test(v) ? v : "/kiosk");
  r.get("/google/start", async (c) => {
    try {
      await limit(c, "google");
      const p = google(c);
      const { url, pending } = await oidcStart(p);
      // Pressing "Continue with Google" under the notice is the consent (IDN-52); adding to a signed-in account needs none.
      const keep = { ...pending, consent: c.req.query("consent") === "1", back: backTo(c.req.query("return")), add: c.get("account")?.sub ?? null };
      setCookie(c, OIDC_COOKIE, await seal(settings(c.env).IDENTITY_SECRET!, JSON.stringify(keep)), { httpOnly: true, secure: !local(c), sameSite: "Lax", path: "/api/identity/google", maxAge: 600 });
      return c.redirect(url, 302);
    } catch (e) {
      return c.redirect(`/kiosk?prefs=account&signin=${encodeURIComponent(e instanceof IdentityError ? e.message : "Google sign-in isn't available right now.")}`, 302);
    }
  });
  r.get("/google/callback", async (c) => {
    const sealed = getCookie(c, OIDC_COOKIE);
    setCookie(c, OIDC_COOKIE, "", { path: "/api/identity/google", maxAge: 0 });
    let back = "/kiosk";
    try {
      if (!sealed) throw new IdentityError("That sign-in took too long. Try again.", 410);
      const kept = JSON.parse(await unseal(settings(c.env).IDENTITY_SECRET!, sealed)) as OidcPending & { consent: boolean; back: string; add: string | null };
      back = kept.back;
      const who = await oidcFinish(google(c), new URL(c.req.url), kept);
      const out = await svc(c).oidcSignIn({ provider: "google", subject: who.subject, email: who.email, emailVerified: who.emailVerified, consent: kept.consent, name: who.name ?? undefined, device: device(c) ?? undefined, account: kept.add ?? undefined });
      if ("consent_required" in out) throw new IdentityError("Read the notice and press Continue with Google again.", 428);
      if ("session" in out) setSession(c, out.session);
      return c.redirect(back.includes("?") ? `${back}&signedin=1` : `${back}?signedin=1`, 302);
    } catch (e) {
      const why = e instanceof IdentityError ? e.message : "Google didn't sign you in. Try again.";
      return c.redirect(`${back}${back.includes("?") ? "&" : "?"}signin=${encodeURIComponent(why)}`, 302);
    }
  });

  // ---- recovery codes (IDN-21) ----
  r.post("/recovery", (c) =>
    call(c, async () => {
      await limit(c, "recovery");
      const b = await body(c, z.object({ code: z.string().max(20) }));
      if (!b) throw new IdentityError("Type the recovery code.");
      return signedIn(c, await svc(c).recoverySignIn({ code: b.code, client: deps.ip(c), device: device(c) ?? undefined }));
    }),
  );
  r.post("/recovery-codes", (c) => call(c, async () => ({ codes: await svc(c).newRecoveryCodes(mustSignIn(c).sub) })));

  // ---- the session ----
  /** Waiting joins whose administrator said yes become spaces; declined or vanished ones are dropped. */
  async function settleJoins(c: Context<AppEnv>, accountId: string) {
    for (const p of await svc(c).pendingJoins(accountId, "all")) {
      const r = await withEdition(p.edition, () => deps.collectJoin(c, p.request_id, p.claim)).catch(() => ({ status: "pending" as const }));
      if (r.status === "collected") {
        await svc(c).addMembership(accountId, { edition: p.edition, tenant_id: p.tenant_id, space_name: p.space_name, kind: p.kind, roles: r.roles, member_id: r.member_id });
        await svc(c).removePendingJoin(p.id);
      } else if (r.status !== "pending") await svc(c).removePendingJoin(p.id);
    }
  }

  /** Who is signed in, refreshing the session when the access token has ended (and the refresh token is good). */
  r.get("/me", async (c) => {
    let account = c.get("account");
    if (!account) {
      const refresh = getCookie(c, REFRESH_COOKIE);
      if (refresh) {
        try {
          const s = await svc(c).refresh(refresh);
          setSession(c, s.session);
          account = (await svc(c).verify(s.session.access)) ?? undefined;
        } catch {
          setSession(c, null);
        }
      }
    }
    if (!account) return c.json({ signedIn: false });
    try {
      await settleJoins(c, account.sub).catch(() => undefined);
      const me = await svc(c).me(account.sub);
      const waiting = (await svc(c).pendingJoins(account.sub, "all")).map((p) => ({ space_name: p.space_name, kind: p.kind }));
      const spaces = me.memberships;
      const open = spaceCookie(c);
      return c.json({ signedIn: true, level: account.lvl, account: me.account, methods: me.methods, spaces, space: c.get("space") ?? (c.get("spaceRefused") ? null : (spaces.find((m) => sameSpace(m, open)) ?? null)), refused: c.get("spaceRefused") ?? null, waiting, edition: currentEdition(), locked: lockedView(c) });
    } catch {
      setSession(c, null);
      return c.json({ signedIn: false });
    }
  });
  r.post("/refresh", (c) =>
    call(c, async () => {
      const t = getCookie(c, REFRESH_COOKIE);
      if (!t) throw new IdentityError("Sign in again.", 401);
      return signedIn(c, await svc(c).refresh(t));
    }),
  );
  r.post("/signout", (c) =>
    call(c, async () => {
      const a = c.get("account");
      const b = await body(c, z.object({ everywhere: z.boolean().optional() }));
      if (a) await svc(c).signOut(a.sub, b?.everywhere ? { allBut: "" } : { session: a.sid });
      setSession(c, null);
      setSpace(c, null);
      return { signedOut: true };
    }),
  );
  r.get("/sessions", (c) => call(c, async () => ({ current: mustSignIn(c).sid, sessions: await svc(c).sessions(mustSignIn(c).sub) })));
  r.delete("/sessions/:id", (c) => call(c, async () => ({ ended: await svc(c).signOut(mustSignIn(c).sub, { session: c.req.param("id") }) })));
  r.delete("/methods/:id", (c) => call(c, () => svc(c).removeMethod(mustSignIn(c).sub, c.req.param("id"))));
  r.patch("/account", (c) =>
    call(c, async () => {
      const b = await body(c, z.object({ name: z.string().max(40) }));
      if (!b) throw new IdentityError("Give a name.");
      return { account: await svc(c).rename(mustSignIn(c).sub, b.name) };
    }),
  );
  r.delete("/account", (c) =>
    call(c, async () => {
      await svc(c).deleteAccount(mustSignIn(c).sub);
      setSession(c, null);
      setSpace(c, null);
      return { deleted: true };
    }),
  );

  // ---- spaces (SPC-1..4, 7) ----
  /** Open a space (or none): only one the account belongs to. Any edition's space opens on any address. */
  r.post("/space", (c) =>
    call(c, async () => {
      const a = mustSignIn(c);
      const b = await body(c, z.object({ tenant: z.string().max(64).nullable(), edition: z.enum(EDITIONS as [Edition, ...Edition[]]).optional() }));
      if (!b) throw new IdentityError("Choose a space.");
      if (b.tenant === null) {
        setSpace(c, null);
        return { space: null };
      }
      const m = await svc(c).spaceOf(a.sub, b.edition ?? currentEdition(), b.tenant);
      if (!m) throw new IdentityError("You don't belong to that space.", 403);
      setSpace(c, m);
      return { space: m };
    }),
  );
  /**
   * "Keep my things across devices" for this space: the signed-in member (their key), or the
   * administrator (ADMIN_TOKEN, who becomes a member with the administrator role), joins this space
   * to their account. Join links that end in a membership come with IDN-40.
   */
  r.post("/spaces/link", (c) =>
    call(c, async () => {
      const a = mustSignIn(c);
      const tenant = deps.tenant();
      const member = (await deps.signedInMember(c)) ?? ((await deps.isAdmin(c)) ? await deps.memberFor(c, { name: (await svc(c).me(a.sub)).account.display_name ?? "Administrator", roles: ["administrator"] }) : null);
      if (!member) throw new IdentityError("Sign in as a member of this space first (your member key or the administrator token).", 403);
      const info = await deps.spaceInfo(c.env, tenant);
      const edition = currentEdition();
      const m: Membership = await svc(c).addMembership(a.sub, { edition, tenant_id: tenant, space_name: info.name, kind: edition === "all" ? info.kind : edition, roles: member.roles, member_id: member.id });
      setSpace(c, m);
      return { space: m };
    }),
  );
  /** Start a space (SPC-8): its administrator is the person; it opens at once. */
  r.post("/spaces/start", (c) =>
    call(c, async () => {
      const a = mustSignIn(c);
      if (a.lvl < 2) throw new IdentityError("Add a passkey or Google first: a recovery code is only for getting back in.", 403);
      const b = await body(c, z.object({ kind: z.enum(["family", "business", "community"]), name: z.string().trim().min(2, "Give it a name.").max(80) }));
      if (!b) throw new IdentityError("Say what it is and give it a name.");
      // A space lives in its kind's edition, whichever address it was started on (SUR-14).
      const edition: Edition = b.kind;
      if (!(await svc(c).mayStartSpace(a.sub))) throw new IdentityError("You've started enough spaces for today. Try again tomorrow.", 429);
      const person = (await svc(c).me(a.sub)).account.display_name ?? "Administrator";
      const s = await withEdition(edition, () => deps.startSpace(c, { kind: b.kind, name: b.name, person }));
      const m = await svc(c).addMembership(a.sub, { edition, tenant_id: s.tenant_id, space_name: s.name, kind: s.kind, roles: s.roles, member_id: s.member_id }, { created: true });
      setSpace(c, m);
      return { space: m };
    }),
  );
  /** Join with a code or link (IDN-40): a membership at once, or a request the administrator answers. */
  r.post("/spaces/join", (c) =>
    call(c, async () => {
      const a = mustSignIn(c);
      await limit(c, "join");
      const b = await body(c, z.object({ code: z.string().trim().min(1).max(400) }));
      const token = b?.code.match(/yaxb_join_[A-Za-z0-9_-]+/)?.[0];
      if (!token) throw new IdentityError("That isn't a join link or code. Paste the whole link you were sent.");
      const person = (await svc(c).me(a.sub)).account.display_name ?? "A member";
      const j = await deps.joinSpace(c, token, person);
      const edition = j.edition;
      if (j.accepted) {
        const r = await withEdition(edition, () => deps.collectJoin(c, j.request_id, j.claim));
        if (r.status !== "collected") throw new IdentityError("That join code couldn't be used. Ask for a new one.", 409);
        const m = await svc(c).addMembership(a.sub, { edition, tenant_id: j.tenant_id, space_name: j.space_name, kind: j.kind, roles: r.roles, member_id: r.member_id });
        setSpace(c, m);
        return { space: m, pending: false };
      }
      await svc(c).addPendingJoin(a.sub, { edition, tenant_id: j.tenant_id, space_name: j.space_name, kind: j.kind, request_id: j.request_id, claim: j.claim });
      return { space: null, pending: true, space_name: j.space_name };
    }),
  );
  // ---- signing in on a kiosk by scanning (IDN-19) ----
  /** The kiosk asks for a code to show as a QR code: nothing is typed on the kiosk. */
  r.post("/handoff/start", (c) =>
    call(c, async () => {
      await limit(c, "handoff");
      if (c.get("account")) throw new IdentityError("Someone is signed in here already.", 409);
      const s = await svc(c).deviceStart({ client: "handoff", name: "A kiosk" });
      const page = `${new URL(c.req.url).origin}/kiosk?prefs=account&device=`;
      return { ...s, verification_uri: page, verification_uri_complete: `${page}${encodeURIComponent(s.user_code)}` };
    }),
  );
  /** The kiosk waits for the phone; once approved it is signed in for a short while. */
  r.post("/handoff/token", (c) =>
    call(c, async () => {
      if (!(await deps.polled(c, `handoff-poll:${deps.ip(c)}`))) throw new IdentityError("Too many tries. Please wait a minute.", 429);
      const b = await body(c, z.object({ device_code: z.string().max(100) }));
      if (!b) throw new IdentityError("Which code?");
      const out = await svc(c).handoffPoll(b.device_code, device(c));
      if (out.status !== "approved") return out;
      setSession(c, out.session);
      return { status: "approved", account: out.account };
    }),
  );

  // ---- a business's own sign-in (IDN-15) ----
  const ORG_COOKIE = "anj_org";
  const orgCallback = (c: Context) => `${new URL(c.req.url).origin}/api/identity/org/callback`;
  r.get("/space-oidc", (c) =>
    call(c, async () => {
      await mustAdminister(c);
      return { oidc: await svc(c).spaceOidc(currentEdition(), deps.tenant()), redirect_uri: orgCallback(c) };
    }),
  );
  r.put("/space-oidc", (c) =>
    call(c, async () => {
      await mustAdminister(c);
      const b = await body(c, z.object({ issuer: z.string().max(300), client_id: z.string().max(200), client_secret: z.string().max(500).optional(), label: z.string().max(40), default_role: z.string().max(32) }));
      if (!b) throw new IdentityError("Check the provider's details.");
      return { oidc: await svc(c).setSpaceOidc(currentEdition(), deps.tenant(), b, c.get("account")?.sub ?? null) };
    }),
  );
  r.delete("/space-oidc", (c) =>
    call(c, async () => {
      await mustAdminister(c);
      return { removed: await svc(c).removeSpaceOidc(currentEdition(), deps.tenant(), c.get("account")?.sub ?? null) };
    }),
  );
  /** Find a business by its short name: whether it has its own sign-in. */
  r.get("/org/find", (c) =>
    call(c, async () => {
      await limit(c, "org-find");
      const space = await deps.findSpace(c, (c.req.query("name") ?? "").trim().toLowerCase());
      const oidc = space ? await svc(c).spaceOidc(space.edition, space.tenant_id) : null;
      if (!space || !oidc) throw new IdentityError("No business with its own sign-in has that short name.", 404);
      return { space: `${space.edition}:${space.tenant_id}`, name: space.name, label: oidc.label };
    }),
  );
  /** Go to the business's provider. Pressing the button under the notice is the consent (IDN-52). */
  r.get("/org/start", async (c) => {
    const back = backTo(c.req.query("return"));
    try {
      await limit(c, "org");
      const named = spaceCookie(c, c.req.query("space") ?? "");
      if (!named || !(c.req.query("space") ?? "").includes(":")) throw new IdentityError("Which business?");
      const p = await svc(c).spaceOidcProvider(named.edition, named.tenant, orgCallback(c));
      if (!p) throw new IdentityError("That business has no sign-in of its own.", 404);
      const { url, pending } = await oidcStart(p);
      const keep = { ...pending, edition: named.edition, tenant: named.tenant, back, consent: c.req.query("consent") === "1" };
      setCookie(c, ORG_COOKIE, await seal(settings(c.env).IDENTITY_SECRET!, JSON.stringify(keep)), { httpOnly: true, secure: !local(c), sameSite: "Lax", path: "/api/identity/org", maxAge: 600 });
      return c.redirect(url, 302);
    } catch (e) {
      return c.redirect(`${back}${back.includes("?") ? "&" : "?"}signin=${encodeURIComponent(e instanceof IdentityError ? e.message : "Your company's sign-in isn't available right now.")}`, 302);
    }
  });
  r.get("/org/callback", async (c) => {
    const sealed = getCookie(c, ORG_COOKIE);
    setCookie(c, ORG_COOKIE, "", { path: "/api/identity/org", maxAge: 0 });
    let back = "/kiosk";
    try {
      if (!sealed) throw new IdentityError("That sign-in took too long. Try again.", 410);
      const kept = JSON.parse(await unseal(settings(c.env).IDENTITY_SECRET!, sealed)) as OidcPending & { edition: Edition; tenant: string; back: string; consent: boolean };
      back = kept.back;
      const p = await svc(c).spaceOidcProvider(kept.edition, kept.tenant, orgCallback(c));
      if (!p) throw new IdentityError("That business has no sign-in of its own.", 404);
      const who = await oidcFinish(p, new URL(c.req.url), kept);
      const out = await svc(c).oidcSignIn({ provider: p.id, label: p.label, requireEmail: false, subject: who.subject, email: who.email, emailVerified: who.emailVerified, consent: kept.consent, name: who.name ?? undefined, device: device(c) ?? undefined });
      if ("consent_required" in out) throw new IdentityError("Read the notice and press Sign in with your company again.", 428);
      if (!("session" in out)) throw new IdentityError("Sign in again.", 401);
      setSession(c, out.session);
      // The business vouched for them: they are its staff, with the role it gives new staff.
      let m = await svc(c).spaceOf(out.account.id, kept.edition, kept.tenant);
      if (!m) {
        const staff = await deps.joinAsStaff(c, kept.edition, kept.tenant, { name: who.name ?? out.account.display_name ?? "Staff", role: p.defaultRole });
        m = await svc(c).addMembership(out.account.id, { edition: kept.edition, tenant_id: kept.tenant, space_name: staff.space_name, kind: staff.kind, roles: staff.roles, member_id: staff.member_id });
      }
      setSpace(c, m);
      return c.redirect(back.includes("?") ? `${back}&signedin=1` : `${back}?signedin=1`, 302);
    } catch (e) {
      const why = e instanceof IdentityError ? e.message : "Your company's sign-in didn't work. Try again.";
      return c.redirect(`${back}${back.includes("?") ? "&" : "?"}signin=${encodeURIComponent(why)}`, 302);
    }
  });

  // ---- the native app signs in through the system browser (IDN-43) ----
  // The app opens the approval page in the system browser (never an embedded web view), the person
  // signs in there and approves, and the app polls for its own tokens, kept on the device and sent
  // as a bearer token. Refreshing rotates the refresh token as on the web.
  r.post("/app/start", (c) =>
    call(c, async () => {
      await limit(c, "app");
      const b = await body(c, z.object({ name: z.string().max(60).optional() }));
      const s = await svc(c).deviceStart({ client: "app", name: b?.name ?? "Anjal on a phone" });
      const page = `${new URL(c.req.url).origin}/kiosk?prefs=account&back=app&device=`;
      return { ...s, verification_uri: page, verification_uri_complete: `${page}${encodeURIComponent(s.user_code)}` };
    }),
  );
  const tokensOf = (s: SignedIn["session"]) => ({ access: s.access, refresh: s.refresh, access_expires_at: s.access_expires_at, expires_at: s.expires_at });
  r.post("/app/token", (c) =>
    call(c, async () => {
      if (!(await deps.polled(c, `app-poll:${deps.ip(c)}`))) throw new IdentityError("Too many tries. Please wait a minute.", 429);
      const b = await body(c, z.object({ device_code: z.string().max(100) }));
      if (!b) throw new IdentityError("Which code?");
      const out = await svc(c).appPoll(b.device_code, device(c));
      return out.status === "approved" ? { status: "approved", account: out.account, tokens: tokensOf(out.session) } : out;
    }),
  );
  r.post("/app/refresh", (c) =>
    call(c, async () => {
      const b = await body(c, z.object({ refresh: z.string().max(200) }));
      if (!b) throw new IdentityError("Sign in again.", 401);
      return { tokens: tokensOf((await svc(c).refresh(b.refresh)).session) };
    }),
  );
  r.post("/app/signout", (c) =>
    call(c, async () => {
      const a = c.get("account");
      if (a) await svc(c).signOut(a.sub, { session: a.sid });
      return { signedOut: true };
    }),
  );

  // ---- the box's offline check (IDN-42) ----
  /** A box token for the person's box, for a week: the box verifies it offline. */
  r.post("/box/token", (c) =>
    call(c, async () => {
      const a = mustSignIn(c);
      return svc(c).boxToken(a.sub, a.sid, a.lvl);
    }),
  );
  /** The box (its own credential, scope "box") fetches its owner's keys and revocations. */
  r.get("/box/trust", (c) =>
    call(c, async () => {
      const d = c.get("device");
      if (!d?.scopes.includes("box")) throw new IdentityError("Only a box signed in to the site reads this.", 403);
      return svc(c).boxTrust(d.account_id);
    }),
  );

  // ---- devices signed in with a code (IDN-17, 18, 41) ----
  /** A device asks for a code (public: it isn't signed in yet). */
  r.post("/device/start", (c) =>
    call(c, async () => {
      await limit(c, "device");
      const b = await body(c, z.object({ client: z.string().max(10), name: z.string().max(60).optional() }));
      if (!b) throw new IdentityError("Say what kind of device this is.");
      const s = await svc(c).deviceStart(b);
      const page = `${new URL(c.req.url).origin}/kiosk?prefs=account&device=`;
      return { ...s, verification_uri: `${page}`, verification_uri_complete: `${page}${encodeURIComponent(s.user_code)}` };
    }),
  );
  /** The device waits for the person: polled every few seconds. */
  r.post("/device/token", (c) =>
    call(c, async () => {
      if (!(await deps.polled(c, `device-poll:${deps.ip(c)}`))) throw new IdentityError("Too many tries. Please wait a minute.", 429);
      const b = await body(c, z.object({ device_code: z.string().max(100) }));
      if (!b) throw new IdentityError("Which device?");
      return svc(c).devicePoll(b.device_code);
    }),
  );
  /** What a typed code asks for, before approving it. */
  r.get("/device/request", (c) => call(c, async () => (mustSignIn(c), svc(c).deviceRequest(c.req.query("code") ?? ""))));
  r.post("/device/approve", (c) =>
    call(c, async () => {
      const a = mustSignIn(c);
      await limit(c, "device-approve");
      const b = await body(c, z.object({ code: z.string().max(20), approve: z.boolean() }));
      if (!b) throw new IdentityError("Type the code the device shows.");
      return svc(c).deviceApprove(a.sub, a.lvl, b.code, b.approve);
    }),
  );
  r.get("/devices", (c) => call(c, async () => ({ devices: await svc(c).deviceCredentials(mustSignIn(c).sub), here: c.get("device")?.id ?? null })));
  /** A device signs itself out (yaxb logout). */
  r.delete("/devices/self", (c) =>
    call(c, async () => {
      const d = c.get("device");
      if (!d) throw new IdentityError("This isn't a device signed in with a code.", 400);
      return svc(c).revokeDeviceCredential(d.account_id, d.id);
    }),
  );
  /** Sign one device out for good (a lost phone): only that one. */
  r.delete("/devices/:id", (c) => call(c, async () => svc(c).revokeDeviceCredential(mustSignIn(c).sub, c.req.param("id"))));

  // ---- a device kept for one space (SPC-5) ----
  const mustAdminister = async (c: Context<AppEnv>) => {
    if (!(await deps.spaceAdministrator(c))) throw new IdentityError("Only this space's administrator can do that.", 403);
  };
  /** Keep this device for the space it is in now: its administrator only. */
  r.post("/device-lock", (c) =>
    call(c, async () => {
      if (c.get("lock")) throw new IdentityError("This device is already kept for a space.", 409);
      await mustAdminister(c);
      const b = await body(c, z.object({ label: z.string().max(60).optional() }));
      const tenant = deps.tenant();
      const info = await deps.spaceInfo(c.env, tenant);
      const { lock, token } = await svc(c).lockDevice({ edition: currentEdition(), tenant_id: tenant, space_name: info.name, label: b?.label, by: c.get("account")?.sub ?? null });
      setLock(c, token);
      return { locked: { space_name: lock.space_name, label: lock.label, edition: lock.edition, created_at: lock.created_at } };
    }),
  );
  /** Release this device: its space's administrator only. */
  r.delete("/device-lock", (c) =>
    call(c, async () => {
      const lock = c.get("lock");
      if (!lock) {
        setLock(c, null);
        return { locked: null };
      }
      await mustAdminister(c);
      await svc(c).unlockDevice(lock.id, { edition: lock.edition, tenant_id: lock.tenant_id }, c.get("account")?.sub ?? null);
      lockChecks.clear();
      setLock(c, null);
      return { locked: null };
    }),
  );
  /** The space's kept devices, for its administrator; any of them may be released from here. */
  r.get("/device-locks", (c) =>
    call(c, async () => {
      await mustAdminister(c);
      return { devices: await svc(c).deviceLocks(currentEdition(), deps.tenant()), here: c.get("lock")?.id ?? null };
    }),
  );
  r.delete("/device-locks/:id", (c) =>
    call(c, async () => {
      await mustAdminister(c);
      const done = await svc(c).unlockDevice(c.req.param("id"), { edition: currentEdition(), tenant_id: deps.tenant() }, c.get("account")?.sub ?? null);
      lockChecks.clear();
      if (c.get("lock")?.id === done.id) setLock(c, null);
      return { released: done.id };
    }),
  );

  // ---- a space's sign-in rules (IDN-34): its administrator only ----
  r.get("/space-policy", (c) =>
    call(c, async () => {
      await mustAdminister(c);
      return { policy: await svc(c).spacePolicy(currentEdition(), deps.tenant()), methods: POLICY_METHODS, hours: SESSION_HOURS };
    }),
  );
  r.put("/space-policy", (c) =>
    call(c, async () => {
      await mustAdminister(c);
      const b = await body(c, z.object({ methods: z.array(z.string().max(20)).max(5), staff_passkeys: z.boolean(), session_hours: z.number().int() }));
      if (!b) throw new IdentityError("Check the rules.");
      // Never shut out the administrator making the change: their own sign-in must still open it.
      const claims = c.get("account");
      const mine = c.get("space");
      if (claims && mine) {
        const verdict = policyAllows({ ...b, methods: b.methods as never }, claims, mine);
        if (!verdict.ok) throw new IdentityError(`That would sign you out of this space: ${verdict.message}`, 409);
      }
      const p = await svc(c).setSpacePolicy(currentEdition(), deps.tenant(), b, claims?.sub ?? null);
      policies.delete(`${p.edition}|${p.tenant_id}`);
      return { policy: p };
    }),
  );

  /** Leave a space: `/spaces/<edition>:<tenant>` (a plain tenant is this request's edition). */
  r.delete("/spaces/:space", (c) =>
    call(c, async () => {
      const raw = c.req.param("space");
      const named = raw.includes(":") ? spaceCookie(c, raw) : { edition: currentEdition(), tenant: raw };
      if (!named) throw new IdentityError("Choose a space.");
      const ok = await svc(c).removeMembership(mustSignIn(c).sub, named.edition, named.tenant);
      const open = spaceCookie(c);
      if (open && open.edition === named.edition && open.tenant === named.tenant) setSpace(c, null);
      return { removed: ok };
    }),
  );

  return r;
}

export type { TokenClaims };
