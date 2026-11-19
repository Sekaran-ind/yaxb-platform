// Context (SUR-1..6): which surface, what it offers, which API routes it serves.
import { describe, expect, it } from "vitest";
import { offers, resolveContext, servesApi, surfaceName } from "../src/context/index.js";

describe("context", () => {
  it("resolves a surface and what it offers", () => {
    const family = resolveContext({ surface: "family" });
    expect(family.features).toEqual(["child-lock", "profiles", "household"]);
    expect(offers(family, "catalogue")).toBe(false);
    const business = resolveContext({ surface: "Business", tenant: "velan", jurisdiction: "in-tn" });
    expect(business).toMatchObject({ surface: "business", tenant: "velan", jurisdiction: "IN-TN" });
    expect(offers(business, "child-lock")).toBe(false);
    expect(offers(business, "catalogue")).toBe(true);
    expect(resolveContext().surface).toBe("all");
    expect(surfaceName(family)).toBe("Anjal Family");
    expect(surfaceName(resolveContext({}))).toBe("Yaxb.ai");
  });

  it("refuses an unknown surface or a malformed jurisdiction", () => {
    expect(() => resolveContext({ surface: "clinic" })).toThrow(/Unknown surface/);
    expect(() => resolveContext({ jurisdiction: "India" })).toThrow(/Malformed jurisdiction/);
  });

  it("serves business-only routes only where they belong", () => {
    const family = resolveContext({ surface: "family" });
    const business = resolveContext({ surface: "business" });
    for (const path of ["/api/library/published", "/api/cases", "/api/join/x", "/api/directory", "/api/team/presence"]) {
      expect(servesApi(family, path)).toBe(false);
      expect(servesApi(business, path)).toBe(true);
    }
    expect(servesApi(family, "/api/agent/chat")).toBe(true);
    expect(servesApi(family, "/api/librarything")).toBe(true); // a prefix only matches whole segments
  });
});
