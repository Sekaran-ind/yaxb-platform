import { createKiosk, type Kiosk } from "@sekaran-ind/yaxb-core/agent";
import { JOURNEY_SERVICES, kioskContent } from "@sekaran-ind/yaxb-core/content";
import { compileBundle } from "@sekaran-ind/yaxb-journeys/bundle";
import { createCaseService, type CaseService, type PartnerPort } from "@sekaran-ind/yaxb-core/cases";
import { createD1LinkStore, createLinkService, type LinkService } from "@sekaran-ind/yaxb-core/links";
import { createDesignerService, type DesignerService } from "@sekaran-ind/yaxb-core/designer";
import { createLibraryService, type LibraryService } from "@sekaran-ind/yaxb-core/library";
import { createVectorizeRetriever } from "@sekaran-ind/yaxb-core/knowledge";
import { auditEvent, createModeratorService, statusOf, type ModeratorService } from "@sekaran-ind/yaxb-core/moderators";
import { createReviewService, type ReviewService } from "@sekaran-ind/yaxb-core/reviews";
import { createD1CaseStore, createD1ConnectorSecretStore, createD1EventStore, createD1FeedbackStore, createD1Relay, createD1DesignerStore, createD1Kv, createD1LibraryStore, createD1ModerationStore, createD1ModeratorStore, createD1ReviewStore, createD1ThreadStore } from "@sekaran-ind/yaxb-core/stores/d1";
import { KvStore } from "@sekaran-ind/yaxb-core/stores/kv";
import { stringEnv, type Bindings } from "./env";
import { guardedFetch, mcpServerOfConnector } from "@sekaran-ind/yaxb-core/connectors";
import { unsealConnectorSecret } from "./secrets";
import type { McpServer } from "@sekaran-ind/yaxb-core/mcp";
import { dohResolver } from "@sekaran-ind/yaxb-core/web/pages";
import { AsyncLocalStorage } from "node:async_hooks";
import { currentEdition, db, scoped } from "./edition";
import { createD1SiteStore, createSiteService } from "@sekaran-ind/yaxb-core/sites";
import { createD1TenantStore, createTenantService, DEFAULT_TENANT, type TenantService } from "@sekaran-ind/yaxb-core/tenants";

/**
 * The business (tenant, TEN-2) a request acts for: set once per request by the /api middleware
 * (a member's own tenant, or the default one), so every service below is scoped without each route
 * passing it along. Each edition has its own tenants and its own database (edition.ts): every store
 * here takes `db(env)`, and every cache is keyed by the edition and the tenant.
 */
export const tenantContext = new AsyncLocalStorage<string>();
export const currentTenant = () => tenantContext.getStore() ?? DEFAULT_TENANT;

const kiosks = new WeakMap<object, Map<string, Kiosk>>();
const moderatorServices = new WeakMap<object, Map<string, ModeratorService>>();
const reviewServices = new WeakMap<object, Map<string, ReviewService>>();
const libraryServices = new WeakMap<object, Map<string, LibraryService>>();
const tenantServices = new WeakMap<object, Map<string, TenantService>>();
const designerServices = new WeakMap<object, Map<string, DesignerService>>();
const caseServices = new WeakMap<object, Map<string, CaseService>>();
const linkServices = new WeakMap<object, Map<string, LinkService>>();
const seeded = new WeakMap<object, Map<string, Promise<unknown>>>();

/**
 * The catalogue, seeded once per isolate with the kiosk's own services (content/catalogue, such as
 * Visits with its check-in journey). A seed the catalogue already has is left alone.
 */
export async function catalogue(env: Bindings): Promise<LibraryService> {
  const l = library(env);
  // The kiosk's own services are the default tenant's; another business starts with its own.
  if (currentTenant() !== DEFAULT_TENANT) return l;
  const edition = currentEdition();
  await scoped(seeded, env, () => l.seed(kioskContent.catalogue.map((c) => c.yaml)).catch(() => seeded.get(env)?.delete(`${edition}\u0000`)));
  return l;
}

/** A published catalogue journey's step fields, for slot filling's model pass. */
async function catalogueFields(env: Bindings, journey: string, step: string) {
  const { services } = await (await catalogue(env)).published([], { all: true });
  for (const s of services) {
    if (!s.journeys.some((j) => j.id === journey)) continue;
    return compileBundle(s.yaml, { services: JOURNEY_SERVICES }).journeys.find((j) => j.id === journey)?.steps[step]?.fields;
  }
  return undefined;
}

/** The Service Catalogue in D1 (LIB-1..20), checked against this kiosk's handlers; audited in the moderators' log. */
export function library(env: Bindings, tenant = currentTenant()): LibraryService {
  return scoped(libraryServices, env, () => {
    const audit = moderators(env, tenant).store;
    return createLibraryService(createD1LibraryStore(db(env), { tenant }), {
      services: JOURNEY_SERVICES,
      audit: (e) => audit.audit(e),
      auditTrail: (id) => audit.auditLog({ targetId: id, limit: 200 }),
      // The Service Designer learns from every review of a service it drafted.
      onReviewed: (entry, decision, note, reviewer) => designer(env).learn(entry, decision, note, reviewer.name),
      // Who is staffed, for the organisation's check (ORG-5): active members' roles only.
      memberRoles: async () => (await moderators(env, tenant).store.list()).filter((m) => statusOf(m) === "active").map((m) => [...m.roles]),
      // DEP-2, DEP-4: a service that uses another business needs an active link that offers it.
      businessOffer: async (business, service, journey) => {
        const o = await links(env).offerFor(tenant, business, service, journey);
        return o ? { as: o.offer.accepts } : null;
      },
    });
  }, tenant);
}

/**
 * Cases (LIB-33..38): catalogue journeys handed between people, in D1. A case runs a journey from
 * the published catalogue, kept with the case as it was then.
 */
export function cases(env: Bindings): CaseService {
  // Each business has its own list of cases (a partner's request is in the partner's list only).
  const tenant = currentTenant();
  return scoped(caseServices, env, () =>
    createCaseService(createD1CaseStore(db(env), { tenant }), {
      partner: partnerPort(env, tenant),
      async journeyFor(entry, journey) {
        const { services } = await (await catalogue(env)).published([], { all: true });
        const s = services.find((x) => x.entry_id === entry);
        const j = s && compileBundle(s.yaml, { services: JOURNEY_SERVICES }).journeys.find((x) => x.id === journey);
        return s && j ? { journey: j, entry_id: s.entry_id, service_id: s.id, service_title: s.title, revision: s.revision } : null;
      },
      // The published organisation: approvals for the requester's manager (ORG-3).
      organisation: async () => (await (await catalogue(env)).published([], { all: true })).organisation,
      // DEP-1: what a `uses:` names, by the service's own id.
      async journeyForService(service, journey) {
        const { services } = await (await catalogue(env)).published([], { all: true });
        const s = services.find((x) => x.id === service);
        const j = s && compileBundle(s.yaml, { services: JOURNEY_SERVICES }).journeys.find((x) => x.id === journey);
        return s && j ? { journey: j, entry_id: s.entry_id, service_id: s.id, service_title: s.title, revision: s.revision } : null;
      },
      // DEP-5: dependency events on the case that needed it, when its service keeps its events here.
      async onDependency(kind, parent) {
        if (kind === "dependency.ended") return;
        const { services } = await (await catalogue(env)).published([], { all: true });
        if (services.find((x) => x.entry_id === parent.entry_id)?.storage !== "server") return;
        await serviceEvents(env).add([{ id: crypto.randomUUID(), service: parent.entry_id, journey: parent.journey_id, kind, step: parent.links?.child?.step ?? parent.waiting_step, role: null, run: parent.id, at: new Date().toISOString(), ms: null, ok: kind === "dependency.started" ? null : false, actor: null, outcome: null }]);
      },
    }),
  tenant);
}

/**
 * Business links (DEP-2, DEP-4, DEP-5), in the edition's database: both businesses are tenants of
 * it. Each side's audit log records the link's creation, consent changes and end.
 */
export function links(env: Bindings): LinkService {
  return scoped(linkServices, env, () =>
    createLinkService(createD1LinkStore(db(env)), {
      tenant: async (key) => {
        const t = await tenants(env).tenant(key);
        return t ? { id: t.id, slug: t.slug, name: t.name, status: t.status } : null;
      },
      // An offer names a journey the provider has published.
      published: async (tenant, service, journey) => {
        const { services } = await library(env, tenant).published([], { all: true });
        const s = services.find((x) => x.id === service);
        return Boolean(s && compileBundle(s.yaml, { services: JOURNEY_SERVICES }).journeys.some((j) => j.id === journey));
      },
      audit: (tenant, action, link, actor, details) => moderators(env, tenant).store.audit(auditEvent({ actor_type: "moderator", actor_id: null, actor_name: actor.name, action, target_id: link.id, details })),
    }),
  );
}

/**
 * What a request for another business needs from the Worker (DEP-2): the link (checked on each side),
 * and the other business's own case service, run as that business so its catalogue, members and list
 * are its own. Only the shaped values go over, and only how it ended comes back.
 */
function partnerPort(env: Bindings, me: string): PartnerPort {
  const as = <T>(tenant: string, fn: () => Promise<T>) => tenantContext.run(tenant, fn);
  return {
    async allows(business, service, journey) {
      const o = await links(env).offerFor(me, business, service, journey);
      return o ? { id: o.link.provider, name: o.link.provider_name, as: o.offer.accepts } : null;
    },
    async start(provider, input) {
      const name = (await tenants(env).tenant(me))?.name ?? me;
      return as(provider, () => cases(env).startForPartner({ ...input, requester: me, requester_name: name }));
    },
    async offered(requester, service, journey) {
      const l = (await links(env).list(me)).find((x) => x.status === "active" && x.requester === requester && x.provider === me);
      return l?.offers.find((o) => o.service === service && o.journey === journey)?.accepts ?? null;
    },
    async closed(requester, input) {
      await as(requester, () => cases(env).resumeFromPartner({ provider: me, ...input }));
    },
  };
}

/** Approved sites (SIT-1..6), in the platform database: one list for every edition. */
export const sites = (env: Bindings) => createSiteService(createD1SiteStore(env.PLATFORM_DB as D1Database));

/** Connector secrets (CNX-3), sealed, per tenant, in the edition's D1. */
export const connectorSecrets = (env: Bindings) => createD1ConnectorSecretStore(db(env));

/**
 * The business's own MCP servers (CNX-1): its published MCP connectors, each with its sealed secret
 * added. One without its secret set is left out.
 */
export async function orgMcpServers(env: Bindings): Promise<McpServer[]> {
  const lib = await catalogue(env);
  const out: McpServer[] = [];
  for (const { connector: c } of await lib.publishedConnectors()) {
    if (!c.mcp) continue;
    const secrets: Record<string, string> = {};
    for (const r of await connectorSecrets(env).list(currentTenant(), c.id)) secrets[r.name] = await unsealConnectorSecret(env, r.sealed);
    const server = mcpServerOfConnector(c, secrets);
    if (server) out.push(server);
  }
  return out;
}

/** A connector's operation was called (CNX-8): facts only, on the server, whatever the services' storage. */
export async function connectorCalled(env: Bindings, entryId: string, op: string, ok: boolean, ms: number, run = crypto.randomUUID()) {
  await serviceEvents(env).add([{ id: crypto.randomUUID(), service: entryId, journey: op, kind: "connector.called", step: null, role: null, run, at: new Date().toISOString(), ms: Math.max(0, Math.round(ms)), ok, actor: null, outcome: null }]);
}

/** Services' events kept on the server (MET-2): the paid plan's storage. */
export const serviceEvents = (env: Bindings, tenant = currentTenant()) => createD1EventStore(db(env), { tenant });

/** The cloud relay (LIB-44): transient envelopes and beacons, in D1. */
export const relay = (env: Bindings) => createD1Relay(db(env));

/** The Service Designer's drafts and lessons, in D1 (LIB-27..32). */
export function designer(env: Bindings, tenant = currentTenant()): DesignerService {
  return scoped(designerServices, env, () => createDesignerService(createD1DesignerStore(db(env), { tenant })), tenant);
}

/** Answers sent for review and moderators' reviews, in D1 (MOD-10..13, MOD-30..34). */
export function reviews(env: Bindings, tenant = currentTenant()): ReviewService {
  return scoped(reviewServices, env, () => createReviewService(createD1ReviewStore(db(env), { tenant }), moderators(env, tenant).store), tenant);
}

/** Moderators, their keys and profiles, and the audit log, in D1 (MOD-20..25). */
export function moderators(env: Bindings, tenant = currentTenant()): ModeratorService {
  return scoped(moderatorServices, env, () => createModeratorService(createD1ModeratorStore(db(env), { tenant })), tenant);
}

/** The directory's businesses and their join links (TEN-1..8). A joining member is made in their business. */
export function tenants(env: Bindings): TenantService {
  return scoped(tenantServices, env, () => createTenantService(createD1TenantStore(db(env)), { issueMember: (tenant, input, actor) => moderators(env, tenant).issue(input, actor) }));
}

/** A member's tenant, from their id (the session cookie names the member, not the tenant). */
export async function tenantOfMember(env: Bindings, id: string): Promise<string | null> {
  return (await db(env).prepare("SELECT tenant_id FROM moderators WHERE id = ?1").bind(id).first<{ tenant_id: string }>())?.tenant_id ?? null;
}

/**
 * yaxb-core's kiosk, wired to this Worker: provider keys from secrets, threads, moderation and the
 * agent's long-term store in the edition's D1, Vectorize search when VECTORIZE and AI are bound. One
 * instance per edition per isolate, so compiled agents are reused across requests.
 */
export function kiosk(env: Bindings, tenant = currentTenant()): Kiosk {
  return scoped(kiosks, env, () =>
    createKiosk({
      env: stringEnv(env),
      threads: createD1ThreadStore(db(env)),
      // What visitors flag, and their feedback, belong to the business whose kiosk they used.
      moderation: createD1ModerationStore(db(env), { tenant }),
      feedback: createD1FeedbackStore(db(env), { tenant }),
      // Storage "server": the agent's /memories/ in D1 through Deep Agents' StoreBackend.
      store: new KvStore(createD1Kv(db(env))),
      vector: env.VECTORIZE && env.AI ? createVectorizeRetriever({ index: env.VECTORIZE, ai: env.AI }) : undefined,
      // Slot filling for journeys from the Service Catalogue: their fields come from the published service.
      journeyFields: (journey, step) => catalogueFields(env, journey, step),
      // The business's own MCP servers (CNX-1), reached through the SSRF guard.
      orgMcp: () => orgMcpServers(env),
      orgMcpFetch: guardedFetch(dohResolver()),
      // Workers Logs. No message content: it may contain health information.
      onError: (error, ctx) =>
        console.error(
          JSON.stringify({
            msg: "kiosk failure",
            ...ctx,
            error: error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown",
            cause: error instanceof Error && error.cause instanceof Error ? `${error.cause.name}: ${String((error.cause as { code?: unknown }).code ?? error.cause.message).slice(0, 120)}` : undefined,
          }),
        ),
    }),
  tenant);
}
