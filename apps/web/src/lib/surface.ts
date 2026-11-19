// Which surface this build is (SUR-1..6): `vite build --mode family` or `--mode business` sets
// VITE_SURFACE (the plain build is "all", the combined site). What a surface offers is the core's
// call (yaxb-core context), shared with the Worker.
import { offers as contextOffers, resolveContext, surfaceName, type Feature } from "@sekaran-ind/yaxb-core/context";

export const CONTEXT = resolveContext({ surface: import.meta.env.VITE_SURFACE ?? "all" });
export const SURFACE = CONTEXT.surface;
/** Whether this build offers a feature (the catalogue, requests, staff, the child lock…). */
export const offers = (f: Feature) => contextOffers(CONTEXT, f);
export const SURFACE_NAME = surfaceName(CONTEXT);
/** The name in the site's header and footer: the combined site is the Yaxb.ai portal (SUR-7). */
export const SITE_BRAND = SURFACE === "all" ? "Yaxb.ai" : "Anjal.ai";

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
