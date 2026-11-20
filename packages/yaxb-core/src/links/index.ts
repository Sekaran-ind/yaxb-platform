// Business links (DEP-2, DEP-4, DEP-5): one business lets another use some of its services as a
// dependency (`uses: { business, service, journey, as }`). The business that asks (the requester)
// invites; the one that provides accepts and chooses which journeys the other may use and the
// schema.org shape it accepts (consent, versioned). Either side ends it. Only the screen's `with:`
// values cross, shaped as an Order or an Invoice, and only for a journey the link offers; the
// provider's request is its own case, and only how it ended goes back (cases/index.ts).
// Facts audited on both sides: link.created, link.consent_changed, link.ended.
import type { D1Like } from "../stores/d1.js";

export const LINK_SHAPES = ["Order", "Invoice"] as const;
export type LinkShape = (typeof LINK_SHAPES)[number];
export type LinkStatus = "invited" | "active" | "ended";

/** What the provider lets the requester use: one journey of one service, accepting one shape. */
export type LinkOffer = { service: string; journey: string; accepts: LinkShape };

export type BusinessLink = {
  id: string;
  /** The business that uses (tenant id and name as they were when it asked). */
  requester: string;
  requester_name: string;
  /** The business whose services are used. */
  provider: string;
  provider_name: string;
  status: LinkStatus;
  offers: LinkOffer[];
  /** Raised each time the provider changes what it offers. */
  consent_version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  ended_by: string | null;
};

/**
 * The properties of each shape (schema.org Order and Invoice, the few that matter here): a screen's
 * `with:` may name only these, so nothing else about a person or a case crosses between businesses.
 */
export const SHAPE_PROPERTIES: Record<LinkShape, readonly string[]> = {
  Order: ["orderNumber", "orderDate", "description", "customer", "orderedItem", "totalPrice", "priceCurrency", "deliveryAddress", "email", "telephone"],
  Invoice: ["referenceNumber", "confirmationNumber", "description", "customer", "totalPaymentDue", "priceCurrency", "paymentDueDate", "billingPeriod", "email", "telephone"],
};

/** What a `with:` may not carry across, and why (empty when it is fine). */
export function shapeProblems(as: LinkShape, keys: readonly string[]): string[] {
  const allowed = SHAPE_PROPERTIES[as];
  const bad = keys.filter((k) => !allowed.includes(k));
  return bad.length ? [`'${bad.join("', '")}' ${bad.length > 1 ? "aren't properties" : "isn't a property"} of a schema.org ${as}; use ${allowed.join(", ")}`] : [];
}

/** The values as the provider receives them: `{ "@context", "@type", ...values }`, only allowed properties. */
export function shapeInputs(as: LinkShape, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { "@context": "https://schema.org", "@type": as };
  for (const k of SHAPE_PROPERTIES[as]) if (values[k] !== undefined) out[k] = values[k];
  return out;
}

export class LinkError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface LinkStore {
  /** Every link the business is on either end of, newest first. */
  forTenant(tenant: string): Promise<BusinessLink[]>;
  get(id: string): Promise<BusinessLink | null>;
  put(l: BusinessLink): Promise<void>;
}

/** Who acts: an administrator of one business (checked by the caller against their own tenant). */
export type LinkActor = { tenant: string; id: string; name: string; admin: boolean };

export type LinkAuditAction = "link.created" | "link.consent_changed" | "link.ended";
export type LinkOptions = {
  /** A business by id or short name. */
  tenant(idOrSlug: string): Promise<{ id: string; slug: string; name: string; status: string } | null>;
  /** Is this journey one the business has published (so the offer names something real)? */
  published?(tenant: string, service: string, journey: string): Promise<boolean>;
  /** Recorded on each side's audit log (facts only: names of the other business and counts). */
  audit?(tenant: string, action: LinkAuditAction, link: BusinessLink, actor: LinkActor, details: Record<string, string | number | boolean>): Promise<void> | void;
  now?: () => Date;
  id?: () => string;
};

const MAX_OFFERS = 50;

export function createLinkService(store: LinkStore, options: LinkOptions) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const newId = options.id ?? (() => crypto.randomUUID());
  const need = (a: LinkActor) => {
    if (!a.admin) throw new LinkError("Only an administrator manages business links.", 403);
  };
  async function load(a: LinkActor, id: string): Promise<BusinessLink> {
    const l = await store.get(id);
    if (!l || (l.requester !== a.tenant && l.provider !== a.tenant)) throw new LinkError("There is no such link.", 404);
    return l;
  }
  async function audit(action: LinkAuditAction, l: BusinessLink, a: LinkActor, details: Record<string, string | number | boolean>) {
    for (const t of [l.requester, l.provider]) await options.audit?.(t, action, l, a, { requester: l.requester_name, provider: l.provider_name, ...details });
  }
  async function checkOffers(provider: string, offers: readonly LinkOffer[]): Promise<LinkOffer[]> {
    if (offers.length > MAX_OFFERS) throw new LinkError(`Offer at most ${MAX_OFFERS} journeys.`);
    const seen = new Set<string>();
    const out: LinkOffer[] = [];
    for (const o of offers) {
      if (!o || typeof o.service !== "string" || typeof o.journey !== "string" || !LINK_SHAPES.includes(o.accepts)) throw new LinkError("Each offer names a service, one of its journeys, and Order or Invoice.");
      const key = `${o.service}/${o.journey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (options.published && !(await options.published(provider, o.service, o.journey))) throw new LinkError(`'${key}' isn't published, so it can't be offered.`, 422);
      out.push({ service: o.service, journey: o.journey, accepts: o.accepts });
    }
    return out;
  }

  const api = {
    /** The requester asks a business to let it use some of its services. */
    async invite(a: LinkActor, providerKey: string): Promise<BusinessLink> {
      need(a);
      const p = await options.tenant(providerKey);
      const me = await options.tenant(a.tenant);
      if (!p || p.status !== "active" || !me) throw new LinkError("There is no active business with that name.", 404);
      if (p.id === a.tenant) throw new LinkError("A business can't link to itself.");
      if ((await store.forTenant(a.tenant)).some((l) => l.status !== "ended" && l.requester === a.tenant && l.provider === p.id)) throw new LinkError(`You already have a link with ${p.name}.`, 409);
      const t = now();
      const l: BusinessLink = { id: newId(), requester: a.tenant, requester_name: me.name, provider: p.id, provider_name: p.name, status: "invited", offers: [], consent_version: 0, created_by: a.name, created_at: t, updated_at: t, ended_at: null, ended_by: null };
      await store.put(l);
      await audit("link.created", l, a, {});
      return l;
    },

    /** The provider accepts, choosing what the other may use (its consent). */
    async accept(a: LinkActor, id: string, offers: readonly LinkOffer[]): Promise<BusinessLink> {
      need(a);
      const l = await load(a, id);
      if (l.provider !== a.tenant) throw new LinkError("Only the business being asked accepts.", 403);
      if (l.status !== "invited") throw new LinkError("This link isn't waiting for an answer.", 409);
      const next: BusinessLink = { ...l, status: "active", offers: await checkOffers(l.provider, offers), consent_version: 1, updated_at: now() };
      await store.put(next);
      await audit("link.consent_changed", next, a, { offers: next.offers.length, version: next.consent_version });
      return next;
    },

    /** The provider changes what is offered; running requests carry on, new ones follow it. */
    async setOffers(a: LinkActor, id: string, offers: readonly LinkOffer[]): Promise<BusinessLink> {
      need(a);
      const l = await load(a, id);
      if (l.provider !== a.tenant) throw new LinkError("Only the business that provides the services changes what is offered.", 403);
      if (l.status !== "active") throw new LinkError("This link isn't active.", 409);
      const next: BusinessLink = { ...l, offers: await checkOffers(l.provider, offers), consent_version: l.consent_version + 1, updated_at: now() };
      await store.put(next);
      await audit("link.consent_changed", next, a, { offers: next.offers.length, version: next.consent_version });
      return next;
    },

    /** Either side ends it (or the provider declines an invitation). */
    async end(a: LinkActor, id: string): Promise<BusinessLink> {
      need(a);
      const l = await load(a, id);
      if (l.status === "ended") throw new LinkError("This link has ended already.", 409);
      const t = now();
      const next: BusinessLink = { ...l, status: "ended", ended_at: t, ended_by: a.tenant === l.requester ? l.requester_name : l.provider_name, updated_at: t };
      await store.put(next);
      await audit("link.ended", next, a, { by: a.tenant === l.requester ? "requester" : "provider" });
      return next;
    },

    list: (tenant: string) => store.forTenant(tenant),
    get: (a: LinkActor, id: string) => load(a, id),

    /**
     * What the requester may use of a provider right now: the active link's offer for this journey
     * (null when there's no active link, or the provider doesn't offer it). `business` is the
     * provider's id or short name.
     */
    async offerFor(requester: string, business: string, service: string, journey: string): Promise<{ link: BusinessLink; offer: LinkOffer } | null> {
      const p = await options.tenant(business);
      if (!p) return null;
      const link = (await store.forTenant(requester)).find((l) => l.status === "active" && l.requester === requester && l.provider === p.id);
      const offer = link?.offers.find((o) => o.service === service && o.journey === journey);
      return link && offer ? { link, offer } : null;
    },
  };
  return api;
}
export type LinkService = ReturnType<typeof createLinkService>;

export function createMemoryLinkStore(): LinkStore {
  const all = new Map<string, BusinessLink>();
  return {
    forTenant: async (t) => [...all.values()].filter((l) => l.requester === t || l.provider === t).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    get: async (id) => all.get(id) ?? null,
    put: async (l) => void all.set(l.id, l),
  };
}

type Row = Omit<BusinessLink, "offers"> & { offers: string };
const COLS = "id, requester, requester_name, provider, provider_name, status, offers, consent_version, created_by, created_at, updated_at, ended_at, ended_by";
const link = (r: Row): BusinessLink => ({ ...r, offers: JSON.parse(r.offers) as LinkOffer[] });
/** Links in the edition's database (migration 0022): both businesses are tenants of it. */
export function createD1LinkStore(db: D1Like): LinkStore {
  return {
    forTenant: async (t) => (await db.prepare(`SELECT ${COLS} FROM business_links WHERE requester = ?1 OR provider = ?1 ORDER BY created_at DESC`).bind(t).all<Row>()).results.map(link),
    get: async (id) => {
      const r = await db.prepare(`SELECT ${COLS} FROM business_links WHERE id = ?1`).bind(id).first<Row>();
      return r ? link(r) : null;
    },
    put: async (l) =>
      void (await db
        .prepare(`INSERT INTO business_links (${COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) ON CONFLICT (id) DO UPDATE SET status = ?6, offers = ?7, consent_version = ?8, updated_at = ?11, ended_at = ?12, ended_by = ?13`)
        .bind(l.id, l.requester, l.requester_name, l.provider, l.provider_name, l.status, JSON.stringify(l.offers), l.consent_version, l.created_by, l.created_at, l.updated_at, l.ended_at, l.ended_by)
        .run()),
  };
}
