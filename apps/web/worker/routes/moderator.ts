// Routes: moderator. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { currentTenant, moderators, tenantContext } from "../kiosk";
import { hashKey, looksLikeKey, statusOf } from "@sekaran-ind/yaxb-core/moderators";
import { moderatorCookie, moderatorOf, setModeratorCookie } from "../session";
import { MAX_FORM_BODY, jsonError, sameOrigin, ip, withinLimit, readJson } from "../http";
import { signInSchema } from "../actors";

/** Who is signed in as a moderator (name and roles; no key). */
app.get("/api/moderator", async (c) => {
  const who = await moderatorOf(c, moderators(c.env));
  return c.json({ moderator: Boolean(who), ...(who ? { name: who.name, roles: who.roles, shared: who.shared } : {}), enabled: true });
});

/** Sign in with a person's member key (the shared MODERATOR_TOKEN is retired, IDN-44). */
app.post("/api/moderator", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `moderator:${ip(c)}`))) return jsonError(c, 429, "Too many attempts. Please wait a minute.");
  const parsed = signInSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 401, "That key isn't right.");
  const token = parsed.data.token.trim();
  if (looksLikeKey(token)) {
    // A key may belong to any business: find the member's tenant first, then sign in within it (TEN-2).
    const found = await moderators(c.env).store.byKeyHash(await hashKey(token));
    const tenant = found?.tenant ?? currentTenant();
    return tenantContext.run(tenant, async () => {
      const svc = moderators(c.env, tenant);
      const m = await svc.signIn(token);
      if (!m) {
        const why = await svc.keyKind(token);
        if (why === "machine") return jsonError(c, 401, "That is a machine's key: it calls the API, it doesn't sign in.");
        if (why === "linked") return jsonError(c, 401, "You sign in with your account now: Preferences → Account.");
        return jsonError(c, 401, "That key isn't right, or it has been revoked or has expired.");
      }
      setModeratorCookie(c, await moderatorCookie(c, m, await svc.store.keyHashOf(m.id)));
      return c.json({ moderator: true, name: m.name, roles: m.roles });
    });
  }
  return jsonError(c, 401, "That key isn't right, or it has been revoked or has expired.");
});

/** The signed-in moderator's profile and their own activity (MOD-24). */
app.get("/api/moderator/me", async (c) => {
  const svc = moderators(c.env);
  const who = await moderatorOf(c, svc);
  if (!who) return jsonError(c, 401, "Moderator sign-in required.");
  if (!who.moderator) return c.json({ moderator: { id: who.id, name: who.name, roles: who.roles, shared: true }, profile: null, activity: [] });
  const m = who.moderator;
  return c.json({
    moderator: { id: m.id, name: m.name, label: m.label, roles: m.roles, status: statusOf(m), key_prefix: m.key_prefix, created_at: m.created_at, expires_at: m.expires_at, last_seen_at: m.last_seen_at, reviews: m.reviews, shared: false },
    profile: await svc.profile(m),
    activity: await svc.store.auditLog({ actorId: m.id, limit: 50 }),
  });
});

app.put("/api/moderator/me", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const svc = moderators(c.env);
  const who = await moderatorOf(c, svc);
  if (!who) return jsonError(c, 401, "Moderator sign-in required.");
  if (!who.moderator) return jsonError(c, 409, "Sign in with your own moderator key to have a profile.");
  try {
    return c.json({ profile: await svc.saveProfile(who.moderator, (await readJson(c, MAX_FORM_BODY)).body) });
  } catch (e) {
    return jsonError(c, 422, (e as { issues?: { message: string }[] }).issues?.[0]?.message ?? "Check the profile.");
  }
});

app.delete("/api/moderator", (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  setModeratorCookie(c, null);
  return c.json({ moderator: false });
});
