// The team and its device-to-device chat and video (docs/specs/11-team-and-collaboration.md).
//
// Members are the moderators, curators and administrators who hold their own key (MOD-20). They
// see each other's names, roles and availability (TEAM-3, TEAM-4), never each other's activity.
//
// Chat and calls are WebRTC, device to device (TEAM-10, TEAM-20, TEAM-51). The server only
// introduces two devices: the same wire protocol as clinux-desk's ChatSignalingRoom and clinic-box
// relay ({type:"ready", initiator}, then opaque offer/answer/ice, {type:"peer-left"}), so the
// browser code can't tell which relay it reached. Nothing relayed is parsed or stored (TEAM-50).
//
// A presence channel says who is online and lets a member invite another to a chat or a call;
// it carries ids, availability and the invitation's kind only, never content.
import { z } from "zod";
import { statusOf, type Moderator, type ModeratorRole } from "../moderators/index.js";

export const AVAILABILITY = ["available", "busy", "away"] as const;
export type Availability = (typeof AVAILABILITY)[number];
export const CHANNELS = ["chat", "video"] as const;
export type Channel = (typeof CHANNELS)[number];

// ---- members -----------------------------------------------------------------------------------------

export type MemberStatus = "invited" | "active" | "suspended" | "expired";

/** What members see of each other (TEAM-3). */
export type TeamMember = { id: string; name: string; roles: ModeratorRole[]; status: MemberStatus; availability: Availability };

/** A member's status (TEAM-1): invited until the first sign-in, suspended when the key is revoked. */
export function memberStatus(m: Pick<Moderator, "status" | "expires_at" | "last_seen_at">, now = new Date()): MemberStatus {
  const s = statusOf(m, now);
  if (s === "revoked") return "suspended";
  if (s === "expired") return "expired";
  return m.last_seen_at ? "active" : "invited";
}

export function teamMember(m: Moderator, profile: { display_name?: string; preferences?: { availability?: Availability } } | null): TeamMember {
  return { id: m.id, name: profile?.display_name || m.name, roles: [...m.roles], status: memberStatus(m), availability: profile?.preferences?.availability ?? "available" };
}

/**
 * TEAM-6: there must always be an active administrator among the members, once there is one.
 * True when the change would leave none (removing, suspending or demoting the last one).
 */
export function leavesNoAdministrator(members: Moderator[], targetId: string, change: { roles?: ModeratorRole[]; remove?: boolean; suspend?: boolean }, now = new Date()): boolean {
  const isAdmin = (m: Moderator) => m.roles.includes("administrator") && statusOf(m, now) === "active";
  const before = members.filter(isAdmin);
  if (!before.length) return false;
  const after = members.filter((m) => {
    if (m.id !== targetId) return isAdmin(m);
    if (change.remove || change.suspend) return false;
    return change.roles ? change.roles.includes("administrator") && statusOf(m, now) === "active" : isAdmin(m);
  });
  return after.length === 0;
}

// ---- signaling: pairing two devices -------------------------------------------------------------------

export const CLOSE_NOT_ALLOWED = 4403;
export const CLOSE_ROOM_FULL = 4409;

/** The smallest socket the hub needs (a Workers WebSocket, a `ws` socket or a test fake). */
export interface HubSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** One room per pair of members and channel, the same name from either side. */
export function roomName(a: string, b: string, channel: Channel = "chat"): string {
  return `${channel}:${[a, b].sort().join(":")}`;
}

/**
 * Pairs two members' devices in a room and forwards what one sends to the other, unread (TEAM-50).
 * The one already waiting answers; the newcomer sends the offer (no "glare").
 */
export class PairingHub<S extends HubSocket = HubSocket> {
  private rooms = new Map<string, { socket: S; member: string }[]>();

  /** Who a room's name allows: exactly the two members it was made for. */
  static allows(name: string, member: string): boolean {
    const [, a, b] = name.split(":");
    return member === a || member === b;
  }

  join(name: string, socket: S, member: string): boolean {
    const members = this.rooms.get(name) ?? [];
    if (!PairingHub.allows(name, member)) {
      socket.close(CLOSE_NOT_ALLOWED, "Not part of this conversation.");
      return false;
    }
    if (members.length >= 2 || members.some((m) => m.member === member)) {
      socket.close(CLOSE_ROOM_FULL, "Already in this conversation on another device.");
      return false;
    }
    const entry = { socket, member };
    members.push(entry);
    this.rooms.set(name, members);
    if (members.length === 2) for (const m of members) send(m.socket, { type: "ready", initiator: m === entry });
    return true;
  }

  relay(name: string, from: S, data: string) {
    for (const m of this.rooms.get(name) ?? []) if (m.socket !== from) m.socket.send(data);
  }

  leave(name: string, socket: S) {
    const current = this.rooms.get(name);
    if (!current) return;
    const remaining = current.filter((m) => m.socket !== socket);
    if (remaining.length === current.length) return;
    if (remaining.length) this.rooms.set(name, remaining);
    else this.rooms.delete(name);
    for (const m of remaining) send(m.socket, { type: "peer-left" });
  }

  size(name: string) {
    return this.rooms.get(name)?.length ?? 0;
  }
}

// ---- presence ---------------------------------------------------------------------------------------

/** What a member's device may say on the presence channel. */
export const presenceMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("availability"), value: z.enum(AVAILABILITY) }),
  z.strictObject({ type: z.literal("invite"), to: z.string().uuid(), channel: z.enum(CHANNELS) }),
  z.strictObject({ type: z.literal("cancel"), to: z.string().uuid(), channel: z.enum(CHANNELS) }),
  z.strictObject({ type: z.literal("decline"), to: z.string().uuid(), channel: z.enum(CHANNELS) }),
]);
export type PresenceMessage = z.infer<typeof presenceMessageSchema>;

export type OnlineMember = { id: string; availability: Availability };

/**
 * Who is online, and invitations between them (a chat opened, a call placed, declined or
 * cancelled). A member may be online on several devices; each gets the invitation.
 */
export class Presence<S extends HubSocket = HubSocket> {
  private sockets = new Map<S, { member: string; availability: Availability }>();

  online(): OnlineMember[] {
    const out = new Map<string, Availability>();
    for (const { member, availability } of this.sockets.values()) out.set(member, availability);
    return [...out].map(([id, availability]) => ({ id, availability })).sort((a, b) => a.id.localeCompare(b.id));
  }

  add(socket: S, member: string, availability: Availability = "available") {
    this.sockets.set(socket, { member, availability });
    this.broadcast();
  }

  remove(socket: S) {
    if (this.sockets.delete(socket)) this.broadcast();
  }

  /** Handle one message from a device; invalid ones are ignored. */
  message(socket: S, raw: string) {
    const me = this.sockets.get(socket);
    if (!me) return;
    let parsed: PresenceMessage;
    try {
      parsed = presenceMessageSchema.parse(JSON.parse(raw));
    } catch {
      return;
    }
    if (parsed.type === "availability") {
      for (const [s, v] of this.sockets) if (v.member === me.member) this.sockets.set(s, { ...v, availability: parsed.value });
      this.broadcast();
      return;
    }
    if (parsed.to === me.member) return;
    const targets = [...this.sockets].filter(([, v]) => v.member === parsed.to).map(([s]) => s);
    if (!targets.length) {
      send(socket, { type: "unavailable", to: parsed.to, channel: parsed.channel });
      return;
    }
    for (const t of targets) send(t, { type: parsed.type, from: me.member, channel: parsed.channel });
  }

  private broadcast() {
    const online = this.online();
    for (const s of this.sockets.keys()) send(s, { type: "presence", online });
  }
}

function send(socket: HubSocket, msg: unknown) {
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    /* closed */
  }
}
