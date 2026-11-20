// Guard hooks (RTN-9, 11): an ask step's answers are taken only when its guard allows them, by a
// condition or a service's yes or no within a time limit. A no keeps the person on the step with the
// reason; the call's answer is kept with the run, and replaying it never calls the hook again.
import { describe, expect, it } from "vitest";
import { compileBundle, createRunner, designFromDoc, designToDoc, guardKey, guardVerdict, parseDocument, replay, type Journey } from "../src/index.js";

const SERVICE = (guard: string) => `kind: service
id: leave
title: Leave
journeys:
  - id: ask
    title: Ask for leave
    screens:
      - id: days
        title: How many days
        questions:
          - { id: n, type: number, label: Days, required: true }
        guard: ${guard}
      - id: done
        result: { title: "Asked for {{answers.days.n}} days" }
`;
const compile = (guard: string, services = ["connector.hr.balance"]) => compileBundle(SERVICE(guard), { services });
const journey = (guard: string): Journey => {
  const b = compile(guard);
  expect(b.problems.filter((p) => p.level === "error")).toEqual([]);
  return b.journeys[0]!;
};

describe("guard hooks (RTN-9)", () => {
  it("checks a guard when the service is compiled", () => {
    const msgs = (g: string) => compile(g).problems.filter((p) => p.level === "error").map((p) => p.message).join(" | ");
    expect(msgs(`{ allow: "answers.days.n <= 10" }`)).toMatch(/reason is what the person sees/);
    expect(msgs(`{ allow: "answers.days.n <= 10", call: connector.hr.balance, reason: No }`)).toMatch(/one of them/);
    expect(msgs(`{ call: connector.hr.nothing, reason: No }`)).toMatch(/no service 'connector.hr.nothing'/);
    expect(msgs(`{ call: connector.hr.balance, within: 60000, reason: No }`)).toMatch(/within is milliseconds/);
    expect(msgs(`{ allow: "answers.days.n <=", reason: No }`)).not.toBe("");
  });

  it("a condition keeps the person on the step with the reason, then lets a good answer through", async () => {
    const r = createRunner(journey(`{ allow: "answers.days.n <= 10", reason: "At most 10 days at a time." }`));
    await r.start();
    const no = await r.answer({ n: 12 });
    expect(no).toMatchObject({ status: "asking", current: "days", refused: { step: "days", reason: "At most 10 days at a time." } });
    expect((no as { answers: object }).answers).toEqual({});
    const yes = await r.answer({ n: 3 });
    expect(yes).toMatchObject({ status: "done", result: { title: "Asked for 3 days" } });
  });

  it("a call answers yes or no in time; its answer is kept and replay reads it back", async () => {
    let calls = 0;
    const balance = async (input: unknown) => {
      calls++;
      const n = (input as { days: number }).days;
      return { ok: true, untrusted: true, status: 200, data: n <= 5 ? { allow: true } : { allow: false, reason: `Only 5 days left.` } };
    };
    const j = journey(`{ call: connector.hr.balance, with: { days: "{{answers.days.n}}" }, reason: "The leave balance says no." }`);
    const r = createRunner(j, { services: { "connector.hr.balance": balance } });
    await r.start();
    expect(await r.answer({ n: 8 })).toMatchObject({ status: "asking", refused: { reason: "Only 5 days left." } });
    const done = await r.answer({ n: 4 });
    expect(done).toMatchObject({ status: "done" });
    expect(calls).toBe(2);
    const snap = r.snapshot();
    expect(snap.steps[guardKey("days")]).toEqual({ allow: true, reason: null });

    // RTN-11: the server's replay reads the kept answer and calls nothing.
    const again = await replay(j, snap);
    expect(again.ok).toBe(true);
    expect(calls).toBe(2);
    // Without the kept answer, the replay can't pass the check.
    const steps = { ...snap.steps };
    delete steps[guardKey("days")];
    expect(await replay(j, { answers: snap.answers, steps })).toMatchObject({ ok: false });
  });

  it("no answer in time, or a failed check, stops the step: nothing goes on unchecked", async () => {
    const slow = () => new Promise((resolve) => setTimeout(() => resolve({ allow: true }), 500));
    const r = createRunner(journey(`{ call: connector.hr.balance, within: 100, reason: "We couldn't check your balance. Try again." }`), { services: { "connector.hr.balance": slow } });
    await r.start();
    expect(await r.answer({ n: 1 })).toMatchObject({ status: "asking", refused: { reason: "We couldn't check your balance. Try again." } });
    const broken = createRunner(journey(`{ call: connector.hr.balance, reason: "No check." }`), { services: { "connector.hr.balance": async () => ({ ok: false, untrusted: true, status: 500, data: { allow: true } }) } });
    await broken.start();
    expect(await broken.answer({ n: 1 })).toMatchObject({ status: "asking", refused: { reason: "No check." } });
  });

  it("reads yes or no only from allow: true", () => {
    expect(guardVerdict({ allow: true })).toEqual({ allow: true, reason: null });
    expect(guardVerdict({ allow: "yes" })).toEqual({ allow: false, reason: null });
    expect(guardVerdict(true).allow).toBe(true);
    expect(guardVerdict({ ok: true, untrusted: true, data: { allow: false, reason: " Over budget " } })).toEqual({ allow: false, reason: "Over budget" });
  });

  it("the designer keeps a screen's guard as written", () => {
    const p = parseDocument(SERVICE(`{ allow: "answers.days.n <= 10", reason: "At most 10." }`));
    if (!p.ok) throw new Error(p.error);
    const d = designFromDoc(p.doc);
    expect(d.unsupported).toEqual([]);
    const back = designToDoc(d.design);
    if (!back.ok) throw new Error(back.problems.join());
    const screen = (back.doc.journeys as { screens: { id: string; guard?: unknown }[] }[])[0]!.screens.find((s) => s.id === "days");
    expect(screen?.guard).toEqual({ allow: "answers.days.n <= 10", reason: "At most 10." });
  });
});
