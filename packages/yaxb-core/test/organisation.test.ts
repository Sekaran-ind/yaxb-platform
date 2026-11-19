// The organisation in the catalogue (ORG-1..5): one organisation entry, reviewed and published like
// a service; templates (ORG-2); and cases sent to the requester's manager (ORG-3). Memory and D1.
import { compileBundle, compileOrganisation, ORGANISATION_TEMPLATES } from "@sekaran-ind/yaxb-journeys";
import { describe, expect, it } from "vitest";
import { load } from "js-yaml";
import { createCaseService, createMemoryCaseStore, CaseError, type CaseActor } from "../src/cases/index.js";
import { createLibraryService, createMemoryLibraryStore, LibraryError, type LibraryActor, type LibraryStore } from "../src/library/index.js";
import { createD1LibraryStore } from "../src/stores/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

const admin: LibraryActor = { id: "admin", name: "Administrator", roles: ["administrator"], admin: true };
const reviewer: LibraryActor = { id: "r1", name: "Ravi", roles: ["reviewer"], admin: false };
const mod: LibraryActor = { id: "m1", name: "Meena", roles: ["moderator"], admin: false };

const failsWith = async (p: Promise<unknown>, status: number, message?: RegExp) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(LibraryError);
  expect((e as LibraryError).status).toBe(status);
  if (message) expect((e as LibraryError).message).toMatch(message);
};

for (const [name, make] of [
  ["memory", (): LibraryStore => createMemoryLibraryStore()],
  ["D1", (): LibraryStore => createD1LibraryStore(sqliteD1())],
] as const) {
  describe(`the organisation on ${name}`, () => {
    const setup = () => createLibraryService(make(), { memberRoles: async () => [["counter-head"]] });

    it("starts from a template: the organisation and starters as drafts, in one step (ORG-2)", async () => {
      const lib = setup();
      expect(lib.templates("business").map((t) => t.id)).toContain("hardware-store");
      await failsWith(lib.applyTemplate(mod, "hardware-store"), 403);
      const { created } = await lib.applyTemplate(admin, "hardware-store", "business");
      expect(created.map((e) => [e.kind, e.doc_id, e.status])).toEqual([
        ["organisation", "hardware-store", "draft"],
        ["service", "hardware-store-orders", "draft"],
        ["service", "hardware-store-time-off", "draft"],
      ]);
      await failsWith(lib.applyTemplate(admin, "salon"), 409, /already has an organisation/);
      await failsWith(lib.applyTemplate(admin, "salon", "family"), 404);
    });

    it("is reviewed and published like a service; only one, by an administrator", async () => {
      const lib = setup();
      const t = ORGANISATION_TEMPLATES.find((x) => x.id === "hardware-store")!;
      await failsWith(lib.createEntry(mod, null, { yaml: t.organisation }), 403, /administrator/);
      const { entry } = await lib.createEntry(admin, null, { yaml: t.organisation });
      await failsWith(lib.createEntry(admin, null, { yaml: t.organisation.replace("id: hardware-store", "id: other") }), 409, /already has an organisation/);
      await failsWith(lib.saveEntry(admin, entry.id, { yaml: t.services[0]! }), 422, /keep kind: organisation/);

      // Before its services are published, the organisation warns that its units run nothing there (ORG-5).
      const { problems } = await lib.entry(admin, entry.id);
      expect(problems.some((p) => /isn't in the catalogue/.test(p.message))).toBe(true);

      for (const yaml of [t.organisation, ...t.services]) {
        const e = (await lib.entries(admin)).find((x) => x.yaml === yaml) ?? (await lib.createEntry(admin, null, { yaml })).entry;
        await lib.submit(admin, e.id);
        await lib.review(reviewer, e.id, { decision: "accept" });
      }
      const out = await lib.published();
      expect(out.organisation?.units.map((u) => u.id)).toEqual(["office", "counter", "store-room"]);
      expect(out.roles.map((r) => r.id)).toEqual(expect.arrayContaining(["owner", "counter-head", "store-keeper"]));
      expect(out.services.map((s) => s.id).sort()).toEqual(["hardware-store-orders", "hardware-store-time-off"]);

      // Staffing (ORG-5): the counter is staffed by the member roles given; the store room isn't asked about.
      const after = await lib.entry(admin, entry.id);
      expect(after.problems.filter((p) => p.level === "warning").map((p) => p.message)).toEqual([]);
    });
  });
}

describe("cases go to the requester's manager (ORG-3)", () => {
  const t = ORGANISATION_TEMPLATES.find((x) => x.id === "hardware-store")!;
  const r = compileOrganisation(load(t.organisation));
  const organisation = r.ok ? r.organisation : null;
  const b = compileBundle(t.services[1]!);
  const journey = b.journeys[0]!;
  const journeyFor = async () => ({ journey, entry_id: "e1", service_id: b.services[0]!.id, service_title: "Time off", revision: 1 });
  const cashier: CaseActor = { id: "c1", name: "Kavi", roles: ["cashier"], admin: false };
  const head: CaseActor = { id: "h1", name: "Hari", roles: ["counter-head"], admin: false };
  const keeper: CaseActor = { id: "k1", name: "Kumar", roles: ["store-keeper"], admin: false };
  const input = { entry: "e1", journey: journey.id, answers: { details: { from: "2026-12-01", to: "2026-12-02" } } };

  it("waits for the lead of the requester's unit, and keeps that with the case", async () => {
    const svc = createCaseService(createMemoryCaseStore(), { journeyFor, organisation: async () => organisation });
    const { case: c } = await svc.start(cashier, input);
    expect(c.waiting_role).toBe("counter-head");
    expect(c.roles).toContain("counter-head");
    // Someone else's manager can't act on it.
    await expect(svc.act(keeper, c.id, { answers: { decision: { answer: "yes" } } })).rejects.toBeInstanceOf(CaseError);
    const { case: done } = await svc.act(head, c.id, { answers: { decision: { answer: "yes" } } });
    expect(done.status).toBe("done");

    // The counter head's own request goes to the owner.
    const { case: up } = await svc.start(head, input);
    expect(up.waiting_role).toBe("owner");
  });

  it("refuses when there is no organisation, or nobody above", async () => {
    const none = createCaseService(createMemoryCaseStore(), { journeyFor });
    await expect(none.start(cashier, input)).rejects.toThrow(/organisation isn't set up/);
  });
});
