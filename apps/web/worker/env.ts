// The Worker's settings, secrets and bindings. Secrets are set with `wrangler secret put` (locally
// in .dev.vars). String settings are validated with zod once per isolate.
import { z } from "zod";
import { SURFACES } from "@sekaran-ind/yaxb-core/context";

export type Bindings = CloudflareEnv & {
  VECTORIZE?: Vectorize;
  AI?: Ai;
  [key: string]: unknown;
};

const schema = z.object({
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  /**
   * Break-glass administration (IDN-44): the administrator signs in with this to issue and manage
   * member and machine keys when no administrator can sign in with their account. Unset = none.
   */
  ADMIN_TOKEN: z.string().min(24, "ADMIN_TOKEN must be at least 24 characters").optional(),
  /** The helpdesk Worker the contact form goes to (as ClinüxFlow's does): `{ type: "email", name, clinic, email, message }` → `{ success }`. Unset = Airtable. */
  HELPDESK_URL: z.url({ protocol: /^https$/ }).optional(),
  AIRTABLE_API_TOKEN: z.string().optional(),
  AIRTABLE_BASE_ID: z.string().regex(/^app[A-Za-z0-9]+$/).optional(),
  AIRTABLE_TABLE_NAME: z.string().default("Contacts"),
  MAILCHIMP_API_KEY: z.string().regex(/-[a-z]{2}\d+$/, "expected a Mailchimp key ending in -<dc>").optional(),
  MAILCHIMP_AUDIENCE_ID: z.string().optional(),
  KIOSK_BOX_ORIGINS: z.string().optional(),
  /** Map tiles' origin when not OpenStreetMap's (VIS-1), such as https://tiles.example.com; added to the CSP. */
  TILE_ORIGIN: z.url({ protocol: /^https$/ }).optional(),
  /** A Nominatim-compatible geocoder for place search (VIS-2); OpenStreetMap's by default. */
  PLACES_URL: z.url({ protocol: /^https$/ }).optional(),
  /**
   * The edition for an address that names none (SUR-14): one Worker serves every address, and each
   * request's edition is the open space's, else the address's (family.anjalai.cc), else this; unset:
   * the combined site ("all"). Useful for a workers.dev preview.
   */
  SURFACE: z.enum(SURFACES).optional(),
  /**
   * Origins of the native app's pages (PLT-14), comma-separated. The app sends its session id in
   * X-Yaxb-Session instead of a cookie. Default: Capacitor's iOS and Android origins.
   */
  KIOSK_APP_ORIGINS: z.string().default("capacitor://localhost,https://localhost"),
  /**
   * Cases (LIB-42..48). Central storage of service data in the cloud is the paid plan: "on" only for
   * a subscribed deployment. Without it, cases live on devices and the box, and the cloud is only a
   * transient relay (CASES_RELAY, "on" by default), whose envelopes expire after RELAY_HOURS.
   */
  CASES_CENTRAL: z.enum(["on", "off"]).default("off"),
  /**
   * Approved sites (SIT-1..6): "on" refuses a site that isn't on the approved list; "off" (until the
   * list is ready) still adds it, flags it and asks for it to be reviewed.
   */
  SITES_ENFORCE: z.enum(["on", "off"]).default("off"),
  CASES_RELAY: z.enum(["on", "off"]).default("on"),
  RELAY_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  /**
   * Accounts and spaces (15-identity.md): keys the hashes and seals the session-signing keys in the
   * platform database. The same value on every edition's Worker. Unset = no accounts on this site.
   */
  IDENTITY_SECRET: z.string().min(32, "IDENTITY_SECRET must be at least 32 characters").optional(),
  /** Who signs sessions (the tokens' `iss`), the same on every edition. */
  IDENTITY_ISSUER: z.string().default("https://anjalai.cc"),
  /** Sign in with Google (IDN-14): an OAuth client of a Google Cloud project. Unset = not offered. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /**
   * The free tier (Phase 0): a visitor who isn't a signed-in member gets this many questions to the
   * hosted AI model per IP address in the window, always on the small model below. 0 = no limit (and
   * no forced model). Kiosk only answers on the device never count.
   */
  FREE_TIER_QUESTIONS: z.coerce.number().int().min(0).max(1000).default(3),
  FREE_TIER_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(40),
  /** Hosted-model questions the free tier may use in a day, for the whole deployment (a spend cap). 0 = none. */
  FREE_TIER_DAILY: z.coerce.number().int().min(0).max(1_000_000).default(2000),
  /** The free tier's model ("provider/model" from the allowlist); default: the first configured model the catalogue marks `free`. */
  FREE_TIER_MODEL: z.string().optional(),
  /**
   * Seals connectors' secrets (their API keys), apart from the session secret so rotating one doesn't
   * lose the other. Unset: SESSION_SECRET is used. Setting it later keeps older secrets readable.
   */
  SEALING_SECRET: z.string().min(32, "SEALING_SECRET must be at least 32 characters").optional(),
  /** Wrong case references one address may try in 15 minutes before it is refused. */
  CASE_REF_MISSES: z.coerce.number().int().min(1).max(100).default(8),
});

/** The native app's origins (PLT-14). */
export const appOrigins = (env: Bindings) =>
  settings(env)
    .KIOSK_APP_ORIGINS.split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
export type Settings = z.infer<typeof schema>;

const cache = new WeakMap<object, Settings>();

/** The Worker env's string values (secrets and vars); blanks count as unset. */
export function stringEnv(env: Bindings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string" && v !== "") out[k] = v;
  return out;
}

export function settings(env: Bindings): Settings {
  let s = cache.get(env);
  if (!s) {
    s = schema.parse(stringEnv(env));
    cache.set(env, s);
  }
  return s;
}
