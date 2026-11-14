import { describe, expect, it } from "vitest";
import { compileBundle } from "@sekaran-ind/yaxb-journeys/bundle";
import { createRunner } from "@sekaran-ind/yaxb-journeys/journeys";
import { createCaseService, createMemoryCaseStore, type CaseActor, type CaseStore } from "../src/cases/index.js";
import { createD1CaseStore } from "../src/stores/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

const MARATHON = `kind: service
id: marathon
title: Marathon registration
roles:
  - { id: organiser, label: Organiser }
  - { id: marshal, label: Marshal }
journeys:
  - id: register
    title: Register for the marathon
    roles: { complete: [marshal] }
    screens:
      - id: about-you
        title: About you
        questions:
          - { id: name, type: text, label: Your name, required: true }
          - { id: code, type: password, label: Entry code }
      - id: approve
        title: Approve the entry
        role: organiser
        questions:
          - { id: approved, type: boolean, label: Approved }
      - id: route
        decide:
          - { if: "answers.approve.approved == true", to: shirt }
          - { to: refused }
      - id: shirt
        title: Your T-shirt
        questions:
          - { id: size, type: text, label: Size, required: true }
      - id: done
        result: { title: "See you at the start, {{answers.about-you.name}}" }
      - id: refused
        result: { title: "Not this time", ok: false }
  - id: staff-only
    title: Staff only
    roles: { initiate: [organiser] }
    screens:
      - { id: q, title: Q, questions: [{ id: x, type: text, label: X }] }
`;
const journeys = compileBundle(MARATHON).journeys;
const journeyFor = async (entry: string, id: string) => {
  const journey = journeys.find((j) => j.id === id);
  return entry === "e1" && journey ? { journey, entry_id: "e1", service_id: "marathon", service_title: "Marathon registration", revision: 1 } : null;
};

const visitor: CaseActor = { id: "guest:abc", name: "Visitor", roles: [], admin: false, guest: true };
const otherVisitor: CaseActor = { id: "guest:xyz", name: "Visitor", roles: [], admin: false, guest: true };
const organiser: CaseActor = { id: "m-org", name: "Olu", roles: ["organiser"], admin: false };
const marshal: CaseActor = { id: "m-mar", name: "Mira", roles: ["marshal"], admin: false };
const outsider: CaseActor = { id: "m-out", name: "Ravi", roles: ["moderator"], admin: false };
const admin: CaseActor = { id: "admin", name: "Administrator", roles: ["administrator"], admin: true };

const stores: [string, () => CaseStore][] = [
  ["memory", createMemoryCaseStore],
  ["D1 (SQLite)", () => createD1CaseStore(sqliteD1())],
];

for (const [name, make] of stores) {
  describe(`cases, ${name}`, () => {
    const service = () => createCaseService(make(), { journeyFor });

    it("hands a journey between roles until a finisher closes it, keeping its thread", async () => {
      const cases = service();
      const { case: c } = await cases.start(visitor, { entry: "e1", journey: "register", answers: { "about-you": { name: "Asha", code: "secret" } } });
      expect(c.status).toBe("waiting");
      expect(c.waiting_role).toBe("organiser");
      expect(c.ref).toMatch(/^R-[2-9A-Z]{6}$/);
      expect(c.started_by_name).toBe("A visitor");

      // The organiser's queue has it; the outsider can't see it.
      expect((await cases.list(organiser)).mine.map((x) => x.id)).toEqual([c.id]);
      expect((await cases.list(outsider)).mine).toEqual([]);
      await expect(cases.get(outsider, c.id)).rejects.toThrow(/isn't yours/);
      // A visitor opens it only by its reference (never by id, never in a list), as its starter.
      await expect(cases.get(visitor, c.id)).rejects.toThrow(/isn't yours/);
      expect((await cases.list(visitor)).started).toEqual([]);
      expect((await cases.get(otherVisitor, c.ref)).case.id).toBe(c.id);
      expect((await cases.get(otherVisitor, c.ref)).turn).toBe(false);

      // Passwords are never stored.
      const seen = await cases.get(organiser, c.id);
      expect(seen.turn).toBe(true);
      expect(seen.case.run.answers["about-you"]!.code).toBe("••••••");
      expect(JSON.stringify(seen.case)).not.toContain("secret");

      // The organiser carries on in their own runner, from the stored run.
      const runner = createRunner(seen.case.journey, { actor: seen.actor });
      await runner.resume(seen.case.run);
      expect(runner.state.prompt?.step).toBe("approve");
      await runner.answer({ approved: true });
      const snap = runner.snapshot();
      const fresh = Object.fromEntries(Object.entries(snap.answers).filter(([k]) => !(k in seen.case.run.answers)));
      const after = await cases.act(organiser, c.id, { answers: fresh, steps: {} });
      // Back to the visitor for the T-shirt.
      expect(after.case.status).toBe("waiting");
      expect(after.case.waiting_role).toBeNull();
      expect((await cases.get(visitor, c.ref)).turn).toBe(true);
      await expect(cases.act(organiser, c.id, { answers: { shirt: { size: "M" } } })).rejects.toThrow(/turn/);

      const ended = await cases.act(visitor, c.ref, { answers: { shirt: { size: "M" } } });
      expect(ended.case.status).toBe("to_finish");
      expect(ended.case.result?.title).toBe("See you at the start, Asha");
      await cases.note(visitor, c.ref, { text: "Can I change my distance later?" });
      await expect(cases.finish(organiser, c.id, { decision: "done" })).rejects.toThrow(/finish this journey/);
      const closed = await cases.finish(marshal, c.id, { decision: "done", note: "Bib 112" });
      expect(closed.case.status).toBe("done");
      expect(closed.case.closed_at).toBeTruthy();

      const thread = (await cases.get(visitor, c.ref)).events.map((e) => `${e.kind}:${e.actor_name}:${e.text ?? ""}`);
      expect(thread).toEqual([
        "started:Visitor:About you",
        "answered:Olu:Approve the entry",
        "answered:Visitor:Your T-shirt",
        "note:Visitor:Can I change my distance later?",
        "finished:Mira:Bib 112",
      ]);
      expect((await cases.get(visitor, c.ref)).case.status).toBe("done");
    });

    it("decides where a case stands itself: no skipped screens, no answers for someone else", async () => {
      const cases = service();
      // The visitor answering the organiser's screen too.
      await expect(cases.start(visitor, { entry: "e1", journey: "register", answers: { "about-you": { name: "A" }, approve: { approved: true } } })).rejects.toThrow(/someone else/);
      // A screen the journey doesn't reach yet.
      await expect(cases.start(visitor, { entry: "e1", journey: "register", answers: { "about-you": { name: "A" }, shirt: { size: "M" } } })).rejects.toThrow(/didn't reach/);
      // Missing a required answer.
      await expect(cases.start(visitor, { entry: "e1", journey: "register", answers: { "about-you": {} } })).rejects.toThrow();
      // Not their part done yet, a journey they can't start, one that isn't published.
      await expect(cases.start(visitor, { entry: "e1", journey: "register", answers: {} })).rejects.toThrow(/Finish your part/);
      await expect(cases.start(visitor, { entry: "e1", journey: "staff-only", answers: { q: { x: "1" } } })).rejects.toThrow(/can't start/);
      await expect(cases.start(visitor, { entry: "e2", journey: "register", answers: { "about-you": { name: "A" } } })).rejects.toThrow(/published/);
      // A journey with nothing to hand over.
      await expect(cases.start(organiser, { entry: "e1", journey: "staff-only", answers: { q: { x: "1" } } })).rejects.toThrow(/nothing to hand over/);

      const { case: c } = await cases.start(visitor, { entry: "e1", journey: "register", answers: { "about-you": { name: "A" } } });
      // Rewriting an answered screen.
      await expect(cases.act(organiser, c.id, { answers: { "about-you": { name: "B" } } })).rejects.toThrow(/answered already/);
      await expect(cases.act(organiser, c.id, { answers: {} })).rejects.toThrow(/Answer the screen/);
    });

    it("lets the role whose turn it is decline with a reason, and administrators see every open case", async () => {
      const cases = service();
      const { case: c } = await cases.start(visitor, { entry: "e1", journey: "register", answers: { "about-you": { name: "A" } } });
      expect((await cases.list(admin)).others.map((x) => x.id)).toEqual([c.id]);
      await expect(cases.finish(visitor, c.ref, { decision: "declined", note: "no" })).rejects.toThrow(/decline/);
      await expect(cases.finish(organiser, c.id, { decision: "declined" })).rejects.toThrow(/Say why/);
      const d = await cases.finish(organiser, c.id, { decision: "declined", note: "The race is full." });
      expect(d.case.status).toBe("declined");
      await expect(cases.note(organiser, c.id, { text: "x".repeat(1001) })).rejects.toThrow();
      expect((await cases.list(organiser)).mine).toEqual([]);
    });
  });
}

describe("staffing", () => {
  it("says whether each role has a member who has signed in, one invited, or nobody", async () => {
    const { staffingOf } = await import("../src/cases/index.js");
    const members = [
      { roles: ["organiser"], status: "active" as const },
      { roles: ["marshal"], status: "invited" as const },
      { roles: ["medic"], status: "suspended" as const },
    ];
    expect(staffingOf(["organiser", "marshal", "medic", "timer"], members)).toEqual({ organiser: "ready", marshal: "invited", medic: "nobody", timer: "nobody" });
  });
});
