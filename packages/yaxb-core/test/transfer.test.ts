import { describe, expect, it } from "vitest";
import { compileBundle } from "@sekaran-ind/yaxb-journeys/bundle";
import {
  addressedTo,
  beaconOf,
  caseEnvelope,
  createCaseService,
  createMemoryCaseStore,
  createMemoryMailbox,
  envelopeSchema,
  expiryOf,
  nextAddress,
  receiveCase,
  RELAY_MAX_HOURS,
  type CaseActor,
  type Mailbox,
} from "../src/cases/index.js";
import { createD1Relay } from "../src/stores/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

const YAML = `kind: service
id: marathon
title: Marathon
roles: [{ id: organiser, label: Organiser }, { id: marshal, label: Marshal }]
journeys:
  - id: register
    title: Register
    roles: { complete: [marshal] }
    screens:
      - { id: about-you, title: About you, questions: [{ id: name, type: text, label: Name, required: true }] }
      - { id: approve, title: Approve, role: organiser, questions: [{ id: approved, type: boolean, label: Approved }] }
      - { id: shirt, title: Shirt, questions: [{ id: size, type: text, label: Size, required: true }] }
      - { id: done, result: { title: Done } }
`;
const journey = compileBundle(YAML).journeys[0]!;
const journeyFor = async () => ({ journey, entry_id: "e1", service_id: "marathon", service_title: "Marathon", revision: 1 });
const kiosk: CaseActor = { id: "guest:dev-kiosk", name: "Visitor", roles: [], admin: false, guest: true, device: "dev-kiosk" };
const organiser: CaseActor = { id: "m-org", name: "Olu", roles: ["organiser"], admin: false, device: "dev-olu" };
const moderator: CaseActor = { id: "m-mod", name: "Meena", roles: ["moderator"], admin: false, device: "dev-meena" };
const from = (a: CaseActor) => ({ id: a.id, name: a.name, device: a.device! });

describe("handing a case between devices", () => {
  it("goes to the next role's devices, comes back to the visitor's kiosk, and is checked on arrival", async () => {
    // The kiosk keeps its own copy; the organiser's device keeps theirs.
    const kioskStore = createMemoryCaseStore();
    const orgStore = createMemoryCaseStore();
    const atKiosk = createCaseService(kioskStore, { journeyFor });
    const atOrg = createCaseService(orgStore, { journeyFor });

    const { case: started } = await atKiosk.start(kiosk, { entry: "e1", journey: "register", answers: { "about-you": { name: "Asha" } } });
    const full = (await kioskStore.get(started.id))!;
    expect(full.starter_device).toBe("dev-kiosk");
    const to = nextAddress(full)!;
    expect(to).toEqual({ roles: ["organiser"] });
    expect(addressedTo(to, { roles: ["organiser"], member: "m-org" })).toBe(true);
    expect(addressedTo(to, { roles: ["marshal"], member: "m-mar" })).toBe(false);

    const env = caseEnvelope(full, await kioskStore.events(full.id), to, from(kiosk), 48);
    expect(envelopeSchema.safeParse(JSON.parse(JSON.stringify(env))).success).toBe(true);
    const got = await receiveCase(orgStore, env.body);
    expect(got.changed).toBe(true);
    expect((await receiveCase(orgStore, env.body)).changed).toBe(false);

    // The organiser answers on their device; it goes back to the kiosk it started on.
    await atOrg.act(organiser, started.id, { answers: { approve: { approved: true } } });
    const after = (await orgStore.get(started.id))!;
    expect(nextAddress(after)).toEqual({ device: "dev-kiosk" });
    const back = caseEnvelope(after, await orgStore.events(after.id), nextAddress(after)!, from(organiser), 48);
    expect((await receiveCase(kioskStore, back.body)).changed).toBe(true);
    // The visitor carries on at the kiosk with their reference.
    const theirs = await atKiosk.get(kiosk, started.ref);
    expect(theirs.turn).toBe(true);
  });

  it("refuses a case that claims to be further along than its answers", async () => {
    const store = createMemoryCaseStore();
    const svc = createCaseService(store, { journeyFor });
    const { case: c } = await svc.start(kiosk, { entry: "e1", journey: "register", answers: { "about-you": { name: "A" } } });
    const full = (await store.get(c.id))!;
    const forged = { ...full, status: "waiting" as const, waiting_step: "shirt", waiting_role: null };
    await expect(receiveCase(createMemoryCaseStore(), { case: forged, events: [] })).rejects.toThrow(/further along/);
    const skipped = { ...full, run: { ...full.run, answers: { ...full.run.answers, shirt: { size: "M" } } } };
    await expect(receiveCase(createMemoryCaseStore(), { case: skipped, events: [] })).rejects.toThrow(/don't fit/);
    await expect(receiveCase(createMemoryCaseStore(), { nothing: true })).rejects.toThrow(/isn't a case/);
  });

  it("lets a moderator give a case to one member of the role, who alone may carry on", async () => {
    const store = createMemoryCaseStore();
    const svc = createCaseService(store, { journeyFor });
    const { case: c } = await svc.start(kiosk, { entry: "e1", journey: "register", answers: { "about-you": { name: "A" } } });
    await expect(svc.reassign(organiser, c.id, { member: "m-org2", name: "Ola" }, ["organiser"])).rejects.toThrow(/moderator/);
    await expect(svc.reassign(moderator, c.id, { member: "m-mar", name: "Mira" }, ["marshal"])).rejects.toThrow(/role/);
    const r = await svc.reassign(moderator, c.id, { member: "m-org2", name: "Ola", reason: "Olu is away" }, ["organiser"]);
    expect(r.case.assignee).toBe("m-org2");
    expect(nextAddress({ ...(await store.get(c.id))! })).toEqual({ member: "m-org2" });
    expect((await svc.get(organiser, c.id)).turn).toBe(false);
    const ola: CaseActor = { id: "m-org2", name: "Ola", roles: ["organiser"], admin: false };
    expect((await svc.get(ola, c.id)).turn).toBe(true);
    const after = await svc.act(ola, c.id, { answers: { approve: { approved: true } } });
    expect(after.case.assignee).toBeNull();
    expect((await svc.get(ola, c.id)).events.map((e) => e.kind)).toEqual(["started", "reassigned", "answered"]);
    // The moderator reassigned it without reading it.
    await expect(svc.get(moderator, c.id)).rejects.toThrow(/isn't yours/);
  });
});

const mailboxes: [string, (now: () => Date) => Mailbox][] = [
  ["memory", (now) => createMemoryMailbox(now)],
  ["cloud relay (D1)", (now) => createD1Relay(sqliteD1(), now)],
];
for (const [name, make] of mailboxes) {
  describe(`a mailbox, ${name}`, () => {
    it("holds an envelope until it is picked up or expires, and keeps no body after pick-up", async () => {
      let t = new Date("2026-11-14T10:00:00Z");
      const box = make(() => t);
      const store = createMemoryCaseStore();
      const svc = createCaseService(store, { journeyFor, now: () => t });
      const { case: c } = await svc.start(kiosk, { entry: "e1", journey: "register", answers: { "about-you": { name: "A" } } });
      const full = (await store.get(c.id))!;
      const e1 = caseEnvelope(full, [], { roles: ["organiser"] }, from(kiosk), 48, t);
      const e2 = caseEnvelope(full, [], { roles: ["organiser"] }, from(kiosk), 1, t);
      await box.post(e1);
      await box.post(e2);
      expect((await box.inbox({ roles: ["marshal"] })).length).toBe(0);
      expect((await box.inbox({ roles: ["organiser"] })).map((e) => e.id).sort()).toEqual([e1.id, e2.id].sort());
      expect(await box.pick(e1.id, "Olu")).toBe(true);
      expect(await box.pick(e1.id, "Ola")).toBe(false);
      expect((await box.status([e1.id]))[e1.id]).toEqual({ state: "delivered", picked_by: "Olu" });

      // Two hours on, the one-hour envelope has expired: its sender can send it again.
      t = new Date("2026-11-14T12:00:00Z");
      expect((await box.inbox({ roles: ["organiser"] })).length).toBe(0);
      expect((await box.status([e2.id]))[e2.id]!.state).toBe("expired");

      await box.putBeacon(beaconOf(full, { roles: ["organiser"] }, null, ["dev-kiosk"], t, 24));
      expect((await box.beacons()).map((b) => [b.ref, b.role])).toEqual([[full.ref, "organiser"]]);
      expect(JSON.stringify(await box.beacons())).not.toContain('"A"');
      t = new Date("2026-11-16T12:00:00Z");
      expect(await box.beacons()).toEqual([]);
    });
  });
}

describe("expiry", () => {
  it("clamps how long the relay keeps an envelope", () => {
    const now = new Date("2026-11-14T00:00:00Z");
    expect(expiryOf(48, now)).toBe("2026-11-16T00:00:00.000Z");
    expect(expiryOf(10_000, now)).toBe(new Date(now.getTime() + RELAY_MAX_HOURS * 3_600_000).toISOString());
    expect(expiryOf(0, now)).toBe("2026-11-14T01:00:00.000Z");
  });
});
