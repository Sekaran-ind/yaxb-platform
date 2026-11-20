// Dependencies (DEP-1, DEP-3): a screen that needs another service's journey waits for it; how
// that request ended comes back in steps.<id>, and a timed-out one goes to the fallback screen.
import { describe, expect, it } from "vitest";
import { compileBundle, createRunner, replay, type Journey } from "../src/index.js";

const ORDER = `kind: service
id: shop
title: Shop
roles:
  - { id: clerk, label: Clerk }
journeys:
  - id: order
    title: Order a part
    screens:
      - id: what
        title: What part
        questions:
          - { id: part, type: text, label: Part, required: true }
      - id: stores
        title: From the stores
        uses: { service: stores, journey: issue, timeout: 48, fallback: chase }
        with: { part: "{{answers.what.part}}" }
        next: done
      - id: chase
        title: Chase the stores
        role: clerk
        questions:
          - { id: note, type: text, label: Note }
      - id: done
        result: { title: "Ordered {{answers.what.part}}" }
`;
const journey = (): Journey => {
  const b = compileBundle(ORDER, { services: [] });
  expect(b.problems.filter((p) => p.level === "error")).toEqual([]);
  return b.journeys[0]!;
};

describe("a screen that uses another service (DEP-1)", () => {
  it("waits for it, then carries on with its outcome", async () => {
    const j = journey();
    const r = createRunner(j);
    await r.start();
    const waiting = await r.answer({ part: "fan belt" });
    expect(waiting).toMatchObject({ status: "waiting", current: "stores", waiting: { step: "stores", role: null, uses: { service: "stores", journey: "issue" } } });
    const done = await replay(j, { answers: { what: { part: "fan belt" } }, steps: { stores: { case: "R-ABCDEF", status: "done", result: { title: "Issued", text: "", ok: true } } } });
    expect(done).toMatchObject({ ok: true, state: { status: "done", result: { title: "Ordered fan belt" } } });
  });
  it("goes to the fallback when it waited too long (DEP-3)", async () => {
    const r = await replay(journey(), { answers: { what: { part: "fan belt" } }, steps: { stores: { case: "R-ABCDEF", status: "timed_out" } } });
    expect(r).toMatchObject({ ok: true, state: { status: "asking", current: "chase" } });
  });
  it("is checked: nothing else on the screen, a timeout with its fallback", () => {
    const msgs = (y: string) => compileBundle(y, { services: [] }).problems.filter((p) => p.level === "error").map((p) => p.message).join(" | ");
    expect(msgs(ORDER.replace("timeout: 48, fallback: chase", "timeout: 48"))).toMatch(/timeout and uses.fallback go together/);
    expect(msgs(ORDER.replace("fallback: chase", "fallback: nowhere"))).toMatch(/no (step|screen) 'nowhere'/);
    expect(msgs(ORDER.replace("        next: done\n", "        next: done\n        questions: [{ id: x, type: text, label: X }]\n"))).toMatch(/does nothing else/);
  });
});
