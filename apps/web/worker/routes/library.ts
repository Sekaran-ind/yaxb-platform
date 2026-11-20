// Routes: library. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { type Context } from "hono";
import { z } from "zod";
import { settings } from "../env";
import { catalogue, designer, kiosk, library, moderators } from "../kiosk";
import { modelGate } from "../limits";
import { currentEdition } from "../edition";
import { historyOf, LESSONS_IN_MEMORY, MAX_NARRATIVE } from "@sekaran-ind/yaxb-core/designer";
import { LibraryError, MAX_ENTRY_BYTES, permissionsOf, type LibraryActor } from "@sekaran-ind/yaxb-core/library";
import { MAX_FORM_BODY, jsonError, sameOrigin, withinLimit, withinIpBurst, refusal, readJson } from "../http";
import { libraryActor, libraryCall } from "../actors";
import type { AppEnv } from "../app";

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
  retainDays: z.number().int().optional(),
  provider: z.string().max(40).optional(),
  model: z.string().max(120).optional(),
});
app.post("/api/library/consent", async (c) => {
  await catalogue(c.env);
  const actor = await libraryActor(c);
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `guardian:${actor.id}`)) || !(await withinIpBurst(c, "guardian"))) return jsonError(c, 429, "Too many requests in a short time. Please wait a minute.");
  if (actor.guest && !(await withinLimit("form", c.env.FORM_LIMITER, `guardian:${actor.id}`))) return jsonError(c, 429, "Too many drafts in a short time. Please wait a minute.");
  const parsed = guardianRequestSchema.safeParse((await readJson(c, MAX_ENTRY_BYTES + MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid request.");
  const gate = await modelGate(c, c.env, { long: true });
  if (!gate.ok) return refusal(c, gate);
  const { yaml, storage, retainDays, provider: askedProvider, model: askedModel } = parsed.data;
  const provider = gate.selection?.provider ?? askedProvider;
  const model = gate.selection?.model ?? askedModel;
  const { roles } = await library(c.env).published([], { all: true });
  const out = await kiosk(c.env).guardian(
    { yaml, storage, relayHours: settings(c.env).RELAY_HOURS, retainDays: settings(c.env).PLAN === "paid" ? retainDays : undefined, roles, selection: provider && model ? { provider, model, temperature: 0.2 } : null },
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
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `design:${actor.id}`)) || !(await withinIpBurst(c, "design"))) return jsonError(c, 429, "Too many requests in a short time. Please wait a minute.");
  if (actor.guest && !(await withinLimit("form", c.env.FORM_LIMITER, `design:${actor.id}`))) return jsonError(c, 429, "Too many drafts in a short time. Please wait a minute.");
  const parsed = designRequestSchema.safeParse((await readJson(c, MAX_ENTRY_BYTES + MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid request.");
  // A whole service drafted by AI is a long answer: the paid plan.
  const gate = await modelGate(c, c.env, { long: true });
  if (!gate.ok) return refusal(c, gate);
  const { narrative, provider: askedProvider, model: askedModel, entry: entryId, thread: threadId, current } = parsed.data;
  const provider = gate.selection?.provider ?? askedProvider;
  const model = gate.selection?.model ?? askedModel;
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
