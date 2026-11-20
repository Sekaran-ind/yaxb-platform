// Dependencies between services (DEP-1..3, 5): a screen that uses another service's journey makes the
// case wait while a child case runs with only the screen's `with:` values; when the child closes,
// the parent carries on with how it ended; past its time, the parent goes to its fallback.
import { describe, expect, it } from "vitest";
import { compileBundle } from "@sekaran-ind/yaxb-journeys/bundle";
import { createCaseService, createMemoryCaseStore, isTurnOf, type CaseActor, type CaseJourney, type CaseStore } from "../src/cases/index.js";
import { createD1CaseStore } from "../src/stores/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

const SHOP = `kind: service
id: shop
title: Shop
roles:
  - { id: clerk, label: Clerk }
journeys:
  - id: order
    title: Order a part
    roles: { initiate: [visitor] }
    screens:
      - id: what
        title: What part
        questions:
          - { id: part, type: text, label: Part, required: true }
          - { id: phone, type: text, label: Phone }
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
        result: { title: "Ordered {{answers.what.part}}", outcome: order.placed }
`;
const STORES = `kind: service
id: stores
title: Stores
roles:
  - { id: storekeeper, label: Storekeeper }
journeys:
  - id: issue
    title: Issue a part
    screens:
      - id: give
        title: "Give {{context.uses.part}}"
        role: storekeeper
        questions:
          - { id: given, type: boolean, label: Given }
      - id: done
        result: { title: "Issued {{context.uses.part}}" }
`;
const compiled = (yaml: string, entry: string): CaseJourney => {
  const b = compileBundle(yaml, { services: [] });
  const s = b.services[0]!;
  return { journey: b.journeys[0]!, entry_id: entry, service_id: s.id, service_title: s.title, revision: 1 };
};
let stores = compiled(STORES, "e-stores");
const shop = compiled(SHOP, "e-shop");
const options = (events: string[]) => ({
  journeyFor: async (entry: string) => (entry === "e-shop" ? shop : entry === "e-stores" ? stores : null),
  journeyForService: async (service: string) => (service === "stores" ? stores : null),
  onDependency: (kind: string) => void events.push(kind),
});
const visitor: CaseActor = { id: "guest:v1", name: "Guest", roles: [], admin: false, guest: true };
const keeper: CaseActor = { id: "m-1", name: "Kumar", roles: ["storekeeper"], admin: false };
const clerk: CaseActor = { id: "m-2", name: "Lata", roles: ["clerk"], admin: false };

for (const [name, make] of [
  ["memory", () => createMemoryCaseStore()],
  ["D1", () => createD1CaseStore(sqliteD1())],
] as [string, () => CaseStore][]) {
  describe(`dependencies on ${name}`, () => {
    it("starts the needed service's request with only the screen's values, and carries on when it closes (DEP-1, DEP-2)", async () => {
      const events: string[] = [];
      const store = make();
      const svc = createCaseService(store, options(events));
      const { case: parent, spawned } = await svc.start(visitor, { entry: "e-shop", journey: "order", answers: { what: { part: "fan belt", phone: "98400 00000" } } });
      expect(parent).toMatchObject({ status: "waiting", waiting_step: "stores", waiting_role: null, links: { child: { service_title: "Stores", step: "stores" } } });
      expect(isTurnOf(parent, visitor)).toBe(false);
      expect(spawned).toHaveLength(1);
      const child = spawned[0]!;
      // DEP-2: the child gets the screen's with: values, nothing else (no phone number).
      expect(child.links?.inputs).toEqual({ part: "fan belt" });
      expect(JSON.stringify(child.run)).not.toContain("98400");
      expect(child).toMatchObject({ status: "waiting", waiting_role: "storekeeper", started_by: `case:${parent.id}` });
      expect((await svc.list(keeper)).mine.map((c) => c.id)).toEqual([child.id]);

      const r = await svc.act(keeper, child.id, { answers: { give: { given: true } } });
      expect(r.case.status).toBe("done");
      expect(r.resumed).toMatchObject({ id: parent.id, status: "done", result: { title: "Ordered fan belt" }, links: { child: null } });
      const kept = await store.get(parent.id);
      expect(kept!.run.steps.stores).toMatchObject({ case: child.ref, status: "done", result: { title: "Issued fan belt" } });
      expect(events).toEqual(["dependency.started", "dependency.ended"]);
    });

    it("stops waiting after its timeout and goes to the fallback (DEP-3)", async () => {
      const events: string[] = [];
      const svc = createCaseService(make(), options(events));
      const { case: parent, spawned } = await svc.start(visitor, { entry: "e-shop", journey: "order", answers: { what: { part: "gasket" } } });
      expect(await svc.expire(new Date(Date.now() + 47 * 3_600_000))).toEqual([]);
      const moved = await svc.expire(new Date(Date.now() + 49 * 3_600_000));
      expect(moved.map((c) => [c.id, c.status, c.waiting_step, c.waiting_role])).toEqual([[parent.id, "waiting", "chase", "clerk"]]);
      expect(events).toEqual(["dependency.started", "dependency.timed_out", "dependency.fallback"]);
      expect((await svc.list(clerk)).mine.map((c) => c.id)).toContain(parent.id);
      // The child, closed later, no longer moves the parent.
      const late = await svc.act(keeper, spawned[0]!.id, { answers: { give: { given: true } } });
      expect(late.resumed).toBeNull();
    });

    it("keeps the version published when the parent started (DEP-3), and refuses one that isn't published", async () => {
      const store = make();
      const svc = createCaseService(store, options([]));
      const { case: parent } = await svc.start(visitor, { entry: "e-shop", journey: "order", answers: { what: { part: "bolt" } } });
      const before = stores;
      try {
        stores = compiled(STORES.replace('title: "Issued {{context.uses.part}}"', "title: Changed"), "e-stores");
        const pinned = (await store.get(parent.id))!.links!.pins!.stores!;
        expect(pinned.journey.steps.done?.result?.title).toBe("Issued {{context.uses.part}}");
      } finally {
        stores = before;
      }
      const none = createCaseService(make(), { ...options([]), journeyForService: async () => null });
      await expect(none.start(visitor, { entry: "e-shop", journey: "order", answers: { what: { part: "bolt" } } })).rejects.toThrow(/isn't published/);
    });
  });
}

describe("dependencies checked when a service is saved (DEP-4)", () => {
  it("names a service that isn't published, a missing journey, one that starts with the requester, and a loop", async () => {
    const { dependencyProblems } = await import("../src/library/index.js");
    const own = compileBundle(SHOP, { services: [] }).journeys;
    const pub = (yaml: string) => {
      const b = compileBundle(yaml, { services: [] });
      return { id: b.services[0]!.id, title: b.services[0]!.title, journeys: b.journeys };
    };
    expect(dependencyProblems("shop", own, [pub(STORES)])).toEqual([]);
    expect(dependencyProblems("shop", own, [])).toEqual(["journey 'order' screen 'stores': uses 'stores', which isn't published"]);
    expect(dependencyProblems("shop", own, [pub(STORES.replace("id: issue", "id: other"))])[0]).toMatch(/has no journey 'issue'/);
    expect(dependencyProblems("shop", own, [pub(STORES.replace("        role: storekeeper\n", ""))])[0]).toMatch(/starts with the requester's own screen/);
    // Stores uses Shop back: a circle.
    const loop = STORES.replace(`      - id: done\n        result: { title: "Issued {{context.uses.part}}" }`, `      - id: back\n        title: Back\n        uses: { service: shop, journey: order }\n      - id: done\n        result: { title: Done }`);
    expect(dependencyProblems("shop", own, [pub(loop)])).toContain("its dependencies go round in a circle back to 'shop'");
  });
});
