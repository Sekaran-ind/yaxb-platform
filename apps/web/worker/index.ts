// The YAXB web Worker: the API under /api (Hono) and the Vue app's static assets for everything
// else, served with strict security headers. The agent runs here (yaxb-core); provider keys never
// leave the Worker.
import { toSSEStream } from "@sekaran-ind/yaxb-core/events";
import { chatRequestSchema, extractRequestSchema } from "@sekaran-ind/yaxb-core/schemas";
import { createMemoryRateLimiter } from "@sekaran-ind/yaxb-core/stores";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { settings, type Bindings } from "./env";
import { kiosk } from "./kiosk";
import { clientId, isModerator, moderatorProof, safeEqual, sessionId, setModeratorCookie } from "./session";

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
    case "moderation":
      if (!(await isModerator(c))) return jsonError(c, 401, "Moderator sign-in required.");
      return c.json({ items: await k.moderation(100) });
    default:
      return jsonError(c, 404, "Not found");
  }
});

app.get("/api/moderator", async (c) => c.json({ moderator: await isModerator(c), enabled: Boolean(settings(c.env).MODERATOR_TOKEN) }));

app.post("/api/moderator", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `moderator:${ip(c)}`))) return jsonError(c, 429, "Too many attempts. Please wait a minute.");
  const { MODERATOR_TOKEN } = settings(c.env);
  if (!MODERATOR_TOKEN) return jsonError(c, 503, "Moderation is not enabled on this site.");
  const parsed = signInSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success || !safeEqual(parsed.data.token, MODERATOR_TOKEN)) return jsonError(c, 401, "That token isn't right.");
  setModeratorCookie(c, await moderatorProof(c));
  return c.json({ moderator: true });
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
