import { describe, expect, it } from "vitest";
import { activityLog, createMemoryEventStore, eventBatchSchema, newEvent, serviceMetrics, weekOf, type EventStore, type ServiceEvent } from "../src/metrics/index.js";
import { createD1EventStore } from "../src/stores/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

const T0 = Date.parse("2026-11-16T09:00:00Z"); // a Monday
const at = (minutes: number) => new Date(T0 + minutes * 60_000);
const ev = (minutes: number, e: Parameters<typeof newEvent>[0]) => newEvent(e, at(minutes));
const base = { service: "e1", journey: "register" };

/** Three runs: one finished, one handed to the organiser and closed, one stopped at its first screen. */
function sample(): ServiceEvent[] {
  return [
    ev(0, { ...base, kind: "journey.started", run: "a" }),
    ev(0, { ...base, kind: "screen.reached", run: "a", step: "about-you" }),
    ev(1, { ...base, kind: "form.words", run: "a", step: "about-you" }),
    ev(2, { ...base, kind: "screen.reached", run: "a", step: "shirt" }),
    ev(3, { ...base, kind: "journey.finished", run: "a", ms: 180_000, ok: true }),

    ev(10, { ...base, kind: "journey.started", run: "b" }),
    ev(10, { ...base, kind: "screen.reached", run: "b", step: "about-you" }),
    ev(11, { ...base, kind: "journey.handed", run: "b", step: "approve", role: "organiser" }),
    ev(71, { ...base, kind: "request.picked_up", run: "b", role: "organiser", ms: 3_600_000, actor: "Olu" }),
    ev(72, { ...base, kind: "request.reassigned", run: "b", role: "organiser", actor: "Meena" }),
    ev(80, { ...base, kind: "request.closed", run: "b", role: "marshal", actor: "Mira" }),

    ev(20, { ...base, kind: "journey.started", run: "c" }),
    ev(20, { ...base, kind: "screen.reached", run: "c", step: "about-you" }),
    ev(21, { ...base, kind: "journey.stopped", run: "c", step: "about-you", ms: 60_000 }),
    ev(21, { ...base, journey: "other", kind: "step.failed", run: "d", step: "summary" }),
  ];
}
const journeys = [{ id: "register", title: "Register", steps: [{ id: "about-you", label: "About you" }, { id: "approve", label: "Approve" }, { id: "shirt", label: "T-shirt" }] }];

describe("service metrics (MET-3..5)", () => {
  it("counts outcomes per journey and for the service, named by their result screens (OUT-2)", () => {
    const events = [
      ...sample(),
      ev(4, { ...base, kind: "journey.outcome", run: "a", step: "entered", outcome: "entry-accepted", ok: true }),
      ev(30, { ...base, kind: "journey.outcome", run: "e", step: "entered", outcome: "entry-accepted", ok: true }),
      ev(31, { ...base, kind: "journey.outcome", run: "f", step: "refused", outcome: "entry.refused", ok: false }),
    ];
    const m = serviceMetrics(events, [{ ...journeys[0]!, outcomes: [{ id: "entry-accepted", label: "You're in" }] }]);
    expect(m.outcomes).toEqual([
      { outcome: "entry-accepted", label: "You're in", count: 2 },
      { outcome: "entry.refused", label: "entry.refused", count: 1 },
    ]);
    expect(m.journeys.find((j) => j.journey === "register")?.outcomes.map((o) => o.count)).toEqual([2, 1]);
    // Older events (no outcome) still parse.
    expect(eventBatchSchema.parse([{ ...sample()[0]!, outcome: undefined }])[0]!.outcome).toBeNull();
    expect(() => eventBatchSchema.parse([{ ...sample()[0]!, outcome: "Not An Id" }])).toThrow();
  });

  it("counts starts, finishes, hand-overs and open requests, and a funnel per journey", () => {
    const m = serviceMetrics(sample(), journeys);
    expect([m.started, m.finished, m.handed, m.open, m.closed, m.declined]).toEqual([3, 1, 1, 0, 1, 0]);
    expect(m.completion).toBeCloseTo(1 / 3);
    expect(m.weeks).toEqual([{ week: "2026-11-16", started: 3, finished: 1 }]);
    const j = m.journeys.find((x) => x.journey === "register")!;
    expect(j.title).toBe("Register");
    expect(j.funnel).toEqual([
      { step: "about-you", label: "About you", reached: 3, stoppedHere: 1 },
      { step: "approve", label: "Approve", reached: 0, stoppedHere: 0 },
      { step: "shirt", label: "T-shirt", reached: 1, stoppedHere: 0 },
    ]);
    expect(j.medianMs).toBe(180_000);
    expect(j.waits).toEqual([{ role: "organiser", medianMs: 3_600_000, picked: 1 }]);
    expect([j.reassigned, j.words, j.success]).toEqual([1, 1, 1]);
    // A journey with events but no definition still counts.
    expect(m.journeys.find((x) => x.journey === "other")!.failed).toEqual([{ step: "summary", count: 1 }]);
  });

  it("keeps an activity log of what people did, newest first, never visitors", () => {
    const log = activityLog(sample());
    expect(log.map((l) => `${l.actor} ${l.kind}`)).toEqual(["Mira request.closed", "Meena request.reassigned", "Olu request.picked_up"]);
  });

  it("refuses anything that isn't a plain event (no free text)", () => {
    const good = sample()[0]!;
    expect(eventBatchSchema.safeParse([good]).success).toBe(true);
    expect(eventBatchSchema.safeParse([{ ...good, answers: { name: "Asha" } }]).success).toBe(false);
    expect(eventBatchSchema.safeParse([{ ...good, kind: "journey.answered" }]).success).toBe(false);
    expect(weekOf("2026-11-22T23:00:00Z")).toBe("2026-11-16");
  });

  for (const [name, make] of [
    ["memory", () => createMemoryEventStore()],
    ["D1 (SQLite)", () => createD1EventStore(sqliteD1())],
  ] as [string, () => EventStore][]) {
    it(`stores events once each and lists a service's since a time, ${name}`, async () => {
      const store = make();
      const events = sample();
      await store.add(events);
      await store.add(events.slice(0, 2));
      expect((await store.list("e1")).length).toBe(events.length);
      expect((await store.list("e1", { since: at(60).toISOString() })).map((e) => e.kind)).toEqual(["request.picked_up", "request.reassigned", "request.closed"]);
      expect(await store.list("e2")).toEqual([]);
      const back = (await store.list("e1")).find((e) => e.kind === "journey.finished")!;
      expect([back.ok, back.ms]).toEqual([true, 180_000]);
    });
  }
});
