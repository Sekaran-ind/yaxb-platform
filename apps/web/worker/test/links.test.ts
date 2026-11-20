// Business links on the server (DEP-2, DEP-4, DEP-5): two businesses of one edition, each with its own
// catalogue and its own list of cases. The requester's request for a linked business's service starts
// in that business's list, with only the shaped values; its closing brings the requester's case on.
import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../packages/yaxb-core/test/sqlite-d1";
import { ADMIN_ACTOR_ID, type LibraryActor } from "@sekaran-ind/yaxb-core/library";
import type { LinkActor } from "@sekaran-ind/yaxb-core/links";
import { withEdition } from "../edition";
import { cases, library, links, moderators, tenantContext, tenants } from "../kiosk";

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
const GARAGE = `kind: service
id: garage
title: Garage
journeys:
  - id: order
    title: Order a part
    roles: { initiate: [visitor] }
    screens:
      - id: what
        title: What part
        questions:
          - { id: part, type: text, label: Part, required: true }
      - id: parts
        title: From the supplier
        uses: { business: parts, service: stores, journey: issue, as: Order }
        with: { description: "{{answers.what.part}}" }
        next: done
      - id: done
        result: { title: "Ordered {{answers.what.part}}" }
`;
const admin: LibraryActor = { id: ADMIN_ACTOR_ID, name: "Administrator", roles: ["administrator"], admin: true };
const reviewer: LibraryActor = { id: "r1", name: "Revathi", roles: ["reviewer"], admin: false };
const env = () => ({ SESSION_SECRET: "x".repeat(40), DB: sqliteD1(), DB_FAMILY: sqliteD1(), DB_BUSINESS: sqliteD1(), DB_COMMUNITY: sqliteD1() }) as never;
const act = (tenant: string): LinkActor => ({ tenant, id: "a", name: "Admin", admin: true });
const as = <T>(tenant: string, fn: () => Promise<T>) => tenantContext.run(tenant, fn);

async function publish(e: never, tenant: string, yaml: string) {
  const lib = library(e, tenant);
  const { entry } = await lib.createEntry(admin, null, { yaml });
  await lib.submit(admin, entry.id);
  await lib.review(reviewer, entry.id, { decision: "accept" });
  return entry;
}

describe("business links on the server", () => {
  it("a request goes to the linked business's own list and comes back when it closes", () =>
    withEdition("business", async () => {
      const e = env();
      const garage = (await tenants(e).createTenant({ name: "Garage", slug: "garage", kind: "business" })).id;
      const parts = (await tenants(e).createTenant({ name: "Parts Co", slug: "parts", kind: "business" })).id;
      await publish(e, parts, STORES);

      // Until a link offers it, the garage can't publish a service that uses it (DEP-4).
      const gl = library(e, garage);
      const draft = (await gl.createEntry(admin, null, { yaml: GARAGE })).entry;
      await expect(gl.submit(admin, draft.id)).rejects.toThrow(/no active link with 'parts'/);

      const l = await links(e).invite(act(garage), "parts");
      await links(e).accept(act(parts), l.id, [{ service: "stores", journey: "issue", accepts: "Order" }]);
      // Audited on both sides (DEP-5).
      for (const t of [garage, parts]) expect((await moderators(e, t).store.auditLog({ limit: 10 })).map((x) => x.action)).toEqual(expect.arrayContaining(["link.created", "link.consent_changed"]));

      await gl.submit(admin, draft.id);
      await gl.review(reviewer, draft.id, { decision: "accept" });
      const entry = draft;
      const visitor = { id: "guest:v", name: "Guest", roles: [], admin: false, guest: true };
      const { case: parent } = await as(garage, () => cases(e).start(visitor, { entry: entry.id, journey: "order", answers: { what: { part: "fan belt" } } }));
      expect(parent.links?.child).toMatchObject({ business: parts, business_name: "Parts Co" });

      const keeper = { id: "m-1", name: "Kumar", roles: ["storekeeper"], admin: false };
      const mine = (await as(parts, () => cases(e).list(keeper))).mine;
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ started_by_name: "Garage", links: { inputs: { "@type": "Order", description: "fan belt" } } });
      // The garage's list doesn't hold the supplier's request.
      expect((await as(garage, () => cases(e).list({ id: "a", name: "A", roles: [], admin: true }))).others.map((c) => c.id)).not.toContain(mine[0]!.id);

      await as(parts, () => cases(e).act(keeper, mine[0]!.id, { answers: { give: { given: true } } }));
      const back = await as(garage, () => cases(e).get(visitor, parent.ref));
      expect(back.case).toMatchObject({ status: "done", result: { title: "Ordered fan belt" } });
      expect(back.case.run.steps.parts).toMatchObject({ status: "done", result: { title: "Issued fan belt" } });
    }));
});
