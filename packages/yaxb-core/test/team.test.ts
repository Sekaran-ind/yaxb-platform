// The team (TEAM-1..6) and its signaling (TEAM-10, TEAM-20, TEAM-50): pairing, relaying unread,
// presence and invitations, and the last-administrator rule, on the memory and D1 stores.
import { describe, expect, it } from "vitest";
import { createMemoryModeratorStore, createModeratorService, TeamRuleError, type ModeratorStore } from "../src/moderators/index.js";
import { createD1ModeratorStore } from "../src/stores/d1.js";
import { CLOSE_NOT_ALLOWED, CLOSE_ROOM_FULL, leavesNoAdministrator, memberStatus, PairingHub, Presence, roomName, teamMember, type HubSocket } from "../src/team/index.js";
import { sqliteD1 } from "./sqlite-d1.js";

class FakeSocket implements HubSocket {
  sent: unknown[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("pairing two devices", () => {
  it("names a room the same from either side, per channel", () => {
    expect(roomName(B, A)).toBe(roomName(A, B));
    expect(roomName(A, B, "video")).not.toBe(roomName(A, B, "chat"));
  });

  it("pairs two members, makes the newcomer the initiator, and relays without reading", () => {
    const hub = new PairingHub<FakeSocket>();
    const room = roomName(A, B);
    const a = new FakeSocket();
    const b = new FakeSocket();
    expect(hub.join(room, a, A)).toBe(true);
    expect(a.sent).toEqual([]);
    expect(hub.join(room, b, B)).toBe(true);
    expect(a.sent).toEqual([{ type: "ready", initiator: false }]);
    expect(b.sent).toEqual([{ type: "ready", initiator: true }]);
    const blob = JSON.stringify({ type: "offer", sdp: { type: "offer", sdp: "v=0…" } });
    hub.relay(room, b, blob);
    expect(a.sent.at(-1)).toEqual(JSON.parse(blob));
    expect(b.sent).toHaveLength(1);
    hub.leave(room, b);
    expect(a.sent.at(-1)).toEqual({ type: "peer-left" });
    expect(hub.size(room)).toBe(1);
  });

  it("refuses a third device, the same member twice, and anyone outside the pair", () => {
    const hub = new PairingHub<FakeSocket>();
    const room = roomName(A, B, "video");
    hub.join(room, new FakeSocket(), A);
    const again = new FakeSocket();
    expect(hub.join(room, again, A)).toBe(false);
    expect(again.closed?.code).toBe(CLOSE_ROOM_FULL);
    const outsider = new FakeSocket();
    expect(hub.join(room, outsider, C)).toBe(false);
    expect(outsider.closed?.code).toBe(CLOSE_NOT_ALLOWED);
    hub.join(room, new FakeSocket(), B);
    const third = new FakeSocket();
    expect(hub.join(room, third, B)).toBe(false);
    expect(third.closed?.code).toBe(CLOSE_ROOM_FULL);
  });
});

describe("presence and invitations", () => {
  it("tells everyone who is online, with availability, across a member's devices", () => {
    const p = new Presence<FakeSocket>();
    const a = new FakeSocket();
    const b1 = new FakeSocket();
    const b2 = new FakeSocket();
    p.add(a, A);
    p.add(b1, B);
    p.add(b2, B);
    expect(a.sent.at(-1)).toEqual({ type: "presence", online: [{ id: A, availability: "available" }, { id: B, availability: "available" }] });
    p.message(b1, JSON.stringify({ type: "availability", value: "busy" }));
    expect(a.sent.at(-1)).toEqual({ type: "presence", online: [{ id: A, availability: "available" }, { id: B, availability: "busy" }] });
    p.remove(b1);
    p.remove(b2);
    expect(a.sent.at(-1)).toEqual({ type: "presence", online: [{ id: A, availability: "available" }] });
  });

  it("delivers invitations to every device of the invitee, and says when they aren't online", () => {
    const p = new Presence<FakeSocket>();
    const a = new FakeSocket();
    const b1 = new FakeSocket();
    const b2 = new FakeSocket();
    p.add(a, A);
    p.add(b1, B);
    p.add(b2, B);
    p.message(a, JSON.stringify({ type: "invite", to: B, channel: "video" }));
    expect(b1.sent.at(-1)).toEqual({ type: "invite", from: A, channel: "video" });
    expect(b2.sent.at(-1)).toEqual({ type: "invite", from: A, channel: "video" });
    p.message(b1, JSON.stringify({ type: "decline", to: A, channel: "video" }));
    expect(a.sent.at(-1)).toEqual({ type: "decline", from: B, channel: "video" });
    p.message(a, JSON.stringify({ type: "invite", to: C, channel: "chat" }));
    expect(a.sent.at(-1)).toEqual({ type: "unavailable", to: C, channel: "chat" });
  });

  it("ignores anything else, including content", () => {
    const p = new Presence<FakeSocket>();
    const a = new FakeSocket();
    const b = new FakeSocket();
    p.add(a, A);
    p.add(b, B);
    const before = b.sent.length;
    p.message(a, JSON.stringify({ type: "invite", to: B, channel: "chat", text: "hello" }));
    p.message(a, JSON.stringify({ type: "message", to: B, text: "hello" }));
    p.message(a, "not json");
    expect(b.sent.length).toBe(before);
  });
});

describe("members", () => {
  it("are invited until they first sign in, suspended when revoked", () => {
    const base = { status: "active" as const, expires_at: null, last_seen_at: null };
    expect(memberStatus(base)).toBe("invited");
    expect(memberStatus({ ...base, last_seen_at: "2026-11-12T10:00:00Z" })).toBe("active");
    expect(memberStatus({ ...base, status: "revoked" })).toBe("suspended");
    expect(memberStatus({ ...base, expires_at: "2020-01-01T00:00:00Z" })).toBe("expired");
  });

  it("show their display name, roles and availability only", () => {
    const m = { id: A, name: "Elizabeth", label: "x", roles: ["moderator" as const], status: "active" as const, key_prefix: "yaxb_mod_abcd…", created_at: "", expires_at: null, last_seen_at: "2026-11-12T10:00:00Z", reviews: 3 };
    expect(teamMember(m, { display_name: "Liz", preferences: { availability: "away" } })).toEqual({ id: A, name: "Liz", roles: ["moderator"], status: "active", availability: "away" });
  });
});

const stores: [string, () => ModeratorStore][] = [
  ["memory", createMemoryModeratorStore],
  ["D1 (SQLite)", () => createD1ModeratorStore(sqliteD1())],
];

describe.each(stores)("team management: %s", (_n, make) => {
  it("keeps at least one active administrator (TEAM-6)", async () => {
    const store = make();
    const svc = createModeratorService(store);
    const admin = (await svc.issue({ name: "Admin", roles: ["administrator", "moderator"] })).moderator;
    const mod = (await svc.issue({ name: "Mod", roles: ["moderator"] })).moderator;
    await expect(svc.revoke(admin.id)).rejects.toThrow(TeamRuleError);
    await expect(svc.remove(admin.id)).rejects.toThrow(TeamRuleError);
    await expect(svc.change(admin.id, { roles: ["moderator"] })).rejects.toThrow(TeamRuleError);
    await svc.change(mod.id, { roles: ["moderator", "administrator"] });
    await svc.change(admin.id, { roles: ["moderator"] });
    expect(leavesNoAdministrator(await store.list(), mod.id, { remove: true })).toBe(true);
  });

  it("removes a member and their profile, and records it; reinstating gives a new key", async () => {
    const store = make();
    const svc = createModeratorService(store);
    const { moderator, key } = await svc.issue({ name: "Leaving" });
    await svc.saveProfile(moderator, { display_name: "Leaving" });
    await svc.revoke(moderator.id);
    const back = (await svc.rotate(moderator.id))!;
    expect(await svc.signIn(key)).toBeNull();
    expect((await svc.signIn(back.key))?.id).toBe(moderator.id);
    expect(await svc.remove(moderator.id, { name: "Administrator" })).toBe(true);
    expect(await store.get(moderator.id)).toBeNull();
    expect(await store.getProfile(moderator.id)).toBeNull();
    expect(await svc.signIn(back.key)).toBeNull();
    const actions = (await store.auditLog()).map((e) => e.action);
    expect(actions).toContain("moderator.removed");
    expect(actions).toContain("moderator.reinstated");
  });
});
