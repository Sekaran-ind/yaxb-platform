// Routes: agent. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { toSSEStream } from "@sekaran-ind/yaxb-core/events";
import { feedbackSchema } from "@sekaran-ind/yaxb-core/feedback";
import { dohResolver, fetchSite, PageError, siteGuard, siteRulesFromEnv } from "@sekaran-ind/yaxb-core/web/pages";
import { chatRequestSchema, extractRequestSchema } from "@sekaran-ind/yaxb-core/schemas";
import { z } from "zod";
import { settings, stringEnv } from "../env";
import { currentTenant, kiosk } from "../kiosk";
import { modelGate } from "../limits";
import { currentEdition } from "../edition";
import { clientId } from "../session";
import { MAX_CHAT_BODY, MAX_FORM_BODY, jsonError, sameOrigin, withinLimit, withinIpBurst, refusal, readJson } from "../http";
import { siteHere, askForSite } from "../actors";

const flagSchema = z.strictObject({ question: z.string().trim().min(1).max(1000), reason: z.string().trim().min(1).max(500) });

/** One kiosk turn, streamed as Server-Sent Events. */
app.post("/api/agent/chat", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const id = await clientId(c);
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, id)) || !(await withinIpBurst(c, "chat"))) return jsonError(c, 429, "Too many questions in a short time. Please wait a minute.");
  // A turn may carry the visitor's notebook (up to about 2 MB of text) and conversation.
  const { body, tooLarge } = await readJson(c, MAX_CHAT_BODY);
  if (tooLarge) return jsonError(c, 413, "That notebook is too large to send. Remove a source and try again.");
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid request.");

  const { threadId, message, provider, model, temperature, settings: agentSettings, client } = parsed.data;
  // The free plan (everyone, members too): a few short questions per IP, on the small tool-calling
  // model, the lean harness and short answers. The paid plan is a deployment of its own.
  const gate = await modelGate(c, c.env, { chars: message.length });
  if (!gate.ok) return refusal(c, gate);
  const events = kiosk(c.env).ask(
    { threadId: `${id}:${threadId}`, message, selection: gate.selection ? { ...gate.selection, temperature } : { provider, model, temperature }, settings: gate.free ? { ...agentSettings, harness: "lean" } : agentSettings, client },
    { signal: c.req.raw.signal, ...(gate.brief ? { brief: gate.brief } : {}) },
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
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, id)) || !(await withinIpBurst(c, "flag"))) return jsonError(c, 429, "Too many questions in a short time. Please wait a minute.");
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
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, id)) || !(await withinIpBurst(c, "search"))) return jsonError(c, 429, "Too many questions in a short time. Please wait a minute.");
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
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, id)) || !(await withinIpBurst(c, "extract"))) return jsonError(c, 429, "Too many requests in a short time. Please wait a minute.");
  const parsed = extractRequestSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid request.");
  const { journey, step, text, provider, model } = parsed.data;
  const gate = await modelGate(c, c.env, { chars: text.length });
  if (!gate.ok) return refusal(c, gate);
  const out = await kiosk(c.env).extract({ journey, step, text, selection: { ...(gate.selection ?? { provider, model }), temperature: 0 } }, { signal: c.req.raw.signal });
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

/** Nominatim asks for at most one request a second from an application: one at a time per isolate. */
let lastPlaceSearch = 0;
const PLACE_CACHE_SECONDS = 7 * 86_400;
/**
 * A place by name or address, for the map fields: through the Worker to OpenStreetMap's Nominatim
 * (or PLACES_URL, a compatible geocoder), cached per business for a week and kept within its usage
 * policy. Only the words searched for are sent, with a generic client name; never who asked.
 */
app.get("/api/places/search", async (c) => {
  // A read-only GET (browsers send no Origin on same-origin GETs); other sites can't read it (CORS), and each session is limited.
  const q = (c.req.query("q") ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (q.length < 3) return jsonError(c, 422, "Type at least three letters.");
  const key = new Request(`https://places.cache/${encodeURIComponent(currentEdition())}/${encodeURIComponent(currentTenant())}?q=${encodeURIComponent(q.toLowerCase())}`);
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return c.json(await hit.json());
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `places:${await clientId(c)}`))) return jsonError(c, 429, "Too many searches. Please wait a minute.");
  const wait = lastPlaceSearch + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 1000)));
  lastPlaceSearch = Date.now();
  const url = new URL(settings(c.env).PLACES_URL || "https://nominatim.openstreetmap.org/search");
  for (const [k, v] of Object.entries({ q, format: "jsonv2", limit: "5", countrycodes: "in", "accept-language": "en" })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Anjal-Kiosk/1 (+https://anjalai.cc)" }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res?.ok) return jsonError(c, 502, "The place search didn't answer. Tap the map instead.");
  const raw = (await res.json().catch(() => [])) as { lat?: string; lon?: string; display_name?: string }[];
  const items = raw
    .map((h) => ({ lat: Number(h.lat), lng: Number(h.lon), label: String(h.display_name ?? "").slice(0, 200) }))
    .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng));
  const body = { items };
  if (cache) c.executionCtx.waitUntil(cache.put(key, new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${PLACE_CACHE_SECONDS}` } })));
  return c.json(body);
});
