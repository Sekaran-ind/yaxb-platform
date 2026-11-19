// Approved sites (SIT-1..6): every outside site Anjal reads, analyses or looks things up on comes from
// an approved list. Two tiers: the platform catalogue (kept by the platform's moderators, per country
// and state, used by every edition) and each business's own list. A business can switch a platform
// entry off but never loosen it; a family uses only the platform catalogue. "Ask to add this site"
// opens a request, merged with others for the same site and use, naming a business or "a family",
// never a person; whoever asked can't approve it.
export const SITE_USES = ["source", "link", "analyse", "lookup"] as const;
export type SiteUse = (typeof SITE_USES)[number];
export const SITE_USE_LABELS: Record<SiteUse, string> = { source: "a notebook source", link: "a link to open", analyse: "analysed when designing", lookup: "looked up while a journey runs" };
export type SiteStatus = "active" | "paused" | "revoked" | "off";
export type ApprovedSite = {
  id: string;
  /** https://host (no path). */
  origin: string;
  /** Path prefixes ("/" is the whole site). */
  paths: string[];
  /** ISO country and state ("IN", "IN-TN"), or "*" for everywhere. */
  region: string;
  category: string;
  uses: SiteUse[];
  /** null: the platform catalogue. */
  edition: string | null;
  tenant_id: string | null;
  status: SiteStatus;
  approved_by: string;
  review_at: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};
export type SiteRequest = {
  id: string;
  origin: string;
  use: SiteUse;
  reason: string | null;
  /** A business's name or "a family": never a person. */
  asked_by_label: string;
  /** Who asked (an account or member id), so they can't approve it themselves. Never shown. */
  asked_by: string;
  edition: string | null;
  tenant_id: string | null;
  count: number;
  status: "open" | "approved" | "rejected";
  decided_by: string | null;
  created_at: string;
  updated_at: string;
};
export type SiteAuditAction = "site.requested" | "site.approved" | "site.rejected" | "site.revoked" | "site.paused" | "site.resumed" | "site.switched_off" | "site.added";

export interface SiteStore {
  sites(): Promise<ApprovedSite[]>;
  site(id: string): Promise<ApprovedSite | null>;
  putSite(s: ApprovedSite): Promise<void>;
  requests(status?: SiteRequest["status"]): Promise<SiteRequest[]>;
  request(id: string): Promise<SiteRequest | null>;
  putRequest(r: SiteRequest): Promise<void>;
  audit(e: { id: string; at: string; actor: string | null; action: SiteAuditAction; origin: string; details: Record<string, unknown> | null }): Promise<void>;
}

export class SiteError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** A site's origin (https://host), or null when it isn't a plain https web address. */
export function originOf(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return `https://${u.hostname.toLowerCase().replace(/\.$/, "")}${u.port && u.port !== "443" ? `:${u.port}` : ""}`;
  } catch {
    return null;
  }
}
const regionHolds = (site: string, here: string) => site === "*" || here === site || here.startsWith(`${site}-`);
const pathHolds = (paths: string[], path: string) => paths.some((p) => p === "/" || path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));

/**
 * Whether a site may be used here for a use: on the platform catalogue (active, for this region and
 * use) and not switched off by this business, or on the business's own list. A family uses only the
 * platform catalogue; a third-party lookup comes only from the platform catalogue (SIT-3).
 */
export function siteVerdict(url: string, use: SiteUse, sites: readonly ApprovedSite[], here: { edition: string; tenant: string | null; family: boolean; region: string }, now = new Date()): { allowed: boolean; site: ApprovedSite | null; why: string; switchedOff?: boolean } {
  const origin = originOf(url);
  if (!origin) return { allowed: false, site: null, why: "Only https sites can be approved." };
  const path = new URL(url).pathname;
  const fits = (s: ApprovedSite) => s.origin === origin && s.uses.includes(use) && pathHolds(s.paths, path) && regionHolds(s.region, here.region) && s.review_at >= now.toISOString().slice(0, 10);
  const mine = (s: ApprovedSite) => s.tenant_id !== null && s.tenant_id === here.tenant && s.edition === here.edition;
  const switchedOff = sites.some((s) => mine(s) && s.status === "off" && s.origin === origin);
  const platform = sites.find((s) => s.tenant_id === null && s.status === "active" && fits(s));
  if (platform && !switchedOff) return { allowed: true, site: platform, why: "On the platform's approved list." };
  if (switchedOff) return { allowed: false, site: null, why: "This business has switched that site off.", switchedOff: true };
  if (!here.family && use !== "lookup") {
    const own = sites.find((s) => mine(s) && s.status === "active" && fits(s));
    if (own) return { allowed: true, site: own, why: "On this business's own list." };
  }
  return { allowed: false, site: null, why: "That site isn't on the approved list yet." };
}

/** A review is due a year after approval by default. */
const reviewIn = (now: Date, days = 365) => new Date(now.getTime() + days * 86400_000).toISOString().slice(0, 10);

export function createSiteService(store: SiteStore, { now = () => new Date() }: { now?: () => Date } = {}) {
  const iso = () => now().toISOString();
  const audit = (actor: string | null, action: SiteAuditAction, origin: string, details: Record<string, unknown> | null = null) => store.audit({ id: crypto.randomUUID(), at: iso(), actor, action, origin, details });
  const cleanUses = (uses: unknown): SiteUse[] => {
    const u = [...new Set((Array.isArray(uses) ? uses : []).filter((x): x is SiteUse => SITE_USES.includes(x as SiteUse)))];
    if (!u.length) throw new SiteError("Choose what the site may be used for.");
    return u;
  };
  const cleanPaths = (paths: unknown) => {
    const p = (Array.isArray(paths) ? paths : ["/"]).map(String).map((x) => (x.startsWith("/") ? x : `/${x}`)).slice(0, 20);
    return p.length ? p : ["/"];
  };
  const cleanRegion = (r: unknown) => {
    const v = String(r ?? "*").toUpperCase();
    if (v !== "*" && !/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(v)) throw new SiteError("A region is * or an ISO code, like IN or IN-TN.");
    return v;
  };
  return {
    verdict: async (url: string, use: SiteUse, here: Parameters<typeof siteVerdict>[3]) => siteVerdict(url, use, await store.sites(), here, now()),

    /** "Ask to add this site": merged with an open request for the same site and use (a count). */
    async request(input: { url: string; use: SiteUse; reason?: string; askedByLabel: string; askedBy: string; edition: string | null; tenant: string | null }) {
      const origin = originOf(input.url);
      if (!origin) throw new SiteError("Only https sites can be asked for.");
      if (!SITE_USES.includes(input.use)) throw new SiteError("Choose what the site is for.");
      const open = (await store.requests("open")).find((r) => r.origin === origin && r.use === input.use);
      if (open) {
        const merged = { ...open, count: open.count + 1, updated_at: iso() };
        await store.putRequest(merged);
        return { request: merged, merged: true };
      }
      const r: SiteRequest = {
        id: crypto.randomUUID(),
        origin,
        use: input.use,
        reason: input.reason?.trim().slice(0, 300) || null,
        asked_by_label: input.askedByLabel.slice(0, 80) || "a family",
        asked_by: input.askedBy,
        edition: input.edition,
        tenant_id: input.tenant,
        count: 1,
        status: "open",
        decided_by: null,
        created_at: iso(),
        updated_at: iso(),
      };
      await store.putRequest(r);
      await audit(null, "site.requested", origin, { use: input.use, by: r.asked_by_label });
      return { request: r, merged: false };
    },
    /** Open requests, without who asked (only the business or "a family"). */
    async openRequests() {
      return (await store.requests("open")).map(({ asked_by: _, ...r }) => r);
    },
    /** A platform moderator approves a request onto the platform catalogue. Never their own. */
    async approve(id: string, by: { id: string; name: string }, input: { region?: string; category?: string; uses?: unknown; paths?: unknown; note?: string }) {
      const r = await store.request(id);
      if (!r || r.status !== "open") throw new SiteError("That request isn't open.", 404);
      if (r.asked_by === by.id) throw new SiteError("Someone else approves a site you asked for.", 403);
      const s: ApprovedSite = {
        id: crypto.randomUUID(),
        origin: r.origin,
        paths: cleanPaths(input.paths),
        region: cleanRegion(input.region ?? "IN"),
        category: (input.category ?? "general").trim().slice(0, 40) || "general",
        uses: cleanUses(input.uses ?? [r.use]),
        edition: null,
        tenant_id: null,
        status: "active",
        approved_by: by.name,
        review_at: reviewIn(now()),
        note: input.note?.trim().slice(0, 300) || null,
        created_at: iso(),
        updated_at: iso(),
      };
      await store.putSite(s);
      // Every open request for this site is answered by it.
      for (const o of await store.requests("open")) if (o.origin === r.origin && s.uses.includes(o.use)) await store.putRequest({ ...o, status: "approved", decided_by: by.name, updated_at: iso() });
      await audit(by.name, "site.approved", s.origin, { uses: s.uses.join(","), region: s.region, requests: r.count });
      return s;
    },
    async reject(id: string, by: { id: string; name: string }, note?: string) {
      const r = await store.request(id);
      if (!r || r.status !== "open") throw new SiteError("That request isn't open.", 404);
      if (r.asked_by === by.id) throw new SiteError("Someone else decides a site you asked for.", 403);
      await store.putRequest({ ...r, status: "rejected", decided_by: by.name, updated_at: iso() });
      await audit(by.name, "site.rejected", r.origin, { use: r.use, note: note?.slice(0, 120) ?? null });
      return { rejected: id };
    },
    /** A business's own entry (its administrator adds it), or switching a platform site off for it. */
    async addOwn(input: { url: string; uses: unknown; paths?: unknown; category?: string; note?: string; edition: string; tenant: string }, by: { name: string }) {
      const origin = originOf(input.url);
      if (!origin) throw new SiteError("Only https sites can be added.");
      const uses = cleanUses(input.uses).filter((u) => u !== "lookup");
      if (!uses.length) throw new SiteError("Looking things up on another site while a journey runs needs the platform's approval: ask for it.");
      const s: ApprovedSite = { id: crypto.randomUUID(), origin, paths: cleanPaths(input.paths), region: "*", category: input.category?.slice(0, 40) || "own", uses, edition: input.edition, tenant_id: input.tenant, status: "active", approved_by: by.name, review_at: reviewIn(now()), note: input.note?.slice(0, 300) || null, created_at: iso(), updated_at: iso() };
      await store.putSite(s);
      await audit(by.name, "site.added", origin, { tenant: true, uses: uses.join(",") });
      return s;
    },
    async switchOff(url: string, here: { edition: string; tenant: string }, by: { name: string }) {
      const origin = originOf(url);
      if (!origin) throw new SiteError("Only https sites.");
      const s: ApprovedSite = { id: crypto.randomUUID(), origin, paths: ["/"], region: "*", category: "off", uses: [...SITE_USES], edition: here.edition, tenant_id: here.tenant, status: "off", approved_by: by.name, review_at: "9999-12-31", note: null, created_at: iso(), updated_at: iso() };
      await store.putSite(s);
      await audit(by.name, "site.switched_off", origin, { tenant: true });
      return s;
    },
    /** Pause, resume or revoke an entry (the platform's by its moderators; a business's by its administrator). */
    async setStatus(id: string, status: "active" | "paused" | "revoked", by: { name: string }, scope: { tenant: string | null; edition: string | null }) {
      const s = await store.site(id);
      if (!s || s.tenant_id !== scope.tenant || (scope.tenant !== null && s.edition !== scope.edition)) throw new SiteError("No such site here.", 404);
      await store.putSite({ ...s, status, updated_at: iso() });
      await audit(by.name, status === "paused" ? "site.paused" : status === "revoked" ? "site.revoked" : "site.resumed", s.origin, null);
      return { ...s, status };
    },
    /** The platform catalogue, and a business's own list (with its switched-off platform sites). */
    async list(scope: { tenant: string | null; edition: string | null }) {
      const all = await store.sites();
      return {
        platform: all.filter((s) => s.tenant_id === null && s.status !== "revoked"),
        own: scope.tenant ? all.filter((s) => s.tenant_id === scope.tenant && s.edition === scope.edition && s.status !== "revoked") : [],
      };
    },
  };
}
export type SiteService = ReturnType<typeof createSiteService>;

export function createMemorySiteStore(): SiteStore & { log: unknown[] } {
  const sites = new Map<string, ApprovedSite>();
  const reqs = new Map<string, SiteRequest>();
  const log: unknown[] = [];
  return {
    log,
    sites: async () => [...sites.values()].map((s) => ({ ...s })),
    site: async (id) => (sites.has(id) ? { ...sites.get(id)! } : null),
    putSite: async (s) => void sites.set(s.id, { ...s }),
    requests: async (status) => [...reqs.values()].filter((r) => !status || r.status === status).map((r) => ({ ...r })),
    request: async (id) => (reqs.has(id) ? { ...reqs.get(id)! } : null),
    putRequest: async (r) => void reqs.set(r.id, { ...r }),
    audit: async (e) => void log.push(e),
  };
}
export { createD1SiteStore } from "./d1.js";
