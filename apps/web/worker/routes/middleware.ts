// Routes: middleware. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { settings } from "../env";
import { moderators, tenantContext, tenantOfMember, tenants } from "../kiosk";
import { DEFAULT_TENANT, SLUG } from "@sekaran-ind/yaxb-core/tenants";
import { resolveContext, servesApi } from "@sekaran-ind/yaxb-core/context";
import { currentEdition, editionContext, editionFor } from "../edition";
import { auditEvent, looksLikeKey, machineMayCall } from "@sekaran-ind/yaxb-core/moderators";
import { fromApp, MODERATOR_COOKIE } from "../session";
import { getCookie } from "hono/cookie";
import { accountContext } from "../identity";
import { jsonError } from "../http";

// The signed-in account and its open space (15-identity.md, SPC-7), checked before the edition and the tenant are chosen.
app.use("/api/*", accountContext);

/**
 * The edition this request acts in (SUR-14): the open space's, else the address's, else the
 * SURFACE setting, else the combined site. It chooses the database (edition.ts) and what is served.
 */
app.use("/api/*", (c, next) => editionContext.run(editionFor({ space: c.get("lock")?.edition ?? c.get("space")?.edition, host: new URL(c.req.url).hostname, fallback: settings(c.env).SURFACE }), () => next()));

/**
 * Routes for features the edition doesn't offer answer 404 (SUR-4, yaxb-core context). Joining is
 * looked up in whichever edition issued the link (joinEdition), so it isn't gated by the address.
 */
const JOINING = /^\/api\/(join|join-requests)(\/|$)/;
app.use("/api/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (!JOINING.test(path) && !servesApi(resolveContext({ surface: currentEdition() }), path)) return jsonError(c, 404, "Not found.");
  await next();
});

/**
 * The business a request acts for (TEN-2): the account's open space (SPC-7, its membership checked);
 * else a signed-in member's own; otherwise `?tenant=<short name>` for reading a business's published
 * services from the directory; otherwise the default. Every service below is scoped to it (kiosk.ts
 * tenantContext).
 */
app.use("/api/*", async (c, next) => {
  // A machine (IDN-16): `Authorization: Bearer yaxb_mod_…`. It acts in its own tenant, never signs in,
  // and may call only what its scopes allow.
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
  // A device's credential (anj_dev_…) and the native app's access token are checked with the
  // account (identity.ts), not here: only member keys are machines.
  if (bearer && looksLikeKey(bearer)) {
    const machine = looksLikeKey(bearer) ? await moderators(c.env).machine(bearer) : null;
    if (!machine) return jsonError(c, 401, "That machine key isn't right, or it has been revoked or has expired.");
    const tenant = machine.tenant ?? DEFAULT_TENANT;
    if (!machineMayCall(machine.scopes ?? [], c.req.method, new URL(c.req.url).pathname)) {
      await tenantContext.run(tenant, () => moderators(c.env, tenant).store.audit(auditEvent({ actor_type: "system", actor_id: machine.id, actor_name: machine.name, action: "machine.refused", target_id: machine.id, details: { method: c.req.method } })));
      return jsonError(c, 403, "This machine key may not do that.");
    }
    c.set("machine", machine);
    return tenantContext.run(tenant, () => next());
  }
  let tenant = DEFAULT_TENANT;
  const cookie = getCookie(c, MODERATOR_COOKIE) ?? "";
  const id = cookie.slice(0, Math.max(cookie.indexOf("."), 0));
  const space = c.get("space");
  const lock = c.get("lock");
  // A device kept for one space acts only there (SPC-5, SPC-7).
  if (lock) tenant = lock.tenant_id;
  else if (space) tenant = space.tenant_id;
  else if (/^[0-9a-f-]{36}$/.test(id)) tenant = (await tenantOfMember(c.env, id)) ?? DEFAULT_TENANT;
  else {
    const asked = c.req.query("tenant");
    if (asked && SLUG.test(asked) && c.req.method === "GET") tenant = (await tenants(c.env).tenant(asked))?.id ?? DEFAULT_TENANT;
  }
  return tenantContext.run(tenant, () => next());
});

app.use("/api/*", async (c, next) => {
  // CORS for the native app's origins only (PLT-14); no credentials: its session is a header.
  const app = fromApp(c);
  if (app && c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": c.req.header("origin")!,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Yaxb-Session, X-Yaxb-Device, X-Yaxb-Space",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      },
    });
  }
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  if (app) {
    c.header("Access-Control-Allow-Origin", c.req.header("origin")!);
    c.header("Vary", "Origin");
  }
});
