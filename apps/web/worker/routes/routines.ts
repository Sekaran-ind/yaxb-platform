// Routes: routines. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { catalogue, currentTenant, library, serviceEvents } from "../kiosk";
import { eventBatchSchema } from "@sekaran-ind/yaxb-core/metrics";
import { FAMILY_ROUTINES, isDue, parseRoutine, ROUTINE_STARTERS, routineLimits, runsFromEvents, localClock } from "@sekaran-ind/yaxb-core/routines";
import { decideApproval, dryRun, fireEvents, routineContext, routineStore, runOnce, sampleEvent, signingKey } from "../routines";
import { LibraryError, permissionsOf, writesRoutines, type LibraryActor } from "@sekaran-ind/yaxb-core/library";
import { clientId } from "../session";
import { jsonError, sameOrigin, withinLimit, readJson } from "../http";
import { audited, libraryCall } from "../actors";

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
