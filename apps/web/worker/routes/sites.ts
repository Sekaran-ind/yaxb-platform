// Routes: sites. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { type Context } from "hono";
import { z } from "zod";
import { settings } from "../env";
import { SITE_USES, SiteError } from "@sekaran-ind/yaxb-core/sites";
import { sites } from "../kiosk";
import { currentEdition } from "../edition";
import { clientId, isAdmin } from "../session";
import { MAX_FORM_BODY, jsonError, sameOrigin, withinLimit, readJson } from "../http";
import { siteScope, siteHere, askForSite, administrator, memberOf } from "../actors";
import type { AppEnv } from "../app";

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
/**
 * May this kiosk use a site this way (SIT-5's web.link_out): the approved list's verdict, nothing
 * fetched. Anyone; same origin; the chat limit.
 */
app.post("/api/sites/verdict", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `site-verdict:${await clientId(c)}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  const b = z.object({ url: z.string().max(500), use: siteUseSchema }).safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!b.success) return jsonError(c, 422, "Give the site's address and what it is for.");
  return siteCall(c, async () => {
    const v = await siteHere(c, b.data.url, b.data.use);
    return { allowed: v.allowed, why: v.why };
  });
});

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
