// Routes: tenants. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { currentTenant, tenants } from "../kiosk";
import { isAdmin } from "../session";
import { MAX_FORM_BODY, jsonError, sameOrigin, readJson } from "../http";
import { administrator, tenantError, audited } from "../actors";

/** The directory: the businesses on this deployment (public). */
app.get("/api/directory", async (c) => c.json({ tenants: await tenants(c.env).directory() }));

/** A new business (the deployment's administrator: the ADMIN_TOKEN holder). */
app.post("/api/tenants", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await isAdmin(c))) return jsonError(c, 401, "Only this deployment's administrator adds businesses.");
  const body = (await readJson(c, MAX_FORM_BODY)).body as { name?: string; slug?: string; kind?: "business" | "family" | "community" };
  try {
    const t = await tenants(c.env).createTenant({ name: String(body?.name ?? ""), slug: String(body?.slug ?? ""), kind: body?.kind });
    await audited(c, "tenant.created", "Administrator", t.id, { slug: t.slug });
    // A new business has nobody yet: its first administrator joins with this one-use link.
    const { token } = await tenants(c.env).issueToken(t.id, { role: "administrator", uses: 1, hours: 168, label: "First administrator", autoAccept: true }, { name: "Administrator" });
    return c.json({ tenant: t, adminLink: `${new URL(c.req.url).origin}/join/${token}` }, 201);
  } catch (e) {
    return tenantError(c, e);
  }
});

/** The business this request acts for, and whether the caller administers it. */
app.get("/api/tenant", async (c) => {
  const t = await tenants(c.env).tenant(currentTenant());
  const who = await administrator(c);
  return c.json({ tenant: t ? { id: t.id, slug: t.slug, name: t.name, kind: t.kind } : null, administrator: Boolean(who) });
});

/** Join links and requests: the business's administrator only. */
app.use("/api/tenant/*", async (c, next) => {
  if (c.req.method !== "GET" && !sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await administrator(c))) return jsonError(c, 401, "Administrator sign-in required.");
  await next();
});
app.get("/api/tenant/join-links", async (c) => c.json({ links: await tenants(c.env).tokens(currentTenant()) }));
app.post("/api/tenant/join-links", async (c) => {
  const who = await administrator(c);
  const body = (await readJson(c, MAX_FORM_BODY)).body as { role?: string; hours?: number; uses?: number; label?: string };
  try {
    const { token, joinToken } = await tenants(c.env).issueToken(currentTenant(), { role: String(body?.role ?? ""), hours: Number(body?.hours) || undefined, uses: Number(body?.uses) || undefined, label: body?.label }, { name: who?.name ?? null });
    await audited(c, "join.link_issued", who?.name ?? null, joinToken.id, { role: joinToken.role, uses: joinToken.uses_left });
    // The token is shown once, in the link to share; only its hash is kept.
    return c.json({ link: `${new URL(c.req.url).origin}/join/${token}`, token, joinLink: joinToken }, 201);
  } catch (e) {
    return tenantError(c, e);
  }
});
app.delete("/api/tenant/join-links/:id", async (c) => {
  const who = await administrator(c);
  try {
    await tenants(c.env).revokeToken(currentTenant(), c.req.param("id"));
    await audited(c, "join.link_withdrawn", who?.name ?? null, c.req.param("id"));
    return c.json({ ok: true });
  } catch (e) {
    return tenantError(c, e);
  }
});
app.get("/api/tenant/join-requests", async (c) => c.json({ requests: await tenants(c.env).requests(currentTenant()) }));
app.post("/api/tenant/join-requests/:id/decide", async (c) => {
  const who = await administrator(c);
  const body = (await readJson(c, MAX_FORM_BODY)).body as { decision?: string; role?: string };
  const decision = body?.decision === "accept" ? "accept" : body?.decision === "decline" ? "decline" : null;
  if (!decision) return jsonError(c, 422, "Accept or decline.");
  try {
    const r = await tenants(c.env).decide(currentTenant(), c.req.param("id"), decision, { role: body?.role }, { name: who?.name ?? null });
    await audited(c, decision === "accept" ? "join.accepted" : "join.declined", who?.name ?? null, r.id, { role: r.role });
    return c.json({ request: r });
  } catch (e) {
    return tenantError(c, e);
  }
});
