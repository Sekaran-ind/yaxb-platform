// Journeys as XState machines (JRN-40..44): the graph, the ways through, and the design checks.
import { describe, expect, it } from "vitest";
import { compileBundle, designChecks, journeyGraph, journeyMachine, waysThrough } from "../src/index.js";

const SERVICE = (screens: string, roles = "[{ id: curator, label: Curator }]", complete = "[curator]") => `kind: service
id: race
title: Race
roles: ${roles}
journeys:
  - id: enter
    title: Enter
    roles: { complete: ${complete} }
    screens:
${screens}`;

const GOOD = `      - id: details
        questions: [{ id: name, type: text, label: Name, required: true }]
      - id: check
        title: Check the entry
        role: curator
        questions: [{ id: ok, type: boolean, label: Approved }]
      - id: approve
        title: Approve registration
        decide:
          - { if: "answers.check.ok == true", to: approved }
          - { to: denied }
      - id: approved
        result: { title: In }
      - id: denied
        result: { title: Not this time, ok: false }
`;
const journeyOf = (yaml: string) => {
  const b = compileBundle(yaml);
  return { b, j: b.journeys[0]! };
};

describe("journeys as state machines", () => {
  it("builds an XState machine with a state per step, finals for results", () => {
    const { j } = journeyOf(SERVICE(GOOD));
    const m = journeyMachine(j);
    expect(Object.keys(m.config.states!)).toEqual(["details", "check", "approve", "approved", "denied"]);
    expect((m.config.states!.approved as { type?: string }).type).toBe("final");
  });

  it("draws the graph with depths and the decision's conditions", () => {
    const { j } = journeyOf(SERVICE(GOOD));
    const g = journeyGraph(j);
    expect(g.nodes.map((n) => [n.id, n.kind, n.depth, n.role])).toEqual([
      ["details", "ask", 0, null],
      ["check", "ask", 1, "curator"],
      ["approve", "decide", 2, null],
      ["approved", "final", 3, null],
      ["denied", "final", 3, null],
    ]);
    expect(g.edges.filter((e) => e.from === "approve").map((e) => e.label)).toEqual(["if answers.check.ok == true", "otherwise"]);
  });

  it("finds one way through to each ending", () => {
    const { j } = journeyOf(SERVICE(GOOD));
    expect(waysThrough(j).map((w) => [w.end, w.steps.join(" → ")])).toEqual([
      ["approved", "details → check → approve → approved"],
      ["denied", "details → check → approve → denied"],
    ]);
  });

  it("a well-made journey has no design warnings", () => {
    const { b } = journeyOf(SERVICE(GOOD));
    expect(b.problems).toEqual([]);
  });

  it("explains the marathon's problems: a result that ends early, an approval nobody does, a role one letter off", () => {
    const bad = `      - id: details
        questions: [{ id: name, type: text, label: Name, required: true }]
      - id: review
        result: { title: Your details }
      - id: approve
        title: Approve registration
        decide:
          - { if: "answers.details.name == 'x'", to: approved }
          - { to: denied }
      - id: approved
        result: { title: In }
      - id: denied
        result: { title: Out }
`;
    const { b } = journeyOf(SERVICE(bad, "[{ id: curators, label: Curators }]", "[curators]"));
    const messages = b.problems.map((p) => p.message);
    expect(b.ok).toBe(true); // warnings only
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^screen 'approve' is never reached: 'review' before it is a result/),
        expect.stringMatching(/^screen 'approved' is never reached: only 'approve' leads to it/),
        expect.stringMatching(/^'Approve registration' is a decision, which runs by itself/),
        expect.stringMatching(/^role 'curators' looks like 'curator'/),
      ]),
    );
    // Each points at its own line.
    expect(b.problems.find((p) => p.message.startsWith("screen 'approve'"))!.line).toBe(12);
  });

  it("warns about a loop with no way out", () => {
    const { j } = journeyOf(
      SERVICE(`      - id: a
        questions: [{ id: x, type: text, label: X }]
        next: b
      - id: b
        decide:
          - { if: "answers.a.x == 'y'", to: a }
          - { to: a }
      - id: done
        result: { title: Done }
`),
    );
    const messages = designChecks(j).map((c) => c.message);
    expect(messages.some((m) => m.startsWith("from screen 'a' the journey can never end"))).toBe(true);
  });

  it("follows a failing service to the end unless it carries on", () => {
    const { j } = journeyOf(
      SERVICE(`      - id: ask-it
        service: agent.ask
        with: { message: hi }
      - id: done
        result: { title: Done }
`),
    );
    expect(waysThrough(j).map((w) => w.end)).toEqual(["done", "(failed)"]);
  });
});
