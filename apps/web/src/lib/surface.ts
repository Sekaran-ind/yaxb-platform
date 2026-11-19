// Which surface this build is (SUR-1..6): `vite build --mode family` or `--mode business` sets
// VITE_SURFACE (the plain build is "all", the combined site). What a surface offers is the core's
// call (yaxb-core context), shared with the Worker.
import { offers as contextOffers, resolveContext, surfaceName, type Feature } from "@sekaran-ind/yaxb-core/context";

const BUILT = (import.meta.env.VITE_SURFACE ?? "all") as "family" | "business" | "community" | "all";
const SPACE_KIND = "yaxb.space.kind";
/**
 * The open space's kind (SPC-3): on the combined site (and the native app) the sections follow the
 * space the person chose, remembered from the last start; an edition's own build is fixed.
 */
function spaceKind(): "family" | "business" | "community" | null {
  if (BUILT !== "all") return null;
  try {
    const k = localStorage.getItem(SPACE_KIND);
    return k === "family" || k === "business" || k === "community" ? k : null;
  } catch {
    return null;
  }
}
/** Remember the open space's kind for the next start (composables/identity.ts). */
export function rememberSpaceKind(kind: "family" | "business" | "community" | null) {
  if (BUILT !== "all") return;
  try {
    if (kind) localStorage.setItem(SPACE_KIND, kind);
    else localStorage.removeItem(SPACE_KIND);
  } catch {
    /* private mode: the combined site's sections */
  }
}

export const CONTEXT = resolveContext({ surface: BUILT });
export const SURFACE = CONTEXT.surface;
/** The sections' context: the open space's kind on the combined site (SPC-3), else the build's. */
const SECTIONS_CONTEXT = (() => {
  const kind = spaceKind();
  return kind ? resolveContext({ surface: kind }) : CONTEXT;
})();
/** Whether this build (or, on the combined site, the open space) offers a feature: the catalogue, requests, staff, the child lock… */
export const offers = (f: Feature) => contextOffers(SECTIONS_CONTEXT, f);
export const SURFACE_NAME = surfaceName(CONTEXT);
/** The name in the site's header and footer: the combined site is the Yaxb.ai portal (SUR-7). */
export const SITE_BRAND = SURFACE === "all" ? "Yaxb.ai" : "Anjalai";

/**
 * The platforms the Yaxb.ai portal leads to (SUR-7..9). Each address is set when the portal is built
 * (VITE_FAMILY_URL, VITE_BUSINESS_URL, VITE_COMMUNITY_URL, VITE_ENTERPRISE_URL; DOM-1: the anjalai.cc domains by default), so subdomains can change without code.
 */
export const PLATFORM_URLS = {
  family: import.meta.env.VITE_FAMILY_URL || "https://family.anjalai.cc/",
  business: import.meta.env.VITE_BUSINESS_URL || "https://business.anjalai.cc/",
  community: import.meta.env.VITE_COMMUNITY_URL || "https://community.anjalai.cc/",
  enterprise: import.meta.env.VITE_ENTERPRISE_URL || "https://clinux.yaxb.ai/",
} as const;
