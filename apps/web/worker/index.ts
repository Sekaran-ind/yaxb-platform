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
import { catalogue, designer, kiosk, library, moderators, reviews } from "./kiosk";
import { DesignerError, LESSONS_IN_MEMORY, MAX_NARRATIVE } from "@sekaran-ind/yaxb-core/designer";
import { ADMIN_ACTOR_ID, LibraryError, MAX_ENTRY_BYTES, permissionsOf, type LibraryActor } from "@sekaran-ind/yaxb-core/library";
import { proposalEntry, ReviewError, type Reviewer } from "@sekaran-ind/yaxb-core/reviews";
import { auditEvent, looksLikeKey, MODERATOR_ROLES, statusOf, TeamRuleError } from "@sekaran-ind/yaxb-core/moderators";
import { AVAILABILITY, roomName, teamMember } from "@sekaran-ind/yaxb-core/team";
import { HUB_HEADERS } from "./team";

export { TeamHub } from "./team";
import { clientId, fromApp, isAdmin, moderatorCookie, moderatorOf, safeEqual, sessionId, setAdminCookie, setModeratorCookie } from "./session";

export type AppEnv = { Bindings: Bindings; Variables: { reviewer: Reviewer } };

const MAX_CHAT_BODY = 4_500_000;
const MAX_FORM_BODY = 64_000;

const contactSchema = z.strictObject({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.email("Please enter a valid email").max(254),
  message: z.string().trim().min(1, "Please enter a message").max(5000),
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

app.use("/api/*", async (c, next) => {
  // CORS for the native app's origins only (PLT-14); no credentials: its session is a header.
  const app = fromApp(c);
  if (app && c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": c.req.header("origin")!,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
        "Access-Control-Allow-Headers": "Content-Type, X-Yaxb-Session",
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
    const site = await fetchSite(parsed.data.url, parsed.data.follow, { resolve: dohResolver(), check: siteGuard(siteRulesFromEnv(stringEnv(c.env))) });
    return c.json({ pages: site.pages.map(({ url, title, text, fetchedAt }) => ({ url, title, text, fetchedAt })), skipped: site.skipped });
  } catch (e) {
    if (e instanceof PageError) return jsonError(c, 422, e.message);
    console.error(JSON.stringify({ msg: "web source failure", error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 120)}` : "unknown" }));
    return jsonError(c, 502, "That page couldn't be loaded.");
  }
});

// Read-only kiosk resources. `moderation` holds visitors' escalated questions: moderators only.
app.get("/api/agent/:resource", async (c) => {
  sessionId(c); // issue the session cookie on the kiosk's first call
  const k = kiosk(c.env);
  switch (c.req.param("resource")) {
    case "providers":
      return c.json(k.providers());
    case "capabilities":
      return c.json(k.capabilities());
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

/** Sign in with a moderator key (or, while it is set, the shared MODERATOR_TOKEN). */
app.post("/api/moderator", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `moderator:${ip(c)}`))) return jsonError(c, 429, "Too many attempts. Please wait a minute.");
  const parsed = signInSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 401, "That key isn't right.");
  const token = parsed.data.token.trim();
  const svc = moderators(c.env);
  if (looksLikeKey(token)) {
    const m = await svc.signIn(token);
    if (!m) return jsonError(c, 401, "That key isn't right, or it has been revoked or has expired.");
    setModeratorCookie(c, await moderatorCookie(c, m, await svc.store.keyHashOf(m.id)));
    return c.json({ moderator: true, name: m.name, roles: m.roles });
  }
  const { MODERATOR_TOKEN } = settings(c.env);
  if (!MODERATOR_TOKEN || !safeEqual(token, MODERATOR_TOKEN)) return jsonError(c, 401, "That key isn't right, or it has been revoked or has expired.");
  setModeratorCookie(c, await moderatorCookie(c, null, null));
  return c.json({ moderator: true, name: "Shared moderator token", shared: true });
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

/** Every admin route below: same origin for changes, and the administrator's cookie. */
app.use("/api/admin/*", async (c, next) => {
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
  return c.json({ events: await moderators(c.env).store.auditLog({ limit: 50, ...(before && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before) ? { before } : {}) }) });
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
  return c.json(await (await catalogue(c.env)).published(actor.roles, { all: actor.admin }));
});

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
      const { library: lib, design, ...rest } = (body ?? {}) as { library?: unknown; design?: unknown };
      const created = await library(c.env).createEntry(a, typeof lib === "string" ? lib : null, rest);
      // Only the draft's own author links it, once; the agent then learns from this entry's review.
      if (typeof design === "string" && design.length <= 64) await designer(c.env).link(design, created.entry.id, a.id);
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
});
app.post("/api/library/design", async (c) => {
  await catalogue(c.env);
  const actor = await libraryActor(c);
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `design:${actor.id}`))) return jsonError(c, 429, "Too many requests in a short time. Please wait a minute.");
  if (actor.guest && !(await withinLimit("form", c.env.FORM_LIMITER, `design:${actor.id}`))) return jsonError(c, 429, "Too many drafts in a short time. Please wait a minute.");
  const parsed = designRequestSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid request.");
  const { narrative, provider, model } = parsed.data;
  const [{ services, roles }, lessons] = await Promise.all([library(c.env).published([], { all: true }), designer(c.env).lessons(LESSONS_IN_MEMORY)]);
  const out = await kiosk(c.env).design(
    { narrative, selection: { provider, model, temperature: 0.2 }, published: services, lessons, roles: roles.map((r) => r.id) },
    { signal: c.req.raw.signal },
  );
  if ("error" in out) return jsonError(c, 422, out.error);
  const run = await designer(c.env).recorded(actor.id, out);
  return c.json({ ...out, run: run.id });
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
  const members = await Promise.all(list.filter((m) => statusOf(m) === "active").map(async (m) => teamMember(m, await svc.store.getProfile(m.id))));
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
  // One relay for the team: a team is small, and both sides of a pair must meet in one place.
  const hub = c.env.TEAM.get(c.env.TEAM.idFromName("team"));
  return hub.fetch(new Request(c.req.raw.url, { headers }));
});

app.delete("/api/moderator", (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  setModeratorCookie(c, null);
  return c.json({ moderator: false });
});

/** Contact form -> Airtable. The Airtable token stays in the Worker. */
app.post("/api/contact", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `contact:${ip(c)}`))) return jsonError(c, 429, "Too many messages. Please try again later.");
  const parsed = contactSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid form.");
  if (parsed.data.company) return c.json({ ok: true }); // honeypot: silently drop bots
  const { AIRTABLE_API_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME } = settings(c.env);
  if (!AIRTABLE_API_TOKEN || !AIRTABLE_BASE_ID) return jsonError(c, 503, "The contact form is not configured.");
  const { name, email, message } = parsed.data;
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: { Name: name, email, message } }], typecast: false }),
  }).catch(() => null);
  if (!res?.ok) return jsonError(c, 502, "We couldn't send your message. Please email support@yaxb.ai.");
  return c.json({ ok: true });
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
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
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

app.get("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(securityHeaders(c.env, new URL(c.req.url)))) out.headers.set(k, v);
  return out;
});

export default app;
