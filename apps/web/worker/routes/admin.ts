// Routes: admin. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { type Context } from "hono";
import { library, moderators } from "../kiosk";
import { auditEvent, MODERATOR_ROLES, statusOf, TeamRuleError, verifyAuditChain } from "@sekaran-ind/yaxb-core/moderators";
import { MAX_FORM_BODY, jsonError, sameOrigin, readJson } from "../http";
import { administrator } from "../actors";
import type { AppEnv } from "../app";

/** Every admin route below: same origin for changes, and the administrator's cookie. */
app.use("/api/admin/*", async (c, next) => {
  // A machine with audit:read reads the chain's head (the box's daily check); nothing else here.
  if (c.get("machine")) return new URL(c.req.url).pathname === "/api/admin/audit/chain" && c.req.method === "GET" ? next() : jsonError(c, 403, "Forbidden");
  if (c.req.method !== "GET" && !sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await administrator(c))) return jsonError(c, 401, "Administrator sign-in required.");
  await next();
});

app.get("/api/admin/moderators", async (c) => {
  const list = await moderators(c.env).store.list();
  return c.json({ moderators: list.map((m) => ({ ...m, status: statusOf(m) })) });
});

/** Roles a member is given must exist: built in, the organisation's, or a published service's (LIB-10). */
async function unknownRole(c: Context<AppEnv>, body: unknown): Promise<string | null> {
  const roles = (body as { roles?: unknown } | null)?.roles;
  if (!Array.isArray(roles)) return null;
  // Built in, the organisation's, and those published services define.
  const known = new Set<string>([...MODERATOR_ROLES, ...(await library(c.env).published([], { all: true })).roles.map((r) => r.id)]);
  const bad = roles.find((r) => typeof r !== "string" || !known.has(r));
  return bad === undefined ? null : `There is no role '${String(bad)}'. Add it in the Service catalogue, Roles, first.`;
}

/** Issue a key. The key is in this response only. */
app.post("/api/admin/moderators", async (c) => {
  try {
    const body = (await readJson(c, MAX_FORM_BODY)).body;
    const bad = await unknownRole(c, body);
    if (bad) return jsonError(c, 422, bad);
    const { moderator, key } = await moderators(c.env).issue(body as never, { name: "Administrator" });
    return c.json({ moderator: { ...moderator, status: statusOf(moderator) }, key });
  } catch (e) {
    return jsonError(c, 422, (e as { issues?: { message: string }[] }).issues?.[0]?.message ?? "Check the details.");
  }
});

app.patch("/api/admin/moderators/:id", async (c) => {
  try {
    const body = (await readJson(c, MAX_FORM_BODY)).body;
    const bad = await unknownRole(c, body);
    if (bad) return jsonError(c, 422, bad);
    const m = await moderators(c.env).change(c.req.param("id"), body);
    return m ? c.json({ moderator: { ...m, status: statusOf(m) } }) : jsonError(c, 404, "No such moderator.");
  } catch (e) {
    if (e instanceof TeamRuleError) return jsonError(c, 409, e.message);
    return jsonError(c, 422, (e as { issues?: { message: string }[] }).issues?.[0]?.message ?? "Check the details.");
  }
});

/** Remove a member (TEAM-2): their key stops working and their profile goes; the audit log keeps the history. */
app.delete("/api/admin/moderators/:id", async (c) => {
  try {
    const ok = await moderators(c.env).remove(c.req.param("id"), (await administrator(c)) ?? { name: null });
    return ok ? c.json({ removed: true }) : jsonError(c, 404, "No such moderator.");
  } catch (e) {
    if (e instanceof TeamRuleError) return jsonError(c, 409, e.message);
    throw e;
  }
});

app.post("/api/admin/moderators/:id/revoke", async (c) => {
  let m;
  try {
    m = await moderators(c.env).revoke(c.req.param("id"));
  } catch (e) {
    if (e instanceof TeamRuleError) return jsonError(c, 409, e.message);
    throw e;
  }
  return m ? c.json({ moderator: { ...m, status: statusOf(m) } }) : jsonError(c, 404, "No such moderator.");
});

/** A new key for the same moderator; the old one stops working. The key is in this response only. */
app.post("/api/admin/moderators/:id/rotate", async (c) => {
  const r = await moderators(c.env).rotate(c.req.param("id"));
  return r ? c.json({ moderator: { ...r.moderator, status: statusOf(r.moderator) }, key: r.key }) : jsonError(c, 404, "No such moderator.");
});

app.get("/api/admin/audit", async (c) => {
  const before = c.req.query("before");
  const store = moderators(c.env).store;
  const events = await store.auditLog({ limit: 50, ...(before && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before) ? { before } : {}) });
  // Reading the audit log is itself audited (AUD-3): who, and how many records.
  const who = await administrator(c);
  await store.audit(auditEvent({ actor_type: "admin", actor_id: null, actor_name: who?.name ?? "Administrator", action: "audit.viewed", target_id: null, details: { scope: "all", count: events.length } }));
  return c.json({ events });
});

/**
 * The audit chain (AUD-2): its head (newest hash and count), for the box to compare daily, and a
 * check of the newest records. Returns hashes and counts only.
 */
app.get("/api/admin/audit/chain", async (c) => {
  const store = moderators(c.env).store;
  const [head, check] = await Promise.all([store.auditHead(), store.auditChain(5000).then(verifyAuditChain)]);
  return c.json({ head, check });
});
