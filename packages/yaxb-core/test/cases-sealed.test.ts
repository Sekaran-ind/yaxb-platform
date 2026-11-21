// A case handed from device to device with a step hidden from one of the people on the way: the step
// is sealed for those who may read it, every device carries it, and the people between can't read it.
import { describe, expect, it } from "vitest";
import { compileBundle } from "@sekaran-ind/yaxb-journeys/bundle";
import { createCaseService, createMemoryCaseStore, openCase, receiveCase, sealCase, sealedSteps, type CaseActor, type KeyDirectory } from "../src/cases/index.js";
import { generateKeyPair, type KeyPair } from "../src/seal/index.js";

const CLINIC = `kind: service
id: clinic
title: Clinic
roles: [{ id: nurse, label: Nurse }, { id: doctor, label: Doctor }, { id: clerk, label: Clerk }]
journeys:
  - id: visit
    title: Visit
    roles: { initiate: [visitor], complete: [doctor] }
    screens:
      - id: symptoms
        title: Symptoms
        access: { starter: rw, nurse: r, doctor: r }
        questions: [{ id: what, type: text, label: What }, { id: urgent, type: boolean, label: Urgent }]
      - id: route
        decide:
          - { if: "answers.symptoms.urgent == true", to: triage }
          - { to: billing }
      - id: triage
        title: Triage
        role: nurse
        access: { nurse: rw, doctor: r }
        questions: [{ id: bp, type: text, label: Blood pressure }]
        next: billing
      - id: billing
        title: Billing
        role: clerk
        questions: [{ id: code, type: text, label: Code }]
      - id: done
        result: { title: Done }
`;
const journey = compileBundle(CLINIC).journeys[0]!;
const journeyFor = async (entry: string) => (entry === "e1" ? { journey, entry_id: "e1", service_id: "clinic", service_title: "Clinic", revision: 1 } : null);
const visitor: CaseActor = { id: "guest:abc", name: "Visitor", roles: [], admin: false, guest: true };
const nurse: CaseActor = { id: "n", name: "Nia", roles: ["nurse"], admin: false };
const clerk: CaseActor = { id: "c", name: "Cy", roles: ["clerk"], admin: false };
const doctor: CaseActor = { id: "d", name: "Dev", roles: ["doctor"], admin: false };

/** A device: its own store and case service, and its own key. */
async function device() {
  const store = createMemoryCaseStore();
  return { store, svc: createCaseService(store, { journeyFor }), key: await generateKeyPair() };
}

async function world() {
  const [v, n, c, d, a] = await Promise.all([device(), device(), device(), device(), generateKeyPair()]);
  const directory: KeyDirectory = {
    forRoles: async (roles) => [...(roles.includes("nurse") ? [n.key] : []), ...(roles.includes("doctor") ? [d.key] : []), ...(roles.includes("clerk") ? [c.key] : [])].map((k: KeyPair) => ({ id: k.id, jwk: k.jwk })),
    admins: async () => [{ id: a.id, jwk: a.jwk }],
  };
  const starterKey = { id: v.key.id, jwk: v.key.jwk };
  /** Send the case at `from` on to `to`'s device, as an envelope would, and open what `to` can read. */
  const hand = async (from: Awaited<ReturnType<typeof device>>, id: string, to: Awaited<ReturnType<typeof device>>) => {
    const c0 = (await from.store.get(id))!;
    const sealed = await sealCase(c0, { directory, starterKey });
    const wire = JSON.parse(JSON.stringify({ case: sealed, events: await from.store.events(id) })); // what travels
    const got = await receiveCase(to.store, wire);
    const opened = await openCase(got.case, to.key);
    await to.store.put(opened);
    return { wire, opened };
  };
  return { v, n, c, d, a, hand };
}

describe("sealed steps on the way", () => {
  it("carries a step through a person who may not read it, and the reader still gets it", async () => {
    const { v, n, c, d, hand } = await world();
    const started = await v.svc.start(visitor, { entry: "e1", journey: "visit", answers: { symptoms: { what: "Chest pain", urgent: true } } });
    const id = started.case.id;

    // Visitor -> nurse: the nurse may read the symptoms and does the triage.
    const toNurse = await hand(v, id, n);
    expect(sealedSteps(toNurse.wire.case)).toEqual(["symptoms"]);
    expect(JSON.stringify(toNurse.wire)).not.toContain("Chest pain");
    expect(toNurse.opened.run.answers.symptoms).toEqual({ what: "Chest pain", urgent: true });
    await n.svc.act(nurse, id, { answers: { triage: { bp: "150/95" } } });

    // Nurse -> clerk: the clerk reads neither the symptoms nor the triage, and still takes the case on.
    const toClerk = await hand(n, id, c);
    expect(sealedSteps(toClerk.wire.case).sort()).toEqual(["symptoms", "triage"]);
    expect(JSON.stringify(toClerk.wire)).not.toMatch(/Chest pain|150\/95/);
    expect(JSON.stringify(await c.store.get(id))).not.toMatch(/Chest pain|150\/95/);
    expect(Object.keys((await c.store.get(id))!.run.answers)).toEqual([]);
    await c.svc.act(clerk, id, { answers: { billing: { code: "B7" } } });
    expect((await c.store.get(id))!.status).toBe("to_finish");

    // Clerk -> doctor: nothing the clerk holds is in the clear, and the doctor reads all of it.
    const toDoctor = await hand(c, id, d);
    expect(toDoctor.opened.run.answers).toEqual({ symptoms: { what: "Chest pain", urgent: true }, triage: { bp: "150/95" }, billing: { code: "B7" } });
    expect(toDoctor.opened.run.sealed).toBeUndefined();
    expect((await d.store.get(id))!.status).toBe("to_finish");
  });

  it("lets the person who started it read their own step when the case comes back, and the administrator read all", async () => {
    const { v, n, a, hand } = await world();
    const started = await v.svc.start(visitor, { entry: "e1", journey: "visit", answers: { symptoms: { what: "Cough", urgent: false } } });
    const toNurse = await hand(v, started.case.id, n);
    expect(Object.keys(toNurse.opened.run.answers)).toEqual(["symptoms"]);
    const back = await receiveCase(v.store, JSON.parse(JSON.stringify({ case: await sealCase((await n.store.get(started.case.id))!, { directory: { forRoles: async () => [], admins: async () => [{ id: a.id, jwk: a.jwk }] }, starterKey: { id: v.key.id, jwk: v.key.jwk } }), events: [] })));
    // The visitor kept what it wrote in the clear, and could open it anyway.
    expect(back.case.run.answers.symptoms).toEqual({ what: "Cough", urgent: false });
    const sealedForAdmin = await sealCase((await n.store.get(started.case.id))!, { directory: { forRoles: async () => [], admins: async () => [{ id: a.id, jwk: a.jwk }] }, starterKey: null });
    expect((await openCase(sealedForAdmin, a)).run.answers.symptoms).toEqual({ what: "Cough", urgent: false });
  });

  it("is not sent when nobody could read a step, and a changed or moved seal is refused", async () => {
    const { v, n, hand } = await world();
    const { case: c } = await v.svc.start(visitor, { entry: "e1", journey: "visit", answers: { symptoms: { what: "x", urgent: true } } });
    const full = (await v.store.get(c.id))!;
    await expect(sealCase(full, { directory: { forRoles: async () => [], admins: async () => [] }, starterKey: null })).rejects.toThrow(/No device can read/);
    // A sealed step moved to another step id is refused when received.
    const { wire } = await hand(v, c.id, n);
    const bad = JSON.parse(JSON.stringify(wire));
    bad.case.run.sealed.triage = bad.case.run.sealed.symptoms;
    await expect(receiveCase(createMemoryCaseStore(), bad)).rejects.toThrow(/triage|further|journey/);
    // A copy with the same sealed step moved can't be opened for the wrong step.
    const nurseKey = n.key;
    const moved = { ...wire.case, id: "other", run: { ...wire.case.run } };
    expect((await openCase(moved, nurseKey)).run.sealed).toBeTruthy();
  });

  it("a decision that depends on a step the device can't read, and wasn't recorded, stops instead of guessing", async () => {
    const { v, c } = await world();
    const { case: started } = await v.svc.start(visitor, { entry: "e1", journey: "visit", answers: { symptoms: { what: "x", urgent: true } } });
    const full = (await v.store.get(started.id))!;
    // Sealed, but without the recorded way (as a careless sender would make it): a device that can't open it can't take the decision.
    const { sealed, ...run } = { ...full.run, sealed: { symptoms: { v: 1, iv: "", ct: "", keys: {} } }, answers: {} as Record<string, Record<string, unknown>> };
    const broken = { ...full, run: { ...run, sealed, steps: {} } };
    await c.store.put(broken);
    await expect(c.svc.act(nurse, started.id, { answers: { triage: { bp: "120/80" } } })).rejects.toThrow(/can't read/);
  });
});
