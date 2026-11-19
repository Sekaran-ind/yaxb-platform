// Context (SUR-1..6): which surface, what it offers, which API routes it serves.
import { describe, expect, it } from "vitest";
import { chooseSurface, offers, resolveContext, servesApi, SURFACE_HEADS, surfaceName, surfaceOfHost } from "../src/context/index.js";

describe("context", () => {
  it("resolves a surface and what it offers", () => {
    const family = resolveContext({ surface: "family" });
    expect(family.features).toEqual(["child-lock", "profiles", "household"]);
    // Community (EDN-2): Business's features, with profiles and the child lock; no household.
    const community = resolveContext({ surface: "community" });
    expect(community.features).toEqual(["catalogue", "requests", "staff", "front-desk", "join", "directory", "child-lock", "profiles"]);
    expect(surfaceName(community)).toBe("Anjalai Community");
    expect(offers(family, "catalogue")).toBe(false);
    const business = resolveContext({ surface: "Business", tenant: "velan", jurisdiction: "in-tn" });
    expect(business).toMatchObject({ surface: "business", tenant: "velan", jurisdiction: "IN-TN" });
    expect(offers(business, "child-lock")).toBe(false);
    expect(offers(business, "catalogue")).toBe(true);
    expect(resolveContext().surface).toBe("all");
    expect(surfaceName(family)).toBe("Anjalai Family");
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

  it("chooses each request's edition: the open space, else the address, else the combined site (SUR-14)", () => {
    expect(surfaceOfHost("family.anjalai.cc")).toBe("family");
    expect(surfaceOfHost("Business.anjalai.cc")).toBe("business");
    expect(surfaceOfHost("community.localhost:5173")).toBe("community");
    for (const h of ["anjalai.cc", "yaxb.ai", "localhost", "127.0.0.1", "yaxb-web.example.workers.dev", "familyx.anjalai.cc", "www.anjalai.cc"]) expect(surfaceOfHost(h)).toBeNull();
    expect(chooseSurface({ space: "business", host: "family.anjalai.cc" })).toBe("business");
    expect(chooseSurface({ space: null, host: "family.anjalai.cc" })).toBe("family");
    expect(chooseSurface({ host: "anjalai.cc" })).toBe("all");
    expect(chooseSurface({ host: "localhost", fallback: "community" })).toBe("community");
    expect(chooseSurface({ space: "clinic", host: "yaxb.ai", fallback: "nonsense" })).toBe("all");
    expect(SURFACE_HEADS.family.title).toBe("Anjalai Family");
  });
});
