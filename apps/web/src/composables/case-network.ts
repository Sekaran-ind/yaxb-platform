// Cases kept on devices (LIB-42..48), for kiosks without the paid central storage. This device keeps
// its copy of each case it works on (lib/browser/cases-local.ts) and runs the core's case service
// over it, so the rules are the same as central storage (the journey decides who is next; answers
// are replayed on every change). A change that needs someone else hands the case on
// (lib/browser/case-transport.ts): straight to an online member's device, else the box, else the
// cloud relay, which keeps it only until it is picked up or expires. This device keeps its copy and
// what it sent, so it can send it again when an envelope expires or a moderator reassigns the case.
//
// Incoming cases arrive on the team's channel, or are collected from the box and the relay
// (`collect`, on opening Services and every minute while the kiosk is open). Beacons (reference,
// role, holder, time; never answers) go to the box, or the relay, so moderators see who has what.
import {
  beaconOf,
  BOX_TTL_HOURS,
  caseEnvelope,
  createCaseService,
  envelopeSchema,
  nextAddress,
  receiveCase,
  type Address,
  type Beacon,
  type Case,
  type CaseActor,
  type CaseSummary,
  type Delivery,
  type Envelope,
  type Mailbox,
} from "@sekaran-ind/yaxb-core/cases";
import { computed, ref } from "vue";
import { kioskViewer, publishedJourney, roleName } from "@/composables/library";
import { settings, useCapabilities } from "@/composables/settings";
import { onTeamData, useTeam } from "@/composables/team";
import { boxMailbox, deliver, recipients, relayMailbox } from "@/lib/browser/case-transport";
import { allLocalCases, deliveriesOf, localCaseStore, saveDelivery, thisDevice } from "@/lib/browser/cases-local";

type CasesCapabilities = { central: boolean; relay: boolean; relayHours: number };
const { data: caps } = useCapabilities();
/** What this server offers for cases: central storage (paid) and the relay. */
export const casesCaps = computed<CasesCapabilities>(() => (caps.value as { cases?: CasesCapabilities } | null)?.cases ?? { central: false, relay: false, relayHours: 48 });
/** The server's capabilities, fetched if they haven't arrived yet (a fresh page collects at once). */
async function capsReady() {
  if (caps.value) return;
  try {
    caps.value = (await (await fetch("/api/agent/capabilities")).json()) as never;
  } catch {
    /* offline: no relay */
  }
}
/** Requests are kept on devices unless central storage is both offered (paid) and chosen. */
export const onDevices = computed(() => !(casesCaps.value.central && settings.cases.storage === "central"));

const service = createCaseService(localCaseStore, { journeyFor: async (entry, journey) => publishedJourney(entry, journey) });
const team = useTeam();

/** Who acts on this device: the signed-in member, or a visitor (known by this device). */
export async function deviceActor(): Promise<CaseActor> {
  const v = kioskViewer.value;
  const device = (await thisDevice()).id;
  if (v.member && v.id) return { id: v.id, name: v.name ?? "A member", roles: v.roles, admin: v.admin, device };
  return { id: `guest:${device}`, name: "Visitor", roles: [], admin: false, guest: true, device };
}

function mailboxes(): { box: Mailbox | null; relay: Mailbox | null } {
  return {
    box: settings.cases.useBox && settings.box.url && settings.box.token ? boxMailbox(settings.box) : null,
    relay: settings.cases.useRelay && casesCaps.value.relay ? relayMailbox() : null,
  };
}

/** The address in words: "Organiser", "Olu", "the visitor's kiosk". */
function nameOf(to: Address, c: Case): string {
  if (to.member) return c.assignee === to.member ? (c.assignee_name ?? "a member") : (team.members.value.find((m) => m.id === to.member)?.name ?? c.started_by_name);
  if (to.device) return "the kiosk it was started on";
  return (to.roles ?? []).map(roleName).join(" or ");
}

/** Is this address this device or its member (so there's nothing to send)? */
async function isMe(to: Address): Promise<boolean> {
  const a = await deviceActor();
  return Boolean((to.member && to.member === a.id) || (to.device && to.device === a.device) || (!a.guest && to.roles?.some((r) => a.roles.includes(r))));
}

/** Tell moderators who has it now (no answers): on the box, or the relay. */
async function beacon(c: Case, to: Address | null) {
  const { box, relay } = mailboxes();
  const me = (await thisDevice()).id;
  const copies = [me, ...(c.starter_device ? [c.starter_device] : [])];
  // The box if it can be reached, else the relay (for no longer than the relay keeps anything).
  for (const [mb, hours] of [
    [box, BOX_TTL_HOURS],
    [relay, casesCaps.value.relayHours],
  ] as const) {
    if (!mb) continue;
    try {
      await mb.putBeacon(beaconOf(c, to ?? { device: me }, to ? nameOf(to, c) : null, copies, new Date(), hours));
      return;
    } catch {
      /* try the next */
    }
  }
}

/**
 * Send a case on to whoever is next, if that isn't this device: the first way that works. Saved, so
 * the case shows how far it got and can be sent again. Null when there's nothing to send.
 */
export async function handOn(c: Case): Promise<Delivery | null> {
  await capsReady();
  const to = nextAddress(c);
  void beacon(c, to);
  if (!to || (await isMe(to))) return null;
  const a = await deviceActor();
  const { box, relay } = mailboxes();
  const hours = box ? BOX_TTL_HOURS : casesCaps.value.relayHours;
  const e = caseEnvelope(c, await localCaseStore.events(c.id), to, { id: a.id, name: a.name, device: a.device! }, hours, new Date(), Math.max(hours, 1));
  const online = a.guest ? [] : recipients(to, team.members.value, team.onlineIds.value).map((m) => ({ id: m.id, name: m.name }));
  const d = await deliver(e, nameOf(to, c), { online, direct: (member, env) => team.sendData(member, env), box, relay, hours: { box: BOX_TTL_HOURS, relay: casesCaps.value.relayHours } });
  await saveDelivery(c.id, d);
  return d;
}

/** Keep a case that arrived (checked by replaying it), and send it on if it isn't for this device. */
async function accept(e: Envelope): Promise<boolean> {
  const parsed = envelopeSchema.safeParse(e);
  if (!parsed.success) return false;
  if (e.kind === "case") {
    const got = await receiveCase(localCaseStore, e.body);
    if (got.changed) void beacon(got.case, nextAddress(got.case));
    return true;
  }
  // A moderator reassigned a case this device has a copy of: apply it and send it to them.
  const kept = await localCaseStore.get(e.body.case_id);
  if (!kept) return false;
  const moderator: CaseActor = { id: e.from.id, name: e.from.name, roles: ["moderator"], admin: false };
  const roles = kept.status === "waiting" ? (kept.waiting_role ? [kept.waiting_role] : []) : kept.finish_roles;
  await service.reassign(moderator, kept.id, { member: e.body.to.member, name: e.body.to_name, ...(e.body.reason ? { reason: e.body.reason } : {}) }, roles);
  const next = (await localCaseStore.get(kept.id))!;
  await handOn(next);
  return true;
}

// Straight from a member's device.
onTeamData(async (_from, payload) => accept(payload as Envelope));

const collecting = ref(false);
export const lastCollected = ref<string | null>(null);
let inflight: Promise<number> | null = null;
/** Collect envelopes for this device, its member and their roles; a call while one runs shares it. */
export function collect(): Promise<number> {
  return (inflight ??= collectNow().finally(() => (inflight = null)));
}
async function collectNow(): Promise<number> {
  await capsReady();
  if (!onDevices.value) return 0;
  collecting.value = true;
  let n = 0;
  try {
    const a = await deviceActor();
    const to = { roles: a.guest ? [] : [...a.roles], member: a.guest ? undefined : a.id, device: a.device };
    for (const box of Object.values(mailboxes())) {
      if (!box) continue;
      const items = await box.inbox(to).catch(() => [] as Envelope[]);
      for (const e of items) {
        try {
          if (await accept(e)) {
            await box.pick(e.id, a.guest ? "a kiosk" : a.name);
            n++;
          }
        } catch {
          /* a case that doesn't check out stays where it is */
        }
      }
    }
    lastCollected.value = new Date().toISOString();
  } finally {
    collecting.value = false;
  }
  return n;
}

/** How far each waiting envelope got: delivered (picked up) or expired. */
export async function refreshDeliveries(caseId: string): Promise<Delivery[]> {
  await capsReady();
  const list = await deliveriesOf(caseId);
  const { box, relay } = mailboxes();
  for (const via of ["box", "relay"] as const) {
    const mb = via === "box" ? box : relay;
    const waiting = list.filter((d) => d.via === via && d.state === "waiting");
    if (!mb || !waiting.length) continue;
    const st = await mb.status(waiting.map((d) => d.envelope)).catch(() => ({}) as Awaited<ReturnType<Mailbox["status"]>>);
    for (const d of waiting) {
      const s = st[d.envelope];
      if (!s || s.state === "waiting") continue;
      d.state = s.state === "delivered" ? "delivered" : "expired";
      d.picked_by = s.picked_by;
      await saveDelivery(caseId, d);
    }
  }
  // Expired by the clock even when the mailbox can't be reached.
  const now = new Date().toISOString();
  for (const d of list) if (d.state === "waiting" && d.expires_at && d.expires_at <= now) await saveDelivery(caseId, { ...d, state: "expired" });
  return deliveriesOf(caseId);
}

// ---- what the kiosk calls ------------------------------------------------------------------------

export async function startOnDevice(entry: string, journey: string, answers: unknown, steps: unknown): Promise<{ case: CaseSummary; delivery: Delivery | null }> {
  const { case: c } = await service.start(await deviceActor(), { entry, journey, answers, steps });
  return { case: c, delivery: await handOn((await localCaseStore.get(c.id))!) };
}
export async function actOnDevice(key: string, answers: unknown, steps: unknown): Promise<{ case: CaseSummary; delivery: Delivery | null }> {
  const { case: c } = await service.act(await deviceActor(), key, { answers, steps });
  return { case: c, delivery: await handOn((await localCaseStore.get(c.id))!) };
}
export async function openOnDevice(key: string) {
  const a = await deviceActor();
  const d = await service.get(a, key);
  return { ...d, deliveries: await refreshDeliveries(d.case.id) };
}
export async function noteOnDevice(key: string, text: string) {
  return service.note(await deviceActor(), key, { text });
}
/** Close it here, and tell the kiosk it started on. */
export async function finishOnDevice(key: string, decision: "done" | "declined", note?: string) {
  const r = await service.finish(await deviceActor(), key, { decision, ...(note?.trim() ? { note: note.trim() } : {}) });
  const c = (await localCaseStore.get(r.case.id))!;
  void beacon(c, null);
  if (c.starter_device && c.starter_device !== (await thisDevice()).id) {
    const a = await deviceActor();
    const { box, relay } = mailboxes();
    const e = caseEnvelope(c, await localCaseStore.events(c.id), { device: c.starter_device }, { id: a.id, name: a.name, device: a.device! }, casesCaps.value.relayHours);
    await saveDelivery(c.id, await deliver(e, "the kiosk it was started on", { online: [], direct: async () => false, box, relay, hours: { box: BOX_TTL_HOURS, relay: casesCaps.value.relayHours } }));
  }
  return r;
}
export async function queueOnDevice() {
  return service.list(await deviceActor());
}
/** Send it again (an envelope expired, or nobody could take it then). */
export async function resend(caseId: string): Promise<Delivery | null> {
  const c = await localCaseStore.get(caseId);
  return c ? handOn(c) : null;
}

// ---- moderators: who has what, and reassigning ------------------------------------------------------

/** The beacons on the box and the relay, newest per case. */
export async function board(): Promise<Beacon[]> {
  await capsReady();
  const out = new Map<string, Beacon>();
  for (const mb of Object.values(mailboxes())) {
    if (!mb) continue;
    for (const b of await mb.beacons().catch(() => [] as Beacon[])) if (!out.has(b.case_id) || out.get(b.case_id)!.updated_at < b.updated_at) out.set(b.case_id, b);
  }
  return [...out.values()].filter((b) => b.status === "waiting" || b.status === "to_finish").sort((x, y) => x.updated_at.localeCompare(y.updated_at));
}

/**
 * Give a case to one member: a reassign envelope to every device with a copy, the first of which
 * to collect it sends the case to that member. (A copy on this device is reassigned at once.)
 */
export async function reassignOnDevices(b: Beacon, member: { id: string; name: string }, reason: string | null) {
  const a = await deviceActor();
  const here = await localCaseStore.get(b.case_id);
  if (here) {
    const roles = here.status === "waiting" ? (here.waiting_role ? [here.waiting_role] : []) : here.finish_roles;
    await service.reassign(a, here.id, { member: member.id, name: member.name, ...(reason ? { reason } : {}) }, roles);
    return handOn((await localCaseStore.get(here.id))!);
  }
  const { box, relay } = mailboxes();
  if (!box && !relay) throw new Error("Reassigning needs the box or the relay: nobody else holds a copy this device can reach.");
  const now = new Date();
  for (const device of b.copies) {
    const e: Envelope = {
      id: crypto.randomUUID(),
      kind: "reassign",
      to: { device },
      from: { id: a.id, name: a.name, device: a.device! },
      case_id: b.case_id,
      ref: b.ref,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + casesCaps.value.relayHours * 3_600_000).toISOString(),
      body: { case_id: b.case_id, ref: b.ref, to: { member: member.id }, to_name: member.name, by: a.name, reason },
    };
    // The box if it can be reached, else the relay.
    try {
      if (!box) throw new Error("no box");
      await box.post(e);
    } catch {
      if (!relay) throw new Error("The box can't be reached and there is no relay: try again when it can.");
      await relay.post(e);
    }
  }
  return null;
}

/** Cases this device keeps (for "You started" on a member's device, and the board's own copies). */
export const localCases = allLocalCases;

let timer: ReturnType<typeof setInterval> | null = null;
/**
 * Start listening for cases on this device: a signed-in member joins the team's channel (so cases
 * can arrive straight from another device), and the box and relay are checked now and every minute.
 */
export function startCaseNetwork() {
  if (!onDevices.value) return;
  if (kioskViewer.value.member && !team.me.value) void team.load();
  void collect();
  timer ??= setInterval(() => void collect(), 60_000);
}
