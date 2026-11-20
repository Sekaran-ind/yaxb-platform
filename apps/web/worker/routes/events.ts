// Routes: events. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { type Context } from "hono";
import { settings } from "../env";
import { catalogue, library, serviceEvents } from "../kiosk";
import { eventBatchSchema } from "@sekaran-ind/yaxb-core/metrics";
import { fireEvents } from "../routines";
import { LibraryError } from "@sekaran-ind/yaxb-core/library";
import { clientId } from "../session";
import { jsonError, sameOrigin, withinLimit, readJson } from "../http";
import { libraryActor, libraryCall } from "../actors";
import type { AppEnv } from "../app";

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
