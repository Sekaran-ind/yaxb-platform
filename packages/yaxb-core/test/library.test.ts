// The Service Catalogue (LIB-1..20): nested services with their own roles, authors (members and
// guests), the review, the audit trail and what kiosks load, on the memory store and on D1
// (node:sqlite with every migration applied).
import { compileBundle } from "@sekaran-ind/yaxb-journeys";
import { describe, expect, it } from "vitest";
import { JOURNEY_SERVICES, kioskContent } from "../src/content/index.js";
import { createLibraryService, createMemoryLibraryStore, LibraryError, MAX_GUEST_SERVICES, type LibraryActor, type LibraryStore } from "../src/library/index.js";
import { createD1ModeratorStore } from "../src/stores/d1.js";
import { createMemoryModeratorStore, type ModeratorStore } from "../src/moderators/index.js";
import { createD1LibraryStore } from "../src/stores/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

const admin: LibraryActor = { id: "admin", name: "Administrator", roles: ["administrator"], admin: true };
const mod: LibraryActor = { id: "m1", name: "Meena", roles: ["moderator"], admin: false };
const reviewer: LibraryActor = { id: "r1", name: "Ravi", roles: ["reviewer"], admin: false };
const nurse: LibraryActor = { id: "n1", name: "Nila", roles: ["nurse"], admin: false };
const guest: LibraryActor = { id: "guest:abc", name: "Guest", roles: [], admin: false, guest: true };
const other: LibraryActor = { id: "guest:xyz", name: "Guest", roles: [], admin: false, guest: true };

const clinic = (id = "clinic") => `kind: service
id: ${id}
title: Clinic visit
roles:
  - { id: nurse, label: Nurse }
journeys:
  - id: check-in
    title: Check in
    roles: { initiate: [visitor], complete: [nurse] }
    screens:
      - id: about-you
        title: About you
        questions:
          - { id: name, type: text, label: Your name, required: true }
      - id: done
        result: { title: "Hello {{answers.about-you.name}}" }
  - id: triage
    title: Triage
    roles: { initiate: [nurse] }
    screens:
      - id: notes
        questions: [{ id: note, type: textarea, label: Notes }]
`;

const expectError = async (p: Promise<unknown>, status: number, message?: RegExp) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(LibraryError);
  expect((e as LibraryError).status).toBe(status);
  if (message) expect((e as LibraryError).message).toMatch(message);
};

for (const [name, make] of [
  ["memory", () => ({ library: createMemoryLibraryStore(), moderators: createMemoryModeratorStore() })],
  [
    "D1",
    () => {
      const db = sqliteD1();
      return { library: createD1LibraryStore(db), moderators: createD1ModeratorStore(db) };
    },
  ],
] as [string, () => { library: LibraryStore; moderators: ModeratorStore }][]) {
  describe(`the catalogue on ${name}`, () => {
    const setup = () => {
      const stores = make();
      const svc = createLibraryService(stores.library, {
        services: JOURNEY_SERVICES,
        audit: (e) => stores.moderators.audit(e),
        auditTrail: (id) => stores.moderators.auditLog({ targetId: id }),
      });
      return svc;
    };

    it("lets a guest design a service in the default library, and keeps it theirs", async () => {
      const svc = setup();
      const { entry, problems } = await svc.createEntry(guest, null, { yaml: clinic() });
      expect(problems).toEqual([]);
      expect(entry).toMatchObject({ doc_id: "clinic", title: "Clinic visit", status: "draft", owner_id: "guest:abc", owner_name: "Guest" });
      expect((await svc.libraries(guest)).map((l) => l.name)).toEqual(["Service catalogue"]);
      // Another guest sees nothing and changes nothing; members see it.
      expect(await svc.entries(other)).toEqual([]);
      await expectError(svc.entry(other, entry.id), 404);
      await expectError(svc.saveEntry(other, entry.id, { yaml: clinic() }), 404);
      expect((await svc.entries(reviewer)).map((e) => e.id)).toEqual([entry.id]);
      await expectError(svc.saveEntry(reviewer, entry.id, { yaml: clinic().replace("Clinic visit", "X") }), 403);
      // The author edits and submits; ids are unique across the catalogue.
      const saved = await svc.saveEntry(guest, entry.id, { yaml: clinic().replace("title: Clinic visit", "title: Clinic"), note: "Shorter" });
      expect(saved.entry).toMatchObject({ revision: 2, title: "Clinic" });
      await expectError(svc.createEntry(mod, null, { yaml: clinic() }), 409, /already has a service with the id 'clinic'/);
      expect((await svc.submit(guest, entry.id)).status).toBe("in_review");
      await expectError(svc.review(guest, entry.id, { decision: "accept" }), 403);
      expect((await svc.reviewQueue(guest)).length).toBe(0);
      expect((await svc.reviewQueue(reviewer)).length).toBe(1);
    });

    it("reviews, publishes, and records an audit trail without content", async () => {
      const svc = setup();
      const { entry } = await svc.createEntry(mod, null, { yaml: clinic() });
      await svc.submit(mod, entry.id);
      await expectError(svc.review(mod, entry.id, { decision: "accept" }), 403);
      await expectError(svc.review({ ...mod, roles: ["moderator", "reviewer"] }, entry.id, { decision: "accept" }), 403, /your own service/);
      await expectError(svc.review(reviewer, entry.id, { decision: "reject" }), 422);
      expect((await svc.review(reviewer, entry.id, { decision: "accept", note: "Clear" })).published_revision).toBe(1);

      // A new revision: back to draft; kiosks keep the accepted one.
      await svc.saveEntry(mod, entry.id, { yaml: clinic().replace("title: Check in", "title: Check in here") });
      const pub = await svc.published();
      expect(pub.services).toHaveLength(1);
      expect(pub.services[0]!.journeys.map((j) => j.title)).toEqual(["Check in", "Triage"]);
      // The latest revision's state goes with it: kiosks offer only accepted services to add.
      expect(pub.services[0]!.state).toBe("draft");

      const trail = await svc.auditTrail(reviewer, entry.id);
      expect(trail.map((e) => e.action)).toEqual(["library.entry_saved", "library.entry_accepted", "library.entry_submitted", "library.entry_created"]);
      expect(trail.every((e) => !JSON.stringify(e).includes("Your name"))).toBe(true);
      await expectError(svc.auditTrail(guest, entry.id), 404);

      // Archived: off kiosks; restored as a draft.
      await svc.setEntryArchived(mod, entry.id, true);
      expect((await svc.published()).services).toEqual([]);
      expect((await svc.setEntryArchived(mod, entry.id, false)).status).toBe("draft");
    });

    it("tells kiosks which journeys each viewer may start, with every role there is", async () => {
      const svc = setup();
      await svc.addRole(admin, { id: "front-desk", label: "Front desk" });
      const { entry } = await svc.createEntry(guest, null, { yaml: clinic() });
      await svc.submit(guest, entry.id);
      await svc.review(reviewer, entry.id, { decision: "accept" });
      const visitor = await svc.published([]);
      expect(visitor.services[0]!.journeys.map((j) => [j.id, j.allowed])).toEqual([
        ["check-in", true],
        ["triage", false],
      ]);
      expect(visitor.roles.map((r) => r.id)).toEqual(["administrator", "moderator", "reviewer", "front-desk", "nurse"]);
      expect((await svc.published(nurse.roles)).services[0]!.journeys.every((j) => j.allowed)).toBe(true);
      // Kiosks compile the YAML they get.
      expect(compileBundle(visitor.services[0]!.yaml, { services: JOURNEY_SERVICES }).ok).toBe(true);
      // A role a service uses can't be removed; one nobody uses can.
      await svc.removeRole(admin, "front-desk");
      await expectError(svc.removeRole(admin, "moderator"), 409);
    });

    it("refuses broken services at submit, and caps a guest's services", async () => {
      const svc = setup();
      const { entry, problems } = await svc.createEntry(guest, null, { yaml: clinic().replace("complete: [nurse]", "complete: [doctor]") });
      expect(problems.map((p) => p.message)).toEqual(["journey 'check-in': role 'doctor' isn't one of this service's roles: add it to the roles"]);
      await expectError(svc.submit(guest, entry.id), 422, /doctor/);
      await expectError(svc.createEntry(guest, null, { yaml: "kind: journey\nid: x\n" }), 422, /kind: service/);
      for (let i = 1; i < MAX_GUEST_SERVICES; i++) await svc.createEntry(guest, null, { yaml: clinic(`clinic-${i}`) });
      await expectError(svc.createEntry(guest, null, { yaml: clinic("one-too-many") }), 429);
    });

    it("is seeded once with the kiosk's own services, published", async () => {
      const svc = setup();
      const seeds = kioskContent.catalogue.map((c) => c.yaml);
      expect(await svc.seed(seeds)).toEqual(["visits"]);
      expect(await svc.seed(seeds)).toEqual([]);
      const pub = await svc.published();
      expect(pub.services.map((s) => [s.id, s.journeys.map((j) => j.id)])).toEqual([["visits", ["visit-check-in"]]]);
      expect(pub.roles.map((r) => r.id)).toContain("front-desk");
      // Archived, it stays archived: seeding again doesn't bring it back.
      const id = pub.services[0]!.entry_id;
      await svc.setEntryArchived(admin, id, true);
      expect(await svc.seed(seeds)).toEqual([]);
      expect((await svc.published()).services).toEqual([]);
    });

    it("keeps libraries for members to organise, and archives them", async () => {
      const svc = setup();
      await expectError(svc.createLibrary(guest, { name: "Mine" }), 403);
      const lib = await svc.createLibrary(mod, { name: "Outpatients" });
      const { entry } = await svc.createEntry(guest, lib.id, { yaml: clinic() });
      expect(entry.library_id).toBe(lib.id);
      await svc.submit(guest, entry.id);
      await svc.review(reviewer, entry.id, { decision: "accept" });
      await expectError(svc.setLibraryStatus(mod, lib.id, "archived"), 403);
      await svc.setLibraryStatus(admin, lib.id, "archived");
      expect((await svc.published()).services).toEqual([]);
      expect((await svc.libraries(guest)).map((l) => l.name)).toEqual([]);
    });
  });
}
