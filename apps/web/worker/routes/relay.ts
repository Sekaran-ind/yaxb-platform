// Routes: relay. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { type Context } from "hono";
import { settings } from "../env";
import { relay } from "../kiosk";
import { beaconSchema, envelopeSchema, MAX_ENVELOPE, mayReassign, RELAY_MAX_HOURS, type Envelope } from "@sekaran-ind/yaxb-core/cases";
import { MAX_FORM_BODY, jsonError, sameOrigin, withinLimit, readJson } from "../http";
import { libraryActor } from "../actors";
import type { AppEnv } from "../app";

/** A device's id: the SHA-256 of the secret it keeps (X-Yaxb-Device), so only it can read its envelopes. */
async function deviceOf(c: Context<AppEnv>): Promise<string | null> {
  const secret = c.req.header("X-Yaxb-Device") ?? "";
  if (secret.length < 32 || secret.length > 128) return null;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
/** Who is asking: their roles and member id (signed in), and their device. */
async function relayReader(c: Context<AppEnv>) {
  const a = await libraryActor(c);
  return { a, to: { roles: a.guest ? [] : [...a.roles], member: a.guest ? undefined : a.id, device: (await deviceOf(c)) ?? undefined } };
}
class RelayError extends Error {
  constructor(
    readonly status: 403 | 404 | 413 | 422,
    message: string,
  ) {
    super(message);
  }
}
async function relayCall(c: Context<AppEnv>, fn: (r: Awaited<ReturnType<typeof relayReader>>) => Promise<unknown>) {
  if (settings(c.env).CASES_RELAY !== "on") return jsonError(c, 404, "This kiosk has no cloud relay.");
  if (c.req.method !== "GET" && !sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const r = await relayReader(c);
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `relay:${r.to.device ?? r.a.id}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  try {
    return c.json(await fn(r));
  } catch (e) {
    if (e instanceof RelayError) return jsonError(c, e.status, e.message);
    throw e;
  }
}
/** Leave an envelope for someone who isn't online: kept until picked up or expired (at most RELAY_HOURS). */
app.post("/api/relay", (c) =>
  relayCall(c, async ({ a, to }) => {
    const { body, tooLarge } = await readJson(c, MAX_ENVELOPE);
    if (tooLarge) throw new RelayError(413, "That request is too large to relay.");
    const parsed = envelopeSchema.safeParse(body);
    if (!parsed.success) throw new RelayError(422, parsed.error.issues[0]?.message ?? "That isn't an envelope.");
    const hours = settings(c.env).RELAY_HOURS;
    const latest = new Date(Date.now() + Math.min(hours, RELAY_MAX_HOURS) * 3_600_000).toISOString();
    // The sender is who the session says, never what the envelope claims.
    const e = { ...parsed.data, from: { ...parsed.data.from, id: a.id, device: to.device ?? parsed.data.from.device }, expires_at: parsed.data.expires_at > latest ? latest : parsed.data.expires_at } as Envelope;
    if (e.kind === "reassign" && !mayReassign(a)) throw new RelayError(403, "Only a moderator or an administrator can reassign a case.");
    await relay(c.env).post(e);
    return { id: e.id, expires_at: e.expires_at };
  }),
);
/** Envelopes for my roles, me, or this device. */
app.get("/api/relay", (c) => relayCall(c, async ({ to }) => ({ items: to.roles.length || to.member || to.device ? await relay(c.env).inbox({ roles: to.roles, member: to.member, device: to.device }) : [] })));
/** Take one that is for me: the relay deletes it. */
app.post("/api/relay/:id/pick", (c) =>
  relayCall(c, async ({ a, to }) => {
    const mine = await relay(c.env).inbox({ roles: to.roles, member: to.member, device: to.device });
    if (!mine.some((e) => e.id === c.req.param("id"))) throw new RelayError(404, "That envelope isn't for you, or it is gone.");
    return { picked: await relay(c.env).pick(c.req.param("id"), a.guest ? "a kiosk" : a.name) };
  }),
);
/** Did my envelopes arrive? (Their ids are random: only their sender knows them.) */
app.get("/api/relay/status", (c) => relayCall(c, async () => ({ status: await relay(c.env).status((c.req.query("ids") ?? "").split(",").filter(Boolean).slice(0, 100)) })));
/** Who holds which case: devices keep it current; moderators and administrators read it. */
app.put("/api/relay/beacons", (c) =>
  relayCall(c, async () => {
    const parsed = beaconSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
    if (!parsed.success) throw new RelayError(422, "That isn't a beacon.");
    const hours = settings(c.env).RELAY_HOURS;
    const latest = new Date(Date.now() + hours * 3_600_000).toISOString();
    await relay(c.env).putBeacon({ ...parsed.data, expires_at: parsed.data.expires_at > latest ? latest : parsed.data.expires_at });
    return { ok: true };
  }),
);
app.get("/api/relay/beacons", (c) =>
  relayCall(c, async ({ a }) => {
    if (!mayReassign(a)) throw new RelayError(403, "Moderators and administrators only.");
    return { items: await relay(c.env).beacons() };
  }),
);
