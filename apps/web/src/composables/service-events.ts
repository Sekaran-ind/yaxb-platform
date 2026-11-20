// Recording what happens to a service's journeys (MET-2), for its dashboard and activity log. Only a
// service with storage records anything: its events go to the organisation's box, or to the server
// (the paid plan); with none, nothing leaves the device. Events are facts (which journey and screen,
// when, how long, the role it went to; a staff member's name for their own actions), never answers.
// They queue here and go every few seconds, and when the page is hidden; a failed send keeps them.
// An event a published routine waits for (a late check-in, RTN-1) also goes to the server's
// /api/routines/events when its service doesn't keep its events there: it isn't kept, it only sets
// the routine off. Services that keep events on the server set routines off as they arrive.
import { newEvent, type EventKind, type ServiceEvent } from "@sekaran-ind/yaxb-core/metrics";
import { catalogue, kioskViewer, publishedRoutineTriggers } from "@/composables/library";
import { settings } from "@/composables/settings";

const queue: ServiceEvent[] = [];
/** Events for routines, from services that don't keep events on the server. */
const forRoutines: ServiceEvent[] = [];
const MAX_QUEUE = 500;

/** Where this service keeps its events: none, box or server. */
export const storageOf = (entryId: string | null) => (entryId ? (catalogue.value.find((s) => s.entry_id === entryId)?.storage ?? "none") : "none");

/** Record one fact about a service's journey (nothing happens for a service without storage). */
/** `actor`: who an attendance check-in is for (their roster id, never a name); otherwise a signed-in staff member's own action. */
export function recordEvent(entryId: string | null, e: { journey: string; kind: EventKind; run: string; step?: string | null; role?: string | null; ms?: number | null; ok?: boolean | null; outcome?: string | null; staff?: boolean; actor?: string }) {
  if (!entryId) return;
  const storage = storageOf(entryId);
  const routine = storage !== "server" && awaited(entryId, e);
  if (storage === "none" && !routine) return;
  const { staff, actor, ...rest } = e;
  const event = newEvent({ ...rest, service: entryId, ms: rest.ms === undefined || rest.ms === null ? null : Math.max(0, Math.round(rest.ms)), actor: actor ?? (staff && kioskViewer.value.member ? (kioskViewer.value.name ?? null) : null) });
  if (storage !== "none") queue.push(event);
  if (routine) forRoutines.push(event);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (forRoutines.length > MAX_QUEUE) forRoutines.splice(0, forRoutines.length - MAX_QUEUE);
  schedule();
}

/** Whether a published routine waits for this event (its service by id, kind, journey, outcome). */
function awaited(entryId: string, e: { journey: string; kind: string; outcome?: string | null }) {
  const triggers = publishedRoutineTriggers.value;
  if (!triggers.length) return false;
  const id = catalogue.value.find((s) => s.entry_id === entryId)?.id;
  return triggers.some((t) => t.event.service === id && t.event.kind === e.kind && (!t.event.journey || t.event.journey === e.journey) && (!t.event.outcome || t.event.outcome === e.outcome));
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule() {
  timer ??= setTimeout(() => {
    timer = null;
    void flush();
  }, 5000);
}

async function send(storage: string, events: ServiceEvent[]): Promise<boolean> {
  try {
    if (storage === "server") {
      const res = await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(events), keepalive: true });
      return res.ok;
    }
    if (storage === "box" && settings.box.url && settings.box.token) {
      const res = await fetch(`${settings.box.url.replace(/\/+$/, "")}/v1/events`, { method: "POST", headers: { Authorization: `Bearer ${settings.box.token}`, "Content-Type": "application/json" }, body: JSON.stringify(events), keepalive: true });
      return res.ok;
    }
  } catch {
    /* offline: kept for the next try */
  }
  return false;
}

/** Send what is queued, by where each service keeps its events. */
export async function flush() {
  if (forRoutines.length) {
    const batch = forRoutines.splice(0, 200);
    try {
      const res = await fetch("/api/routines/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch), keepalive: true });
      // Refused (not a batch, or too many): dropped; offline or rate limited: kept for the next try.
      if (!res.ok && (res.status === 429 || res.status >= 500)) forRoutines.unshift(...batch);
    } catch {
      forRoutines.unshift(...batch);
    }
  }
  if (!queue.length) {
    if (forRoutines.length) schedule();
    return;
  }
  const batch = queue.splice(0, 200);
  const byStorage = new Map<string, ServiceEvent[]>();
  for (const e of batch) {
    const st = storageOf(e.service);
    byStorage.set(st, [...(byStorage.get(st) ?? []), e]);
  }
  for (const [storage, events] of byStorage) {
    if (storage === "none") continue;
    if (!(await send(storage, events))) queue.unshift(...events);
  }
  if (queue.length) schedule();
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void flush());

/**
 * A service's events, for its dashboard and activity log (MET-3): from the organisation's box, or
 * from the server (administrators, moderators and reviewers). None for a service without storage.
 */
export async function loadEvents(entryId: string, since?: string): Promise<ServiceEvent[]> {
  const storage = storageOf(entryId);
  const q = `service=${encodeURIComponent(entryId)}${since ? `&since=${encodeURIComponent(since)}` : ""}`;
  if (storage === "box") {
    if (!settings.box.url || !settings.box.token) throw new Error("This service keeps its records on the box: connect the box in Preferences → Storage.");
    const res = await fetch(`${settings.box.url.replace(/\/+$/, "")}/v1/events?${q}`, { headers: { Authorization: `Bearer ${settings.box.token}` } });
    if (!res.ok) throw new Error(`The box answered ${res.status}.`);
    return ((await res.json()) as { items: ServiceEvent[] }).items;
  }
  if (storage === "server") {
    const res = await fetch(`/api/events?${q}`);
    const body = (await res.json().catch(() => null)) as { items?: ServiceEvent[]; error?: string } | null;
    if (!res.ok) throw Object.assign(new Error(body?.error ?? "Couldn't read the records."), { status: res.status });
    return body?.items ?? [];
  }
  return [];
}
