// Context (SUR-1..6), after clinux-core's resolveContext: which surface the app is, for which
// business (tenant) and jurisdiction, and so what it offers. Resolved once, then every surface
// (the web app, the Worker) asks it instead of keeping its own lists.
//
//   surface   family    Ask Me, notebooks, the Scheduler, Quick tools, profiles, the child lock
//             business  the kiosk and its front desk, the Service Catalogue and AI designer,
//                       requests, staff, join links and the directory
//             all       the combined site (both)
//   tenant    the business a request acts for (TEN-2); default: "default"
//   jurisdiction  an ISO country (and subdivision), e.g. IN or IN-TN; it will choose a realm pack
//             (consent wording, what may be kept) the way ClinüxFlow's realm does: not yet.
//
// As in ClinüxFlow, "surface" is which app it is; "realm" is kept for the regulatory context.
export const SURFACES = ["family", "business", "community", "all"] as const;
export type Surface = (typeof SURFACES)[number];

/** household: requests between the profiles at home (EDN-20..24), kept on the household's devices. */
export const FEATURES = ["catalogue", "requests", "staff", "front-desk", "join", "directory", "child-lock", "profiles", "household"] as const;
export type Feature = (typeof FEATURES)[number];

/** What each surface leaves out. */
const LEAVES_OUT: Record<Surface, readonly Feature[]> = {
  family: ["catalogue", "requests", "staff", "front-desk", "join", "directory"],
  business: ["child-lock", "profiles", "household"],
  // An association, club or committee (EDN-2): what Business offers, with profiles and the child lock.
  community: ["household"],
  all: [],
};

/** API routes that belong to a feature: a surface without the feature answers 404 on them. */
const API_FEATURES: [prefix: string, feature: Feature][] = [
  ["/api/library", "catalogue"],
  ["/api/cases", "requests"],
  ["/api/relay", "requests"],
  ["/api/events", "staff"],
  ["/api/team", "staff"],
  ["/api/reviews", "staff"],
  ["/api/tenants", "directory"],
  ["/api/directory", "directory"],
  ["/api/tenant", "join"],
  ["/api/join", "join"],
  ["/api/join-requests", "join"],
];

export type Context = Readonly<{ surface: Surface; tenant: string; jurisdiction: string; features: readonly Feature[] }>;
export const DEFAULT_CONTEXT: Context = Object.freeze({ surface: "all", tenant: "default", jurisdiction: "IN", features: FEATURES });

/** A complete context from a partial one. Throws on an unknown surface or a malformed jurisdiction. */
export function resolveContext(input: { surface?: string | null; tenant?: string | null; jurisdiction?: string | null } = {}): Context {
  const surface = String(input.surface || DEFAULT_CONTEXT.surface).toLowerCase();
  if (!(SURFACES as readonly string[]).includes(surface)) throw new Error(`Unknown surface '${input.surface}'. Known: ${SURFACES.join(", ")}.`);
  const jurisdiction = String(input.jurisdiction || DEFAULT_CONTEXT.jurisdiction).toUpperCase();
  if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(jurisdiction)) throw new Error(`Malformed jurisdiction '${input.jurisdiction}' (an ISO code like IN or IN-TN).`);
  const out = LEAVES_OUT[surface as Surface];
  return Object.freeze({ surface: surface as Surface, tenant: String(input.tenant || DEFAULT_CONTEXT.tenant), jurisdiction, features: Object.freeze(FEATURES.filter((f) => !out.includes(f))) });
}

/** Whether the context offers a feature. */
export const offers = (ctx: Context, feature: Feature): boolean => ctx.features.includes(feature);

/** Whether the context serves an API path (business-only routes are absent from the family surface). */
export function servesApi(ctx: Context, path: string): boolean {
  const hit = API_FEATURES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return !hit || offers(ctx, hit[1]);
}

/** The surface's name for people. */
export const surfaceName = (ctx: Context) => (ctx.surface === "family" ? "Anjalai Family" : ctx.surface === "business" ? "Anjalai for Business" : ctx.surface === "community" ? "Anjalai Community" : "Yaxb.ai");

// ---- one address for every edition (SUR-14) ---------------------------------------------------
//
// One Worker and one build serve every address. Each request's edition is the open space's (its
// membership checked by the Worker), else the address's (`family.anjalai.cc` is Family, and so on),
// else the combined site's. The edition chooses the sections and, on the Worker, the database.

/** The editions an address or a space can name; "all" is the combined site (the portal). */
export const EDITION_SURFACES = ["family", "business", "community"] as const;

/**
 * The edition an address names, or null: the first label of the host (`family.anjalai.cc`,
 * `business.localhost`). Any other host (anjalai.cc, yaxb.ai, workers.dev, localhost) names none.
 */
export function surfaceOfHost(host: string): Surface | null {
  const first = host.toLowerCase().replace(/:\d+$/, "").split(".");
  if (first.length < 2) return null;
  return (EDITION_SURFACES as readonly string[]).includes(first[0]!) ? (first[0] as Surface) : null;
}

/** A request's edition: the open space's, else the address's, else the fallback (a Worker setting), else "all". */
export function chooseSurface(input: { space?: string | null; host?: string | null; fallback?: string | null }): Surface {
  const known = (s: string | null | undefined): s is Surface => Boolean(s) && (SURFACES as readonly string[]).includes(s!);
  if (known(input.space)) return input.space;
  const fromHost = input.host ? surfaceOfHost(input.host) : null;
  if (fromHost) return fromHost;
  return known(input.fallback) ? input.fallback : "all";
}

/** Each address's page title and description (the Worker writes them into the one index.html). */
export const SURFACE_HEADS: Record<Surface | "native", { title: string; description: string }> = {
  all: { title: "Yaxb.ai", description: "Yaxb.ai: AI kiosks that answer with facts and sources, in your own language, for families and communities (Anjalai Family), small businesses (Anjalai for Business) and enterprises in regulated care (ClinüxFlow)." },
  family: { title: "Anjalai Family", description: "Anjalai Family: one shared notebook the whole family can ask in its own language, key dates that come up by themselves, and a protected space." },
  business: { title: "Anjalai for Business", description: "Anjalai for Business: connect with your customers, design your services with the AI designer, and get found on Anjalai." },
  community: { title: "Anjalai Community", description: "Anjalai Community: for apartment associations, clubs and committees. Residents raise complaints and book the hall, the committee answers, and notices reach everyone in their own language." },
  native: { title: "Anjalai", description: "Anjalai, the kiosk." },
};
