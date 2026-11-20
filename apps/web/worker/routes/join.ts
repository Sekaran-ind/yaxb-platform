// Routes: join. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { tenantContext, tenantOfMember, tenants } from "../kiosk";
import { withEdition } from "../edition";
import { MAX_FORM_BODY, jsonError, sameOrigin, ip, withinLimit, readJson } from "../http";
import { tenantError, audited, joinEdition } from "../actors";

/**
 * Joining (public, rate limited): what a link offers, asking to join, where a request stands, and
 * collecting the member key once accepted. The claim code comes in a header, never the address.
 */
app.get("/api/join/:token", async (c) => {
  // Not rate limited: reading what a link offers changes nothing, and links can't be guessed (192 bits).
  try {
    return c.json((await joinEdition(() => tenants(c.env).preview(c.req.param("token")))).value);
  } catch (e) {
    return tenantError(c, e);
  }
});
app.post("/api/join/:token", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `join:${ip(c)}`))) return jsonError(c, 429, "Too many attempts. Please wait a minute.");
  const body = (await readJson(c, MAX_FORM_BODY)).body as { name?: string };
  try {
    const { request, claim } = (await joinEdition(() => tenants(c.env).redeem(c.req.param("token"), { name: String(body?.name ?? "") }))).value;
    return c.json({ request: { id: request.id, status: request.status, role: request.role }, claim }, 201);
  } catch (e) {
    return tenantError(c, e);
  }
});
app.get("/api/join-requests/:id", async (c) => {
  try {
    return c.json((await joinEdition(() => tenants(c.env).status(c.req.param("id"), c.req.header("x-yaxb-claim") ?? ""))).value);
  } catch (e) {
    return tenantError(c, e);
  }
});
app.post("/api/join-requests/:id/collect", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `join:${ip(c)}`))) return jsonError(c, 429, "Too many attempts. Please wait a minute.");
  try {
    const { edition, value } = await joinEdition(() => tenants(c.env).collect(c.req.param("id"), c.req.header("x-yaxb-claim") ?? ""));
    await withEdition(edition, async () => {
      const t = await tenantOfMember(c.env, value.memberId);
      if (t) await tenantContext.run(t, () => audited(c, "join.collected", null, value.memberId));
    });
    return c.json({ key: value.key });
  } catch (e) {
    return tenantError(c, e);
  }
});
