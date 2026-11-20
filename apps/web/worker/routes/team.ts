// Routes: team. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { z } from "zod";
import { currentTenant, moderators } from "../kiosk";
import { currentEdition } from "../edition";
import { statusOf } from "@sekaran-ind/yaxb-core/moderators";
import { AVAILABILITY, hubName, roomName, teamMember } from "@sekaran-ind/yaxb-core/team";
import { HUB_HEADERS } from "../team";
import { MAX_FORM_BODY, jsonError, sameOrigin, readJson } from "../http";
import { memberOf } from "../actors";

/** The team as members see it: names, roles, status and availability (TEAM-3). */
app.get("/api/team", async (c) => {
  const me = await memberOf(c);
  if (!me) return jsonError(c, 401, "Sign in with your own moderator key to see the team.");
  const svc = moderators(c.env);
  const list = await svc.store.list();
  // People only: machines aren't on the team.
  const members = await Promise.all(list.filter((m) => statusOf(m) === "active" && m.kind !== "machine").map(async (m) => teamMember(m, await svc.store.getProfile(m.id))));
  return c.json({ me: members.find((m) => m.id === me.id) ?? teamMember(me, null), members });
});

/** Set my availability (TEAM-4). */
const availabilitySchema = z.strictObject({ value: z.enum(AVAILABILITY) });
app.put("/api/team/availability", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const me = await memberOf(c);
  if (!me) return jsonError(c, 401, "Moderator sign-in required.");
  const parsed = availabilitySchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, "Choose available, busy or away.");
  const svc = moderators(c.env);
  const p = await svc.profile(me);
  await svc.store.putProfile({ ...p, preferences: { ...p.preferences, availability: parsed.data.value }, updated_at: new Date().toISOString() });
  return c.json({ availability: parsed.data.value });
});

/**
 * The signaling sockets: presence (who is online, invitations) and a pair's room for a chat or a
 * call. Only signed-in, active members; a room only for the two members it names (TEAM-50).
 */
app.get("/api/team/:socket{presence|signal}", async (c) => {
  if (c.req.header("upgrade") !== "websocket") return jsonError(c, 426, "Expected a WebSocket.");
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const me = await memberOf(c);
  if (!me) return jsonError(c, 401, "Moderator sign-in required.");
  const headers = new Headers(c.req.raw.headers);
  headers.set(HUB_HEADERS.member, me.id);
  if (c.req.param("socket") === "presence") {
    headers.set(HUB_HEADERS.kind, "presence");
    const p = await moderators(c.env).store.getProfile(me.id);
    headers.set(HUB_HEADERS.availability, p?.preferences.availability ?? "available");
  } else {
    const peerId = c.req.query("peer") ?? "";
    const channel = c.req.query("channel") === "video" ? "video" : "chat";
    const peer = /^[0-9a-f-]{36}$/.test(peerId) && peerId !== me.id ? await moderators(c.env).store.get(peerId) : null;
    if (!peer || statusOf(peer) !== "active") return jsonError(c, 404, "That member isn't on the team.");
    headers.set(HUB_HEADERS.kind, "room");
    headers.set(HUB_HEADERS.room, roomName(me.id, peer.id, channel));
  }
  // One relay per tenant (TEAM-52): a team is small, both sides of a pair must meet in one place, and
  // presence never shows another business's members.
  const hub = c.env.TEAM.get(c.env.TEAM.idFromName(hubName(currentTenant(), currentEdition())));
  return hub.fetch(new Request(c.req.raw.url, { headers }));
});
