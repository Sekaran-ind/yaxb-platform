// Cases (LIB-33..48): catalogue journeys handed between people. Where they are kept is a choice,
// devices first and the cloud last: on the devices that work on them (composables/case-network.ts:
// handed device to device, through the box, or through the transient cloud relay), or centrally in
// the cloud, which is the paid plan (the Worker's /api/cases). This is the one way in for the kiosk,
// whichever is in use: start, carry on, open, note, close, the work queue, resend and reassign.
// A visitor never gets a list (kiosks are shared): they open theirs by its reference.
import type { Beacon, Case, CaseEvent, CaseSummary, Delivery } from "@sekaran-ind/yaxb-core/cases";
import type { RunActor } from "@sekaran-ind/yaxb-journeys";
import { computed, shallowRef } from "vue";
import { api } from "@/lib/api";
import {
  actOnDevice,
  board as boardOnDevices,
  finishOnDevice,
  noteOnDevice,
  onDevices,
  openOnDevice,
  queueOnDevice,
  reassignOnDevices,
  resend as resendOnDevice,
  startCaseNetwork,
  startOnDevice,
} from "./case-network";

export type CaseDetail = { case: Case; events: CaseEvent[]; turn: boolean; actor: RunActor; mayFinish: boolean; mayDecline: boolean; deliveries?: Delivery[] };
export type CaseQueue = { mine: CaseSummary[]; started: CaseSummary[]; others: CaseSummary[] };
export type Handed = { case: CaseSummary; delivery: Delivery | null };

export { onDevices, startCaseNetwork };
const queue = shallowRef<CaseQueue>({ mine: [], started: [], others: [] });

/** Fetch the work queue again (nothing for a visitor). Offline, it keeps what it had. */
export async function refreshQueue(): Promise<void> {
  try {
    queue.value = onDevices.value ? await queueOnDevice() : await api<CaseQueue>("/api/cases");
  } catch {
    /* offline or no Worker */
  }
}
export const caseQueue = computed(() => queue.value);
export const waitingForMe = computed(() => queue.value.mine.length);

/** A visitor's case is theirs by its reference; everyone else's by its id. */
const keyOf = (d: CaseDetail) => (d.actor.starter && d.case.started_by.startsWith("guest:") ? d.case.ref : d.case.id);

/** Hand a run over: a new case. */
export async function startCase(entry: string, journey: string, answers: unknown, steps: unknown): Promise<Handed> {
  if (onDevices.value) return startOnDevice(entry, journey, answers, steps);
  return { ...(await api<{ case: CaseSummary }>("/api/cases", { entry, journey, answers, steps })), delivery: null };
}
/** This person's part of a case they carried on. */
export async function actCase(d: CaseDetail, answers: unknown, steps: unknown): Promise<Handed> {
  if (onDevices.value) return actOnDevice(keyOf(d), answers, steps);
  return { ...(await api<{ case: CaseSummary }>(`/api/cases/${encodeURIComponent(keyOf(d))}/act`, { answers, steps })), delivery: null };
}
export const openCase = (key: string): Promise<CaseDetail> => (onDevices.value ? openOnDevice(key.trim()) : api<CaseDetail>(`/api/cases/${encodeURIComponent(key.trim())}`));
export const addNote = (key: string, text: string) => (onDevices.value ? noteOnDevice(key, text) : api<{ event: CaseEvent }>(`/api/cases/${encodeURIComponent(key)}/notes`, { text }));
export const finishCase = (key: string, decision: "done" | "declined", note?: string) =>
  onDevices.value ? finishOnDevice(key, decision, note) : api<{ case: CaseSummary }>(`/api/cases/${encodeURIComponent(key)}/finish`, { decision, ...(note?.trim() ? { note: note.trim() } : {}) });

/** Send a case on again (devices: its envelope expired, or nobody could take it). */
export const resendCase = (caseId: string) => resendOnDevice(caseId);

/** Moderators: who holds which open case, and since when (no answers). */
export async function caseBoard(): Promise<Beacon[]> {
  return onDevices.value ? boardOnDevices() : [];
}
export const reassignCase = (b: Beacon, member: { id: string; name: string }, reason: string | null) => reassignOnDevices(b, member, reason);

/** What a case's status means, in words. */
export function statusText(c: Pick<CaseSummary, "status" | "waiting_role" | "finish_roles">, roleName: (id: string) => string): string {
  if (c.status === "waiting") return c.waiting_role ? `Waiting for ${roleName(c.waiting_role)}` : "Waiting for the person who started it";
  if (c.status === "to_finish") return `To be finished by ${c.finish_roles.map(roleName).join(" or ")}`;
  return c.status === "done" ? "Done" : "Declined";
}

/** How far a hand-over got, in words. */
export function deliveryText(d: Delivery): string {
  const until = d.expires_at ? new Date(d.expires_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  if (d.state === "delivered") return d.via === "device" ? `Delivered to ${d.to_name}'s device.` : `Collected${d.picked_by ? ` by ${d.picked_by}` : ""}.`;
  if (d.state === "expired") return `Nobody collected it before it expired. It is still on this device: send it again.`;
  if (d.state === "not-sent") return `Nobody who can take it is online, and there is no box or relay to leave it with. It stays on this device: send it again later.`;
  return d.via === "box" ? `Waiting on the organisation's box for ${d.to_name}, until ${until}.` : `Waiting in the cloud relay for ${d.to_name} until ${until}. It is deleted then if nobody collects it.`;
}
