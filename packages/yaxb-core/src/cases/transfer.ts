// Handing a case between devices (LIB-42..48), for kiosks without central storage. Central storage
// of service data in the cloud is a paid plan; without it, a case lives on the devices that work on
// it, tied to its thread, and travels to the next person in an envelope:
//
//   1. device to device, to an online member with the role (the team's peer-to-peer channel);
//   2. the organisation's own yaxb-box, which keeps it until someone picks it up;
//   3. the cloud relay, transient: it holds the envelope only until it is picked up or expires
//      (RELAY_TTL_HOURS, at most RELAY_MAX_HOURS), then deletes it. Nothing stays in the cloud.
//
// The sender keeps its copy, so when an envelope expires unread, or a moderator reassigns a case
// whose holder has gone quiet, the sender (or whoever holds a copy) sends it again. The receiving
// device checks every case itself by replaying its answers on its journey (as the server does in
// central storage), so a case can't arrive further along than its answers allow.
//
// A beacon is what a moderator needs to see who holds what and for how long: the reference, the
// journey's title, the role, the holder and the time. Never answers or notes. Beacons sit on the
// box, or in the relay with the same expiry, refreshed while the case moves.
import { replay, type RunState } from "@sekaran-ind/yaxb-journeys/journeys";
import { z } from "zod";
import type { Case, CaseEvent, CaseStore } from "./index.js";

export const RELAY_TTL_HOURS = 48;
export const RELAY_MAX_HOURS = 7 * 24;
export const BOX_TTL_HOURS = 30 * 24;
/** An envelope's size, as JSON (a case, its journey and its thread). */
export const MAX_ENVELOPE = 256 * 1024;

/** Where an envelope goes: members with one of the roles, one member, or one device (a visitor's kiosk). */
export type Address = { roles?: string[]; member?: string; device?: string };
export type Sender = { id: string; name: string; device: string };

export type CaseBody = { case: Case; events: CaseEvent[] };
export type ReassignBody = { case_id: string; ref: string; to: Address; to_name: string; by: string; reason: string | null };

export type Envelope =
  | { id: string; kind: "case"; to: Address; from: Sender; case_id: string; ref: string; created_at: string; expires_at: string; body: CaseBody }
  | { id: string; kind: "reassign"; to: Address; from: Sender; case_id: string; ref: string; created_at: string; expires_at: string; body: ReassignBody };

/** Who holds a case and since when: for a moderator's board. No answers, no notes. */
export type Beacon = {
  case_id: string;
  ref: string;
  journey_title: string;
  service_title: string;
  status: Case["status"];
  role: string | null;
  holder: Address;
  holder_name: string | null;
  /** The devices with a copy, which can send it again. */
  copies: string[];
  updated_at: string;
  expires_at: string;
};

/** How an envelope got on (or didn't). */
export type Delivery = {
  envelope: string;
  via: "device" | "box" | "relay" | "none";
  to: Address;
  to_name: string;
  sent_at: string;
  expires_at: string | null;
  state: "delivered" | "waiting" | "expired" | "not-sent";
  picked_by?: string | null;
};

/** A mailbox for envelopes and beacons: the box, or the cloud relay. */
export interface Mailbox {
  post(e: Envelope): Promise<void>;
  /** Envelopes for these roles, this member or this device, not picked up and not expired. */
  inbox(to: { roles: readonly string[]; member?: string; device?: string }): Promise<Envelope[]>;
  /** Take one: it is gone from the mailbox (a stub says who took it, until it would have expired). */
  pick(id: string, by: string): Promise<boolean>;
  status(ids: readonly string[]): Promise<Record<string, { state: "waiting" | "delivered" | "expired"; picked_by: string | null }>>;
  putBeacon(b: Beacon): Promise<void>;
  beacons(): Promise<Beacon[]>;
}

const address = z
  .strictObject({ roles: z.array(z.string().max(32)).max(10).optional(), member: z.string().max(80).optional(), device: z.string().max(80).optional() })
  .refine((a) => Boolean(a.roles?.length || a.member || a.device), "An envelope needs an address.");
const sender = z.strictObject({ id: z.string().max(80), name: z.string().max(80), device: z.string().max(80) });
const base = { id: z.string().min(8).max(64), to: address, from: sender, case_id: z.string().max(64), ref: z.string().max(16), created_at: z.string().max(40), expires_at: z.string().max(40) };
export const envelopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...base, kind: z.literal("case"), body: z.strictObject({ case: z.record(z.string(), z.unknown()), events: z.array(z.record(z.string(), z.unknown())).max(500) }) }),
  z.strictObject({
    ...base,
    kind: z.literal("reassign"),
    body: z.strictObject({ case_id: z.string().max(64), ref: z.string().max(16), to: address, to_name: z.string().max(80), by: z.string().max(80), reason: z.string().max(1000).nullable() }),
  }),
]);
export const beaconSchema = z.strictObject({
  case_id: z.string().max(64),
  ref: z.string().max(16),
  journey_title: z.string().max(200),
  service_title: z.string().max(200),
  status: z.enum(["waiting", "to_finish", "done", "declined"]),
  role: z.string().max(32).nullable(),
  holder: address,
  holder_name: z.string().max(80).nullable(),
  copies: z.array(z.string().max(80)).max(20),
  updated_at: z.string().max(40),
  expires_at: z.string().max(40),
});

/** An envelope's expiry, clamped: the relay never keeps one longer than RELAY_MAX_HOURS. */
export function expiryOf(hours: number, now = new Date(), max = RELAY_MAX_HOURS): string {
  const h = Math.min(Math.max(Number.isFinite(hours) ? hours : RELAY_TTL_HOURS, 1), max);
  return new Date(now.getTime() + h * 3_600_000).toISOString();
}
export const expired = (e: { expires_at: string }, now = new Date()) => e.expires_at <= now.toISOString();

/** Who the case goes to next: the role whose turn it is, its finishers, or back to whoever started it. */
export function nextAddress(c: Pick<Case, "status" | "waiting_role" | "finish_roles" | "started_by"> & { starter_device?: string | null; assignee?: string | null }): Address | null {
  if (c.status === "waiting") {
    if (c.waiting_role) return c.assignee ? { member: c.assignee } : { roles: [c.waiting_role] };
    return c.starter_device ? { device: c.starter_device } : { member: c.started_by };
  }
  if (c.status === "to_finish") return c.assignee ? { member: c.assignee } : { roles: [...c.finish_roles] };
  return null;
}

/** Is this address me? */
export const addressedTo = (a: Address, me: { roles: readonly string[]; member?: string; device?: string }) =>
  Boolean((a.member && a.member === me.member) || (a.device && a.device === me.device) || a.roles?.some((r) => me.roles.includes(r)));

export function caseEnvelope(c: Case, events: CaseEvent[], to: Address, from: Sender, hours: number, now = new Date(), max = RELAY_MAX_HOURS): Envelope {
  return { id: crypto.randomUUID(), kind: "case", to, from, case_id: c.id, ref: c.ref, created_at: now.toISOString(), expires_at: expiryOf(hours, now, max), body: { case: c, events } };
}

export function beaconOf(c: Case, holder: Address, holderName: string | null, copies: string[], now = new Date(), hours = RELAY_MAX_HOURS): Beacon {
  return {
    case_id: c.id,
    ref: c.ref,
    journey_title: c.journey_title,
    service_title: c.service_title,
    status: c.status,
    role: c.status === "waiting" ? c.waiting_role : c.status === "to_finish" ? (c.finish_roles[0] ?? null) : null,
    holder,
    holder_name: holderName,
    copies: [...new Set(copies)].slice(0, 20),
    updated_at: now.toISOString(),
    expires_at: expiryOf(hours, now, Math.max(hours, 1)),
  };
}

export class TransferError extends Error {}

/**
 * Check a case that arrived and keep it: its answers must replay on its journey to exactly where it
 * says it stands. A copy that is further along (more events) replaces the one kept; an older one is
 * ignored. Returns what is kept now, and whether it changed.
 */
export async function receiveCase(store: CaseStore, body: unknown): Promise<{ case: Case; changed: boolean }> {
  const b = body as CaseBody;
  const c = b?.case;
  if (!c || typeof c !== "object" || !c.journey || !c.run || !Array.isArray(b.events)) throw new TransferError("That isn't a case.");
  const r = await replay(c.journey, { answers: c.run.answers ?? {}, steps: c.run.steps ?? {} });
  if (!r.ok) throw new TransferError(`The case's answers don't fit its journey: ${r.problems[0]}`);
  const at = standing(r.state);
  const claimed = c.status === "done" || c.status === "declined" ? (r.state.status === "done" ? "to_finish" : "waiting") : c.status;
  if (at.status !== claimed || (at.status === "waiting" && at.step !== c.waiting_step)) throw new TransferError("The case says it is further along than its answers.");
  const finishable = (c.journey.roles?.complete ?? []).some((x) => x !== "visitor");
  if ((c.status === "done" && !(r.state.status === "done")) || (c.status === "to_finish" && !finishable)) throw new TransferError("The case's status doesn't fit its journey.");
  const kept = await store.get(c.id);
  const keptEvents = kept ? await store.events(c.id) : [];
  if (kept && keptEvents.length >= b.events.length && kept.updated_at >= c.updated_at) return { case: kept, changed: false };
  await store.put(c);
  const have = new Set(keptEvents.map((e) => e.id));
  for (const e of b.events) if (!have.has(e.id)) await store.addEvent(e);
  return { case: c, changed: true };
}

function standing(s: RunState): { status: "waiting" | "to_finish"; step: string | null } {
  return s.status === "done" ? { status: "to_finish", step: null } : { status: "waiting", step: s.prompt?.step ?? null };
}

/** A mailbox in memory (tests, and the shape the box and the relay follow). */
export function createMemoryMailbox(now = () => new Date()): Mailbox {
  const envelopes = new Map<string, { e: Envelope; picked_by: string | null }>();
  const beacons = new Map<string, Beacon>();
  const live = () => {
    for (const [id, x] of envelopes) if (expired(x.e, now())) envelopes.delete(id);
    for (const [id, b] of beacons) if (expired(b, now())) beacons.delete(id);
  };
  return {
    async post(e) {
      envelopes.set(e.id, { e: JSON.parse(JSON.stringify(e)), picked_by: null });
    },
    async inbox(to) {
      live();
      return [...envelopes.values()].filter((x) => !x.picked_by && addressedTo(x.e.to, to)).map((x) => JSON.parse(JSON.stringify(x.e)));
    },
    async pick(id, by) {
      live();
      const x = envelopes.get(id);
      if (!x || x.picked_by) return false;
      x.picked_by = by;
      // Gone, but for a stub saying who took it.
      (x.e as { body: unknown }).body = null;
      return true;
    },
    async status(ids) {
      const out: Record<string, { state: "waiting" | "delivered" | "expired"; picked_by: string | null }> = {};
      for (const id of ids) {
        const x = envelopes.get(id);
        out[id] = !x || expired(x.e, now()) ? { state: x?.picked_by ? "delivered" : "expired", picked_by: x?.picked_by ?? null } : { state: x.picked_by ? "delivered" : "waiting", picked_by: x.picked_by };
      }
      return out;
    },
    async putBeacon(b) {
      beacons.set(b.case_id, { ...b });
    },
    async beacons() {
      live();
      return [...beacons.values()].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    },
  };
}
