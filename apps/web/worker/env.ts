// The Worker's settings, secrets and bindings. Secrets are set with `wrangler secret put` (locally
// in .dev.vars). String settings are validated with zod once per isolate.
import { z } from "zod";

export type Bindings = CloudflareEnv & {
  VECTORIZE?: Vectorize;
  AI?: Ai;
  [key: string]: unknown;
};

const schema = z.object({
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  /** Moderators sign in to the curation view with this. Unset = the moderation queue is closed. */
  MODERATOR_TOKEN: z.string().min(24, "MODERATOR_TOKEN must be at least 24 characters").optional(),
  /** The administrator signs in to /kiosk/admin with this, to issue and manage moderator keys. Unset = no administration. */
  ADMIN_TOKEN: z.string().min(24, "ADMIN_TOKEN must be at least 24 characters").optional(),
  AIRTABLE_API_TOKEN: z.string().optional(),
  AIRTABLE_BASE_ID: z.string().regex(/^app[A-Za-z0-9]+$/).optional(),
  AIRTABLE_TABLE_NAME: z.string().default("Contacts"),
  MAILCHIMP_API_KEY: z.string().regex(/-[a-z]{2}\d+$/, "expected a Mailchimp key ending in -<dc>").optional(),
  MAILCHIMP_AUDIENCE_ID: z.string().optional(),
  KIOSK_BOX_ORIGINS: z.string().optional(),
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
  CASES_RELAY: z.enum(["on", "off"]).default("on"),
  RELAY_HOURS: z.coerce.number().int().min(1).max(168).default(48),
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
