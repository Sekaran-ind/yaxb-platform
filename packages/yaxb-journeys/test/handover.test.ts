import { describe, expect, it } from "vitest";
import { checkDocument, compileBundle, createRunner, designFromDoc, designToDoc, journeyRolesNeeded, mayAnswer, parseDocument, replay, type Journey } from "../src/index.js";

// A journey that passes between roles: the runner registers, the organiser approves, the runner
// picks a T-shirt size only when approved.
export const MARATHON = `kind: service
id: marathon
title: Marathon registration
roles:
  - { id: organiser, label: Organiser }
  - { id: marshal, label: Marshal }
journeys:
  - id: register
    title: Register for the marathon
    roles: { initiate: [visitor], complete: [marshal] }
    screens:
      - id: about-you
        title: About you
        questions:
          - { id: name, type: text, label: Your name, required: true }
          - { id: distance, type: select, label: Distance, options: [{ value: 10k, label: 10 km }, { value: half, label: Half }, { value: full, label: Full }], required: true }
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
          - { id: size, type: select, label: Size, options: [{ value: S, label: Small }, { value: M, label: Medium }, { value: L, label: Large }], required: true }
      - id: done
        result: { title: "See you at the start, {{answers.about-you.name}}" }
      - id: refused
        result: { title: "Not this time", ok: false }
`;

const journey = (): Journey => {
  const b = compileBundle(MARATHON);
  expect(b.problems.filter((p) => p.level === "error")).toEqual([]);
  return b.journeys[0]!;
};
const VISITOR = { starter: true, roles: [] };
const ORGANISER = { starter: false, roles: ["organiser"] };

describe("journeys handed between roles", () => {
  it("keeps a screen's role in the flat journey and names every role it needs", () => {
    const j = journey();
    expect(j.steps.approve!.role).toBe("organiser");
    expect(j.steps["about-you"]!.role).toBeUndefined();
    expect(journeyRolesNeeded(j)).toEqual([
      { role: "organiser", for: ["answer"] },
      { role: "marshal", for: ["finish"] },
    ]);
    expect(mayAnswer(j.steps.approve!, ORGANISER)).toBe(true);
    expect(mayAnswer(j.steps.approve!, VISITOR)).toBe(false);
    expect(mayAnswer(j.steps.shirt!, VISITOR)).toBe(true);
  });

  it("waits at a screen another role answers, and carries on there as that role", async () => {
    const j = journey();
    const first = createRunner(j, { actor: VISITOR });
    await first.start();
    const s1 = await first.answer({ name: "Asha", distance: "half" });
    expect("status" in s1 && s1.status).toBe("waiting");
    expect(first.state.waiting).toEqual({ step: "approve", role: "organiser" });
    const stored = JSON.parse(JSON.stringify(first.snapshot()));

    // The organiser, elsewhere, from the stored run.
    const second = createRunner(j, { actor: ORGANISER });
    const s2 = await second.resume(stored);
    expect(s2.status).toBe("asking");
    expect(s2.prompt?.step).toBe("approve");
    const s3 = await second.answer({ approved: true });
    // Back to the runner for the T-shirt.
    expect("status" in s3 && s3.status).toBe("waiting");
    expect(second.state.waiting).toEqual({ step: "shirt", role: null });

    const third = createRunner(j, { actor: VISITOR });
    await third.resume(second.snapshot());
    const end = await third.answer({ size: "M" });
    expect("status" in end && end.status).toBe("done");
    expect(third.state.result?.title).toBe("See you at the start, Asha");
    expect(third.state.trail.map((t) => t.step)).toEqual(["about-you", "approve", "route", "shirt", "done"]);
  });

  it("asks every screen when no actor is given (the plain preview and built-in journeys)", async () => {
    const r = createRunner(journey());
    await r.start();
    const s = await r.answer({ name: "Asha", distance: "10k" });
    expect("status" in s && s.status).toBe("asking");
  });

  it("continues in place as another actor (the designer's preview)", async () => {
    const r = createRunner(journey(), { actor: VISITOR });
    await r.start();
    await r.answer({ name: "Asha", distance: "full" });
    const s = await r.continueAs(ORGANISER);
    expect(s.status).toBe("asking");
    expect(s.prompt?.step).toBe("approve");
  });

  it("replays stored answers to find where a run stands, and refuses ones that don't fit", async () => {
    const j = journey();
    const at = await replay(j, { answers: { "about-you": { name: "Asha", distance: "half" } }, steps: {} });
    expect(at.ok && at.state.prompt?.step).toBe("approve");

    const done = await replay(j, { answers: { "about-you": { name: "Asha", distance: "half" }, approve: { approved: false } }, steps: {} });
    expect(done.ok && done.state.status).toBe("done");
    expect(done.ok && done.state.result?.ok).toBe(false);

    // A missing required answer, a step the journey never reaches, a choice that isn't offered.
    expect((await replay(j, { answers: { "about-you": { distance: "half" } }, steps: {} })).ok).toBe(false);
    const skipped = await replay(j, { answers: { "about-you": { name: "A", distance: "half" }, shirt: { size: "M" } }, steps: {} });
    expect(skipped.ok).toBe(false);
    expect((await replay(j, { answers: { "about-you": { name: "A", distance: "marathon" } }, steps: {} })).ok).toBe(false);
  });

  it("replays service steps from their recorded results, never calling a service", async () => {
    const b = compileBundle(`kind: service
id: s
title: S
roles: [{ id: nurse, label: Nurse }]
journeys:
  - id: j
    title: J
    screens:
      - { id: q, title: Q, questions: [{ id: x, type: text, label: X, required: true }] }
      - { id: ai, service: agent.ask, with: { message: "{{answers.q.x}}" } }
      - { id: n, title: Nurse, role: nurse, questions: [{ id: ok, type: boolean, label: OK }] }
`);
    const j = b.journeys[0]!;
    const missing = await replay(j, { answers: { q: { x: "hi" } }, steps: {} });
    expect(missing.ok).toBe(false);
    const ran = await replay(j, { answers: { q: { x: "hi" } }, steps: { ai: { text: "hello" } } });
    expect(ran.ok && ran.state.prompt?.step).toBe("n");
  });

  it("checks screen roles", () => {
    const doc = (role: string, extra = "") => `kind: service
id: s
title: S
roles: [{ id: nurse, label: Nurse }]
journeys:
  - id: j
    title: J
    screens:
      - { id: q, title: Q, role: ${role}, questions: [{ id: x, type: text, label: X }]${extra} }
`;
    const errors = (y: string) => checkDocument(y, []).problems.filter((p) => p.level === "error").map((p) => p.message);
    expect(errors(doc("nurse"))).toEqual([]);
    expect(errors(doc("porter")).join(" ")).toMatch(/porter/);
    expect(errors(doc("visitor")).join(" ")).toMatch(/started the journey/);
  });

  it("keeps a screen's role through the designer", () => {
    const p = parseDocument(MARATHON);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const { design } = designFromDoc(p.doc);
    expect(design.journeys[0]!.screens.find((s) => s.id === "approve")!.role).toBe("organiser");
    const back = designToDoc(design);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const screens = (back.doc.journeys as { screens: { id: string; role?: string }[] }[])[0]!.screens;
    expect(screens.find((s) => s.id === "approve")!.role).toBe("organiser");
    expect(screens.find((s) => s.id === "about-you")!.role).toBeUndefined();
  });
});
