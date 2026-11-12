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
import { kiosk, moderators } from "./kiosk";
import { auditEvent, looksLikeKey, statusOf } from "@sekaran-ind/yaxb-core/moderators";
import { clientId, isAdmin, moderatorCookie, moderatorOf, safeEqual, sessionId, setAdminCookie, setModeratorCookie } from "./session";

export type AppEnv = { Bindings: Bindings };

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

/** CSRF defence for state-changing routes: the request must come from our own origin. */
function sameOrigin(c: Context<AppEnv>): boolean {
  const origin = c.req.header("origin");
  if (!origin) return false;
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
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
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
      return c.json({ items: await k.moderation(100) });
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

app.get("/api/admin", async (c) => c.json({ admin: await isAdmin(c), enabled: Boolean(settings(c.env).ADMIN_TOKEN) }));

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
  if (!(await isAdmin(c))) return jsonError(c, 401, "Administrator sign-in required.");
  await next();
});

app.get("/api/admin/moderators", async (c) => {
  const list = await moderators(c.env).store.list();
  return c.json({ moderators: list.map((m) => ({ ...m, status: statusOf(m) })) });
});

/** Issue a key. The key is in this response only. */
app.post("/api/admin/moderators", async (c) => {
  try {
    const { moderator, key } = await moderators(c.env).issue((await readJson(c, MAX_FORM_BODY)).body as never, { name: "Administrator" });
    return c.json({ moderator: { ...moderator, status: statusOf(moderator) }, key });
  } catch (e) {
    return jsonError(c, 422, (e as { issues?: { message: string }[] }).issues?.[0]?.message ?? "Check the details.");
  }
});

app.patch("/api/admin/moderators/:id", async (c) => {
  try {
    const m = await moderators(c.env).change(c.req.param("id"), (await readJson(c, MAX_FORM_BODY)).body);
    return m ? c.json({ moderator: { ...m, status: statusOf(m) } }) : jsonError(c, 404, "No such moderator.");
  } catch (e) {
    return jsonError(c, 422, (e as { issues?: { message: string }[] }).issues?.[0]?.message ?? "Check the details.");
  }
});

app.post("/api/admin/moderators/:id/revoke", async (c) => {
  const m = await moderators(c.env).revoke(c.req.param("id"));
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
    "Permissions-Policy": "camera=(), geolocation=(), payment=(), microphone=(self)",
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
