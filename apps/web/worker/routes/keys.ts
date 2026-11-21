// Routes: keys. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
// The directory of members' device keys for sealed steps (step access on devices; core cases/sealed.ts).
// Public keys only: a key with a private part is refused. Members and the administrator, of this business.
import { app } from "../app";
import { db } from "../edition";
import { currentTenant } from "../kiosk";
import { checkPublicKey, createD1MemberKeys } from "@sekaran-ind/yaxb-core/stores/keys";
import type { D1Like } from "@sekaran-ind/yaxb-core/stores/d1";
import { libraryActor } from "../actors";
import { jsonError, readJson, sameOrigin, MAX_FORM_BODY, withinLimit } from "../http";
import type { Context } from "hono";
import type { AppEnv } from "../app";

const directory = (c: Context<AppEnv>) => createD1MemberKeys(db(c.env) as unknown as D1Like, { tenant: currentTenant() });
/** A member or the administrator; never a visitor. */
async function who(c: Context<AppEnv>) {
  const a = await libraryActor(c);
  return a.guest ? null : a;
}

/** List this device's public key for the signed-in member (or the administrator). */
app.put("/api/keys", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const a = await who(c);
  if (!a) return jsonError(c, 403, "Sign in as a member to list a device's key.");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `keys:${a.id}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  try {
    const key = checkPublicKey((await readJson(c, MAX_FORM_BODY)).body);
    await directory(c).register(a.id, key);
    return c.json({ ok: true, id: key.id });
  } catch (e) {
    return jsonError(c, 422, e instanceof Error ? e.message : "That isn't a key.");
  }
});

/** Take one of your own devices' keys out (a lost device). */
app.delete("/api/keys/:id", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const a = await who(c);
  if (!a) return jsonError(c, 403, "Sign in as a member.");
  await directory(c).remove(a.id, c.req.param("id"));
  return c.json({ ok: true });
});

/**
 * The public keys of the devices of members with these roles, and the administrator's: for sealing a step.
 * Open to a visitor too, because a visitor's device seals what they gave before it leaves it; rate limited,
 * and public keys only (no names, no member ids).
 */
app.get("/api/keys/directory", async (c) => {
  const a = await libraryActor(c);
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `keys:${a.id}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  const roles = (c.req.query("roles") ?? "").split(",").map((r) => r.trim()).filter((r) => /^[a-z][a-z0-9-]{0,31}$/.test(r)).slice(0, 20);
  const d = directory(c);
  return c.json({ keys: await d.forRoles(roles), admins: await d.admins() });
});
