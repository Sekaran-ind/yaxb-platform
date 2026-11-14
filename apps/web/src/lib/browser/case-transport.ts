// How a case gets to the next device (LIB-43..46), in order:
//   1. device to device: an online member who may take it (the team's peer-to-peer channel);
//   2. the organisation's yaxb-box, which keeps it until someone picks it up;
//   3. the cloud relay, transient: kept only until picked up or expired, then deleted.
// Without any of them it stays on this device, which says so and can send it again later.
// Framework-free: the composable passes who is online and how to reach them.
import type { Address, Beacon, Delivery, Envelope, Mailbox } from "@sekaran-ind/yaxb-core/cases";
import type { BoxConnection } from "@/lib/browser/store";
import { thisDevice } from "./cases-local";

class TransportError extends Error {}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new TransportError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Failed (${res.status}).`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** The organisation's yaxb-box, as a mailbox (its token stays in this browser). */
export function boxMailbox(box: BoxConnection): Mailbox {
  const base = box.url.replace(/\/+$/, "");
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${box.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  return {
    post: async (e) => void (await json(await call("/v1/mailbox", { method: "POST", body: JSON.stringify(e) }))),
    async inbox(to) {
      const q = new URLSearchParams({ roles: to.roles.join(","), ...(to.member ? { member: to.member } : {}), ...(to.device ? { device: to.device } : {}) });
      return (await json<{ items: Envelope[] }>(await call(`/v1/mailbox?${q}`))).items;
    },
    pick: async (id, by) => (await json<{ picked: boolean }>(await call(`/v1/mailbox/${encodeURIComponent(id)}/pick`, { method: "POST", body: JSON.stringify({ by }) }))).picked,
    status: async (ids) => (await json<{ status: Awaited<ReturnType<Mailbox["status"]>> }>(await call(`/v1/mailbox-status?ids=${ids.map(encodeURIComponent).join(",")}`))).status,
    putBeacon: async (b) => void (await json(await call(`/v1/beacons/${encodeURIComponent(b.case_id)}`, { method: "PUT", body: JSON.stringify(b) }))),
    beacons: async () => (await json<{ items: Beacon[] }>(await call("/v1/beacons"))).items,
  };
}

/** The cloud relay (transient), as a mailbox: this device proves itself with its secret. */
export function relayMailbox(): Mailbox {
  const call = async (path: string, init: RequestInit = {}) =>
    fetch(path, { ...init, headers: { "X-Yaxb-Device": (await thisDevice()).secret, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  return {
    post: async (e) => void (await json(await call("/api/relay", { method: "POST", body: JSON.stringify(e) }))),
    inbox: async () => (await json<{ items: Envelope[] }>(await call("/api/relay"))).items,
    pick: async (id) => (await json<{ picked: boolean }>(await call(`/api/relay/${encodeURIComponent(id)}/pick`, { method: "POST", body: "{}" }))).picked,
    status: async (ids) => (await json<{ status: Awaited<ReturnType<Mailbox["status"]>> }>(await call(`/api/relay/status?ids=${ids.map(encodeURIComponent).join(",")}`))).status,
    putBeacon: async (b) => void (await json(await call("/api/relay/beacons", { method: "PUT", body: JSON.stringify(b) }))),
    beacons: async () => (await json<{ items: Beacon[] }>(await call("/api/relay/beacons"))).items,
  };
}

export type Route = {
  /** Members' devices that are online and may take it (by member id, with a name). */
  online: { id: string; name: string }[];
  /** Straight to a member's device; true when it kept it. */
  direct: (member: string, e: Envelope) => Promise<boolean>;
  box: Mailbox | null;
  relay: Mailbox | null;
  /** How long each keeps it: the box holds longer; the relay is transient. */
  hours: { box: number; relay: number };
};

/**
 * Send an envelope on the first way that works. Direct goes to every online member who may take it
 * until one keeps it; then the box; then the relay. The result is what to show and keep.
 */
export async function deliver(e: Envelope, toName: string, route: Route): Promise<Delivery> {
  const base = { envelope: e.id, to: e.to, to_name: toName, sent_at: new Date().toISOString() };
  for (const m of route.online) {
    try {
      if (await route.direct(m.id, e)) return { ...base, via: "device", to_name: m.name, expires_at: null, state: "delivered", picked_by: m.name };
    } catch {
      /* try the next */
    }
  }
  for (const [via, box] of [
    ["box", route.box],
    ["relay", route.relay],
  ] as const) {
    if (!box) continue;
    // Stamped for the route that takes it: the relay never keeps it as long as the box would.
    const stamped = { ...e, expires_at: new Date(Date.now() + route.hours[via] * 3_600_000).toISOString() };
    try {
      await box.post(stamped);
      return { ...base, via, expires_at: stamped.expires_at, state: "waiting" };
    } catch {
      /* try the next */
    }
  }
  return { ...base, via: "none", expires_at: null, state: "not-sent" };
}

/** Who may take a case at this address: online members with the role, or the one member. */
export function recipients(to: Address, members: readonly { id: string; name: string; roles: readonly string[] }[], online: ReadonlySet<string>) {
  return members.filter((m) => online.has(m.id) && ((to.member && m.id === to.member) || to.roles?.some((r) => m.roles.includes(r))));
}
