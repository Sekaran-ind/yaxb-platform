// Accounts and spaces on the Worker (docs/specs/15-identity.md step 1; SPC-1..4, 6, 7, 10).
//
// Session (IDN-50, DOM-2): `anj_at` is the short ES256 access token, `anj_rt` the rotating refresh
// token (sent only to /api/identity). On anjalai.cc both are scoped to `.anjalai.cc`, so one sign-in
// works on every edition; elsewhere they are host-only. HttpOnly, Secure (except on localhost), Lax.
// Passkeys use the relying party `anjalai.cc` there (DOM-3) and `localhost` locally; other addresses
// (workers.dev, yaxb.ai) offer no passkeys (DOM-5).
//
// The open space (SPC-7) is `anj_space`, host-only, naming a tenant of this edition. Every request
// checks it against the account's memberships before the tenant context uses it; a membership linked
// to a member record makes that member signed in (the account stands in for their key), so the
// person switches spaces without signing in again (SPC-4).
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
  seal,
  unseal,
  type Edition,
  type IdentityService,
  type Membership,
  type OidcPending,
  type RelyingParty,
  type SignedIn,
  type SpaceKind,
  type TokenClaims,
} from "@sekaran-ind/yaxb-core/identity";
import { settings, type Bindings } from "./env";
import type { AppEnv } from "./index";

export const ACCESS_COOKIE = "anj_at";
export const REFRESH_COOKIE = "anj_rt";
export const SPACE_COOKIE = "anj_space";
const OIDC_COOKIE = "anj_oidc";
const SHARED_DOMAIN = "anjalai.cc";
const EDITION_ORIGINS = ["", "family.", "business.", "community."].map((s) => `https://${s}${SHARED_DOMAIN}`);

const hostOf = (c: Context) => new URL(c.req.url).hostname;
const onShared = (c: Context) => hostOf(c) === SHARED_DOMAIN || hostOf(c).endsWith(`.${SHARED_DOMAIN}`);
const local = (c: Context) => hostOf(c) === "localhost" || hostOf(c) === "127.0.0.1";

/** Passkeys' relying party for this address (DOM-3, DOM-5), or null where none is offered. */
export function relyingParty(c: Context): RelyingParty | null {
  if (onShared(c)) return { id: SHARED_DOMAIN, name: "Anjal", origins: EDITION_ORIGINS };
  if (hostOf(c) === "localhost") return { id: "localhost", name: "Anjal (local)", origins: [new URL(c.req.url).origin] };
  return null;
}

/** This Worker's edition: its surface, or "all" for the combined site. */
export const editionOf = (env: Bindings): Edition => settings(env).SURFACE ?? "all";

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
function setSpace(c: Context, tenant: string | null) {
  setCookie(c, SPACE_COOKIE, tenant ?? "", { httpOnly: true, secure: !local(c), sameSite: "Lax", path: "/", maxAge: tenant ? 365 * 86400 : 0 });
}

// ---- every request: who is signed in, and in which space (SPC-7) ----------------------------------------

/**
 * Reads the account session and the open space, and checks the membership. Sets `account` and
 * `space` for the routes and the tenant context. A space the account doesn't belong to is ignored.
 */
export async function accountContext(c: Context<AppEnv>, next: Next) {
  const svc = identity(c);
  const token = getCookie(c, ACCESS_COOKIE);
  if (svc && token) {
    const claims = await svc.verify(token).catch(() => null);
    if (claims) {
      c.set("account", claims);
      const tenant = getCookie(c, SPACE_COOKIE);
      if (tenant) {
        const m = await svc.spaceOf(claims.sub, editionOf(c.env), tenant).catch(() => null);
        if (m) c.set("space", m);
      }
    }
  }
  await next();
}

// ---- routes ---------------------------------------------------------------------------------------------

type Deps = {
  sameOrigin: (c: Context<AppEnv>) => boolean;
  limited: (c: Context<AppEnv>, key: string) => Promise<boolean>;
  ip: (c: Context<AppEnv>) => string;
  /** The space's name and kind on this edition (its tenant). */
  spaceInfo: (env: Bindings, tenant: string) => Promise<{ name: string; kind: SpaceKind }>;
  /** Make (or find) the member record that a membership stands for, in that tenant. */
  memberFor: (c: Context<AppEnv>, input: { name: string; roles: string[] }) => Promise<{ id: string; roles: string[] }>;
  /** The signed-in member (their key) and whether the administrator token is signed in, for linking. */
  signedInMember: (c: Context<AppEnv>) => Promise<{ id: string; roles: string[] } | null>;
  isAdmin: (c: Context<AppEnv>) => Promise<boolean>;
  /** The tenant this request acts in (the tenant context). */
  tenant: () => string;
  /** Start a space on this edition (SPC-8): a new tenant, with the person as its administrator. */
  startSpace: (c: Context<AppEnv>, input: { kind: SpaceKind; name: string; person: string }) => Promise<{ tenant_id: string; name: string; kind: SpaceKind; member_id: string; roles: string[] }>;
  /** Use a join code (IDN-40): accepted at once (a new space's first administrator), or waiting for the administrator. */
  joinSpace: (c: Context<AppEnv>, token: string, person: string) => Promise<{ tenant_id: string; space_name: string; kind: SpaceKind; request_id: string; claim: string; accepted: boolean }>;
  /** Where a waiting join stands; accepted ones are collected into a member. */
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
    await next();
  });

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
    return { account: s.account, memberships: s.memberships.filter((m) => editionOf(c.env) === "all" || m.edition === editionOf(c.env)) };
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
      edition: editionOf(c.env),
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
    const edition = editionOf(c.env);
    for (const p of await svc(c).pendingJoins(accountId, edition)) {
      if (p.edition !== edition) continue;
      const r = await deps.collectJoin(c, p.request_id, p.claim).catch(() => ({ status: "pending" as const }));
      if (r.status === "collected") {
        await svc(c).addMembership(accountId, { edition, tenant_id: p.tenant_id, space_name: p.space_name, kind: p.kind, roles: r.roles, member_id: r.member_id });
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
      const edition = editionOf(c.env);
      const waiting = (await svc(c).pendingJoins(account.sub, edition)).map((p) => ({ space_name: p.space_name, kind: p.kind }));
      const spaces = me.memberships.filter((m) => edition === "all" || m.edition === edition);
      const tenant = getCookie(c, SPACE_COOKIE);
      return c.json({ signedIn: true, level: account.lvl, account: me.account, methods: me.methods, spaces, space: spaces.find((m) => m.tenant_id === tenant) ?? null, waiting, edition });
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
  /** Open a space (or none): only one the account belongs to on this edition. */
  r.post("/space", (c) =>
    call(c, async () => {
      const a = mustSignIn(c);
      const b = await body(c, z.object({ tenant: z.string().max(64).nullable() }));
      if (!b) throw new IdentityError("Choose a space.");
      if (b.tenant === null) {
        setSpace(c, null);
        return { space: null };
      }
      const m = await svc(c).spaceOf(a.sub, editionOf(c.env), b.tenant);
      if (!m) throw new IdentityError("You don't belong to that space here.", 403);
      setSpace(c, m.tenant_id);
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
      const edition = editionOf(c.env);
      const m: Membership = await svc(c).addMembership(a.sub, { edition, tenant_id: tenant, space_name: info.name, kind: edition === "all" ? info.kind : edition, roles: member.roles, member_id: member.id });
      setSpace(c, m.tenant_id);
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
      const edition = editionOf(c.env);
      if (edition !== "all" && b.kind !== edition) throw new IdentityError(`A ${b.kind} is started on its own site: ${b.kind}.anjalai.cc.`, 409);
      if (!(await svc(c).mayStartSpace(a.sub))) throw new IdentityError("You've started enough spaces for today. Try again tomorrow.", 429);
      const person = (await svc(c).me(a.sub)).account.display_name ?? "Administrator";
      const s = await deps.startSpace(c, { kind: b.kind, name: b.name, person });
      const m = await svc(c).addMembership(a.sub, { edition, tenant_id: s.tenant_id, space_name: s.name, kind: s.kind, roles: s.roles, member_id: s.member_id }, { created: true });
      setSpace(c, m.tenant_id);
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
      const edition = editionOf(c.env);
      if (j.accepted) {
        const r = await deps.collectJoin(c, j.request_id, j.claim);
        if (r.status !== "collected") throw new IdentityError("That join code couldn't be used. Ask for a new one.", 409);
        const m = await svc(c).addMembership(a.sub, { edition, tenant_id: j.tenant_id, space_name: j.space_name, kind: j.kind, roles: r.roles, member_id: r.member_id });
        setSpace(c, m.tenant_id);
        return { space: m, pending: false };
      }
      await svc(c).addPendingJoin(a.sub, { edition, tenant_id: j.tenant_id, space_name: j.space_name, kind: j.kind, request_id: j.request_id, claim: j.claim });
      return { space: null, pending: true, space_name: j.space_name };
    }),
  );
  r.delete("/spaces/:tenant", (c) =>
    call(c, async () => {
      const ok = await svc(c).removeMembership(mustSignIn(c).sub, editionOf(c.env), c.req.param("tenant"));
      if (getCookie(c, SPACE_COOKIE) === c.req.param("tenant")) setSpace(c, null);
      return { removed: ok };
    }),
  );

  return r;
}

export type { TokenClaims };
