// Recording what happens to a service's journeys (MET-2), for its dashboard and activity log. Only a
// service with storage records anything: its events go to the organisation's box, or to the server
// (the paid plan); with none, nothing leaves the device. Events are facts (which journey and screen,
// when, how long, the role it went to; a staff member's name for their own actions), never answers.
// They queue here and go every few seconds, and when the page is hidden; a failed send keeps them.
import { newEvent, type EventKind, type ServiceEvent } from "@sekaran-ind/yaxb-core/metrics";
import { catalogue, kioskViewer } from "@/composables/library";
import { settings } from "@/composables/settings";

const queue: ServiceEvent[] = [];
const MAX_QUEUE = 500;

/** Where this service keeps its events: none, box or server. */
export const storageOf = (entryId: string | null) => (entryId ? (catalogue.value.find((s) => s.entry_id === entryId)?.storage ?? "none") : "none");

/** Record one fact about a service's journey (nothing happens for a service without storage). */
export function recordEvent(entryId: string | null, e: { journey: string; kind: EventKind; run: string; step?: string | null; role?: string | null; ms?: number | null; ok?: boolean | null; outcome?: string | null; staff?: boolean }) {
  if (!entryId || storageOf(entryId) === "none") return;
  const { staff, ...rest } = e;
  queue.push(newEvent({ ...rest, service: entryId, ms: rest.ms === undefined || rest.ms === null ? null : Math.max(0, Math.round(rest.ms)), actor: staff && kioskViewer.value.member ? (kioskViewer.value.name ?? null) : null }));
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  schedule();
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
  if (!queue.length) return;
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
