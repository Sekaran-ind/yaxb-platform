// Outcomes (OUT-1..3): a result screen names what the journey achieved; the runner returns it,
// the checks validate it, and the designer keeps it.
import { describe, expect, it } from "vitest";
import { compileBundle, createRunner, designFromDoc, designToDoc, parseDocument } from "../src/index.js";

const SERVICE = (outcome: string) => `kind: service
id: race
title: Race
journeys:
  - id: enter
    title: Enter
    screens:
      - id: you
        questions: [{ id: km, type: select, label: Distance, options: [{ value: "5", label: 5 km }, { value: "42", label: Marathon }], required: true }]
      - id: route
        decide:
          - { if: "answers.you.km == '42'", to: refused }
          - { to: entered }
      - id: entered
        result: { title: "You're in", outcome: ${outcome} }
      - id: refused
        result: { title: Not this time, ok: false, outcome: entry.refused }
`;

describe("outcomes", () => {
  it("the run's result carries its screen's outcome", async () => {
    const b = compileBundle(SERVICE("entry-accepted"));
    expect(b.problems).toEqual([]);
    const r = createRunner(b.journeys[0]!);
    await r.start();
    const done = await r.answer({ km: "5" });
    expect("status" in done && done.result).toEqual({ title: "You're in", text: "", ok: true, outcome: "entry-accepted" });
    const r2 = createRunner(b.journeys[0]!);
    await r2.start();
    const no = await r2.answer({ km: "42" });
    expect("status" in no && no.result?.outcome).toBe("entry.refused");
  });

  it("refuses an outcome that isn't a plain id", () => {
    const b = compileBundle(SERVICE('"Entry {{answers.you.km}}"'));
    expect(b.ok).toBe(false);
    expect(b.problems.map((p) => p.message).join(" ")).toMatch(/outcome is an id/);
  });

  it("the designer keeps a result's outcome both ways", () => {
    const p = parseDocument(SERVICE("entry-accepted"));
    if (!p.ok) throw new Error(p.error);
    const d = designFromDoc(p.doc).design;
    const entered = d.journeys[0]!.screens.find((s) => s.id === "entered")!;
    expect(entered.resultOutcome).toBe("entry-accepted");
    const back = designToDoc(d);
    if (!back.ok) throw new Error(back.problems.join());
    const screens = (back.doc.journeys as { screens: { id: string; result?: { outcome?: string } }[] }[])[0]!.screens;
    expect(screens.find((s) => s.id === "refused")?.result?.outcome).toBe("entry.refused");
  });
});
