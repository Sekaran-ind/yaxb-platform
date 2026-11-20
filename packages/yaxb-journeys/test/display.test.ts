// Display blocks (VIS-6): a screen or a result shows a map, a chart or a timeline, filled from the run.
import { describe, expect, it } from "vitest";
import { compileBundle, createRunner, geoPoint } from "../src/index.js";

const SERVICE = (show: string) => `kind: service
id: plots
title: Plots
journeys:
  - id: mark
    title: Mark the gate
    screens:
      - id: where
        title: Where
        questions:
          - { id: gate, type: location, label: The gate, required: true }
      - id: load
        title: Load
        service: test.load
      - id: done
        result: { title: Marked }
        show: ${show}
`;

describe("display blocks (VIS-6)", () => {
  it("fills a result's map, chart and timeline from the run", async () => {
    const b = compileBundle(SERVICE(`[{ map: { from: "{{answers.where.gate}}", title: The gate } }, { chart: { from: "{{steps.load.counts}}", kind: line } }, { timeline: { from: "{{steps.load.visits}}" } }]`), { services: ["test.load"] });
    expect(b.problems.filter((p) => p.level === "error")).toEqual([]);
    const counts = [{ label: "Mon", value: 3 }, { label: "Tue", value: 5 }];
    const visits = [{ name: "Survey", startDate: "2026-11-23" }];
    const r = createRunner(b.journeys[0]!, { services: { "test.load": async () => ({ counts, visits }) } });
    await r.start();
    const done = await r.answer({ gate: geoPoint({ lat: 13.08, lng: 80.27 }) });
    expect(done).toMatchObject({ status: "done" });
    expect((done as { result: { show: unknown } }).result.show).toEqual([
      { type: "map", title: "The gate", data: { "@type": "GeoCoordinates", latitude: 13.08, longitude: 80.27 } },
      { type: "chart", title: null, kind: "line", data: counts },
      { type: "timeline", title: null, data: visits },
    ]);
  });
  it("checks the blocks", () => {
    const msgs = (show: string) => compileBundle(SERVICE(show), { services: ["test.load"] }).problems.filter((p) => p.level === "error").map((p) => p.message).join(" | ");
    expect(msgs(`[{ table: { from: "{{answers.where.gate}}" } }]`)).toMatch(/one of map, chart, timeline/);
    expect(msgs(`[{ map: { from: "answers.where.gate" } }]`)).toMatch(/from is a template/);
    expect(msgs(`[{ map: { from: "{{answers.where.gate}}", kind: bar } }]`)).toMatch(/kind is bar or line, for a chart/);
  });
});
