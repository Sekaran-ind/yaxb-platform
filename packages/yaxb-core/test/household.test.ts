// Household requests in Family (EDN-20..24): the built-in service compiles cleanly, a child's
// request reaches only that child's guardians, a repair reaches whoever handles repairs, and the
// household is checked for mistakes.
import { describe, expect, it } from "vitest";
import { createCaseService, createMemoryCaseStore, type CaseActor } from "../src/cases/index.js";
import {
  HOUSEHOLD_ENTRY,
  householdAllows,
  householdBundle,
  householdCaseJourney,
  householdProblems,
  householdRoles,
  householdSchema,
  profileActorId,
  type Household,
} from "../src/household/index.js";

// Amma and Appa are guardians; Appa handles repairs; Kavin (a child) has Amma as guardian; Ravi is an
// uncle staying with them, a guardian of no one here; Paati is an elder.
const household: Household = householdSchema.parse({
  members: [
    { profile: "amma", roles: ["guardian"] },
    { profile: "appa", roles: ["guardian", "handler"] },
    { profile: "kavin", guardians: ["amma"] },
    { profile: "ravi", roles: ["guardian"] },
    { profile: "paati" },
  ],
});
const actor = (profile: string, name: string): CaseActor => ({ id: profileActorId(profile), name, roles: householdRoles(household, profile), admin: false });
const amma = actor("amma", "Amma");
const appa = actor("appa", "Appa");
const kavin = actor("kavin", "Kavin");
const ravi = actor("ravi", "Ravi");
const paati = actor("paati", "Paati");

const service = () =>
  createCaseService(createMemoryCaseStore(), {
    journeyFor: async (entry, journey) => (entry === HOUSEHOLD_ENTRY ? householdCaseJourney(journey) : null),
    allows: householdAllows(household),
  });

describe("the Household service (EDN-22)", () => {
  it("compiles with no problems, and nothing for the ethics check", () => {
    const b = householdBundle();
    expect(b.problems).toEqual([]);
    expect(b.journeys.map((j) => j.id)).toEqual(["household-ask", "household-repair", "household-outing"]);
    expect(b.roles.map((r) => r.id)).toEqual(["guardian", "handler"]);
  });
});

describe("household requests (EDN-20, EDN-21)", () => {
  it("sends a child's request only to that child's guardians", async () => {
    const cases = service();
    const { case: c } = await cases.start(kavin, { entry: HOUSEHOLD_ENTRY, journey: "household-ask", answers: { what: { thing: "A new football" } } });
    expect(c).toMatchObject({ status: "waiting", waiting_role: "guardian", started_by_name: "Kavin" });
    // Amma is Kavin's guardian: it waits for her. Appa and Ravi are guardians, but not Kavin's.
    expect((await cases.list(amma)).mine.map((x) => x.id)).toEqual([c.id]);
    for (const other of [appa, ravi, paati]) {
      const q = await cases.list(other);
      expect([...q.mine, ...q.others]).toEqual([]);
      await expect(cases.get(other, c.id)).rejects.toThrow(/isn't yours/);
    }
    await expect(cases.act(ravi, c.id, { answers: { decision: { answer: "yes" } } })).rejects.toThrow(/isn't yours/);
    // Kavin sees his own request.
    expect((await cases.list(kavin)).started.map((x) => x.id)).toEqual([c.id]);
    const done = await cases.act(amma, c.id, { answers: { decision: { answer: "yes", note: "On Saturday" } } });
    expect(done.case.status).toBe("done");
    expect(done.case.result).toMatchObject({ title: "Yes", text: "On Saturday", outcome: "agreed" });
  });

  it("sends an elder's request to any guardian, and a repair to whoever handles repairs", async () => {
    const cases = service();
    const { case: ask } = await cases.start(paati, { entry: HOUSEHOLD_ENTRY, journey: "household-ask", answers: { what: { thing: "A ride to the temple" } } });
    for (const g of [amma, appa, ravi]) expect((await cases.list(g)).mine.map((x) => x.id)).toEqual([ask.id]);
    const { case: repair } = await cases.start(kavin, { entry: HOUSEHOLD_ENTRY, journey: "household-repair", answers: { what: { thing: "The tap drips", where: "Kitchen", urgent: false } } });
    expect(repair.waiting_role).toBe("handler");
    // A child's repair still goes only to the child's guardians: Appa handles repairs but isn't Kavin's guardian.
    expect((await cases.list(appa)).mine.map((x) => x.id)).toEqual([ask.id]);
    const { case: adultRepair } = await cases.start(paati, { entry: HOUSEHOLD_ENTRY, journey: "household-repair", answers: { what: { thing: "The fan is noisy" } } });
    expect((await cases.list(appa)).mine.map((x) => x.id).sort()).toEqual([ask.id, adultRepair.id].sort());
    expect((await cases.list(amma)).mine.map((x) => x.id)).not.toContain(adultRepair.id);
  });
});

describe("the household itself", () => {
  it("finds mistakes in who guards whom", () => {
    expect(householdProblems(household)).toEqual([]);
    const bad = householdSchema.parse({
      members: [
        { profile: "a", roles: ["guardian"], guardians: ["a"] },
        { profile: "b", guardians: ["c"] },
        { profile: "c" },
      ],
    });
    expect(householdProblems(bad)).toEqual(["A profile can't be its own guardian.", "A child can't be a guardian.", "A child's guardian must have the guardian role."]);
  });

  it("keeps only ids and roles: no names, ages or anything else", () => {
    expect(householdSchema.safeParse({ members: [{ profile: "a", name: "Amma" }] }).success).toBe(false);
    expect(householdSchema.safeParse({ members: [{ profile: "a", roles: ["owner"] }] }).success).toBe(false);
  });
});
