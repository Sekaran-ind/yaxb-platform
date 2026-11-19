import { describe, expect, it } from "vitest";
import { load } from "js-yaml";
import {
  compileBundle,
  compileOrganisation,
  createRunner,
  managerOf,
  MANAGER_OF_REQUESTER,
  ORGANISATION_TEMPLATES,
  organisationChecks,
  resolveForRequester,
  templatesFor,
  unitLinks,
  unitTree,
  type Organisation,
} from "../src/index.js";

const STORE = `kind: organisation
id: store
title: Store
type: business
sites:
  - { id: main, title: Main shop }
units:
  - id: office
    title: Owner
    lead: owner
    roles: [{ id: owner, label: Owner }]
  - id: counter
    title: Counter
    reports_to: office
    lead: counter-head
    roles: [counter-head, cashier]
    services: [orders]
    sites: [main]
  - id: night
    title: Night shift
    reports_to: counter
    roles: [night-cashier]
`;

const org = (yaml = STORE): Organisation => {
  const r = compileOrganisation(load(yaml));
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.organisation;
};

describe("compileOrganisation (ORG-1)", () => {
  it("reads units, roles, reporting lines and sites", () => {
    const o = org();
    expect(o.units.map((u) => u.id)).toEqual(["office", "counter", "night"]);
    expect(o.units[1]!.roles.map((r) => r.label)).toEqual(["Counter head", "Cashier"]);
    expect(unitTree(o).map((t) => `${t.depth}:${t.unit.id}`)).toEqual(["0:office", "1:counter", "2:night"]);
  });

  it("refuses unknown units, sites, leads, loops and a role in two units", () => {
    const bad = `kind: organisation
id: x
units:
  - { id: a, reports_to: b, lead: boss, roles: [one] }
  - { id: b, reports_to: a, roles: [one], sites: [nowhere] }
  - { id: c, reports_to: zz, roles: [two] }
`;
    const r = compileOrganisation(load(bad));
    expect(r.ok).toBe(false);
    const text = r.problems.join("\n");
    expect(text).toMatch(/lead 'boss' isn't one of its roles/);
    expect(text).toMatch(/role 'one' is already in unit 'a'/);
    expect(text).toMatch(/no site 'nowhere'/);
    expect(text).toMatch(/no unit 'zz'/);
    expect(text).toMatch(/goes round in a circle/);
  });

  it("refuses HR records (ORG-9)", () => {
    const r = compileOrganisation(load(`kind: organisation\nid: x\nunits:\n  - { id: a, roles: [one], salary: 100 }\n`));
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/no HR records, salaries or grades/);
  });

  it("has no reporting lines in a household (ORG-8)", () => {
    const r = compileOrganisation(load(`kind: organisation\nid: home\ntype: household\nunits:\n  - { id: home, lead: grown-up, roles: [grown-up, child] }\n`));
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/nobody reports to anyone/);
    const ok = org(`kind: organisation\nid: home\ntype: household\nunits:\n  - { id: home, roles: [grown-up, child] }\n`);
    expect(managerOf(ok, ["child"])).toBeNull();
  });
});

describe("manager-of-requester (ORG-3)", () => {
  it("goes to the lead of the requester's unit, or above when they are the lead", () => {
    const o = org();
    expect(managerOf(o, ["cashier"])).toBe("counter-head");
    expect(managerOf(o, ["counter-head"])).toBe("owner");
    expect(managerOf(o, ["owner"])).toBeNull();
    // A unit with no lead: the first lead above it.
    expect(managerOf(o, ["night-cashier"])).toBe("counter-head");
    // A visitor: the lead of the unit that runs the service.
    expect(managerOf(o, [], { service: "orders" })).toBe("counter-head");
    expect(managerOf(o, [])).toBeNull();
  });

  it("rewrites a journey for one requester, so the runner waits for that role only", async () => {
    const yaml = `kind: service
id: leave
title: Leave
roles: [cashier, counter-head]
journeys:
  - id: ask
    title: Ask
    roles: { initiate: [cashier, counter-head] }
    screens:
      - { id: days, title: Days, questions: [{ id: n, type: number, label: Days, required: true }] }
      - { id: approve, title: Approve, role: ${MANAGER_OF_REQUESTER}, questions: [{ id: ok, type: boolean, label: OK }] }
      - { id: done, result: { title: Done } }
`;
    const b = compileBundle(yaml);
    expect(b.problems.filter((p) => p.level === "error")).toEqual([]);
    const j = b.journeys[0]!;
    const forCashier = resolveForRequester(j, org(), ["cashier"]);
    expect(forCashier.ok && forCashier.journey.steps.approve!.role).toBe("counter-head");
    const forHead = resolveForRequester(j, org(), ["counter-head"]);
    expect(forHead.ok && forHead.journey.steps.approve!.role).toBe("owner");
    expect(resolveForRequester(j, org(), ["owner"]).ok).toBe(false);
    expect(resolveForRequester(j, null, ["cashier"]).ok).toBe(false);

    const run = createRunner(j, { actor: { starter: true, roles: ["cashier"] } });
    await run.start();
    await run.answer({ n: 2 });
    expect(run.state.status).toBe("waiting");
    expect(run.state.waiting?.role).toBe(MANAGER_OF_REQUESTER);
  });

  it("can't start a journey", () => {
    const b = compileBundle(`kind: service\nid: s\njourneys:\n  - id: j\n    roles: { initiate: [${MANAGER_OF_REQUESTER}] }\n    screens:\n      - { id: done, result: { title: Done } }\n`);
    expect(b.problems.some((p) => p.level === "error" && /only answers a screen/.test(p.message))).toBe(true);
  });
});

describe("checks and links (ORG-4, ORG-5)", () => {
  it("warns about roles no unit holds, unknown services, and nobody staffed", () => {
    const checks = organisationChecks(org(), [{ id: "orders", title: "Orders", roles: ["cashier", "packer", "visitor", "administrator"] }], [["owner"]]);
    const text = checks.map((c) => c.message);
    expect(text).toContain("role 'packer' of service 'orders' is held by no unit");
    expect(text.some((m) => /unit 'counter' runs 'orders' with nobody staffed/.test(m))).toBe(true);
    expect(organisationChecks(org(), []).map((c) => c.message)).toContain("unit 'counter' runs 'orders', which isn't in the catalogue");
  });

  it("draws units working together from journeys, weighted by hand-overs", () => {
    const journeys = [
      { id: "order", roles: { initiate: ["cashier"], complete: ["owner"] }, steps: { a: { id: "a" }, b: { id: "b", role: "counter-head" } } },
      { id: "night", roles: { initiate: ["night-cashier"] }, steps: { a: { id: "a", role: "cashier" } } },
    ] as never;
    expect(unitLinks(org(), journeys, { order: 5 })).toEqual([
      { from: "counter", to: "office", journeys: ["order"], weight: 5 },
      { from: "night", to: "counter", journeys: ["night"], weight: 1 },
    ]);
  });

  it("adds the checks to a bundle with services, and the units' roles to its roles", () => {
    const b = compileBundle([STORE, `kind: service\nid: orders\ntitle: Orders\nroles: [packer]\njourneys:\n  - id: o\n    roles: { complete: [packer] }\n    screens:\n      - { id: done, result: { title: Done } }\n`]);
    expect(b.organisations).toHaveLength(1);
    expect(b.roles.map((r) => r.id)).toEqual(expect.arrayContaining(["owner", "cashier", "packer"]));
    expect(b.problems.some((p) => p.kind === "organisation" && /'packer'/.test(p.message))).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe("templates (ORG-2)", () => {
  it("has every template the spec names, by edition", () => {
    expect(templatesFor("business").map((t) => t.id)).toEqual(["hardware-store", "salon", "tuition-centre", "home-kitchen", "attendance"]);
    expect(templatesFor("family").map((t) => t.id)).toEqual(["our-home", "joint-family", "elder-alone", "students-flat"]);
    expect(templatesFor("community").map((t) => t.id)).toEqual(["apartment-association", "housing-society", "temple-committee", "club", "self-help-group", "parents-group"]);
  });

  it.each(ORGANISATION_TEMPLATES.map((t) => [t.id, t] as const))("%s compiles with its starter services, without warnings", (_, t) => {
    const b = compileBundle([t.organisation, ...t.services]);
    expect(b.problems).toEqual([]);
    expect(b.organisations).toHaveLength(1);
    expect(b.services).toHaveLength(t.services.length);
    if (t.edition !== "family") {
      // Every unit's own services are among its starters.
      const ids = new Set(b.services.map((s) => s.id));
      for (const u of b.organisations[0]!.units) for (const s of u.services) expect(ids.has(s)).toBe(true);
    }
  });
});
