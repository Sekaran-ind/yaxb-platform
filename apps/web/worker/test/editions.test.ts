// One Worker for every edition (SUR-14): each edition's data is read only through its own database,
// and no per-isolate cache serves one edition's service to another.
import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../packages/yaxb-core/test/sqlite-d1";
import { dbFor, editionFor, firstEdition, withEdition } from "../edition";
import { kiosk, library, moderators, tenants } from "../kiosk";

const fourDatabases = () => ({
  SESSION_SECRET: "x".repeat(40),
  DB: sqliteD1(),
  DB_FAMILY: sqliteD1(),
  DB_BUSINESS: sqliteD1(),
  DB_COMMUNITY: sqliteD1(),
});

describe("one Worker, one database per edition", () => {
  it("chooses the edition from the open space, else the address", () => {
    expect(editionFor({ space: "business", host: "family.anjalai.cc" })).toBe("business");
    expect(editionFor({ host: "community.anjalai.cc" })).toBe("community");
    expect(editionFor({ host: "anjalai.cc" })).toBe("all");
  });

  it("never falls back to another edition's database", () => {
    expect(() => dbFor({ DB: sqliteD1() }, "family")).toThrow(/family database isn't bound/);
    expect(() => library({} as never)).toThrow(/No edition chosen/);
  });

  it("a Business tenant opened against Family gets nothing", async () => {
    const env = fourDatabases();
    const t = await withEdition("business", () => tenants(env as never).createTenant({ name: "Sri Ram Hardware", slug: "sri-ram", kind: "business" }));
    expect(await withEdition("business", () => tenants(env as never).tenant("sri-ram"))).toMatchObject({ id: t.id });
    expect(await withEdition("family", () => tenants(env as never).tenant("sri-ram"))).toBeNull();
    expect(await withEdition("all", () => tenants(env as never).tenant(t.id))).toBeNull();

    // A member issued in Business's default tenant isn't in Family's default tenant.
    const { moderator } = await withEdition("business", () => moderators(env as never).issue({ name: "Meena", label: "test", roles: ["moderator"] }, { name: "Admin" }));
    expect((await withEdition("business", () => moderators(env as never).store.list())).map((m) => m.id)).toContain(moderator.id);
    expect(await withEdition("family", () => moderators(env as never).store.list())).toEqual([]);
  });

  it("keys every cache by edition as well as tenant", () => {
    const env = fourDatabases();
    const [fam, biz] = [withEdition("family", () => moderators(env as never)), withEdition("business", () => moderators(env as never))];
    expect(fam).not.toBe(biz);
    expect(withEdition("family", () => moderators(env as never))).toBe(fam);
    expect(withEdition("family", () => kiosk(env as never))).not.toBe(withEdition("community", () => kiosk(env as never)));
  });

  it("looks a join link up edition by edition", async () => {
    const seen: string[] = [];
    const missing = (e: unknown) => e instanceof Error && e.message === "missing";
    const found = await firstEdition(["family", "business", "community"], async () => {
      const { currentEdition } = await import("../edition");
      seen.push(currentEdition());
      if (currentEdition() !== "business") throw new Error("missing");
      return "here";
    }, missing);
    expect(found).toEqual({ edition: "business", value: "here" });
    expect(seen).toEqual(["family", "business"]);
    await expect(firstEdition(["family"], async () => { throw new Error("refused"); }, missing)).rejects.toThrow("refused");
  });
});
