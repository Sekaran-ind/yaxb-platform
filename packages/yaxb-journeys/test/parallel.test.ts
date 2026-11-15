// Parallel journeys on the XState runner (JRN-45..49): tasks available together unless they wait
// for others (after:), worked on one at a time, then the journey carries on in sequence.
import { describe, expect, it } from "vitest";
import { compileBundle, createRunner, designFromDoc, designToDoc, journeyGraph, parseDocument, replay, toYaml, waysThrough, type Journey, type RunState } from "../src/index.js";

const EVENT = `kind: service
id: event
title: Event day
roles: [{ id: marshal, label: Marshal }]
journeys:
  - id: prepare
    title: Prepare the event
    flow: parallel
    screens:
      - id: venue
        title: Book the venue
        questions: [{ id: hall, type: text, label: Hall, required: true }]
      - id: food
        title: Order the food
        questions: [{ id: meals, type: number, label: Meals, required: true }]
      - id: route
        title: Check the route
        role: marshal
        after: [venue]
        questions: [{ id: ok, type: boolean, label: Route is safe }]
      - id: notice
        title: Send the notice
        service: notify.send
        after: [venue, food]
        with: { text: "At {{answers.venue.hall}}" }
      - id: go
        decide:
          - { if: "answers.route.ok == true", to: ready }
          - { to: wait }
      - id: ready
        result: { title: "All set at {{answers.venue.hall}}", outcome: event-ready }
      - id: wait
        result: { title: Route not cleared, ok: false, outcome: event-on-hold }
`;
const journey = (): Journey => {
  const b = compileBundle(EVENT, { services: ["notify.send"] });
  if (!b.ok) throw new Error(b.problems.map((p) => p.message).join("; "));
  return b.journeys[0]!;
};
const statuses = (s: RunState) => Object.fromEntries((s.tasks ?? []).map((t) => [t.step, t.status]));

describe("parallel journeys", () => {
  it("offers the tasks together, focuses the first, and lets a person switch", async () => {
    const r = createRunner(journey(), { services: { "notify.send": async (input) => ({ sent: input }) } });
    const s = await r.start();
    expect(s.status).toBe("asking");
    expect(s.prompt?.step).toBe("venue");
    expect(statuses(s)).toEqual({ venue: "asking", food: "ready", route: "pending", notice: "pending" });
    const switched = await r.focus("food");
    expect(switched.prompt?.step).toBe("food");
    expect(statuses(switched)).toMatchObject({ venue: "ready", food: "asking" });
  });

  it("starts a task when what it waits for is done, runs services by themselves, then carries on in sequence", async () => {
    const sent: unknown[] = [];
    const r = createRunner(journey(), { services: { "notify.send": async (input) => (sent.push(input), { sent: true }) } });
    await r.start();
    let s = (await r.answer({ hall: "Town hall" })) as RunState;
    // route waited for venue; notice waits for food too.
    expect(statuses(s)).toMatchObject({ venue: "done", route: "ready", notice: "pending" });
    s = (await r.answer({ meals: 40 })) as RunState; // food (focused next)
    expect(sent).toEqual([{ text: "At Town hall" }]);
    expect(statuses(s)).toMatchObject({ food: "done", notice: "done", route: "asking" });
    s = (await r.answer({ ok: true })) as RunState;
    expect(s.status).toBe("done");
    expect(s.result).toEqual({ title: "All set at Town hall", text: "", ok: true, outcome: "event-ready" });
    expect(s.trail.map((t) => t.step)).toEqual(["venue", "food", "notice", "route", "go", "ready"]);
  });

  it("waits for a role's task, hands over, and carries on as that role", async () => {
    const services = { "notify.send": async () => ({ sent: true }) };
    const organiser = createRunner(journey(), { services, actor: { starter: true, roles: [] } });
    await organiser.start();
    await organiser.answer({ hall: "Town hall" });
    const s = (await organiser.answer({ meals: 40 })) as RunState;
    expect(s.status).toBe("waiting");
    expect(s.waiting).toEqual({ step: "route", role: "marshal" });
    const snap = organiser.snapshot();
    const marshal = createRunner(journey(), { services, actor: { starter: false, roles: ["marshal"] } });
    const m = await marshal.resume(snap);
    expect(m.prompt?.step).toBe("route");
    const end = (await marshal.answer({ ok: false })) as RunState;
    expect(end.result?.outcome).toBe("event-on-hold");
  });

  it("replays stored answers in whatever order the tasks allow", async () => {
    const r = await replay(journey(), { answers: { food: { meals: 12 }, venue: { hall: "Library" } }, steps: { notice: { sent: true } } });
    if (!r.ok) throw new Error(r.problems.join());
    expect(r.state.status).toBe("asking");
    expect(r.state.prompt?.step).toBe("route");
    expect(r.answered.sort()).toEqual(["food", "venue"]);
  });

  it("checks parallel journeys: no next on a task, after only between tasks, no circles", () => {
    const bad = EVENT.replace("after: [venue]\n", "after: [route]\n").replace("        after: [venue, food]\n", "        after: [venue, food, go]\n");
    const b = compileBundle(bad, { services: ["notify.send"] });
    const messages = b.problems.map((p) => p.message).join(" | ");
    expect(messages).toMatch(/can't wait for itself/);
    expect(messages).toMatch(/after: no task 'go'/);
    const seq = compileBundle(EVENT.replace("    flow: parallel\n", ""), { services: ["notify.send"] });
    expect(seq.problems.map((p) => p.message).join(" | ")).toMatch(/after is for parallel journeys/);
  });

  it("draws and checks a parallel journey: no warnings, tasks by what they wait for, one way to each ending", () => {
    const b = compileBundle(EVENT, { services: ["notify.send"] });
    expect(b.problems).toEqual([]);
    const g = journeyGraph(b.journeys[0]!);
    const depth = Object.fromEntries(g.nodes.map((n) => [n.id, n.depth]));
    expect(depth).toMatchObject({ venue: 0, food: 0, route: 1, notice: 1, go: 2, ready: 3, wait: 3 });
    expect(g.edges.filter((e) => e.event === "ALL_DONE").map((e) => e.from).sort()).toEqual(["notice", "route"]);
    const ways = waysThrough(b.journeys[0]!).map((w) => [w.end, w.steps.join(" > ")]);
    expect(ways).toContainEqual(["ready", "venue > food > route > notice > go > ready"]);
  });

  it("the Service Designer keeps a parallel journey and its after lists", () => {
    const p = parseDocument(EVENT);
    if (!p.ok) throw new Error(p.error);
    const d = designFromDoc(p.doc).design;
    expect(d.journeys[0]!.flow).toBe("parallel");
    expect(d.journeys[0]!.screens.find((s) => s.id === "notice")!.after).toBe("venue, food");
    const back = designToDoc(d);
    if (!back.ok) throw new Error(back.problems.join());
    const again = compileBundle(toYaml(back.doc), { services: ["notify.send"] });
    expect(again.problems).toEqual([]);
    expect(again.journeys[0]!.flow).toBe("parallel");
    expect(again.journeys[0]!.steps.notice!.after).toEqual(["venue", "food"]);
  });

  it("still runs ordinary journeys in sequence, and goes round in circles no more than before", async () => {
    const loop = compileBundle(`kind: service
id: l
title: L
journeys:
  - id: j
    title: J
    screens:
      - id: a
        decide: [{ to: b }]
      - id: b
        decide: [{ to: a }]
`);
    const r = createRunner(loop.journeys[0]!);
    const s = await r.start();
    expect(s.status).toBe("failed");
    expect(s.error).toBe("The journey went round in circles.");
  });
});
