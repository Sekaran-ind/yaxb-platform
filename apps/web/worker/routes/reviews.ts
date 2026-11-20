// Routes: reviews. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { z } from "zod";
import { kiosk, moderators, reviews } from "../kiosk";
import { proposalEntry, ReviewError } from "@sekaran-ind/yaxb-core/reviews";
import { auditEvent } from "@sekaran-ind/yaxb-core/moderators";
import { clientId, moderatorOf } from "../session";
import { MAX_FORM_BODY, jsonError, sameOrigin, withinLimit, readJson } from "../http";

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
