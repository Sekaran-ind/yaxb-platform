// Step access (rwx) in cases: a step a person may not read is left out of the case they are sent.
import { describe, expect, it } from "vitest";
import { compileBundle } from "@sekaran-ind/yaxb-journeys/bundle";
import { createCaseService, createMemoryCaseStore, type CaseActor } from "../src/cases/index.js";

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
        questions: [{ id: what, type: text, label: What }]
      - id: triage
        title: Triage
        role: nurse
        access: { nurse: rw, doctor: r, starter: "-" }
        questions: [{ id: bp, type: text, label: Blood pressure }]
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
const doctor: CaseActor = { id: "d", name: "Dev", roles: ["doctor"], admin: false };
const clerk: CaseActor = { id: "c", name: "Cy", roles: ["clerk"], admin: false };
const admin: CaseActor = { id: "admin", name: "Administrator", roles: ["administrator"], admin: true };

describe("case access", () => {
  it("sends each person only the steps they may read", async () => {
    const cases = createCaseService(createMemoryCaseStore(), { journeyFor });
    const { case: c } = await cases.start(visitor, { entry: "e1", journey: "visit", answers: { symptoms: { what: "Cough" } } });
    await cases.act(nurse, c.id, { answers: { triage: { bp: "120/80" } } });
    // A step with no access (billing) is as before: everyone who sees the case reads it.
    await cases.act(clerk, c.id, { answers: { billing: { code: "B7" } } });

    const answersOf = async (a: CaseActor, key = c.id) => (await cases.get(a, key)).case.run.answers;
    expect(Object.keys(await answersOf(doctor))).toEqual(["symptoms", "triage", "billing"]);
    expect(Object.keys(await answersOf(nurse))).toEqual(["symptoms", "triage", "billing"]);
    // The clerk answered billing and sees the case, but may not read the nurse's or the visitor's steps.
    const clerkView = await cases.get(clerk, c.id);
    expect(Object.keys(clerkView.case.run.answers)).toEqual(["billing"]);
    expect(clerkView.hidden.sort()).toEqual(["symptoms", "triage"]);
    expect(JSON.stringify(clerkView.case)).not.toContain("120/80");
    // The person who started it reads what they gave, and not the nurse's step.
    const own = await cases.get(visitor, c.ref);
    expect(Object.keys(own.case.run.answers)).toEqual(["symptoms", "billing"]);
    expect(own.hidden).toEqual(["triage"]);
    // Administrators are accountable for the service and read everything.
    expect((await cases.get(admin, c.id)).hidden).toEqual([]);
  });

  it("access can let another role answer a step", async () => {
    const yaml = CLINIC.replace("access: { nurse: rw, doctor: r, starter: \"-\" }", "access: { nurse: rw, clerk: rw, doctor: r }");
    const j = compileBundle(yaml).journeys[0]!;
    const cases = createCaseService(createMemoryCaseStore(), { journeyFor: async () => ({ journey: j, entry_id: "e1", service_id: "clinic", service_title: "Clinic", revision: 1 }) });
    const { case: c } = await cases.start(visitor, { entry: "e1", journey: "visit", answers: { symptoms: { what: "Cough" } } });
    expect((await cases.get(clerk, c.id)).turn).toBe(true); // the clerk may write the step, so it is their turn
    await cases.act(clerk, c.id, { answers: { triage: { bp: "118/76" } } });
    expect((await cases.get(admin, c.id)).case.run.answers.triage).toEqual({ bp: "118/76" });
  });
});
