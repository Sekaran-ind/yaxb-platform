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
