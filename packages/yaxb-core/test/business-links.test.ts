// Business links (DEP-2, DEP-4, DEP-5): one business lets another use a journey as a dependency.
// Consent is the provider's (versioned, audited on both sides); only the screen's `with:` values cross,
// shaped as a schema.org Order or Invoice; the provider's request lives in its own list; only how it
// ended goes back.
import { describe, expect, it } from "vitest";
import { compileBundle } from "@sekaran-ind/yaxb-journeys/bundle";
import { createCaseService, createMemoryCaseStore, type CaseActor, type CaseJourney, type CaseService } from "../src/cases/index.js";
import { createD1CaseStore } from "../src/stores/d1.js";
import { createD1LinkStore, createLinkService, createMemoryLinkStore, LinkError, shapeInputs, shapeProblems, type LinkActor, type LinkStore } from "../src/links/index.js";
import { dependencyProblems } from "../src/library/index.js";
import { sqliteD1 } from "./sqlite-d1.js";

const SHOP = `kind: service
id: garage
title: Garage
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
      - id: parts
        title: From the supplier
        uses: { business: parts, service: stores, journey: issue, as: Order, timeout: 48, fallback: chase }
        with: { orderNumber: "{{answers.what.part}}", description: "{{answers.what.part}}" }
        next: done
      - id: chase
        title: Chase the supplier
        role: clerk
        questions:
          - { id: note, type: text, label: Note }
      - id: done
        result: { title: "Ordered {{answers.what.part}}" }
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
        title: "Give {{context.uses.description}}"
        role: storekeeper
        questions:
          - { id: given, type: boolean, label: Given }
      - id: done
        result: { title: "Issued {{context.uses.description}}" }
`;
const compiled = (yaml: string, entry: string): CaseJourney => {
  const b = compileBundle(yaml, { services: [] });
  const s = b.services[0]!;
  return { journey: b.journeys[0]!, entry_id: entry, service_id: s.id, service_title: s.title, revision: 1 };
};
const shop = compiled(SHOP, "e-garage");
const stores = compiled(STORES, "e-stores");

const TENANTS: Record<string, { id: string; slug: string; name: string; status: string }> = {
  garage: { id: "garage", slug: "garage", name: "Garage", status: "active" },
  parts: { id: "parts", slug: "parts", name: "Parts Co", status: "active" },
  gone: { id: "gone", slug: "gone", name: "Gone", status: "suspended" },
};
const admin = (tenant: string): LinkActor => ({ tenant, id: `${tenant}-admin`, name: `${tenant} admin`, admin: true });
const visitor: CaseActor = { id: "guest:v1", name: "Guest", roles: [], admin: false, guest: true };
const keeper: CaseActor = { id: "m-1", name: "Kumar", roles: ["storekeeper"], admin: false };
const clerk: CaseActor = { id: "m-2", name: "Lata", roles: ["clerk"], admin: false };
const OFFER = { service: "stores", journey: "issue", accepts: "Order" as const };

function world(linkStore: LinkStore = createMemoryLinkStore()) {
  const audits: string[] = [];
  const links = createLinkService(linkStore, {
    tenant: async (k) => TENANTS[k] ?? null,
    published: async (_t, service, journey) => service === "stores" && journey === "issue",
    audit: (tenant, action) => void audits.push(`${tenant}:${action}`),
  });
  const db = sqliteD1();
  let requesting!: CaseService;
  let providing!: CaseService;
  const requesterPort = {
    allows: async (b: string, s: string, j: string) => {
      const o = await links.offerFor("garage", b, s, j);
      return o ? { id: o.link.provider, name: o.link.provider_name, as: o.offer.accepts } : null;
    },
    start: (provider: string, input: Parameters<CaseService["startForPartner"]>[0] extends infer I ? Omit<Extract<I, object>, "requester" | "requester_name"> : never) => {
      expect(provider).toBe("parts");
      return providing.startForPartner({ ...input, requester: "garage", requester_name: "Garage" });
    },
    offered: async () => null,
    closed: async () => undefined,
  };
  const providerPort = {
    allows: async () => null,
    start: async () => {
      throw new Error("never");
    },
    offered: async (requester: string, service: string, journey: string) => {
      const l = (await links.list("parts")).find((x) => x.status === "active" && x.requester === requester && x.provider === "parts");
      return l?.offers.find((o) => o.service === service && o.journey === journey)?.accepts ?? null;
    },
    closed: async (requester: string, input: { parent: string; ref: string; status: "done" | "declined"; result: never }) => void (await requesting.resumeFromPartner({ provider: "parts", ...input })),
  };
  requesting = createCaseService(createD1CaseStore(db, { tenant: "garage" }), { journeyFor: async () => shop, partner: requesterPort as never });
  providing = createCaseService(createD1CaseStore(db, { tenant: "parts" }), { journeyFor: async () => stores, journeyForService: async (s) => (s === "stores" ? stores : null), partner: providerPort as never });
  return { links, audits, requesting, providing, db };
}
const linked = async (w: ReturnType<typeof world>) => {
  const l = await w.links.invite(admin("garage"), "parts");
  await w.links.accept(admin("parts"), l.id, [OFFER]);
  return l;
};
const order = (w: ReturnType<typeof world>) => w.requesting.start(visitor, { entry: "e-garage", journey: "order", answers: { what: { part: "fan belt", phone: "98400 00000" } } });

describe("business links: consent and audit (DEP-2, DEP-5)", () => {
  it("is asked for by the requester, accepted with an offer by the provider, versioned, ended by either", async () => {
    const w = world();
    const l = await w.links.invite(admin("garage"), "parts");
    expect(l).toMatchObject({ status: "invited", requester: "garage", provider: "parts", offers: [], consent_version: 0 });
    await expect(w.links.invite(admin("garage"), "parts")).rejects.toThrow(/already/);
    await expect(w.links.accept(admin("garage"), l.id, [OFFER])).rejects.toThrow(/being asked/);
    await expect(w.links.accept(admin("parts"), l.id, [{ ...OFFER, journey: "nope" }])).rejects.toThrow(/isn't published/);
    expect(await w.links.accept(admin("parts"), l.id, [OFFER, OFFER])).toMatchObject({ status: "active", offers: [OFFER], consent_version: 1 });
    expect(await w.links.setOffers(admin("parts"), l.id, [])).toMatchObject({ offers: [], consent_version: 2 });
    await expect(w.links.setOffers(admin("garage"), l.id, [OFFER])).rejects.toThrow(/provides/);
    expect(await w.links.end(admin("garage"), l.id)).toMatchObject({ status: "ended", ended_by: "Garage" });
    await expect(w.links.end(admin("parts"), l.id)).rejects.toThrow(/ended already/);
    // Audited on both sides (DEP-5): created, consent changed twice, ended.
    expect(w.audits.filter((a) => a.startsWith("garage:"))).toEqual(["garage:link.created", "garage:link.consent_changed", "garage:link.consent_changed", "garage:link.ended"]);
    expect(w.audits.filter((a) => a.startsWith("parts:"))).toHaveLength(4);
  });

  it("refuses non-administrators, itself, a suspended business, and a link nobody is on", async () => {
    const w = world();
    await expect(w.links.invite({ ...admin("garage"), admin: false }, "parts")).rejects.toThrow(LinkError);
    await expect(w.links.invite(admin("garage"), "garage")).rejects.toThrow(/itself/);
    await expect(w.links.invite(admin("garage"), "gone")).rejects.toThrow(/no active business/);
    const l = await linked(w);
    await expect(w.links.get(admin("gone"), l.id)).rejects.toThrow(/no such link/);
  });

  it("works on D1 too", async () => {
    const db = sqliteD1();
    const w = world(createD1LinkStore(db));
    const l = await linked(w);
    expect((await w.links.list("garage"))[0]).toMatchObject({ id: l.id, status: "active", offers: [OFFER] });
    expect((await w.links.offerFor("garage", "parts", "stores", "issue"))?.offer.accepts).toBe("Order");
    expect(await w.links.offerFor("garage", "parts", "stores", "other")).toBeNull();
  });
});

describe("a request across a business link (DEP-2)", () => {
  it("starts in the provider's own list with only the shaped values, and comes back when it closes", async () => {
    const w = world();
    await linked(w);
    const { case: parent, spawned } = await order(w);
    // Nothing local was spawned: the request is the provider's.
    expect(spawned).toEqual([]);
    expect(parent).toMatchObject({ status: "waiting", waiting_step: "parts", links: { child: { business: "parts", business_name: "Parts Co", service_title: "Stores" } } });
    const theirs = (await w.providing.list(keeper)).mine;
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ started_by_name: "Garage", links: { parent: { business: "garage", id: parent.id }, inputs: { "@context": "https://schema.org", "@type": "Order", orderNumber: "fan belt", description: "fan belt" } } });
    // The garage's own people never see the supplier's request, and the phone number never left.
    expect((await w.requesting.list(clerk)).others.map((c) => c.id)).not.toContain(theirs[0]!.id);
    const full = await w.providing.get(keeper, theirs[0]!.id);
    expect(JSON.stringify(full.case)).not.toContain("98400");

    const r = await w.providing.act(keeper, theirs[0]!.id, { answers: { give: { given: true } } });
    expect(r.case.status).toBe("done");
    const back = await w.requesting.get({ id: "guest:v1", name: "Guest", roles: [], admin: false, guest: true }, parent.ref);
    expect(back.case).toMatchObject({ status: "done", result: { title: "Ordered fan belt" }, links: { child: null } });
    expect(back.case.run.steps.parts).toMatchObject({ case: theirs[0]!.ref, status: "done", result: { title: "Issued fan belt" } });
  });

  it("each business sees only its own cases", async () => {
    const w = world();
    await linked(w);
    await order(w);
    const admins: CaseActor = { id: "a", name: "A", roles: [], admin: true };
    expect((await w.requesting.list(admins)).others.every((c) => c.entry_id === "e-garage")).toBe(true);
    expect((await w.providing.list(admins)).others.every((c) => c.entry_id === "e-stores")).toBe(true);
  });

  it("is refused without an active link that offers the journey", async () => {
    const w = world();
    await expect(order(w)).rejects.toThrow(/no active link/);
    const l = await linked(w);
    await w.links.setOffers(admin("parts"), l.id, []);
    await expect(order(w)).rejects.toThrow(/no active link/);
    await w.links.setOffers(admin("parts"), l.id, [OFFER]);
    await w.links.end(admin("parts"), l.id);
    await expect(order(w)).rejects.toThrow(/no active link/);
  });

  it("the provider refuses a forged request: no link, wrong shape, or a property outside the shape", async () => {
    const w = world();
    const input = { requester: "garage", requester_name: "Garage", service: "stores", journey: "issue", as: "Order" as const, inputs: { description: "x" }, parent: { id: "p", ref: "R-AAAAAA", step: "parts", service_title: "Garage", journey_title: "Order" } };
    await expect(w.providing.startForPartner(input)).rejects.toThrow(/no active link/);
    await linked(w);
    await expect(w.providing.startForPartner({ ...input, as: "Invoice" })).rejects.toThrow(/no active link/);
    await expect(w.providing.startForPartner({ ...input, inputs: { description: "x", phone: "98400" } })).rejects.toThrow(/isn't a property of a schema.org Order/);
    await expect(w.providing.startForPartner(input)).resolves.toMatchObject({ service_title: "Stores" });
  });

  it("stops waiting after its timeout and takes the fallback; a late close does nothing", async () => {
    const w = world();
    await linked(w);
    const { case: parent } = await order(w);
    const moved = await w.requesting.expire(new Date(Date.now() + 49 * 3_600_000));
    expect(moved.map((c) => [c.id, c.waiting_step])).toEqual([[parent.id, "chase"]]);
    const child = (await w.providing.list(keeper)).mine[0]!;
    await w.providing.act(keeper, child.id, { answers: { give: { given: true } } });
    expect((await w.requesting.get(clerk, parent.id)).case).toMatchObject({ status: "waiting", waiting_step: "chase" });
  });

  it("only the request it waits for, from the business it waits on, resumes a case", async () => {
    const w = world();
    await linked(w);
    const { case: parent } = await order(w);
    const result = { title: "x", text: "", ok: true };
    expect(await w.requesting.resumeFromPartner({ provider: "other", parent: parent.id, ref: parent.links!.child!.ref, status: "done", result })).toBeNull();
    expect(await w.requesting.resumeFromPartner({ provider: "parts", parent: parent.id, ref: "R-AAAAAA", status: "done", result })).toBeNull();
    expect((await w.requesting.get(visitor, parent.ref)).case.status).toBe("waiting");
  });

  it("works on the memory store", async () => {
    const w = world();
    expect(createMemoryCaseStore()).toBeTruthy();
    await linked(w);
    expect((await order(w)).case.links?.child?.business).toBe("parts");
  });
});

describe("what a service may use of another business at publish time (DEP-2, DEP-4)", () => {
  const own = compileBundle(SHOP, { services: [] }).journeys;
  const pub = (yaml: string) => {
    const b = compileBundle(yaml, { services: [] });
    return { id: b.services[0]!.id, title: b.services[0]!.title, journeys: b.journeys };
  };
  it("needs an active link that offers the journey, in the shape written, with only that shape's properties", () => {
    const offer = (as: "Order" | "Invoice") => () => ({ as });
    expect(dependencyProblems("garage", own, [], { business: offer("Order") })).toEqual([]);
    expect(dependencyProblems("garage", own, [], { business: () => null })[0]).toMatch(/no active link with 'parts' offers 'stores' \(issue\)/);
    expect(dependencyProblems("garage", own, [], { business: offer("Invoice") })[0]).toMatch(/accepts a Invoice.*write as: Invoice/);
    expect(dependencyProblems("garage", own, [], {})[0]).toMatch(/business links aren't available/);
    const wide = compileBundle(SHOP.replace("description: ", "phone: "), { services: [] }).journeys;
    expect(dependencyProblems("garage", wide, [], { business: offer("Order") })[0]).toMatch(/'phone' isn't a property of a schema.org Order/);
  });

  it("needs someone to hold the roles the used service runs on (DEP-4)", () => {
    const local = compileBundle(SHOP.replace("business: parts, ", "").replace("as: Order, ", "").replace("orderNumber", "part").replace("description", "x"), { services: [] }).journeys;
    expect(dependencyProblems("garage", local, [pub(STORES)], { staffed: (r) => r === "storekeeper" })).toEqual([]);
    expect(dependencyProblems("garage", local, [pub(STORES)], { staffed: () => false })).toEqual(["journey 'order' screen 'parts': nobody holds the role 'storekeeper', which 'Stores' needs to run"]);
    expect(dependencyProblems("garage", local, [pub(STORES)])).toEqual([]);
  });

  it("shapes values as schema.org and drops everything else", () => {
    expect(shapeInputs("Invoice", { referenceNumber: "A1", phone: "98400" })).toEqual({ "@context": "https://schema.org", "@type": "Invoice", referenceNumber: "A1" });
    expect(shapeProblems("Order", ["description", "ssn"])).toHaveLength(1);
  });
});
