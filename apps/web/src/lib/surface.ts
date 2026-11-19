// Which edition this address is (SUR-1..6, SUR-14). One build serves every address: the Worker writes
// the address's edition into the page (`<meta name="yaxb-edition">`, worker/index.ts), and the app
// also reads the host itself (`family.anjalai.cc`, `family.localhost`) for pages the Worker didn't
// write, such as Vite's in development. The native app has no address: VITE_SURFACE, else "all".
// What an edition offers is the core's call (yaxb-core context), shared with the Worker.
import { offers as contextOffers, resolveContext, surfaceName, surfaceOfHost, type Feature, type Surface } from "@sekaran-ind/yaxb-core/context";
import { NATIVE } from "@/lib/platform";

type Kind = "family" | "business" | "community";
function addressEdition(): Surface {
  const known = (s: string | null | undefined): s is Surface => s === "family" || s === "business" || s === "community" || s === "all";
  if (!NATIVE && typeof document !== "undefined") {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="yaxb-edition"]')?.content;
    if (known(meta)) return meta;
    const host = surfaceOfHost(location.hostname);
    if (host) return host;
  }
  const built = import.meta.env.VITE_SURFACE;
  return known(built) ? built : "all";
}
const BUILT = addressEdition();
const SPACE_KIND = "yaxb.space.kind";
/**
 * The open space's kind (SPC-3): the sections follow the space the person chose, remembered from the
 * last start, on every address (a Business space opened on family.anjalai.cc shows Business's).
 */
function spaceKind(): Kind | null {
  try {
    const k = localStorage.getItem(SPACE_KIND);
    return k === "family" || k === "business" || k === "community" ? k : null;
  } catch {
    return null;
  }
}
/** Remember the open space's kind for the next start (composables/identity.ts). */
export function rememberSpaceKind(kind: Kind | null) {
  try {
    if (kind) localStorage.setItem(SPACE_KIND, kind);
    else localStorage.removeItem(SPACE_KIND);
  } catch {
    /* private mode: the address's sections */
  }
}

export const CONTEXT = resolveContext({ surface: BUILT });
export const SURFACE = CONTEXT.surface;
/** The sections' context: the open space's kind (SPC-3), else the address's edition. The home page and the brand stay the address's. */
const SECTIONS_CONTEXT = (() => {
  const kind = spaceKind();
  return kind ? resolveContext({ surface: kind }) : CONTEXT;
})();
/** Whether the open space (else this address) offers a feature: the catalogue, requests, staff, the child lock… */
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
