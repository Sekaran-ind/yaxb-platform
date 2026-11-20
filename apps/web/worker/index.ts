// The YAXB web Worker: the API under /api (Hono) and the Vue app's static assets for everything
// else, served with strict security headers. The agent runs here (yaxb-core); provider keys never
// leave the Worker.
import { toSSEStream } from "@sekaran-ind/yaxb-core/events";
import { feedbackSchema } from "@sekaran-ind/yaxb-core/feedback";
import { dohResolver, fetchSite, PageError, siteGuard, siteRulesFromEnv } from "@sekaran-ind/yaxb-core/web/pages";
import { chatRequestSchema, extractRequestSchema } from "@sekaran-ind/yaxb-core/schemas";
import { createMemoryRateLimiter } from "@sekaran-ind/yaxb-core/stores";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { settings, stringEnv, type Bindings } from "./env";
import { connectorSecrets } from "./kiosk";
import { callConnector, connectorSecrets as connectorSecretNames, ConnectorError, parseConnector } from "@sekaran-ind/yaxb-core/connectors";
import { seal as sealIdentity, unseal as unsealIdentity } from "@sekaran-ind/yaxb-core/identity";
import { SITE_USES, SiteError, type SiteUse } from "@sekaran-ind/yaxb-core/sites";
import { sites } from "./kiosk";
import { cases, catalogue, currentTenant, designer, kiosk, library, moderators, relay, reviews, serviceEvents, tenantContext, tenantOfMember, tenants } from "./kiosk";
import { DEFAULT_TENANT, SLUG, TenantError } from "@sekaran-ind/yaxb-core/tenants";
import { offers, resolveContext, servesApi, SURFACE_HEADS } from "@sekaran-ind/yaxb-core/context";
import { currentEdition, editionContext, editionFor, EDITIONS, firstEdition, withEdition, type Edition } from "./edition";
import { eventBatchSchema } from "@sekaran-ind/yaxb-core/metrics";
import { FAMILY_ROUTINES, isDue, parseRoutine, ROUTINE_STARTERS, routineLimits, runsFromEvents, localClock } from "@sekaran-ind/yaxb-core/routines";
import { decideApproval, dryRun, fireEvents, routineContext, routineStore, runOnce, sampleEvent, signingKey, sweep } from "./routines";
import { beaconSchema, CaseError, envelopeSchema, MAX_CASE_RUN, MAX_ENVELOPE, mayReassign, RELAY_MAX_HOURS, staffingOf, type Envelope } from "@sekaran-ind/yaxb-core/cases";
import { DesignerError, historyOf, LESSONS_IN_MEMORY, MAX_NARRATIVE } from "@sekaran-ind/yaxb-core/designer";
import { ADMIN_ACTOR_ID, LibraryError, MAX_ENTRY_BYTES, permissionsOf, writesRoutines, type LibraryActor } from "@sekaran-ind/yaxb-core/library";
import { proposalEntry, ReviewError, type Reviewer } from "@sekaran-ind/yaxb-core/reviews";
import { auditEvent, hashKey, looksLikeKey, machineMayCall, MODERATOR_ROLES, statusOf, TeamRuleError, verifyAuditChain, type Moderator } from "@sekaran-ind/yaxb-core/moderators";
import { AVAILABILITY, hubName, memberStatus, roomName, teamMember } from "@sekaran-ind/yaxb-core/team";
import { HUB_HEADERS } from "./team";

export { TeamHub } from "./team";
import { clientId, fromApp, isAdmin, MODERATOR_COOKIE, moderatorCookie, moderatorOf, safeEqual, sessionId, setAdminCookie, setModeratorCookie } from "./session";
import { getCookie } from "hono/cookie";
import { accountContext, identityRoutes } from "./identity";
import { IdentityError, type DeviceCredentialView, type DeviceLockView, type Membership, type TokenClaims } from "@sekaran-ind/yaxb-core/identity";

export type AppEnv = {
  Bindings: Bindings;
  /** `account` and `space`: the signed-in account and its open space, checked on this request (identity.ts). */
  Variables: { reviewer: Reviewer; account?: TokenClaims; space?: Membership; lock?: DeviceLockView; machine?: Moderator; device?: DeviceCredentialView; spaceRefused?: { space_name: string; why: string; message: string } };
};

const MAX_CHAT_BODY = 4_500_000;
const MAX_FORM_BODY = 64_000;

const contactSchema = z.strictObject({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.email("Please enter a valid email").max(254),
  message: z.string().trim().min(1, "Please enter a message").max(5000),
  organisation: z.string().trim().max(160).optional().default(""),
  // Honeypot: real users never fill this hidden field.
  company: z.string().max(0).optional().default(""),
});
const newsletterSchema = z.strictObject({ email: z.email("Please enter a valid email").max(254) });
const signInSchema = z.strictObject({ token: z.string().min(1).max(256) });
const flagSchema = z.strictObject({ question: z.string().trim().min(1).max(1000), reason: z.string().trim().min(1).max(500) });

const app = new Hono<AppEnv>();

// ---- helpers -------------------------------------------------------------------------------------

const jsonError = (c: Context<AppEnv>, status: number, message: string) => {
  c.header("Cache-Control", "no-store");
  return c.json({ error: message }, status as 400);
};

/**
 * CSRF defence for state-changing routes: the request must come from our own origin, or from the
 * native app (PLT-14), which carries no cookies (its session is a header), so it can't be forged
 * from another site.
 */
function sameOrigin(c: Context<AppEnv>): boolean {
  // A machine's key or a device's credential is a bearer token another site's page can't send
  // (browsers never add it), so no CSRF.
  if (c.get("machine") || c.get("device")) return true;
  const origin = c.req.header("origin");
  if (!origin) return false;
  if (fromApp(c)) return true;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

const ip = (c: Context<AppEnv>) => c.req.header("cf-connecting-ip") ?? "local";

// Used only when the Rate Limiting bindings are absent.
const fallbacks = { chat: createMemoryRateLimiter({ limit: 20 }), form: createMemoryRateLimiter({ limit: 5 }) };
async function withinLimit(kind: keyof typeof fallbacks, limiter: RateLimit | undefined, key: string) {
  if (limiter) return (await limiter.limit({ key: `${kind}:${key}` })).success;
  return fallbacks[kind].limit(`${kind}:${key}`);
}

/** Read a JSON body up to a size; null when it's missing, too large or not JSON. */
async function readJson(c: Context<AppEnv>, max: number): Promise<{ body: unknown; tooLarge: boolean }> {
  if (Number(c.req.header("content-length") ?? 0) > max) return { body: null, tooLarge: true };
  const raw = await c.req.text().catch(() => "");
  if (raw.length > max) return { body: null, tooLarge: true };
  try {
    return { body: JSON.parse(raw), tooLarge: false };
  } catch {
    return { body: null, tooLarge: false };
  }
}

// ---- API ------------------------------------------------------------------------------------------

// The signed-in account and its open space (15-identity.md, SPC-7), checked before the edition and the tenant are chosen.
app.use("/api/*", accountContext);

/**
 * The edition this request acts in (SUR-14): the open space's, else the address's, else the
 * SURFACE setting, else the combined site. It chooses the database (edition.ts) and what is served.
 */
app.use("/api/*", (c, next) => editionContext.run(editionFor({ space: c.get("lock")?.edition ?? c.get("space")?.edition, host: new URL(c.req.url).hostname, fallback: settings(c.env).SURFACE }), () => next()));

/**
 * Routes for features the edition doesn't offer answer 404 (SUR-4, yaxb-core context). Joining is
 * looked up in whichever edition issued the link (joinEdition), so it isn't gated by the address.
 */
const JOINING = /^\/api\/(join|join-requests)(\/|$)/;
app.use("/api/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (!JOINING.test(path) && !servesApi(resolveContext({ surface: currentEdition() }), path)) return jsonError(c, 404, "Not found.");
  await next();
});

/**
 * The business a request acts for (TEN-2): the account's open space (SPC-7, its membership checked);
 * else a signed-in member's own; otherwise `?tenant=<short name>` for reading a business's published
 * services from the directory; otherwise the default. Every service below is scoped to it (kiosk.ts
 * tenantContext).
 */
app.use("/api/*", async (c, next) => {
  // A machine (IDN-16): `Authorization: Bearer yaxb_mod_…`. It acts in its own tenant, never signs in,
  // and may call only what its scopes allow.
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
  // A device's credential (anj_dev_…) and the native app's access token are checked with the
  // account (identity.ts), not here: only member keys are machines.
  if (bearer && looksLikeKey(bearer)) {
    const machine = looksLikeKey(bearer) ? await moderators(c.env).machine(bearer) : null;
    if (!machine) return jsonError(c, 401, "That machine key isn't right, or it has been revoked or has expired.");
    const tenant = machine.tenant ?? DEFAULT_TENANT;
    if (!machineMayCall(machine.scopes ?? [], c.req.method, new URL(c.req.url).pathname)) {
      await tenantContext.run(tenant, () => moderators(c.env, tenant).store.audit(auditEvent({ actor_type: "system", actor_id: machine.id, actor_name: machine.name, action: "machine.refused", target_id: machine.id, details: { method: c.req.method } })));
      return jsonError(c, 403, "This machine key may not do that.");
    }
    c.set("machine", machine);
    return tenantContext.run(tenant, () => next());
  }
  let tenant = DEFAULT_TENANT;
  const cookie = getCookie(c, MODERATOR_COOKIE) ?? "";
  const id = cookie.slice(0, Math.max(cookie.indexOf("."), 0));
  const space = c.get("space");
  const lock = c.get("lock");
  // A device kept for one space acts only there (SPC-5, SPC-7).
  if (lock) tenant = lock.tenant_id;
  else if (space) tenant = space.tenant_id;
  else if (/^[0-9a-f-]{36}$/.test(id)) tenant = (await tenantOfMember(c.env, id)) ?? DEFAULT_TENANT;
  else {
    const asked = c.req.query("tenant");
    if (asked && SLUG.test(asked) && c.req.method === "GET") tenant = (await tenants(c.env).tenant(asked))?.id ?? DEFAULT_TENANT;
  }
  return tenantContext.run(tenant, () => next());
});

app.use("/api/*", async (c, next) => {
  // CORS for the native app's origins only (PLT-14); no credentials: its session is a header.
  const app = fromApp(c);
  if (app && c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": c.req.header("origin")!,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Yaxb-Session, X-Yaxb-Device, X-Yaxb-Space",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      },
    });
  }
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  if (app) {
    c.header("Access-Control-Allow-Origin", c.req.header("origin")!);
    c.header("Vary", "Origin");
  }
});

/** One kiosk turn, streamed as Server-Sent Events. */
app.post("/api/agent/chat", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const id = await clientId(c);
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, id))) return jsonError(c, 429, "Too many questions in a short time. Please wait a minute.");
  // A turn may carry the visitor's notebook (up to about 2 MB of text) and conversation.
  const { body, tooLarge } = await readJson(c, MAX_CHAT_BODY);
  if (tooLarge) return jsonError(c, 413, "That notebook is too large to send. Remove a source and try again.");
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid request.");

  const { threadId, message, provider, model, temperature, settings: agentSettings, client } = parsed.data;
  const events = kiosk(c.env).ask(
    { threadId: `${id}:${threadId}`, message, selection: { provider, model, temperature }, settings: agentSettings, client },
    { signal: c.req.raw.signal },
  );
  return new Response(toSSEStream(events), {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
});

/**
 * Escalation for questions answered on the visitor's device (Settings → Knowledge → On this
 * device): not covered, red-flag topics and possible emergencies reach the moderators as they
 * would from the agent. Same origin, session and rate limit as a chat turn.
 */
app.post("/api/agent/flag", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const id = await clientId(c);
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, id))) return jsonError(c, 429, "Too many questions in a short time. Please wait a minute.");
  const parsed = flagSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, "Invalid request.");
  const item = await kiosk(c.env).flag(parsed.data.question, parsed.data.reason);
  return c.json({ ok: true, ticket: item.id.slice(0, 8) });
});

/**
 * Kiosk only (no AI model), KNW-45: web results for a question the device couldn't answer, which
 * the browser quotes as found. Same origin, session and rate limit as a chat turn; never for a
 * possible emergency (the core returns nothing).
 */
const searchSchema = z.strictObject({ question: z.string().trim().min(1).max(1000) });
app.post("/api/agent/search", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const id = await clientId(c);
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, id))) return jsonError(c, 429, "Too many questions in a short time. Please wait a minute.");
  const parsed = searchSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, "Invalid request.");
  try {
    return c.json({ results: await kiosk(c.env).searchWeb(parsed.data.question, { signal: c.req.raw.signal }) });
  } catch (e) {
    console.error(JSON.stringify({ msg: "web search failure", error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 160)}` : "unknown" }));
    return jsonError(c, 502, "The web search couldn't be reached.");
  }
});

/**
 * Slot filling's model pass: the AI model reads what the visitor said into the fields of a journey
 * step (looked up by the core, never sent by the client), with a schema-constrained answer.
 */
app.post("/api/agent/extract", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const id = await clientId(c);
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, id))) return jsonError(c, 429, "Too many requests in a short time. Please wait a minute.");
  const parsed = extractRequestSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid request.");
  const { journey, step, text, provider, model } = parsed.data;
  const out = await kiosk(c.env).extract({ journey, step, text, selection: { provider, model, temperature: 0 } }, { signal: c.req.raw.signal });
  if ("error" in out) return jsonError(c, 422, out.error);
  return c.json(out);
});

/** Session feedback (FBK): a rating and an optional comment, nothing identifying. Same origin, session and form rate limit. */
app.post("/api/feedback", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const id = await clientId(c);
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `feedback:${id}`))) return jsonError(c, 429, "Too many requests. Please try again later.");
  const parsed = feedbackSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, "Invalid feedback.");
  await kiosk(c.env).addFeedback(parsed.data);
  return c.json({ ok: true });
});

/**
 * Websites as notebook sources (KNW-20..24, SEC-4): fetch a page (and up to 5 pages it links to on
 * the same site) and return its readable text. Nothing is stored here: the browser adds it to the
 * visitor's notebook. No private or local addresses, every redirect checked, 2 MB and 10 s caps.
 */
const webSourceSchema = z.strictObject({ url: z.string().trim().min(1).max(2000), follow: z.number().int().min(0).max(5).default(0) });
app.post("/api/sources/web", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const id = await clientId(c);
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `web-source:${id}`))) return jsonError(c, 429, "Too many websites in a short time. Please wait a minute.");
  const parsed = webSourceSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, "Enter a web address.");
  try {
    // Family DNS (blocks malware, phishing, adult sites), the organisation's allow/block lists, and Safe Browsing if configured.
    // The approved list (SIT-1..6): refused when enforced; otherwise added, flagged, and asked for.
    const verdict = await siteHere(c, parsed.data.url, "source");
    if (!verdict.allowed && settings(c.env).SITES_ENFORCE === "on") return c.json({ error: `${verdict.why} Ask for it to be added.`, ask: true }, 403);
    const site = await fetchSite(parsed.data.url, parsed.data.follow, { resolve: dohResolver(), check: siteGuard(siteRulesFromEnv(stringEnv(c.env))) });
    // A site this business switched off itself is never asked for again on its behalf.
    if (!verdict.allowed && !verdict.switchedOff) await askForSite(c, parsed.data.url, "source", "Added to a notebook").catch(() => undefined);
    return c.json({ pages: site.pages.map(({ url, title, text, fetchedAt }) => ({ url, title, text, fetchedAt })), skipped: site.skipped, unapproved: !verdict.allowed });
  } catch (e) {
    if (e instanceof PageError) return jsonError(c, 422, e.message);
    console.error(JSON.stringify({ msg: "web source failure", error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 120)}` : "unknown" }));
    return jsonError(c, 502, "That page couldn't be loaded.");
  }
});

// ---- approved sites (SIT-1..6) ---------------------------------------------------------------------------

/** Where this request stands for the approved list: its edition, its business (none for a family) and region. */
const siteScope = (c: Context<AppEnv>) => {
  const edition = currentEdition();
  const family = edition === "family" || c.get("space")?.kind === "family";
  return { edition, tenant: family ? null : currentTenant(), family, region: "IN" };
};
const siteHere = (c: Context<AppEnv>, url: string, use: SiteUse) => sites(c.env).verdict(url, use, siteScope(c));
/** Ask for a site: in the business's name, or "a family"; the asker kept only so they can't approve it. */
async function askForSite(c: Context<AppEnv>, url: string, use: SiteUse, reason?: string) {
  const scope = siteScope(c);
  const label = scope.family ? "a family" : ((await tenants(c.env).tenant(currentTenant()).catch(() => null))?.name ?? (currentTenant() === DEFAULT_TENANT ? "this kiosk's business" : "a business"));
  const askedBy = c.get("account")?.sub ?? `session:${await clientId(c)}`;
  return sites(c.env).request({ url, use, reason, askedByLabel: label, askedBy, edition: scope.edition, tenant: scope.tenant });
}
/** The platform's moderators: the portal's administrator, or its members who moderate. */
async function platformModerator(c: Context<AppEnv>): Promise<{ id: string; name: string } | null> {
  if (currentEdition() !== "all") return null;
  if (await isAdmin(c)) return { id: "admin", name: "Platform administrator" };
  const m = await memberOf(c);
  return m && (m.roles.includes("moderator") || m.roles.includes("administrator")) ? { id: c.get("account")?.sub ?? m.id, name: m.name } : null;
}
const siteCall = async (c: Context<AppEnv>, fn: () => Promise<unknown>) => {
  try {
    return c.json(await fn());
  } catch (e) {
    if (e instanceof SiteError) return jsonError(c, e.status, e.message);
    throw e;
  }
};
const siteUseSchema = z.enum(SITE_USES);
/** "Ask to add this site" (anyone; same origin; a form's limit). */
app.post("/api/sites/requests", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `site-ask:${await clientId(c)}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  const b = z.object({ url: z.string().max(500), use: siteUseSchema, reason: z.string().max(300).optional() }).safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!b.success) return jsonError(c, 422, "Give the site's address and what it is for.");
  return siteCall(c, async () => {
    const r = await askForSite(c, b.data.url, b.data.use, b.data.reason);
    return { asked: true, merged: r.merged };
  });
});
/** The lists: the platform's, this business's own, and (for the platform's moderators) the open requests. */
app.get("/api/sites", async (c) =>
  siteCall(c, async () => {
    const scope = siteScope(c);
    const lists = await sites(c.env).list({ tenant: scope.tenant, edition: scope.tenant ? scope.edition : null });
    const mod = await platformModerator(c);
    const admin = await administrator(c);
    return { ...lists, requests: mod ? await sites(c.env).openRequests() : [], moderator: Boolean(mod), administrator: Boolean(admin && scope.tenant), enforce: settings(c.env).SITES_ENFORCE === "on" };
  }),
);
app.post("/api/sites/requests/:id/:decision{approve|reject}", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const mod = await platformModerator(c);
  if (!mod) return jsonError(c, 403, "Only the platform's moderators decide on sites.");
  const body = ((await readJson(c, MAX_FORM_BODY)).body ?? {}) as { region?: string; category?: string; uses?: unknown; paths?: unknown; note?: string };
  return siteCall(c, () => (c.req.param("decision") === "approve" ? sites(c.env).approve(c.req.param("id"), mod, body) : sites(c.env).reject(c.req.param("id"), mod, body.note)));
});
/** A business's own list, and switching a platform site off for it (its administrator). */
app.post("/api/sites/own", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const admin = await administrator(c);
  const scope = siteScope(c);
  if (!admin || !scope.tenant) return jsonError(c, 403, "A business's administrator keeps its own list.");
  const body = ((await readJson(c, MAX_FORM_BODY)).body ?? {}) as { url?: string; uses?: unknown; paths?: unknown; category?: string; off?: boolean };
  return siteCall(c, () =>
    body.off ? sites(c.env).switchOff(String(body.url ?? ""), { edition: scope.edition, tenant: scope.tenant! }, admin) : sites(c.env).addOwn({ url: String(body.url ?? ""), uses: body.uses, paths: body.paths, category: body.category, edition: scope.edition, tenant: scope.tenant! }, admin),
  );
});
app.post("/api/sites/:id/status", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const status = ((await readJson(c, MAX_FORM_BODY)).body as { status?: string } | null)?.status;
  if (status !== "active" && status !== "paused" && status !== "revoked") return jsonError(c, 422, "Choose active, paused or revoked.");
  const mod = await platformModerator(c);
  const admin = await administrator(c);
  const scope = siteScope(c);
  return siteCall(c, async () => {
    // The platform's moderators change the platform's entries; a business's administrator its own.
    if (mod) {
      try {
        return await sites(c.env).setStatus(c.req.param("id"), status, mod, { tenant: null, edition: null });
      } catch (e) {
        if (!(e instanceof SiteError) || !admin) throw e;
      }
    }
    if (!admin || !scope.tenant) throw new SiteError("You can't change that site.", 403);
    return sites(c.env).setStatus(c.req.param("id"), status, admin, { tenant: scope.tenant, edition: scope.edition });
  });
});

// Read-only kiosk resources. `moderation` holds visitors' escalated questions: moderators only.
app.get("/api/agent/:resource", async (c) => {
  sessionId(c); // issue the session cookie on the kiosk's first call
  const k = kiosk(c.env);
  switch (c.req.param("resource")) {
    case "providers":
      return c.json(k.providers());
    case "capabilities": {
      // Where cases may be kept here (LIB-42..48): central storage only on the paid plan.
      const s = settings(c.env);
      return c.json({ ...k.capabilities(), cases: { central: s.CASES_CENTRAL === "on", relay: s.CASES_RELAY === "on", relayHours: s.RELAY_HOURS } });
    }
    case "sources":
      return c.json({ sources: k.sources() });
    case "curated":
      return c.json({ items: k.curated().slice(0, 10) });
    case "feedback":
      if (!(await moderatorOf(c, moderators(c.env)))) return jsonError(c, 401, "Moderator sign-in required.");
      return c.json(await k.feedbackSummary());
    case "moderation":
      if (!(await moderatorOf(c, moderators(c.env)))) return jsonError(c, 401, "Moderator sign-in required.");
      return c.json({
        items: await k.moderation(100, {
          ...(c.req.query("state") === "open" || c.req.query("state") === "handled" ? { state: c.req.query("state") as "open" | "handled" } : {}),
          ...(c.req.query("reason") ? { reason: c.req.query("reason")!.slice(0, 500) } : {}),
        }),
      });
    default:
      return jsonError(c, 404, "Not found");
  }
});

// ---- moderators (MOD-20..25) -------------------------------------------------------------------------

/** Who is signed in as a moderator (name and roles; no key). */
app.get("/api/moderator", async (c) => {
  const who = await moderatorOf(c, moderators(c.env));
  return c.json({ moderator: Boolean(who), ...(who ? { name: who.name, roles: who.roles, shared: who.shared } : {}), enabled: true });
});

/** Sign in with a person's member key (the shared MODERATOR_TOKEN is retired, IDN-44). */
app.post("/api/moderator", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `moderator:${ip(c)}`))) return jsonError(c, 429, "Too many attempts. Please wait a minute.");
  const parsed = signInSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 401, "That key isn't right.");
  const token = parsed.data.token.trim();
  if (looksLikeKey(token)) {
    // A key may belong to any business: find the member's tenant first, then sign in within it (TEN-2).
    const found = await moderators(c.env).store.byKeyHash(await hashKey(token));
    const tenant = found?.tenant ?? currentTenant();
    return tenantContext.run(tenant, async () => {
      const svc = moderators(c.env, tenant);
      const m = await svc.signIn(token);
      if (!m) {
        const why = await svc.keyKind(token);
        if (why === "machine") return jsonError(c, 401, "That is a machine's key: it calls the API, it doesn't sign in.");
        if (why === "linked") return jsonError(c, 401, "You sign in with your account now: Preferences → Account.");
        return jsonError(c, 401, "That key isn't right, or it has been revoked or has expired.");
      }
      setModeratorCookie(c, await moderatorCookie(c, m, await svc.store.keyHashOf(m.id)));
      return c.json({ moderator: true, name: m.name, roles: m.roles });
    });
  }
  return jsonError(c, 401, "That key isn't right, or it has been revoked or has expired.");
});

/** The signed-in moderator's profile and their own activity (MOD-24). */
app.get("/api/moderator/me", async (c) => {
  const svc = moderators(c.env);
  const who = await moderatorOf(c, svc);
  if (!who) return jsonError(c, 401, "Moderator sign-in required.");
  if (!who.moderator) return c.json({ moderator: { id: who.id, name: who.name, roles: who.roles, shared: true }, profile: null, activity: [] });
  const m = who.moderator;
  return c.json({
    moderator: { id: m.id, name: m.name, label: m.label, roles: m.roles, status: statusOf(m), key_prefix: m.key_prefix, created_at: m.created_at, expires_at: m.expires_at, last_seen_at: m.last_seen_at, reviews: m.reviews, shared: false },
    profile: await svc.profile(m),
    activity: await svc.store.auditLog({ actorId: m.id, limit: 50 }),
  });
});

app.put("/api/moderator/me", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const svc = moderators(c.env);
  const who = await moderatorOf(c, svc);
  if (!who) return jsonError(c, 401, "Moderator sign-in required.");
  if (!who.moderator) return jsonError(c, 409, "Sign in with your own moderator key to have a profile.");
  try {
    return c.json({ profile: await svc.saveProfile(who.moderator, (await readJson(c, MAX_FORM_BODY)).body) });
  } catch (e) {
    return jsonError(c, 422, (e as { issues?: { message: string }[] }).issues?.[0]?.message ?? "Check the profile.");
  }
});

// ---- the administrator (MOD-20..23, MOD-25) -----------------------------------------------------------

/** The administrator: the ADMIN_TOKEN holder, or a member with the administrator role (TEAM-1). */
async function administrator(c: Context<AppEnv>): Promise<{ name: string } | null> {
  if (await isAdmin(c)) return { name: "Administrator" };
  const m = await memberOf(c);
  return m?.roles.includes("administrator") ? { name: m.name } : null;
}

app.get("/api/admin", async (c) => {
  const who = await administrator(c);
  return c.json({ admin: Boolean(who), name: who?.name ?? null, enabled: Boolean(settings(c.env).ADMIN_TOKEN) });
});

app.post("/api/admin", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `admin:${ip(c)}`))) return jsonError(c, 429, "Too many attempts. Please wait a minute.");
  const { ADMIN_TOKEN } = settings(c.env);
  if (!ADMIN_TOKEN) return jsonError(c, 503, "Administration is not enabled on this site (ADMIN_TOKEN is not set).");
  const parsed = signInSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success || !safeEqual(parsed.data.token.trim(), ADMIN_TOKEN)) return jsonError(c, 401, "That administrator token isn't right.");
  await setAdminCookie(c, true);
  await moderators(c.env).store.audit(auditEvent({ actor_type: "admin", actor_id: null, actor_name: "Administrator", action: "admin.signed_in", target_id: null }));
  return c.json({ admin: true });
});

app.delete("/api/admin", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  await setAdminCookie(c, false);
  return c.json({ admin: false });
});

// ---- the directory, businesses and join links (TEN-1..8) --------------------------------------------------

const tenantError = (c: Context<AppEnv>, e: unknown) => {
  if (e instanceof TenantError) return jsonError(c, e.status, e.message);
  throw e;
};
const audited = (c: Context<AppEnv>, action: Parameters<typeof auditEvent>[0]["action"], name: string | null, target: string | null, details?: Record<string, unknown>) =>
  moderators(c.env).store.audit(auditEvent({ actor_type: "moderator", actor_id: null, actor_name: name, action, target_id: target, ...(details ? { details } : {}) }));

/** The directory: the businesses on this deployment (public). */
app.get("/api/directory", async (c) => c.json({ tenants: await tenants(c.env).directory() }));

/** A new business (the deployment's administrator: the ADMIN_TOKEN holder). */
app.post("/api/tenants", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await isAdmin(c))) return jsonError(c, 401, "Only this deployment's administrator adds businesses.");
  const body = (await readJson(c, MAX_FORM_BODY)).body as { name?: string; slug?: string; kind?: "business" | "family" | "community" };
  try {
    const t = await tenants(c.env).createTenant({ name: String(body?.name ?? ""), slug: String(body?.slug ?? ""), kind: body?.kind });
    await audited(c, "tenant.created", "Administrator", t.id, { slug: t.slug });
    // A new business has nobody yet: its first administrator joins with this one-use link.
    const { token } = await tenants(c.env).issueToken(t.id, { role: "administrator", uses: 1, hours: 168, label: "First administrator", autoAccept: true }, { name: "Administrator" });
    return c.json({ tenant: t, adminLink: `${new URL(c.req.url).origin}/join/${token}` }, 201);
  } catch (e) {
    return tenantError(c, e);
  }
});

/** The business this request acts for, and whether the caller administers it. */
app.get("/api/tenant", async (c) => {
  const t = await tenants(c.env).tenant(currentTenant());
  const who = await administrator(c);
  return c.json({ tenant: t ? { id: t.id, slug: t.slug, name: t.name, kind: t.kind } : null, administrator: Boolean(who) });
});

/** Join links and requests: the business's administrator only. */
app.use("/api/tenant/*", async (c, next) => {
  if (c.req.method !== "GET" && !sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await administrator(c))) return jsonError(c, 401, "Administrator sign-in required.");
  await next();
});
app.get("/api/tenant/join-links", async (c) => c.json({ links: await tenants(c.env).tokens(currentTenant()) }));
app.post("/api/tenant/join-links", async (c) => {
  const who = await administrator(c);
  const body = (await readJson(c, MAX_FORM_BODY)).body as { role?: string; hours?: number; uses?: number; label?: string };
  try {
    const { token, joinToken } = await tenants(c.env).issueToken(currentTenant(), { role: String(body?.role ?? ""), hours: Number(body?.hours) || undefined, uses: Number(body?.uses) || undefined, label: body?.label }, { name: who?.name ?? null });
    await audited(c, "join.link_issued", who?.name ?? null, joinToken.id, { role: joinToken.role, uses: joinToken.uses_left });
    // The token is shown once, in the link to share; only its hash is kept.
    return c.json({ link: `${new URL(c.req.url).origin}/join/${token}`, token, joinLink: joinToken }, 201);
  } catch (e) {
    return tenantError(c, e);
  }
});
app.delete("/api/tenant/join-links/:id", async (c) => {
  const who = await administrator(c);
  try {
    await tenants(c.env).revokeToken(currentTenant(), c.req.param("id"));
    await audited(c, "join.link_withdrawn", who?.name ?? null, c.req.param("id"));
    return c.json({ ok: true });
  } catch (e) {
    return tenantError(c, e);
  }
});
app.get("/api/tenant/join-requests", async (c) => c.json({ requests: await tenants(c.env).requests(currentTenant()) }));
app.post("/api/tenant/join-requests/:id/decide", async (c) => {
  const who = await administrator(c);
  const body = (await readJson(c, MAX_FORM_BODY)).body as { decision?: string; role?: string };
  const decision = body?.decision === "accept" ? "accept" : body?.decision === "decline" ? "decline" : null;
  if (!decision) return jsonError(c, 422, "Accept or decline.");
  try {
    const r = await tenants(c.env).decide(currentTenant(), c.req.param("id"), decision, { role: body?.role }, { name: who?.name ?? null });
    await audited(c, decision === "accept" ? "join.accepted" : "join.declined", who?.name ?? null, r.id, { role: r.role });
    return c.json({ request: r });
  } catch (e) {
    return tenantError(c, e);
  }
});

/**
 * Join links and requests live in the edition that issued them; one address serves every edition, so
 * they are looked up in this request's edition first, then the others that offer joining. "Not
 * found" in one edition means "try the next"; any other refusal is the answer.
 */
function joinEdition<T>(find: () => Promise<T>) {
  const here = currentEdition();
  const order = [here, ...EDITIONS.filter((e) => e !== here)].filter((e) => offers(resolveContext({ surface: e }), "join"));
  if (!order.length) throw new TenantError("That join link isn't valid.", 404);
  return firstEdition(order, find, (e) => e instanceof TenantError && e.status === 404);
}

/**
 * Joining (public, rate limited): what a link offers, asking to join, where a request stands, and
 * collecting the member key once accepted. The claim code comes in a header, never the address.
 */
app.get("/api/join/:token", async (c) => {
  // Not rate limited: reading what a link offers changes nothing, and links can't be guessed (192 bits).
  try {
    return c.json((await joinEdition(() => tenants(c.env).preview(c.req.param("token")))).value);
  } catch (e) {
    return tenantError(c, e);
  }
});
app.post("/api/join/:token", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `join:${ip(c)}`))) return jsonError(c, 429, "Too many attempts. Please wait a minute.");
  const body = (await readJson(c, MAX_FORM_BODY)).body as { name?: string };
  try {
    const { request, claim } = (await joinEdition(() => tenants(c.env).redeem(c.req.param("token"), { name: String(body?.name ?? "") }))).value;
    return c.json({ request: { id: request.id, status: request.status, role: request.role }, claim }, 201);
  } catch (e) {
    return tenantError(c, e);
  }
});
app.get("/api/join-requests/:id", async (c) => {
  try {
    return c.json((await joinEdition(() => tenants(c.env).status(c.req.param("id"), c.req.header("x-yaxb-claim") ?? ""))).value);
  } catch (e) {
    return tenantError(c, e);
  }
});
app.post("/api/join-requests/:id/collect", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `join:${ip(c)}`))) return jsonError(c, 429, "Too many attempts. Please wait a minute.");
  try {
    const { edition, value } = await joinEdition(() => tenants(c.env).collect(c.req.param("id"), c.req.header("x-yaxb-claim") ?? ""));
    await withEdition(edition, async () => {
      const t = await tenantOfMember(c.env, value.memberId);
      if (t) await tenantContext.run(t, () => audited(c, "join.collected", null, value.memberId));
    });
    return c.json({ key: value.key });
  } catch (e) {
    return tenantError(c, e);
  }
});

/** Every admin route below: same origin for changes, and the administrator's cookie. */
app.use("/api/admin/*", async (c, next) => {
  // A machine with audit:read reads the chain's head (the box's daily check); nothing else here.
  if (c.get("machine")) return new URL(c.req.url).pathname === "/api/admin/audit/chain" && c.req.method === "GET" ? next() : jsonError(c, 403, "Forbidden");
  if (c.req.method !== "GET" && !sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await administrator(c))) return jsonError(c, 401, "Administrator sign-in required.");
  await next();
});

app.get("/api/admin/moderators", async (c) => {
  const list = await moderators(c.env).store.list();
  return c.json({ moderators: list.map((m) => ({ ...m, status: statusOf(m) })) });
});

/** Roles a member is given must exist: built in, the organisation's, or a published service's (LIB-10). */
async function unknownRole(c: Context<AppEnv>, body: unknown): Promise<string | null> {
  const roles = (body as { roles?: unknown } | null)?.roles;
  if (!Array.isArray(roles)) return null;
  // Built in, the organisation's, and those published services define.
  const known = new Set<string>([...MODERATOR_ROLES, ...(await library(c.env).published([], { all: true })).roles.map((r) => r.id)]);
  const bad = roles.find((r) => typeof r !== "string" || !known.has(r));
  return bad === undefined ? null : `There is no role '${String(bad)}'. Add it in the Service catalogue, Roles, first.`;
}

/** Issue a key. The key is in this response only. */
app.post("/api/admin/moderators", async (c) => {
  try {
    const body = (await readJson(c, MAX_FORM_BODY)).body;
    const bad = await unknownRole(c, body);
    if (bad) return jsonError(c, 422, bad);
    const { moderator, key } = await moderators(c.env).issue(body as never, { name: "Administrator" });
    return c.json({ moderator: { ...moderator, status: statusOf(moderator) }, key });
  } catch (e) {
    return jsonError(c, 422, (e as { issues?: { message: string }[] }).issues?.[0]?.message ?? "Check the details.");
  }
});

app.patch("/api/admin/moderators/:id", async (c) => {
  try {
    const body = (await readJson(c, MAX_FORM_BODY)).body;
    const bad = await unknownRole(c, body);
    if (bad) return jsonError(c, 422, bad);
    const m = await moderators(c.env).change(c.req.param("id"), body);
    return m ? c.json({ moderator: { ...m, status: statusOf(m) } }) : jsonError(c, 404, "No such moderator.");
  } catch (e) {
    if (e instanceof TeamRuleError) return jsonError(c, 409, e.message);
    return jsonError(c, 422, (e as { issues?: { message: string }[] }).issues?.[0]?.message ?? "Check the details.");
  }
});

/** Remove a member (TEAM-2): their key stops working and their profile goes; the audit log keeps the history. */
app.delete("/api/admin/moderators/:id", async (c) => {
  try {
    const ok = await moderators(c.env).remove(c.req.param("id"), (await administrator(c)) ?? { name: null });
    return ok ? c.json({ removed: true }) : jsonError(c, 404, "No such moderator.");
  } catch (e) {
    if (e instanceof TeamRuleError) return jsonError(c, 409, e.message);
    throw e;
  }
});

app.post("/api/admin/moderators/:id/revoke", async (c) => {
  let m;
  try {
    m = await moderators(c.env).revoke(c.req.param("id"));
  } catch (e) {
    if (e instanceof TeamRuleError) return jsonError(c, 409, e.message);
    throw e;
  }
  return m ? c.json({ moderator: { ...m, status: statusOf(m) } }) : jsonError(c, 404, "No such moderator.");
});

/** A new key for the same moderator; the old one stops working. The key is in this response only. */
app.post("/api/admin/moderators/:id/rotate", async (c) => {
  const r = await moderators(c.env).rotate(c.req.param("id"));
  return r ? c.json({ moderator: { ...r.moderator, status: statusOf(r.moderator) }, key: r.key }) : jsonError(c, 404, "No such moderator.");
});

app.get("/api/admin/audit", async (c) => {
  const before = c.req.query("before");
  const store = moderators(c.env).store;
  const events = await store.auditLog({ limit: 50, ...(before && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before) ? { before } : {}) });
  // Reading the audit log is itself audited (AUD-3): who, and how many records.
  const who = await administrator(c);
  await store.audit(auditEvent({ actor_type: "admin", actor_id: null, actor_name: who?.name ?? "Administrator", action: "audit.viewed", target_id: null, details: { scope: "all", count: events.length } }));
  return c.json({ events });
});

/**
 * The audit chain (AUD-2): its head (newest hash and count), for the box to compare daily, and a
 * check of the newest records. Returns hashes and counts only.
 */
app.get("/api/admin/audit/chain", async (c) => {
  const store = moderators(c.env).store;
  const [head, check] = await Promise.all([store.auditHead(), store.auditChain(5000).then(verifyAuditChain)]);
  return c.json({ head, check });
});

// ---- answer reviews and quality (MOD-4, MOD-10..13, MOD-30..34) ------------------------------------

/**
 * A visitor (or a moderator trying the kiosk) sends an answer for review: the question, the answer
 * and the notebook it was asked in. The cited sources are read from the answer by the core. Only
 * when someone presses the button: answers never reach the server's review queue otherwise.
 */
app.post("/api/agent/review", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const id = await clientId(c);
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `review:${id}`))) return jsonError(c, 429, "Too many requests. Please try again later.");
  const who = await moderatorOf(c, moderators(c.env));
  try {
    const a = await reviews(c.env).submit((await readJson(c, MAX_FORM_BODY)).body, who ? "moderator" : "visitor");
    return c.json({ ok: true, id: a.id, ticket: a.id.slice(0, 8) });
  } catch {
    return jsonError(c, 422, "That answer couldn't be sent for review.");
  }
});

/** Every review route below: a signed-in moderator, and same origin for changes. */
app.use("/api/reviews/*", async (c, next) => {
  if (c.req.method !== "GET" && !sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const who = await moderatorOf(c, moderators(c.env));
  if (!who) return jsonError(c, 401, "Moderator sign-in required.");
  c.set("reviewer", { id: who.id, name: who.moderator ? who.name : "Shared moderator token", moderator: who.moderator });
  await next();
});

app.get("/api/reviews/answers", async (c) => {
  const state = c.req.query("state");
  const notebook = c.req.query("notebook");
  const items = await reviews(c.env).store.listAnswers({
    ...(state === "open" || state === "reviewed" ? { state } : {}),
    ...(notebook && /^[A-Za-z0-9_-]{1,64}$/.test(notebook) ? { notebook } : {}),
    limit: 100,
  });
  return c.json({ items });
});

/** One answer with its review history, and the titles of curated sources it cites. */
app.get("/api/reviews/answers/:id", async (c) => {
  const d = await reviews(c.env).detail(c.req.param("id"));
  if (!d) return jsonError(c, 404, "No such answer.");
  const curated = Object.fromEntries(kiosk(c.env).curated().map((q) => [`curated:${q.id}`, q.question]));
  return c.json({ ...d, titles: Object.fromEntries(d.answer.refs.filter((r) => curated[r.id]).map((r) => [r.id, curated[r.id]])) });
});

app.post("/api/reviews/answers/:id", async (c) => {
  try {
    const r = await reviews(c.env).review(c.req.param("id"), (await readJson(c, MAX_FORM_BODY)).body, c.get("reviewer"));
    return r ? c.json({ review: r }) : jsonError(c, 404, "No such answer.");
  } catch (e) {
    if (e instanceof ReviewError) return jsonError(c, 422, e.message);
    return jsonError(c, 422, (e as { issues?: { message: string }[] }).issues?.[0]?.message ?? "Check the review.");
  }
});

/** The F1 dashboard (MOD-33): every notebook's scores, optionally over the last N weeks. */
app.get("/api/reviews/scores", async (c) => {
  const weeks = Number(c.req.query("weeks") ?? 0);
  const since = Number.isInteger(weeks) && weeks > 0 && weeks <= 104 ? new Date(Date.now() - weeks * 7 * 864e5).toISOString() : undefined;
  return c.json(await reviews(c.env).scores({ since }));
});

/** Proposed knowledge-base entries (MOD-12), as entries for content/curated_qa.json. */
app.get("/api/reviews/proposals", async (c) => {
  const items = await reviews(c.env).store.proposals(50);
  const next = nextCuratedId(kiosk(c.env).curated().map((q) => q.id));
  return c.json({ items: items.map((p, i) => ({ answer_id: p.answer.id, notebook: p.answer.notebook, entry: proposalEntry(p.review, next(i)) })) });
});

/** Mark an escalated question handled, with a note (MOD-4). */
const handleSchema = z.strictObject({ note: z.string().trim().min(1, "Add a note.").max(1000) });
app.post("/api/reviews/moderation/:id/handle", async (c) => {
  const parsed = handleSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Add a note.");
  const who = c.get("reviewer");
  const item = await kiosk(c.env).handle(c.req.param("id"), parsed.data.note, who.name);
  if (!item) return jsonError(c, 404, "No such question.");
  await moderators(c.env).store.audit(auditEvent({ actor_type: "moderator", actor_id: who.moderator?.id ?? null, actor_name: who.name, action: "moderation.handled", target_id: item.id, details: { reason: item.reason } }));
  return c.json({ item });
});

/** "qa-123" ids after the highest number in use, for proposals. */
function nextCuratedId(ids: string[]) {
  const top = Math.max(0, ...ids.map((id) => Number(id.match(/(\d+)$/)?.[1] ?? 0)));
  return (i: number) => `qa-${String(top + 1 + i).padStart(3, "0")}`;
}


// ---- the Service Catalogue (LIB-1..20) ---------------------------------------------------------------

/**
 * Who acts on the catalogue: the ADMIN_TOKEN holder, a signed-in member with their roles, or a
 * guest (anyone else), known by their session, who may design services and change only their own.
 */
async function libraryActor(c: Context<AppEnv>): Promise<LibraryActor> {
  if (await isAdmin(c)) return { id: ADMIN_ACTOR_ID, name: "Administrator", roles: ["administrator"], admin: true };
  const who = await moderatorOf(c, moderators(c.env));
  if (who) return { id: who.id, name: who.name, roles: who.roles, admin: false };
  return { id: `guest:${await clientId(c)}`, name: "Guest", roles: [], admin: false, guest: true };
}

/** Run a catalogue action, turning its refusals into JSON errors. Guests' creating and submitting are rate limited. */
async function libraryCall(c: Context<AppEnv>, fn: (a: LibraryActor, body: unknown) => Promise<unknown>, { limited = false } = {}) {
  await catalogue(c.env);
  const actor = await libraryActor(c);
  if (limited && actor.guest && !(await withinLimit("form", c.env.FORM_LIMITER, `catalogue:${actor.id}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  const body = c.req.method === "GET" || c.req.method === "DELETE" ? null : (await readJson(c, MAX_ENTRY_BYTES * 2 + 4096)).body;
  try {
    return c.json((await fn(actor, body)) ?? { ok: true });
  } catch (e) {
    if (e instanceof LibraryError || e instanceof DesignerError) return jsonError(c, e.status, e.message);
    throw e;
  }
}

/**
 * The published catalogue (LIB-8, LIB-18): every accepted service of an active library, with its
 * roles and journeys, and which journeys this viewer may start. Kiosks load services from it.
 */
app.get("/api/library/published", async (c) => {
  const actor = await libraryActor(c);
  const out = await (await catalogue(c.env)).published(actor.roles, { all: actor.admin });
  // Whether the team has someone for each role (LIB-37), so a kiosk loading a service can say
  // which of its journeys would wait with nobody to act. Yes, invited or no; never who, or how many.
  const members = (await moderators(c.env).store.list()).map((m) => ({ roles: m.roles, status: memberStatus(m) }));
  return c.json({ ...out, staffing: staffingOf(out.roles.map((r) => r.id), members), viewer: { roles: actor.roles, member: !actor.guest, admin: actor.admin, ...(actor.guest ? {} : { id: actor.id, name: actor.name }) } });
});

// ---- cases: journeys handed between people (LIB-33..38) ----------------------------------------------

/**
 * Run a case action as the catalogue's actor (a member with their roles, the administrator, or a
 * visitor by their session). Changes are same origin; starting one is rate limited like a form.
 */
async function caseCall(c: Context<AppEnv>, fn: (a: LibraryActor & { level: number }, body: unknown) => Promise<unknown>, { limited = false } = {}) {
  if (c.req.method !== "GET" && !sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  // Central storage of cases is the paid plan; otherwise they live on devices and the box.
  if (settings(c.env).CASES_CENTRAL !== "on") return jsonError(c, 402, "Keeping requests in the cloud is part of the paid plan. This kiosk keeps them on its devices and box.");
  // How sure the server is of who this is (IDN-30): the account session's level; 0 without one.
  const actor = { ...(await libraryActor(c)), level: c.get("account")?.lvl ?? 0 };
  // Starting a case is limited like a form. A visitor opens cases by reference, so every call of
  // theirs counts too (like chat: a visit takes a few), and references (30^6) can't be guessed.
  if (limited && !(await withinLimit("form", c.env.FORM_LIMITER, `case:${actor.id}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  if (actor.guest && !(await withinLimit("chat", c.env.CHAT_LIMITER, `case:${actor.id}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  const body = c.req.method === "GET" ? null : (await readJson(c, MAX_CASE_RUN + 8192)).body;
  try {
    return c.json(await fn(actor, body));
  } catch (e) {
    if (e instanceof CaseError) return jsonError(c, e.status, e.message);
    throw e;
  }
}
/** A case id, or a reference as typed ("r-7kq4mx" works too). */
const caseKey = (c: Context<AppEnv>) => {
  const k = (c.req.param("id") ?? "").trim();
  return /^r-/i.test(k) ? k.toUpperCase() : k;
};
// ---- accounts and spaces (15-identity.md step 1) ----------------------------------------------------

/** A space's name when its tenant has none (the edition's own space). */
const OWN_SPACE: Record<string, { name: string; kind: "family" | "business" | "community" }> = {
  family: { name: "Our home", kind: "family" },
  business: { name: "Our business", kind: "business" },
  community: { name: "Our community", kind: "community" },
  all: { name: "Anjal", kind: "business" },
};
app.route(
  "/api/identity",
  identityRoutes({
    sameOrigin,
    ip,
    limited: (c, key) => withinLimit("form", c.env.FORM_LIMITER, key),
    polled: (c, key) => withinLimit("chat", c.env.CHAT_LIMITER, key),
    tenant: currentTenant,
    isAdmin,
    async findSpace(_c, slug) {
      if (!SLUG.test(slug)) return null;
      for (const edition of ["business", "community", "all"] as const) {
        const t = await withEdition(edition, () => tenants(_c.env).tenant(slug)).catch(() => null);
        if (t) return { edition, tenant_id: t.id, name: t.name };
      }
      return null;
    },
    async joinAsStaff(c, edition, tenant, input) {
      return withEdition(edition, () =>
        tenantContext.run(tenant, async () => {
          const svc = moderators(c.env, tenant);
          const { moderator } = await svc.issue({ name: input.name.slice(0, 80) || "Staff", label: "Signed in with the company's sign-in", roles: [input.role] }, { name: "Company sign-in" });
          // They sign in with their company's account; the key made for the record is never used (IDN-44).
          await svc.linkToAccount(moderator.id);
          const t = await tenants(c.env).tenant(tenant);
          return { member_id: moderator.id, roles: [...moderator.roles], space_name: t?.name ?? "Our business", kind: t?.kind ?? (edition === "community" ? "community" : "business") };
        }),
      );
    },
    async spaceAdministrator(c) {
      const who = await moderatorOf(c, moderators(c.env));
      return Boolean(who?.roles.includes("administrator")) || (await isAdmin(c));
    },
    async spaceInfo(env, tenant) {
      const own = OWN_SPACE[currentEdition()]!;
      if (tenant === DEFAULT_TENANT) return own;
      const t = await tenants(env).tenant(tenant);
      return t ? { name: t.name, kind: t.kind } : own;
    },
    async signedInMember(c) {
      const who = await moderatorOf(c, moderators(c.env));
      if (!who || who.machine) return null;
      // The person now signs in with their account (IDN-44): their key stops signing in.
      await moderators(c.env).linkToAccount(who.moderator.id);
      return { id: who.moderator.id, roles: [...who.moderator.roles] };
    },
    async startSpace(c, input) {
      const base = input.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "space";
      const slug = `${base}-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36).slice(0, 5)}`;
      const t = await tenants(c.env).createTenant({ name: input.name, slug, kind: input.kind });
      const { moderator } = await moderators(c.env, t.id).issue({ name: input.person.slice(0, 80) || "Administrator", label: "Started the space", roles: ["administrator"] }, { name: input.person });
      // The person signs in with their account; the key made for the record is never shown or used (IDN-44).
      await moderators(c.env, t.id).linkToAccount(moderator.id);
      return { tenant_id: t.id, name: t.name, kind: t.kind, member_id: moderator.id, roles: [...moderator.roles] };
    },
    async joinSpace(c, token, person) {
      try {
        const { edition, value } = await joinEdition(async () => {
          const svc = tenants(c.env);
          const { request, claim } = await svc.redeem(token, { name: person });
          const t = await svc.tenant(request.tenant_id);
          const own = OWN_SPACE[currentEdition()]!;
          return { tenant_id: request.tenant_id, space_name: t?.name ?? own.name, kind: t?.kind ?? own.kind, request_id: request.id, claim, accepted: request.status === "accepted" };
        });
        return { ...value, edition };
      } catch (e) {
        if (e instanceof TenantError) throw new IdentityError(e.message, e.status);
        throw e;
      }
    },
    async collectJoin(c, requestId, claim) {
      const svc = tenants(c.env);
      try {
        const s = await svc.status(requestId, claim);
        if (s.status === "pending") return { status: "pending" };
        if (s.status === "declined") return { status: "declined" };
        if (s.status === "collected") return { status: "gone" };
        const { memberId } = await svc.collect(requestId, claim);
        // The member is made in the space's tenant; they sign in with their account from now (IDN-44).
        const tenant = (await tenantOfMember(c.env, memberId)) ?? currentTenant();
        const m = await moderators(c.env, tenant).linkToAccount(memberId);
        return { status: "collected", member_id: memberId, roles: m ? [...m.roles] : [s.role] };
      } catch {
        return { status: "gone" };
      }
    },
    async memberFor(c, input) {
      const { moderator } = await moderators(c.env).issue({ name: input.name.slice(0, 80) || "Administrator", label: "Linked to an account", roles: input.roles as never }, { name: "Administrator" });
      await moderators(c.env).linkToAccount(moderator.id);
      return { id: moderator.id, roles: [...moderator.roles] };
    },
  }),
);

app.post("/api/cases", (c) => caseCall(c, (a, body) => cases(c.env).start(a, body), { limited: true }));
app.get("/api/cases", (c) => caseCall(c, (a) => cases(c.env).list(a)));
app.get("/api/cases/:id", (c) => caseCall(c, (a) => cases(c.env).get(a, caseKey(c))));
app.post("/api/cases/:id/act", (c) => caseCall(c, (a, body) => cases(c.env).act(a, caseKey(c), body)));
app.post("/api/cases/:id/notes", (c) => caseCall(c, (a, body) => cases(c.env).note(a, caseKey(c), body)));
app.post("/api/cases/:id/finish", (c) => caseCall(c, (a, body) => cases(c.env).finish(a, caseKey(c), body)));

// ---- service storage and events (MET-1..2) --------------------------------------------------------

// ---- connectors (CNX-2..8) -----------------------------------------------------------------------------

/** A published connector of this tenant, and whether a published journey uses the operation. */
async function connectorFor(c: Context<AppEnv>, id: string) {
  const lib = await catalogue(c.env);
  const pub = await lib.published([], { all: true });
  const entry = pub.connectors.find((x) => x.id === id);
  if (!entry) return null;
  const e = await lib.store.entry(entry.entry_id);
  const parsed = e?.published_yaml ? parseConnector(e.published_yaml) : null;
  if (!parsed?.ok) return null;
  return { connector: parsed.connector, entry_id: entry.entry_id, used: (handler: string) => pub.services.some((s) => s.yaml.includes(handler)) };
}
const sealKey = (c: Context<AppEnv>) => settings(c.env).SESSION_SECRET;

/**
 * A journey's connector step (CNX-2, CNX-5): the kiosk sends the step's input; the server adds the
 * secret and calls the API through the SSRF guard. Only an operation a published journey uses can be
 * called, so this is never an open proxy. The answer comes back as untrusted data.
 */
app.post("/api/connectors/:id/:op", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `connector:${await clientId(c)}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  const found = await connectorFor(c, c.req.param("id"));
  const handler = `connector.${c.req.param("id")}.${c.req.param("op")}`;
  if (!found || !found.used(handler)) return jsonError(c, 404, "That connector isn't used by a published service here.");
  const body = (await readJson(c, MAX_FORM_BODY)).body as { input?: unknown } | null;
  const input = body?.input && typeof body.input === "object" && !Array.isArray(body.input) ? (body.input as Record<string, unknown>) : {};
  const secrets: Record<string, string> = {};
  for (const r of await connectorSecrets(c.env).list(currentTenant(), found.connector.id)) secrets[r.name] = await unsealIdentity(sealKey(c), r.sealed);
  try {
    const out = await callConnector(found.connector, c.req.param("op"), input, secrets, { resolve: dohResolver() });
    return c.json(out);
  } catch (e) {
    if (e instanceof ConnectorError) return jsonError(c, e.status, e.message);
    throw e;
  }
});

/** A connector's secrets for its administrator: names and when they were set, never the values (CNX-3). */
app.get("/api/library/connectors/:id/secrets", (c) =>
  libraryCall(c, async (a) => {
    if (!permissionsOf(a).manage) throw new LibraryError("Only an administrator sees a connector's secrets.", 403);
    const found = await connectorFor(c, c.req.param("id"));
    const needed = found ? connectorSecretNames(found.connector) : [];
    const set = await connectorSecrets(c.env).list(currentTenant(), c.req.param("id"));
    return { needed, set: set.map((r) => ({ name: r.name, set_at: r.set_at, set_by: r.set_by })) };
  }),
);
app.put("/api/library/connectors/:id/secrets/:name", (c) =>
  libraryCall(c, async (a, body) => {
    if (!permissionsOf(a).manage) throw new LibraryError("Only an administrator sets a connector's secrets.", 403);
    const value = String((body as { value?: unknown } | null)?.value ?? "");
    if (!/^[A-Z][A-Z0-9_]{1,47}$/.test(c.req.param("name"))) throw new LibraryError("A secret's name is UPPER_CASE.");
    if (!value || value.length > 4000) throw new LibraryError("Give the secret's value.");
    await connectorSecrets(c.env).put({ tenant_id: currentTenant(), connector_id: c.req.param("id"), name: c.req.param("name"), sealed: await sealIdentity(sealKey(c), value), set_at: new Date().toISOString(), set_by: a.name });
    await audited(c, "connector.secret_set", a.name, c.req.param("id"), { name: c.req.param("name") });
    return { set: true };
  }),
);
app.delete("/api/library/connectors/:id/secrets/:name", (c) =>
  libraryCall(c, async (a) => {
    if (!permissionsOf(a).manage) throw new LibraryError("Only an administrator removes a connector's secrets.", 403);
    await connectorSecrets(c.env).remove(currentTenant(), c.req.param("id"), c.req.param("name"));
    await audited(c, "connector.secret_removed", a.name, c.req.param("id"), { name: c.req.param("name") });
    return { removed: true };
  }),
);

/**
 * Where a service records what happens to its journeys: none, the box, or the server. Only an
 * administrator chooses; the server is the paid plan (CASES_CENTRAL), like central requests.
 */
app.put("/api/library/entries/:id/storage", (c) =>
  libraryCall(c, async (a, body) => {
    const storage = (body as { storage?: unknown } | null)?.storage;
    if (storage === "server" && settings(c.env).CASES_CENTRAL !== "on") throw new LibraryError("Keeping a service's records on the server is part of the paid plan. Choose the box, or none.", 402);
    return { entry: await library(c.env).setEntryStorage(a, c.req.param("id"), storage) };
  }),
);

/** Which published service an event belongs to, and where it keeps its events. */
async function serviceStorage(c: Context<AppEnv>, entryId: string) {
  const { services } = await (await catalogue(c.env)).published([], { all: true });
  return services.find((s) => s.entry_id === entryId)?.storage ?? null;
}

/**
 * Kiosks send a service's events here when it keeps them on the server (paid plan). Facts only: the
 * schema refuses anything else. Anyone at a kiosk sends them (a visitor's journey), rate limited.
 */
app.post("/api/events", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (settings(c.env).CASES_CENTRAL !== "on") return jsonError(c, 402, "Keeping records on the server is part of the paid plan.");
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `events:${await clientId(c)}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  const parsed = eventBatchSchema.safeParse((await readJson(c, 256 * 1024)).body);
  if (!parsed.success) return jsonError(c, 422, "That isn't a batch of events.");
  const services = [...new Set(parsed.data.map((e) => e.service))];
  for (const s of services) if ((await serviceStorage(c, s)) !== "server") return jsonError(c, 409, "That service doesn't keep its records on the server.");
  await serviceEvents(c.env).add(parsed.data);
  // Routines these events set off (RTN-1) run after the answer; each event runs a routine once.
  c.executionCtx.waitUntil(fireEvents(c.env, parsed.data).catch((e) => console.error(JSON.stringify({ msg: "routine events failed", error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }))));
  return c.json({ ok: true, count: parsed.data.length });
});

/** A service's events, for its dashboard and activity log: administrators, moderators and reviewers. */
app.get("/api/events", async (c) => {
  const a = await libraryActor(c);
  // A machine got here only with the events:read scope.
  if (!(c.get("machine") || a.admin || a.roles.some((r) => r === "administrator" || r === "moderator" || r === "reviewer"))) return jsonError(c, 403, "Administrators, moderators and reviewers only.");
  const service = c.req.query("service") ?? "";
  if (!service || (await serviceStorage(c, service)) !== "server") return jsonError(c, 404, "That service doesn't keep its records on the server.");
  return c.json({ items: await serviceEvents(c.env).list(service, { since: c.req.query("since") ?? undefined }) });
});

// ---- routines (RTN-1..5, 7, 13) ------------------------------------------------------------------------

/** Who may read routines and their runs: administrators, automators, moderators and reviewers. */
const readsRoutines = (a: LibraryActor) => a.admin || a.roles.some((r) => ["administrator", "automator", "moderator", "reviewer"].includes(r));
const refuse = (message: string, status = 403) => {
  throw new LibraryError(message, status);
};

/** The business's published routines (when each runs next), its settings and today's use, and the starters. */
app.get("/api/routines", (c) =>
  libraryCall(c, async (a) => {
    if (a.guest) refuse("Sign in as a member to see the routines.");
    const ctx = await routineContext(c.env);
    const store = routineStore(c.env);
    const now = new Date();
    const routines = ctx.routines.map(({ entry, routine: r }) => {
      const due = "event" in r.on ? null : isDue(r, now, now, () => null);
      return {
        entry_id: entry.id,
        id: r.id,
        title: r.title,
        summary: r.summary ?? null,
        on: r.on,
        actions: r.actions.map((x) => x.type),
        next: due && !due.due && due.next ? due.next.toISOString() : null,
      };
    });
    const [s, usage] = await Promise.all([store.settings(currentTenant()), store.usage(currentTenant(), localClock(now).date)]);
    return { routines, settings: s, usage, writer: writesRoutines(a), manage: permissionsOf(a).manage, starters: ROUTINE_STARTERS };
  }),
);

/** A routine's runs, newest first, from its events (RTN-4). */
app.get("/api/routines/:entry/runs", (c) =>
  libraryCall(c, async (a) => {
    if (!readsRoutines(a)) refuse("Administrators, automators, moderators and reviewers see a routine's runs.");
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    return { runs: runsFromEvents(await serviceEvents(c.env).list(c.req.param("entry"), { since })).slice(0, 100) };
  }),
);

/**
 * A dry run (RTN-3) of a routine's YAML, saved or not: what each action would do, with nothing
 * sent, called or recorded. An event routine gets a made-up event of the kind it waits for.
 */
app.post("/api/routines/dry-run", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `routine:${await clientId(c)}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  return libraryCall(c, async (a, body) => {
    if (!writesRoutines(a) && !readsRoutines(a)) refuse("Only members who write or review routines try them.");
    const parsed = parseRoutine(String((body as { yaml?: unknown } | null)?.yaml ?? ""));
    if (!parsed.ok) return { ok: false, problems: parsed.problems };
    const at = new Date();
    const trigger = "schedule" in parsed.routine.on ? "schedule" : "date" in parsed.routine.on ? "date" : "event";
    const run = await dryRun(c.env, await routineContext(c.env), parsed.routine, { at, trigger, event: sampleEvent(parsed.routine, at) });
    return { ok: true, run };
  });
});

/** Run a published routine now, for real (administrators), audited. */
app.post("/api/routines/:entry/run", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  return libraryCall(c, async (a) => {
    if (!permissionsOf(a).manage) refuse("Only an administrator runs a routine now.");
    const ctx = await routineContext(c.env);
    const found = ctx.routines.find((x) => x.entry.id === c.req.param("entry"));
    if (!found) refuse("There's no published routine with that id.", 404);
    const at = new Date();
    const run = await runOnce(c.env, ctx, { entry: found!.entry, routine: found!.routine, input: { at, trigger: "manual", event: sampleEvent(found!.routine, at) }, key: `manual|${crypto.randomUUID()}` });
    await audited(c, "routine.run_now", a.name, found!.entry.id, { status: run?.status ?? "claimed" });
    return { run };
  });
});

/** The switch that pauses every routine, and the daily limits (RTN-5): administrators, audited. */
app.put("/api/routines/settings", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  return libraryCall(c, async (a, body) => {
    if (!permissionsOf(a).manage) refuse("Only an administrator changes the routines' settings.");
    const b = (body ?? {}) as { paused?: unknown; limits?: unknown };
    const next = { paused: b.paused === true, limits: routineLimits(b.limits) };
    await routineStore(c.env).putSettings(currentTenant(), next);
    await audited(c, "routine.settings", a.name, null, { paused: next.paused, ...next.limits });
    return { settings: next };
  });
});

/** Notices routines left for this member's roles (My work). */
app.get("/api/routines/notices", (c) =>
  libraryCall(c, async (a) => {
    if (a.guest) return { items: [] };
    return { items: await routineStore(c.env).notices(currentTenant(), a.roles, { limit: 100 }) };
  }),
);
app.post("/api/routines/notices/:id/done", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  return libraryCall(c, async (a) => {
    if (a.guest) refuse("Sign in as a member first.");
    const mine = await routineStore(c.env).notices(currentTenant(), a.roles, { limit: 500 });
    if (!mine.some((n) => n.id === c.req.param("id"))) refuse("There's no such notice for you.", 404);
    return { done: await routineStore(c.env).doneNotice(currentTenant(), c.req.param("id"), a.name, new Date().toISOString()) };
  });
});

/** Actions routines keep for one of this member's roles to approve (RTN-6), in My work. */
app.get("/api/routines/approvals", (c) =>
  libraryCall(c, async (a) => {
    if (a.guest) return { items: [] };
    return { items: await routineStore(c.env).approvals(currentTenant(), a.roles, { limit: 100 }) };
  }),
);
app.post("/api/routines/approvals/:id", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  return libraryCall(c, async (a, body) => {
    if (a.guest) refuse("Sign in as a member first.");
    const decision = (body as { decision?: unknown } | null)?.decision;
    if (decision !== "approved" && decision !== "declined") refuse("Approve it or decline it.", 422);
    const mine = await routineStore(c.env).approvals(currentTenant(), a.roles, { limit: 500 });
    if (!mine.some((x) => x.id === c.req.param("id"))) refuse("There's nothing waiting for your approval with that id.", 404);
    const out = await decideApproval(c.env, c.req.param("id"), decision as "approved" | "declined", a.name);
    if (!out) refuse("Someone else decided it first.", 409);
    await audited(c, decision === "approved" ? "routine.approved" : "routine.declined", a.name, out!.approval.routine_id, { action: out!.approval.action, type: out!.approval.type, sent: out!.sent?.ok ?? false });
    return { decision, sent: out!.sent };
  });
});

/** A routine's webhook signing key, for whoever sets up the receiving end (administrators, audited). */
app.get("/api/routines/:entry/signing-key", (c) =>
  libraryCall(c, async (a) => {
    if (!permissionsOf(a).manage) refuse("Only an administrator sees a routine's signing key.");
    const ctx = await routineContext(c.env);
    if (!ctx.routines.some((x) => x.entry.id === c.req.param("entry"))) refuse("There's no published routine with that id.", 404);
    await audited(c, "routine.signing_key", a.name, c.req.param("entry"));
    return { key: await signingKey(c.env, c.req.param("entry")), header: "X-Anjal-Signature", signs: "sha256 HMAC of <X-Anjal-Timestamp>.<body>" };
  }),
);

/** A family's ready-made routines (RTN-12): each with whether it is on. */
app.get("/api/routines/family", (c) =>
  libraryCall(c, async (a) => {
    if (a.guest) refuse("Sign in to your family's space first.");
    const ctx = await routineContext(c.env);
    const on = new Set(ctx.routines.map((x) => x.routine.id));
    return { manage: permissionsOf(a).manage, switches: FAMILY_ROUTINES.map((f) => ({ id: f.id, title: f.title, summary: f.summary, on: on.has(f.id) })) };
  }),
);
app.put("/api/routines/family/:id", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  return libraryCall(c, async (a, body) => {
    const f = FAMILY_ROUTINES.find((x) => x.id === c.req.param("id"));
    if (!f) refuse("There's no such routine.", 404);
    if (!permissionsOf(a).manage) refuse("Only a parent who runs the family's space switches routines.");
    const on = (body as { on?: unknown } | null)?.on === true;
    await library(c.env).switchRoutine(a, f!.yaml, on);
    await audited(c, "routine.switched", a.name, f!.id, { on });
    return { id: f!.id, on };
  });
});

/**
 * Kiosks forward the events a published routine waits for when their service keeps its events on
 * the device or the box (the catalogue's `routines` say which). The events aren't kept; only the runs
 * they set off are. A service that keeps its events here fires through POST /api/events instead.
 */
app.post("/api/routines/events", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `routine-events:${await clientId(c)}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  const parsed = eventBatchSchema.safeParse((await readJson(c, 256 * 1024)).body);
  if (!parsed.success) return jsonError(c, 422, "That isn't a batch of events.");
  await catalogue(c.env);
  const ctx = await routineContext(c.env);
  const server = new Set(ctx.pub.services.filter((s) => s.storage === "server").map((s) => s.entry_id));
  const runs = await fireEvents(c.env, parsed.data.filter((e) => !server.has(e.service)), ctx);
  return c.json({ ok: true, runs: runs.length });
});

// ---- the cloud relay: transient envelopes between devices (LIB-44..48) -----------------------------

/** A device's id: the SHA-256 of the secret it keeps (X-Yaxb-Device), so only it can read its envelopes. */
async function deviceOf(c: Context<AppEnv>): Promise<string | null> {
  const secret = c.req.header("X-Yaxb-Device") ?? "";
  if (secret.length < 32 || secret.length > 128) return null;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
/** Who is asking: their roles and member id (signed in), and their device. */
async function relayReader(c: Context<AppEnv>) {
  const a = await libraryActor(c);
  return { a, to: { roles: a.guest ? [] : [...a.roles], member: a.guest ? undefined : a.id, device: (await deviceOf(c)) ?? undefined } };
}
class RelayError extends Error {
  constructor(
    readonly status: 403 | 404 | 413 | 422,
    message: string,
  ) {
    super(message);
  }
}
async function relayCall(c: Context<AppEnv>, fn: (r: Awaited<ReturnType<typeof relayReader>>) => Promise<unknown>) {
  if (settings(c.env).CASES_RELAY !== "on") return jsonError(c, 404, "This kiosk has no cloud relay.");
  if (c.req.method !== "GET" && !sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const r = await relayReader(c);
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `relay:${r.to.device ?? r.a.id}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  try {
    return c.json(await fn(r));
  } catch (e) {
    if (e instanceof RelayError) return jsonError(c, e.status, e.message);
    throw e;
  }
}
/** Leave an envelope for someone who isn't online: kept until picked up or expired (at most RELAY_HOURS). */
app.post("/api/relay", (c) =>
  relayCall(c, async ({ a, to }) => {
    const { body, tooLarge } = await readJson(c, MAX_ENVELOPE);
    if (tooLarge) throw new RelayError(413, "That request is too large to relay.");
    const parsed = envelopeSchema.safeParse(body);
    if (!parsed.success) throw new RelayError(422, parsed.error.issues[0]?.message ?? "That isn't an envelope.");
    const hours = settings(c.env).RELAY_HOURS;
    const latest = new Date(Date.now() + Math.min(hours, RELAY_MAX_HOURS) * 3_600_000).toISOString();
    // The sender is who the session says, never what the envelope claims.
    const e = { ...parsed.data, from: { ...parsed.data.from, id: a.id, device: to.device ?? parsed.data.from.device }, expires_at: parsed.data.expires_at > latest ? latest : parsed.data.expires_at } as Envelope;
    if (e.kind === "reassign" && !mayReassign(a)) throw new RelayError(403, "Only a moderator or an administrator can reassign a case.");
    await relay(c.env).post(e);
    return { id: e.id, expires_at: e.expires_at };
  }),
);
/** Envelopes for my roles, me, or this device. */
app.get("/api/relay", (c) => relayCall(c, async ({ to }) => ({ items: to.roles.length || to.member || to.device ? await relay(c.env).inbox({ roles: to.roles, member: to.member, device: to.device }) : [] })));
/** Take one that is for me: the relay deletes it. */
app.post("/api/relay/:id/pick", (c) =>
  relayCall(c, async ({ a, to }) => {
    const mine = await relay(c.env).inbox({ roles: to.roles, member: to.member, device: to.device });
    if (!mine.some((e) => e.id === c.req.param("id"))) throw new RelayError(404, "That envelope isn't for you, or it is gone.");
    return { picked: await relay(c.env).pick(c.req.param("id"), a.guest ? "a kiosk" : a.name) };
  }),
);
/** Did my envelopes arrive? (Their ids are random: only their sender knows them.) */
app.get("/api/relay/status", (c) => relayCall(c, async () => ({ status: await relay(c.env).status((c.req.query("ids") ?? "").split(",").filter(Boolean).slice(0, 100)) })));
/** Who holds which case: devices keep it current; moderators and administrators read it. */
app.put("/api/relay/beacons", (c) =>
  relayCall(c, async () => {
    const parsed = beaconSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
    if (!parsed.success) throw new RelayError(422, "That isn't a beacon.");
    const hours = settings(c.env).RELAY_HOURS;
    const latest = new Date(Date.now() + hours * 3_600_000).toISOString();
    await relay(c.env).putBeacon({ ...parsed.data, expires_at: parsed.data.expires_at > latest ? latest : parsed.data.expires_at });
    return { ok: true };
  }),
);
app.get("/api/relay/beacons", (c) =>
  relayCall(c, async ({ a }) => {
    if (!mayReassign(a)) throw new RelayError(403, "Moderators and administrators only.");
    return { items: await relay(c.env).beacons() };
  }),
);

/** Every other catalogue route: same origin for changes. Who may do what is the core's decision. */
app.use("/api/library/*", async (c, next) => {
  if (c.req.method !== "GET" && !sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  await next();
});

app.get("/api/library", (c) =>
  libraryCall(c, async (a) => {
    const svc = library(c.env);
    return {
      me: { id: a.id, name: a.name, roles: a.roles, admin: a.admin, guest: Boolean(a.guest), can: svc.permissionsOf(a) },
      roles: await svc.catalogue(),
      libraries: await svc.libraries(a),
      services: await svc.entries(a),
      queue: await svc.reviewQueue(a),
    };
  }),
);
/** Organisation templates for this edition (ORG-2); the combined site offers every one. */
const templateEdition = (_c: Context<AppEnv>) => {
  const s = currentEdition();
  return s === "all" ? null : s;
};
app.get("/api/library/templates", (c) => libraryCall(c, async () => ({ templates: library(c.env).templates(templateEdition(c)) })));
/** Start from a template: the organisation and its starter services, as drafts (administrators). */
app.post("/api/library/templates/:id", (c) => libraryCall(c, (a) => library(c.env).applyTemplate(a, c.req.param("id"), templateEdition(c))));
app.post("/api/library/roles", (c) => libraryCall(c, (a, body) => library(c.env).addRole(a, body)));
app.patch("/api/library/roles/:id", (c) => libraryCall(c, (a, body) => library(c.env).updateRole(a, c.req.param("id"), body)));
app.delete("/api/library/roles/:id", (c) =>
  libraryCall(c, async (a) => {
    const members = await moderators(c.env).store.list();
    await library(c.env).removeRole(a, c.req.param("id"), members.map((m) => m.roles));
    return { removed: true };
  }),
);
app.post("/api/library/libraries", (c) => libraryCall(c, (a, body) => library(c.env).createLibrary(a, body)));
app.patch("/api/library/libraries/:id", (c) => libraryCall(c, (a, body) => library(c.env).updateLibrary(a, c.req.param("id"), body)));
app.post("/api/library/libraries/:id/:action{archive|restore}", (c) =>
  libraryCall(c, (a) => library(c.env).setLibraryStatus(a, c.req.param("id"), c.req.param("action") === "archive" ? "archived" : "active")),
);
/** A new service: { yaml, library?, design? } (the default library when absent; `design`: the Service Designer draft it came from). */
app.post("/api/library/services", (c) =>
  libraryCall(
    c,
    async (a, body) => {
      const { library: lib, design, thread, ...rest } = (body ?? {}) as { library?: unknown; design?: unknown; thread?: unknown };
      const created = await library(c.env).createEntry(a, typeof lib === "string" ? lib : null, rest);
      // Only the draft's own author links it, once; the agent then learns from this entry's review,
      // and the design conversation stays with the service.
      if (typeof design === "string" && design.length <= 64) await designer(c.env).link(design, created.entry.id, a.id);
      if (typeof thread === "string" && thread.length <= 64) await designer(c.env).linkThread(thread, created.entry.id, a.id);
      return created;
    },
    { limited: true },
  ),
);

/**
 * The Service Designer agent (LIB-27..32): a draft service from a narrative, with few-shot examples
 * from the published catalogue and the lessons reviewers taught it. Nothing is saved but the draft
 * (never the narrative); the author creates the entry, which is reviewed as usual. Anyone who may
 * design may ask; it counts as a chat turn, and guests are also held to the form limit.
 */
const designRequestSchema = z.strictObject({
  narrative: z.string().max(MAX_NARRATIVE + 200),
  provider: z.string().min(1).max(60),
  model: z.string().min(1).max(160),
  /** The catalogue entry being designed, or a new service's thread (LIB-39..41). */
  entry: z.string().min(1).max(64).optional(),
  thread: z.string().min(1).max(64).optional(),
  /** The service in the editor now. */
  current: z.string().max(MAX_ENTRY_BYTES).optional(),
});

/**
 * Where a design conversation is, and whether this person may talk in it: a new service's thread
 * is its starter's; an entry's thread is read by whoever may see the entry, and its editors, or a
 * reviewer while it is in review (who gets suggestions, not changes), talk in it.
 */
async function designThread(c: Context<AppEnv>, a: LibraryActor, key: { entry?: string; thread?: string }) {
  if (key.entry) {
    const { entry, canChange } = await library(c.env).entry(a, key.entry);
    const reviewer = permissionsOf(a).review && entry.status === "in_review";
    const thread = await designer(c.env).thread({ entry: entry.id });
    return { entry, thread, mayTalk: canChange || reviewer, applies: canChange };
  }
  const thread = key.thread ? await designer(c.env).thread({ thread: key.thread }) : null;
  if (thread && (thread.owner_id !== a.id || thread.entry_id)) throw new LibraryError("That conversation isn't yours, or it belongs to a service now: open the service.", 404);
  return { entry: null, thread, mayTalk: true, applies: true };
}

/** A design conversation: GET ?entry= or ?thread=. */
app.get("/api/library/design", (c) =>
  libraryCall(c, async (a) => {
    const entry = c.req.query("entry") || undefined;
    const thread = c.req.query("thread") || undefined;
    const t = await designThread(c, a, { entry, thread });
    return { thread: t.thread?.id ?? null, messages: t.thread?.messages ?? [], mayTalk: t.mayTalk, applies: t.applies };
  }),
);

/**
 * The Legal Guardian (CON-1..8): consent forms for the service in the editor, one per role, with the
 * flags a reviewer should see. Anyone who may design may ask (the result is a draft for the editor,
 * stored nowhere); rate limited like chat, and like a form for guests. Without a model it drafts from
 * the service alone.
 */
const guardianRequestSchema = z.strictObject({
  yaml: z.string().min(1).max(MAX_ENTRY_BYTES),
  storage: z.enum(["none", "box", "server"]).optional(),
  provider: z.string().max(40).optional(),
  model: z.string().max(120).optional(),
});
app.post("/api/library/consent", async (c) => {
  await catalogue(c.env);
  const actor = await libraryActor(c);
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `guardian:${actor.id}`))) return jsonError(c, 429, "Too many requests in a short time. Please wait a minute.");
  if (actor.guest && !(await withinLimit("form", c.env.FORM_LIMITER, `guardian:${actor.id}`))) return jsonError(c, 429, "Too many drafts in a short time. Please wait a minute.");
  const parsed = guardianRequestSchema.safeParse((await readJson(c, MAX_ENTRY_BYTES + MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid request.");
  const { yaml, storage, provider, model } = parsed.data;
  const { roles } = await library(c.env).published([], { all: true });
  const out = await kiosk(c.env).guardian(
    { yaml, storage, relayHours: settings(c.env).RELAY_HOURS, roles, selection: provider && model ? { provider, model, temperature: 0.2 } : null },
    { signal: c.req.raw.signal },
  );
  if ("error" in out) return jsonError(c, 422, out.error);
  return c.json(out);
});

/**
 * The Service Designer agent (LIB-27..32, LIB-39..41): one turn of a design conversation. The first
 * turn of a new service drafts it from the description; later turns, and every turn on an existing
 * service, change the service in the editor. Rate limited like chat, and like a form for guests.
 */
app.post("/api/library/design", async (c) => {
  await catalogue(c.env);
  const actor = await libraryActor(c);
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `design:${actor.id}`))) return jsonError(c, 429, "Too many requests in a short time. Please wait a minute.");
  if (actor.guest && !(await withinLimit("form", c.env.FORM_LIMITER, `design:${actor.id}`))) return jsonError(c, 429, "Too many drafts in a short time. Please wait a minute.");
  const parsed = designRequestSchema.safeParse((await readJson(c, MAX_ENTRY_BYTES + MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid request.");
  const { narrative, provider, model, entry: entryId, thread: threadId, current } = parsed.data;
  let t: Awaited<ReturnType<typeof designThread>>;
  try {
    t = await designThread(c, actor, { entry: entryId, thread: threadId });
  } catch (e) {
    if (e instanceof LibraryError) return jsonError(c, e.status, e.message);
    throw e;
  }
  if (!t.mayTalk) return jsonError(c, 403, "Only its designer or an editor, or a reviewer while it is in review, can ask the Service Designer about this service.");
  const [{ services, roles }, lessons] = await Promise.all([library(c.env).published([], { all: true }), designer(c.env).lessons(LESSONS_IN_MEMORY)]);
  const history = historyOf(t.thread?.messages ?? []);
  const editing = current ?? t.entry?.yaml;
  const out = await kiosk(c.env).design(
    {
      narrative,
      // A first description starts from nothing; every later turn changes the service in the editor.
      ...(editing && (t.entry || history.length) ? { current: editing } : {}),
      ...(history.length ? { history } : {}),
      ...(t.entry?.status === "rejected" && t.entry.review_note ? { review: t.entry.review_note } : {}),
      selection: { provider, model, temperature: 0.2 },
      published: services,
      lessons,
      roles: roles.map((r) => r.id),
    },
    { signal: c.req.raw.signal },
  );
  if ("error" in out) return jsonError(c, 422, out.error);
  const run = await designer(c.env).recorded(actor.id, out, t.entry?.id ?? null);
  const thread = t.thread?.id ?? crypto.randomUUID();
  const errors = out.problems.filter((p) => p.level === "error").length;
  const reply = [out.notes, errors ? `The draft has ${errors} problem${errors === 1 ? "" : "s"} to fix.` : null].filter(Boolean).join(" ") || (history.length ? "Changed as you asked." : "Drafted the service.");
  const messages = await designer(c.env).turn(thread, t.entry?.id ?? null, { id: actor.id, name: actor.guest ? "You" : actor.name }, narrative.trim(), { text: reply, result: out, run: run.id });
  return c.json({ ...out, run: run.id, thread, messages, applies: t.applies });
});

/** What the Service Designer has learnt (administrators): read, add and delete lessons. */
const mustManage = (a: LibraryActor) => {
  if (!permissionsOf(a).manage) throw new LibraryError("Only administrators can change what the Service Designer has learnt.", 403);
};
app.get("/api/library/lessons", (c) =>
  libraryCall(c, async (a) => {
    mustManage(a);
    return { lessons: await designer(c.env).lessons() };
  }),
);
app.post("/api/library/lessons", (c) =>
  libraryCall(c, async (a, body) => {
    mustManage(a);
    return { lesson: await designer(c.env).addLesson(body, a.name) };
  }),
);
app.delete("/api/library/lessons/:id", (c) =>
  libraryCall(c, async (a) => {
    mustManage(a);
    if (!(await designer(c.env).removeLesson(c.req.param("id")))) throw new LibraryError("That lesson isn't there any more.", 404);
    return { removed: true };
  }),
);
app.get("/api/library/entries/:id", (c) => libraryCall(c, (a) => library(c.env).entry(a, c.req.param("id"))));
app.get("/api/library/entries/:id/audit", (c) => libraryCall(c, async (a) => ({ events: await library(c.env).auditTrail(a, c.req.param("id")) })));
app.put("/api/library/entries/:id", (c) => libraryCall(c, (a, body) => library(c.env).saveEntry(a, c.req.param("id"), body)));
app.post("/api/library/entries/:id/submit", (c) => libraryCall(c, (a) => library(c.env).submit(a, c.req.param("id")), { limited: true }));
app.post("/api/library/entries/:id/review", (c) => libraryCall(c, (a, body) => library(c.env).review(a, c.req.param("id"), body)));
app.post("/api/library/entries/:id/:action{archive|restore}", (c) =>
  libraryCall(c, (a) => library(c.env).setEntryArchived(a, c.req.param("id"), c.req.param("action") === "archive")),
);

// ---- the team (TEAM-1..6, TEAM-10, TEAM-20, TEAM-50) ----------------------------------------------------

/** A member: signed in with their own key (the shared token has no identity to call or message). */
async function memberOf(c: Context<AppEnv>) {
  const who = await moderatorOf(c, moderators(c.env));
  return who?.moderator ? who.moderator : null;
}

/** The team as members see it: names, roles, status and availability (TEAM-3). */
app.get("/api/team", async (c) => {
  const me = await memberOf(c);
  if (!me) return jsonError(c, 401, "Sign in with your own moderator key to see the team.");
  const svc = moderators(c.env);
  const list = await svc.store.list();
  // People only: machines aren't on the team.
  const members = await Promise.all(list.filter((m) => statusOf(m) === "active" && m.kind !== "machine").map(async (m) => teamMember(m, await svc.store.getProfile(m.id))));
  return c.json({ me: members.find((m) => m.id === me.id) ?? teamMember(me, null), members });
});

/** Set my availability (TEAM-4). */
const availabilitySchema = z.strictObject({ value: z.enum(AVAILABILITY) });
app.put("/api/team/availability", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const me = await memberOf(c);
  if (!me) return jsonError(c, 401, "Moderator sign-in required.");
  const parsed = availabilitySchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, "Choose available, busy or away.");
  const svc = moderators(c.env);
  const p = await svc.profile(me);
  await svc.store.putProfile({ ...p, preferences: { ...p.preferences, availability: parsed.data.value }, updated_at: new Date().toISOString() });
  return c.json({ availability: parsed.data.value });
});

/**
 * The signaling sockets: presence (who is online, invitations) and a pair's room for a chat or a
 * call. Only signed-in, active members; a room only for the two members it names (TEAM-50).
 */
app.get("/api/team/:socket{presence|signal}", async (c) => {
  if (c.req.header("upgrade") !== "websocket") return jsonError(c, 426, "Expected a WebSocket.");
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const me = await memberOf(c);
  if (!me) return jsonError(c, 401, "Moderator sign-in required.");
  const headers = new Headers(c.req.raw.headers);
  headers.set(HUB_HEADERS.member, me.id);
  if (c.req.param("socket") === "presence") {
    headers.set(HUB_HEADERS.kind, "presence");
    const p = await moderators(c.env).store.getProfile(me.id);
    headers.set(HUB_HEADERS.availability, p?.preferences.availability ?? "available");
  } else {
    const peerId = c.req.query("peer") ?? "";
    const channel = c.req.query("channel") === "video" ? "video" : "chat";
    const peer = /^[0-9a-f-]{36}$/.test(peerId) && peerId !== me.id ? await moderators(c.env).store.get(peerId) : null;
    if (!peer || statusOf(peer) !== "active") return jsonError(c, 404, "That member isn't on the team.");
    headers.set(HUB_HEADERS.kind, "room");
    headers.set(HUB_HEADERS.room, roomName(me.id, peer.id, channel));
  }
  // One relay per tenant (TEAM-52): a team is small, both sides of a pair must meet in one place, and
  // presence never shows another business's members.
  const hub = c.env.TEAM.get(c.env.TEAM.idFromName(hubName(currentTenant(), currentEdition())));
  return hub.fetch(new Request(c.req.raw.url, { headers }));
});

app.delete("/api/moderator", (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  setModeratorCookie(c, null);
  return c.json({ moderator: false });
});

/** Contact form -> the helpdesk Worker (as ClinüxFlow's), else Airtable. Tokens stay in the Worker. */
app.post("/api/contact", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `contact:${ip(c)}`))) return jsonError(c, 429, "Too many messages. Please try again later.");
  const parsed = contactSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid form.");
  if (parsed.data.company) return c.json({ ok: true }); // honeypot: silently drop bots
  const { HELPDESK_URL, AIRTABLE_API_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME } = settings(c.env);
  const { name, email, message, organisation } = parsed.data;
  const failed = () => jsonError(c, 502, "That didn't send. Please write to helpdesk@yaxb.ai.");
  if (HELPDESK_URL) {
    const res = await fetch(HELPDESK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "email", name, clinic: organisation, email, message }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { success?: boolean } | null;
    return res?.ok && body?.success ? c.json({ ok: true }) : failed();
  }
  if (!AIRTABLE_API_TOKEN || !AIRTABLE_BASE_ID) return jsonError(c, 503, "The contact form is not configured. Please write to helpdesk@yaxb.ai.");
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: { Name: name, email, message: organisation ? `${organisation}: ${message}` : message } }], typecast: false }),
  }).catch(() => null);
  return res?.ok ? c.json({ ok: true }) : failed();
});

/** Newsletter signup -> Mailchimp (double opt-in). */
app.post("/api/newsletter", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `newsletter:${ip(c)}`))) return jsonError(c, 429, "Too many requests.");
  const parsed = newsletterSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid email.");
  const { MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID } = settings(c.env);
  if (!MAILCHIMP_API_KEY || !MAILCHIMP_AUDIENCE_ID) return jsonError(c, 503, "Newsletter is not configured.");
  const dc = MAILCHIMP_API_KEY.split("-").pop();
  const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${MAILCHIMP_AUDIENCE_ID}/members`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`any:${MAILCHIMP_API_KEY}`)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email_address: parsed.data.email, status: "pending" }),
  }).catch(() => null);
  // "Member Exists" is reported as success so the endpoint can't be used to probe the list.
  if (res && (res.ok || res.status === 400)) return c.json({ ok: true });
  return jsonError(c, 502, "Subscription failed. Please try again later.");
});

app.all("/api/*", (c) => jsonError(c, 404, "Not found"));

// ---- pages ------------------------------------------------------------------------------------------

// The old CRA kiosk URL.
app.get("/yaxb", (c) => c.redirect("/kiosk", 301));

/** Security headers for every page and asset. The app has no inline scripts, so no nonce is needed. */
function securityHeaders(env: Bindings, url: URL): Record<string, string> {
  // Transformers.js downloads model weights from the Hugging Face Hub and its ONNX runtime from jsDelivr.
  const modelHosts = "https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net";
  // yaxb-box addresses the browser may call (Storage: Local box).
  const box = (settings(env).KIOSK_BOX_ORIGINS ?? "")
    .split(/[\s,]+/)
    .filter((o) => /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(o))
    .join(" ");
  const local = url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname === "127.0.0.1";
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${modelHosts}${box ? ` ${box}` : ""}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    local ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    ...(local ? {} : { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" }),
    // The kiosk needs the microphone for voice input; nothing else.
    // The microphone for voice input; the camera and screen sharing for team calls (TEAM-20).
    "Permissions-Policy": "camera=(self), display-capture=(self), geolocation=(), payment=(), microphone=(self)",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/**
 * The one index.html serves every address (SUR-14): the address's edition, title and description
 * are written into it here, and the app reads `yaxb-edition` to choose its home page and brand.
 */
function pageFor(res: Response, edition: Edition, sections: string | null): Response {
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  const head = SURFACE_HEADS[edition];
  const metas = `<meta name="yaxb-edition" content="${edition}">${sections ? `<meta name="yaxb-sections" content="${sections}">` : ""}`;
  return new HTMLRewriter()
    .on("title", { element: (e) => void e.setInnerContent(head.title) })
    .on('meta[name="description"]', { element: (e) => void e.setAttribute("content", head.description) })
    .on("head", { element: (e) => void e.append(metas, { html: true }) })
    .transform(res);
}

/**
 * The sections a page shows (SPC-3, SPC-5): the kind of the space this device is kept for, else of
 * the account's open space, both checked here as on /api. Null: the app decides (the address's).
 */
async function sectionsFor(c: Context<AppEnv>): Promise<string | null> {
  await accountContext(c, async () => undefined);
  const lock = c.get("lock");
  if (lock) return lock.edition === "all" ? null : lock.edition;
  return c.get("space")?.kind ?? null;
}

app.get("*", async (c) => {
  const url = new URL(c.req.url);
  // Only pages (no file extension) need the space: assets skip the session check.
  const page = !/\.[a-z0-9]+$/i.test(url.pathname);
  const res = pageFor(await c.env.ASSETS.fetch(c.req.raw), editionFor({ host: url.hostname, fallback: settings(c.env).SURFACE }), page ? await sectionsFor(c).catch(() => null) : null);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(securityHeaders(c.env, url))) out.headers.set(k, v);
  return out;
});

/**
 * The Worker: requests through Hono, and the Cron Trigger (wrangler.jsonc `triggers.crons`, every
 * 15 minutes) sweeping every business's time routines (RTN-2).
 */
export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    ctx.waitUntil(sweep(env).then((n) => void (n && console.log(JSON.stringify({ msg: "routines swept", runs: n })))));
  },
} satisfies ExportedHandler<AppEnv["Bindings"]>;
