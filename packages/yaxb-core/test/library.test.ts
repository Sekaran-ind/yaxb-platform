// The journey library (LIB-1..12): roles, libraries, entries, the review and what the kiosk loads,
// on the memory store and on D1 (node:sqlite with every migration applied).
import { compileBundle, servicesFor } from "@sekaran-ind/yaxb-journeys";
import { describe, expect, it } from "vitest";
import { JOURNEY_SERVICES } from "../src/content/index.js";
import { createLibraryService, createMemoryLibraryStore, LibraryError, type LibraryActor, type LibraryStore } from "../src/library/index.js";
import type { AuditEvent } from "../src/moderators/index.js";
import { createD1LibraryStore } from "../src/stores/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

const admin: LibraryActor = { id: "admin", name: "Administrator", roles: [], admin: true };
const mod: LibraryActor = { id: "m1", name: "Meena", roles: ["moderator"], admin: false };
const reviewer: LibraryActor = { id: "r1", name: "Ravi", roles: ["reviewer"], admin: false };
const nurse: LibraryActor = { id: "n1", name: "Nila", roles: ["nurse"], admin: false };

const questionnaire = `kind: questionnaire
id: intake
title: Intake
fields:
  - { id: name, type: text, label: Name, required: true }
`;
const journey = `kind: journey
id: check-in
title: Check in
roles: { initiate: [visitor], complete: [nurse] }
start: ask
steps:
  ask: { questionnaire: intake, next: done }
  done: { final: true, result: { title: "Hello {{answers.ask.name}}" } }
`;
const staffJourney = `kind: journey
id: triage
title: Triage
roles: { initiate: [nurse] }
start: done
steps:
  done: { final: true }
`;
const service = `kind: service
id: clinic
title: Clinic
roles: [nurse]
items:
  - { key: in, label: Check in, journey: check-in }
  - { key: triage, label: Triage, journey: triage }
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
  ["memory", () => createMemoryLibraryStore()],
  ["D1", () => createD1LibraryStore(sqliteD1())],
] as [string, () => LibraryStore][]) {
  describe(`library on ${name}`, () => {
    const setup = () => {
      const log: AuditEvent[] = [];
      const svc = createLibraryService(make(), { services: JOURNEY_SERVICES, audit: async (e) => void log.push(e) });
      return { svc, log };
    };

    it("has the built-in roles, and administrators add their own", async () => {
      const { svc, log } = setup();
      expect((await svc.catalogue()).map((r) => r.id)).toEqual(["administrator", "moderator", "reviewer"]);
      await expectError(svc.addRole(mod, { id: "nurse", label: "Nurse" }), 403);
      await svc.addRole(admin, { id: "nurse", label: "Nurse", description: "Ward nurse" });
      await expectError(svc.addRole(admin, { id: "nurse", label: "Again" }), 409);
      await expectError(svc.addRole(admin, { id: "visitor", label: "V" }), 409);
      await expectError(svc.updateRole(admin, "reviewer", { label: "R" }), 409);
      expect((await svc.updateRole(admin, "nurse", { label: "Staff nurse" })).label).toBe("Staff nurse");
      expect((await svc.catalogue()).find((r) => r.id === "nurse")).toEqual({ id: "nurse", label: "Staff nurse", description: "Ward nurse", builtin: false });
      await expectError(svc.removeRole(admin, "moderator"), 409);
      await expectError(svc.removeRole(admin, "nurse", [["moderator", "nurse"]]), 409, /team member/);
      await svc.removeRole(admin, "nurse");
      expect(log.map((e) => e.action)).toEqual(["library.role_added", "library.role_changed", "library.role_removed"]);
    });

    it("runs an entry from draft through review to the kiosk", async () => {
      const { svc } = setup();
      await svc.addRole(admin, { id: "nurse", label: "Nurse" });
      await expectError(svc.createLibrary(reviewer, { name: "Clinic" }), 403);
      const lib = await svc.createLibrary(mod, { name: "Clinic", description: "Front desk journeys" });
      await expectError(svc.createLibrary(mod, { name: "clinic" }), 409);

      // A journey before its questionnaire: saved, with the problem reported, and it can't be submitted.
      const j = await svc.createEntry(mod, lib.id, { kind: "journey", yaml: journey });
      expect(j.entry).toMatchObject({ doc_id: "check-in", title: "Check in", status: "draft", revision: 1 });
      expect(j.problems.map((p) => p.message)).toEqual(["step 'ask': no questionnaire 'intake'"]);
      await expectError(svc.submit(mod, j.entry.id), 422, /no questionnaire 'intake'/);

      const q = await svc.createEntry(mod, lib.id, { kind: "questionnaire", yaml: questionnaire });
      expect(q.problems).toEqual([]);
      await expectError(svc.createEntry(mod, lib.id, { kind: "questionnaire", yaml: questionnaire }), 409);
      await expectError(svc.createEntry(mod, lib.id, { kind: "service", yaml: questionnaire }), 422, /kind: service/);
      await expectError(svc.createEntry(mod, lib.id, { kind: "service", yaml: "a: [" }), 422, /YAML/);

      expect((await svc.submit(mod, j.entry.id)).status).toBe("in_review");
      expect((await svc.reviewQueue(reviewer)).map((e) => e.doc_id)).toEqual(["check-in"]);
      // Accepting the journey before its questionnaire is published is refused.
      await expectError(svc.review(reviewer, j.entry.id, { decision: "accept" }), 422, /Accept what it refers to first/);
      await svc.submit(mod, q.entry.id);
      // Nobody reviews their own submission; moderators don't review at all.
      await expectError(svc.review(mod, q.entry.id, { decision: "accept" }), 403);
      await expectError(svc.review({ ...mod, roles: ["moderator", "reviewer"] }, q.entry.id, { decision: "accept" }), 403, /another reviewer/);
      await expectError(svc.review(reviewer, q.entry.id, { decision: "reject" }), 422);
      expect((await svc.review(reviewer, q.entry.id, { decision: "accept" })).published_revision).toBe(1);
      expect((await svc.review(reviewer, j.entry.id, { decision: "accept" })).status).toBe("accepted");

      // A new revision of an accepted entry: back to draft, but the kiosk keeps the accepted one.
      const saved = await svc.saveEntry(mod, j.entry.id, { yaml: journey.replace("title: Check in", "title: Check in here"), note: "Clearer" });
      expect(saved.entry).toMatchObject({ status: "draft", revision: 2, title: "Check in here", published_revision: 1 });
      const detail = await svc.entry(reviewer, j.entry.id);
      expect(detail.revisions.map((r) => [r.revision, r.note])).toEqual([
        [2, "Clearer"],
        [1, "Created"],
      ]);
      const pub = await svc.published();
      expect(pub.libraries).toHaveLength(1);
      expect(pub.libraries[0]!.sources.some((s) => s.includes("title: Check in\n"))).toBe(true);

      // Rejected with a note, then archived: off the kiosk; restored as a draft.
      await svc.submit(mod, j.entry.id);
      const rejected = await svc.review(reviewer, j.entry.id, { decision: "reject", note: "Say where the desk is." });
      expect(rejected).toMatchObject({ status: "rejected", review_note: "Say where the desk is.", reviewed_by_name: "Ravi" });
      await svc.setEntryArchived(mod, j.entry.id, true);
      expect((await svc.published()).libraries[0]!.sources).toEqual([questionnaire]);
      expect((await svc.setEntryArchived(mod, j.entry.id, false)).status).toBe("draft");
      await expectError(svc.saveEntry(reviewer, j.entry.id, { yaml: journey }), 403);
    });

    it("gives the kiosk only the journeys the viewer may start, and hides archived libraries", async () => {
      const { svc } = setup();
      await svc.addRole(admin, { id: "nurse", label: "Nurse" });
      const lib = await svc.createLibrary(admin, { name: "Clinic" });
      for (const [kind, yaml] of [
        ["questionnaire", questionnaire],
        ["journey", journey],
        ["journey", staffJourney],
        ["service", service],
      ] as const) {
        const { entry } = await svc.createEntry(mod, lib.id, { kind, yaml });
        await svc.submit(mod, entry.id);
        await svc.review(reviewer, entry.id, { decision: "accept" });
      }
      const visitor = await svc.published([]);
      expect(visitor.libraries[0]!.allowed).toEqual(["check-in"]);
      // The kiosk compiles every document and offers the allowed journeys only.
      const b = compileBundle(visitor.libraries[0]!.sources, { services: JOURNEY_SERVICES });
      expect(b.ok).toBe(true);
      expect(servicesFor(b.services, { journeys: visitor.libraries[0]!.allowed })[0]!.items.map((i) => i.key)).toEqual(["in"]);
      expect((await svc.published(nurse.roles)).libraries[0]!.allowed).toEqual(["check-in", "triage"]);

      await expectError(svc.setLibraryStatus(mod, lib.id, "archived"), 403);
      await svc.setLibraryStatus(admin, lib.id, "archived");
      expect((await svc.published()).libraries).toEqual([]);
      await expectError(svc.createEntry(mod, lib.id, { kind: "questionnaire", yaml: questionnaire.replace("id: intake", "id: other") }), 409);
      const counts = (await svc.libraries(reviewer))[0]!.counts;
      expect(counts).toMatchObject({ total: 4, accepted: 4 });
    });

    it("needs a team member to see anything", async () => {
      const { svc } = setup();
      await expectError(svc.libraries({ id: "x", name: "x", roles: [], admin: false }), 403);
    });
  });
}
