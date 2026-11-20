// Approved sites (SIT-1..6): the two tiers, requests merged without naming people, approvals by
// someone else, a business switching a platform site off, families on the platform list only.
import { describe, expect, it } from "vitest";
import { createD1SiteStore, createMemorySiteStore, createSiteService, originOf, type SiteStore } from "../src/sites/index.js";
import { sqliteD1 } from "./sqlite-d1.js";

const shop = { edition: "business", tenant: "t1", family: false, region: "IN-TN" };
const family = { edition: "family", tenant: "f1", family: true, region: "IN-TN" };
const mod = { id: "m-1", name: "Platform moderator" };

for (const [name, make] of [
  ["memory", (): SiteStore => createMemorySiteStore()],
  ["D1", (): SiteStore => createD1SiteStore(sqliteD1({ folder: "migrations-platform" }))],
] as const)
  describe(`approved sites on ${name}`, () => {
    it("asks, merges, approves by someone else, and allows by region and use", async () => {
      const svc = createSiteService(make());
      expect(originOf("https://TNEB.example.gov.in/bill?no=1")).toBe("https://tneb.example.gov.in");
      expect(originOf("http://x.example.com")).toBeNull();
      expect((await svc.verdict("https://tneb.example.gov.in/bill", "source", shop)).allowed).toBe(false);
      const a = await svc.request({ url: "https://tneb.example.gov.in/bill", use: "source", reason: "Electricity bills", askedByLabel: "Ravi Hardware", askedBy: "acct-1", edition: "business", tenant: "t1" });
      const b = await svc.request({ url: "https://tneb.example.gov.in/other", use: "source", askedByLabel: "a family", askedBy: "acct-2", edition: "family", tenant: "f1" });
      expect(b.merged).toBe(true);
      const open = await svc.openRequests();
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ count: 2, asked_by_label: "Ravi Hardware" });
      expect(open[0]).not.toHaveProperty("asked_by");
      await expect(svc.approve(a.request.id, { id: "acct-1", name: "Ravi" }, {})).rejects.toThrow(/Someone else/);
      const s = await svc.approve(a.request.id, mod, { region: "IN-TN", category: "utility", uses: ["source", "lookup"] });
      expect(s).toMatchObject({ origin: "https://tneb.example.gov.in", region: "IN-TN", uses: ["source", "lookup"], tenant_id: null });
      expect(await svc.openRequests()).toEqual([]);
      expect((await svc.verdict("https://tneb.example.gov.in/bill", "source", shop)).allowed).toBe(true);
      expect((await svc.verdict("https://tneb.example.gov.in/bill", "source", family)).allowed).toBe(true);
      expect((await svc.verdict("https://tneb.example.gov.in/bill", "source", { ...shop, region: "IN-KA" })).allowed).toBe(false);
      expect((await svc.verdict("https://tneb.example.gov.in/bill", "link", shop)).allowed).toBe(false);
      // A business switches the platform's entry off for itself: never looser.
      await svc.switchOff("https://tneb.example.gov.in", { edition: "business", tenant: "t1" }, { name: "Admin" });
      expect((await svc.verdict("https://tneb.example.gov.in/bill", "source", shop)).allowed).toBe(false);
      expect((await svc.verdict("https://tneb.example.gov.in/bill", "source", { ...shop, tenant: "t2" })).allowed).toBe(true);
      // Paused by the platform: nobody uses it.
      await svc.setStatus(s.id, "paused", mod, { tenant: null, edition: null });
      expect((await svc.verdict("https://tneb.example.gov.in/bill", "source", { ...shop, tenant: "t2" })).allowed).toBe(false);
    });

    it("keeps a business's own list for its own uses; families and lookups only through the platform", async () => {
      const svc = createSiteService(make());
      await expect(svc.addOwn({ url: "https://supplier.example.com", uses: ["lookup"], edition: "business", tenant: "t1" }, { name: "Admin" })).rejects.toThrow(/platform's approval/);
      await svc.addOwn({ url: "https://supplier.example.com", uses: ["source", "link"], paths: ["/catalogue"], edition: "business", tenant: "t1" }, { name: "Admin" });
      expect((await svc.verdict("https://supplier.example.com/catalogue/x", "source", shop)).allowed).toBe(true);
      expect((await svc.verdict("https://supplier.example.com/private", "source", shop)).allowed).toBe(false);
      expect((await svc.verdict("https://supplier.example.com/catalogue", "source", { ...shop, tenant: "t2" })).allowed).toBe(false);
      expect((await svc.verdict("https://supplier.example.com/catalogue", "source", { ...family, tenant: "t1" })).allowed).toBe(false);
      const l = await svc.list({ tenant: "t1", edition: "business" });
      expect(l.own.map((s) => s.origin)).toEqual(["https://supplier.example.com"]);
      expect(l.platform).toEqual([]);
    });
  });
