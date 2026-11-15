// Tenants and join tokens (TEN-1..8): the join flow, and each business's members and catalogue
// kept apart on D1.
import { describe, expect, it } from "vitest";
import { createLibraryService, type LibraryActor } from "../src/library/index.js";
import { createModeratorService } from "../src/moderators/index.js";
import { createD1LibraryStore, createD1ModeratorStore } from "../src/stores/d1.js";
import { createD1TenantStore, createMemoryTenantStore, createTenantService, TenantError, type MemberIssuer } from "../src/tenants/index.js";
import { sqliteD1 } from "./sqlite-d1.js";

const SERVICE = (id: string) => `kind: service
id: ${id}
title: ${id}
journeys:
  - id: ${id}-j
    title: J
    screens:
      - id: a
        questions: [{ id: x, type: text, label: X }]
`;

describe("join tokens", () => {
  const setup = () => {
    const issued: { tenant: string; name: string; roles: string[] }[] = [];
    const issueMember: MemberIssuer = async (tenant, input) => (issued.push({ tenant, ...input }), { moderator: { id: `m-${issued.length}` }, key: `yaxb_mod_key${issued.length}` });
    let t = Date.parse("2026-11-15T10:00:00Z");
    const svc = createTenantService(createMemoryTenantStore(), { issueMember, now: () => new Date(t) });
    return { svc, issued, later: (h: number) => (t += h * 3_600_000) };
  };

  it("runs the whole flow: link, preview, request, accept, collect once", async () => {
    const { svc, issued } = setup();
    const shop = await svc.createTenant({ name: "Velan Two Wheelers", slug: "velan" });
    const { token, joinToken } = await svc.issueToken(shop.id, { role: "sales", label: "Showroom staff" }, { name: "Asha" });
    expect(token).toMatch(/^yaxb_join_/);
    expect(JSON.stringify(await svc.tokens(shop.id))).not.toContain(token); // only the hash is kept
    expect(await svc.preview(token)).toMatchObject({ tenant: { name: "Velan Two Wheelers", slug: "velan" }, role: "sales", label: "Showroom staff" });
    const { request, claim } = await svc.redeem(token, { name: "Ravi" });
    expect(request.status).toBe("pending");
    // Used up: one use by default.
    await expect(svc.preview(token)).rejects.toThrow(/has been used/);
    await expect(svc.collect(request.id, claim)).rejects.toThrow(/still waiting/);
    const accepted = await svc.decide(shop.id, request.id, "accept", { role: "service-desk" }, { name: "Asha" });
    expect(accepted).toMatchObject({ status: "accepted", role: "service-desk", decided_by: "Asha" });
    expect(await svc.status(request.id, claim)).toMatchObject({ status: "accepted", tenant: { slug: "velan" } });
    await expect(svc.collect(request.id, "yaxb_claim_wrong")).rejects.toThrow(/No such request/);
    const got = await svc.collect(request.id, claim);
    expect(got.key).toBe("yaxb_mod_key1");
    expect(issued).toEqual([{ tenant: shop.id, name: "Ravi", roles: ["service-desk"] }]);
    await expect(svc.collect(request.id, claim)).rejects.toThrow(/already collected/);
    expect(joinToken.uses_left).toBe(1);
  });

  it("accepts a new business's first administrator without a decision, and nobody else", async () => {
    const { svc, issued } = setup();
    const shop = await svc.createTenant({ name: "Shop", slug: "shop" });
    const first = await svc.issueToken(shop.id, { role: "administrator", autoAccept: true }, { name: "Deployment admin" });
    const { request, claim } = await svc.redeem(first.token, { name: "Asha" });
    expect(request).toMatchObject({ status: "accepted", decided_by: "join link" });
    expect((await svc.collect(request.id, claim)).key).toBeTruthy();
    expect(issued[0]).toMatchObject({ tenant: shop.id, roles: ["administrator"] });
    const plain = await svc.issueToken(shop.id, { role: "sales" }, { name: "Asha" });
    expect((await svc.redeem(plain.token, { name: "Ravi" })).request.status).toBe("pending");
  });

  it("refuses expired, withdrawn and foreign requests, and a taken short name", async () => {
    const { svc, later } = setup();
    const a = await svc.createTenant({ name: "A", slug: "a-shop" });
    const b = await svc.createTenant({ name: "B", slug: "b-shop" });
    await expect(svc.createTenant({ name: "A again", slug: "a-shop" })).rejects.toThrow(/taken/);
    await expect(svc.createTenant({ name: "Bad", slug: "Bad Slug" })).rejects.toBeInstanceOf(TenantError);
    const one = await svc.issueToken(a.id, { role: "staff", hours: 2 }, { name: null });
    later(3);
    await expect(svc.preview(one.token)).rejects.toThrow(/expired/);
    const two = await svc.issueToken(a.id, { role: "staff", uses: 3 }, { name: null });
    await svc.revokeToken(a.id, two.joinToken.id);
    await expect(svc.redeem(two.token, { name: "X" })).rejects.toThrow(/withdrawn/);
    const three = await svc.issueToken(a.id, { role: "staff", uses: 3 }, { name: null });
    const { request } = await svc.redeem(three.token, { name: "Y" });
    // B's administrator can't decide A's request.
    await expect(svc.decide(b.id, request.id, "accept", {}, { name: "B admin" })).rejects.toThrow(/No such request/);
    await svc.decide(a.id, request.id, "decline", {}, { name: "A admin" });
    await expect(svc.decide(a.id, request.id, "accept", {}, { name: "A admin" })).rejects.toThrow(/already decided/);
    expect((await svc.directory()).map((t) => t.slug)).toEqual(["a-shop", "b-shop", "default"]);
  });
});

describe("tenants on D1 (TEN-2..3)", () => {
  it("keeps each business's members and catalogue apart, and joins a member to the right one", async () => {
    const db = sqliteD1();
    const tenants = createD1TenantStore(db);
    const svc = createTenantService(tenants, { issueMember: (tenant, input, actor) => createModeratorService(createD1ModeratorStore(db, { tenant })).issue(input, actor) });
    const shop = await svc.createTenant({ name: "Velan", slug: "velan" });
    // Members: one in each tenant; each tenant lists only its own; a key finds its member anywhere.
    const home = createModeratorService(createD1ModeratorStore(db));
    const { key: homeKey } = await home.issue({ name: "Sekaran", roles: ["administrator"] });
    const { token } = await svc.issueToken(shop.id, { role: "sales" }, { name: "Sekaran" });
    const { request, claim } = await svc.redeem(token, { name: "Ravi" });
    await svc.decide(shop.id, request.id, "accept", {}, { name: "Sekaran" });
    const { key, memberId } = await svc.collect(request.id, claim);
    expect((await createD1ModeratorStore(db).list()).map((m) => m.name)).toEqual(["Sekaran"]);
    expect((await createD1ModeratorStore(db, { tenant: shop.id }).list()).map((m) => [m.name, m.roles, m.tenant])).toEqual([["Ravi", ["sales"], shop.id]]);
    expect(await createD1ModeratorStore(db).get(memberId)).toBeNull(); // not visible from the default tenant
    const signedIn = await createModeratorService(createD1ModeratorStore(db)).signIn(key);
    expect(signedIn?.tenant).toBe(shop.id);
    expect(homeKey).not.toBe(key);

    // Catalogue: the same service id may exist in both; each sees only its own.
    const actor = (id: string): LibraryActor => ({ id, name: id, roles: ["administrator"], admin: false });
    const libHome = createLibraryService(createD1LibraryStore(db));
    const libShop = createLibraryService(createD1LibraryStore(db, { tenant: shop.id }));
    await libHome.createEntry(actor("a"), null, { yaml: SERVICE("test-ride") });
    await libShop.createEntry(actor("b"), null, { yaml: SERVICE("test-ride") });
    await libShop.createEntry(actor("b"), null, { yaml: SERVICE("booking") });
    const ids = async (s: typeof libHome, a: LibraryActor) => (await s.entries(a)).map((e) => e.doc_id).sort();
    expect(await ids(libHome, actor("a"))).toEqual(["test-ride"]);
    expect(await ids(libShop, actor("b"))).toEqual(["booking", "test-ride"]);
    // Roles too: both may name "sales".
    const store = createD1LibraryStore(db, { tenant: shop.id });
    await store.putRole({ id: "sales", label: "Sales", created_at: "2026-11-15" });
    await createD1LibraryStore(db).putRole({ id: "sales", label: "Front desk sales", created_at: "2026-11-15" });
    expect((await store.roles()).map((r) => r.label)).toEqual(["Sales"]);
    expect((await createD1LibraryStore(db).roles()).map((r) => r.label)).toEqual(["Front desk sales"]);
  });
});
