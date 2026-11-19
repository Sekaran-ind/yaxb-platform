// Assurance levels (IDN-30..33): a journey states how sure the kiosk must be of who answers; a run
// signed in below a step's level pauses there (status "step_up") and carries on, where it paused,
// once the person signs in more strongly. The gate's hall booking: level 2 to start, 3 to approve.
import { describe, expect, it } from "vitest";
import { ASSURANCE_LEVELS, compileBundle, createRunner, designFromDoc, designToDoc, levelNeeded, parseDocument, replay, sureEnough, type Journey } from "../src/index.js";

const HALL = `kind: service
id: hall
title: Community hall
roles:
  - { id: secretary, label: Secretary }
journeys:
  - id: book
    title: Book the hall
    level: 2
    screens:
      - id: when
        title: When
        questions:
          - { id: date, type: date, label: Date, required: true }
      - id: approve
        title: Approve the booking
        role: secretary
        level: 3
        questions:
          - { id: ok, type: boolean, label: Approved }
      - id: done
        result: { title: Booked }
`;
const hall = (): Journey => {
  const b = compileBundle(HALL);
  expect(b.problems.filter((p) => p.level === "error")).toEqual([]);
  return b.journeys[0]!;
};

describe("assurance levels", () => {
  it("keeps levels in the flat journey and checks them", () => {
    const j = hall();
    expect(j.level).toBe(2);
    expect(j.steps.approve!.level).toBe(3);
    expect(levelNeeded(j, j.steps.when!)).toBe(2);
    expect(levelNeeded(j, j.steps.approve!)).toBe(3);
    expect(sureEnough(j, j.steps.approve!, { level: 2 })).toBe(false);
    expect(ASSURANCE_LEVELS.map((l) => l.level)).toEqual([0, 1, 2, 3, 4]);
    const bad = compileBundle(HALL.replace("level: 3", "level: 7").replace("    level: 2\n", "    level: two\n"));
    expect(bad.problems.map((p) => p.message).join("\n")).toMatch(/level is a whole number/);
    const onDecision = compileBundle(HALL.replace("      - id: done\n", "      - id: route\n        level: 3\n        decide: [{ to: done }]\n      - id: done\n"));
    expect(onDecision.problems.map((p) => p.message).join("\n")).toMatch(/only a step with questions needs a level/);
  });

  it("pauses an anonymous visitor at the start, then carries on after signing in", async () => {
    const j = hall();
    const r = createRunner(j, { actor: { starter: true, roles: [], level: 0 } });
    const s0 = await r.start();
    expect(s0.status).toBe("step_up");
    expect(s0.stepUp).toEqual({ step: "when", level: 2 });
    const s1 = await r.continueAs({ starter: true, roles: [], level: 2 });
    expect(s1.status).toBe("asking");
    expect(s1.prompt?.step).toBe("when");
  });

  it("steps up at the approval and resumes where it paused (the gate)", async () => {
    const j = hall();
    const visitor = createRunner(j, { actor: { starter: true, roles: [], level: 2 } });
    await visitor.start();
    const handed = await visitor.answer({ date: "2026-12-01" });
    expect("status" in handed && handed.status).toBe("waiting");
    const stored = JSON.parse(JSON.stringify(visitor.snapshot()));
    // The secretary signed in with Google (level 2): the approval needs a passkey (3).
    const secretary = createRunner(j, { actor: { starter: false, roles: ["secretary"], level: 2 } });
    const paused = await secretary.resume(stored);
    expect(paused.status).toBe("step_up");
    expect(paused.stepUp).toEqual({ step: "approve", level: 3 });
    expect(paused.answers.when).toEqual({ date: "2026-12-01" });
    const asked = await secretary.continueAs({ starter: false, roles: ["secretary"], level: 3 });
    expect(asked.status).toBe("asking");
    expect(asked.prompt?.step).toBe("approve");
    const done = await secretary.answer({ ok: true });
    expect("status" in done && done.status).toBe("done");
    // The server's replay (no actor) still finds where a stored run stands.
    const again = await replay(j, secretary.snapshot());
    expect(again.ok && again.state.status).toBe("done");
  });

  it("a plain preview (no actor) asks every step", async () => {
    const s = await createRunner(hall()).start();
    expect(s.status).toBe("asking");
  });

  it("the designer keeps levels through the design form", () => {
    const parsed = parseDocument(HALL);
    if (!parsed.ok) throw new Error(parsed.error);
    const back = designToDoc(designFromDoc(parsed.doc).design);
    if (!back.ok) throw new Error(back.problems.join("; "));
    const j = (back.doc as { journeys: { level?: number; screens: { id: string; level?: number }[] }[] }).journeys[0]!;
    expect(j.level).toBe(2);
    expect(j.screens.find((s) => s.id === "approve")?.level).toBe(3);
  });
});
