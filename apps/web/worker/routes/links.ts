// Routes: links. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { type Context } from "hono";
import { catalogue, currentTenant, links } from "../kiosk";
import { LinkError, type LinkActor } from "@sekaran-ind/yaxb-core/links";
import { MAX_FORM_BODY, jsonError, sameOrigin, readJson } from "../http";
import { administrator } from "../actors";
import type { AppEnv } from "../app";

/**
 * Business links (DEP-2, DEP-4, DEP-5): the business's administrator asks another business to let it
 * use some of its services, or, being asked, accepts and chooses what is offered. Everything is
 * audited on both sides; only an administrator of the business acts for it.
 */
app.use("/api/links", async (c, next) => (await linkGate(c)) ?? next());
app.use("/api/links/*", async (c, next) => (await linkGate(c)) ?? next());
async function linkGate(c: Context<AppEnv>) {
  if (c.req.method !== "GET" && !sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await administrator(c))) return jsonError(c, 401, "Administrator sign-in required.");
  return undefined;
}
async function linkCall(c: Context<AppEnv>, fn: (a: LinkActor, body: Record<string, unknown>) => Promise<unknown>, status: 200 | 201 = 200) {
  const who = await administrator(c);
  const body = c.req.method === "GET" ? {} : (((await readJson(c, MAX_FORM_BODY)).body ?? {}) as Record<string, unknown>);
  try {
    return c.json((await fn({ tenant: currentTenant(), id: who?.name ?? "administrator", name: who?.name ?? "Administrator", admin: true }, body)) ?? { ok: true }, status);
  } catch (e) {
    if (e instanceof LinkError) return jsonError(c, e.status, e.message);
    throw e;
  }
}
const offersOf = (v: unknown) => (Array.isArray(v) ? (v as { service?: unknown; journey?: unknown; accepts?: unknown }[]).map((o) => ({ service: String(o?.service ?? ""), journey: String(o?.journey ?? ""), accepts: o?.accepts as "Order" | "Invoice" })) : []);
app.get("/api/links", (c) =>
  linkCall(c, async (a) => {
    // What this business could offer: each published service's journeys.
    const { services } = await (await catalogue(c.env)).published([], { all: true });
    return { me: a.tenant, links: await links(c.env).list(a.tenant), offerable: services.flatMap((s) => s.journeys.map((j) => ({ service: s.id, service_title: s.title, journey: j.id, journey_title: j.title }))) };
  }),
);
app.post("/api/links", (c) => linkCall(c, async (a, b) => ({ link: await links(c.env).invite(a, String(b.business ?? "").toLowerCase()) }), 201));
app.post("/api/links/:id/accept", (c) => linkCall(c, async (a, b) => ({ link: await links(c.env).accept(a, c.req.param("id"), offersOf(b.offers)) })));
app.put("/api/links/:id/offers", (c) => linkCall(c, async (a, b) => ({ link: await links(c.env).setOffers(a, c.req.param("id"), offersOf(b.offers)) })));
app.post("/api/links/:id/end", (c) => linkCall(c, async (a) => ({ link: await links(c.env).end(a, c.req.param("id")) })));
