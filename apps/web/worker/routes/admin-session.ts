// Routes: admin-session. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { settings } from "../env";
import { moderators } from "../kiosk";
import { auditEvent } from "@sekaran-ind/yaxb-core/moderators";
import { safeEqual, setAdminCookie } from "../session";
import { MAX_FORM_BODY, jsonError, sameOrigin, ip, withinLimit, readJson } from "../http";
import { signInSchema, administrator } from "../actors";

app.get("/api/admin", async (c) => {
  const who = await administrator(c);
  return c.json({ admin: Boolean(who), name: who?.name ?? null, enabled: Boolean(settings(c.env).ADMIN_TOKEN) });
});

app.post("/api/admin", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `admin:${ip(c)}`))) return jsonError(c, 429, "Too many attempts. Please wait a minute.");
  const { ADMIN_TOKEN } = settings(c.env);
  if (!ADMIN_TOKEN) return jsonError(c, 503, "Administration is not enabled on this site (ADMIN_TOKEN is not set).");
  const parsed = signInSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success || !safeEqual(parsed.data.token.trim(), ADMIN_TOKEN)) return jsonError(c, 401, "That administrator token isn't right.");
  await setAdminCookie(c, true);
  await moderators(c.env).store.audit(auditEvent({ actor_type: "admin", actor_id: null, actor_name: "Administrator", action: "admin.signed_in", target_id: null }));
  return c.json({ admin: true });
});

app.delete("/api/admin", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  await setAdminCookie(c, false);
  return c.json({ admin: false });
});
