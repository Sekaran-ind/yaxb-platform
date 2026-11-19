import { createKiosk, type Kiosk } from "@sekaran-ind/yaxb-core/agent";
import { JOURNEY_SERVICES, kioskContent } from "@sekaran-ind/yaxb-core/content";
import { compileBundle } from "@sekaran-ind/yaxb-journeys/bundle";
import { createCaseService, type CaseService } from "@sekaran-ind/yaxb-core/cases";
import { createDesignerService, type DesignerService } from "@sekaran-ind/yaxb-core/designer";
import { createLibraryService, type LibraryService } from "@sekaran-ind/yaxb-core/library";
import { createVectorizeRetriever } from "@sekaran-ind/yaxb-core/knowledge";
import { createModeratorService, statusOf, type ModeratorService } from "@sekaran-ind/yaxb-core/moderators";
import { createReviewService, type ReviewService } from "@sekaran-ind/yaxb-core/reviews";
import { createD1CaseStore, createD1EventStore, createD1FeedbackStore, createD1Relay, createD1DesignerStore, createD1Kv, createD1LibraryStore, createD1ModerationStore, createD1ModeratorStore, createD1ReviewStore, createD1ThreadStore } from "@sekaran-ind/yaxb-core/stores/d1";
import { KvStore } from "@sekaran-ind/yaxb-core/stores/kv";
import { stringEnv, type Bindings } from "./env";
import { AsyncLocalStorage } from "node:async_hooks";
import { createD1TenantStore, createTenantService, DEFAULT_TENANT, type TenantService } from "@sekaran-ind/yaxb-core/tenants";

/**
 * The business (tenant, TEN-2) a request acts for: set once per request by the /api middleware
 * (a member's own tenant, or the default one), so every service below is scoped without each route
 * passing it along.
 */
export const tenantContext = new AsyncLocalStorage<string>();
export const currentTenant = () => tenantContext.getStore() ?? DEFAULT_TENANT;
/** One service per tenant, per isolate. */
function perTenant<T>(cache: WeakMap<object, Map<string, T>>, env: Bindings, tenant: string, make: () => T): T {
  let byTenant = cache.get(env);
  if (!byTenant) cache.set(env, (byTenant = new Map()));
  let s = byTenant.get(tenant);
  if (!s) byTenant.set(tenant, (s = make()));
  return s;
}

const kiosks = new WeakMap<object, Kiosk>();
const moderatorServices = new WeakMap<object, Map<string, ModeratorService>>();
const reviewServices = new WeakMap<object, Map<string, ReviewService>>();
const libraryServices = new WeakMap<object, Map<string, LibraryService>>();
const tenantServices = new WeakMap<object, TenantService>();
const designerServices = new WeakMap<object, DesignerService>();
const caseServices = new WeakMap<object, CaseService>();
const seeded = new WeakMap<object, Promise<unknown>>();

/**
 * The catalogue, seeded once per isolate with the kiosk's own services (content/catalogue, such as
 * Visits with its check-in journey). A seed the catalogue already has is left alone.
 */
export async function catalogue(env: Bindings): Promise<LibraryService> {
  const l = library(env);
  // The kiosk's own services are the default tenant's; another business starts with its own.
  if (currentTenant() !== DEFAULT_TENANT) return l;
  let s = seeded.get(env);
  if (!s) seeded.set(env, (s = l.seed(kioskContent.catalogue.map((c) => c.yaml)).catch(() => seeded.delete(env))));
  await s;
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
  return perTenant(libraryServices, env, tenant, () => {
    const audit = moderators(env, tenant).store;
    return createLibraryService(createD1LibraryStore(env.DB, { tenant }), {
      services: JOURNEY_SERVICES,
      audit: (e) => audit.audit(e),
      auditTrail: (id) => audit.auditLog({ targetId: id, limit: 200 }),
      // The Service Designer learns from every review of a service it drafted.
      onReviewed: (entry, decision, note, reviewer) => designer(env).learn(entry, decision, note, reviewer.name),
      // Who is staffed, for the organisation's check (ORG-5): active members' roles only.
      memberRoles: async () => (await moderators(env, tenant).store.list()).filter((m) => statusOf(m) === "active").map((m) => [...m.roles]),
    });
  });
}

/**
 * Cases (LIB-33..38): catalogue journeys handed between people, in D1. A case runs a journey from
 * the published catalogue, kept with the case as it was then.
 */
export function cases(env: Bindings): CaseService {
  let k = caseServices.get(env);
  if (!k) {
    k = createCaseService(createD1CaseStore(env.DB), {
      async journeyFor(entry, journey) {
        const { services } = await (await catalogue(env)).published([], { all: true });
        const s = services.find((x) => x.entry_id === entry);
        const j = s && compileBundle(s.yaml, { services: JOURNEY_SERVICES }).journeys.find((x) => x.id === journey);
        return s && j ? { journey: j, entry_id: s.entry_id, service_id: s.id, service_title: s.title, revision: s.revision } : null;
      },
      // The published organisation: approvals for the requester's manager (ORG-3).
      organisation: async () => (await (await catalogue(env)).published([], { all: true })).organisation,
    });
    caseServices.set(env, k);
  }
  return k;
}

/** Services' events kept on the server (MET-2): the paid plan's storage. */
export const serviceEvents = (env: Bindings) => createD1EventStore(env.DB);

/** The cloud relay (LIB-44): transient envelopes and beacons, in D1. */
export const relay = (env: Bindings) => createD1Relay(env.DB);

/** The Service Designer's drafts and lessons, in D1 (LIB-27..32). */
export function designer(env: Bindings): DesignerService {
  let d = designerServices.get(env);
  if (!d) designerServices.set(env, (d = createDesignerService(createD1DesignerStore(env.DB))));
  return d;
}

/** Answers sent for review and moderators' reviews, in D1 (MOD-10..13, MOD-30..34). */
export function reviews(env: Bindings, tenant = currentTenant()): ReviewService {
  return perTenant(reviewServices, env, tenant, () => createReviewService(createD1ReviewStore(env.DB), moderators(env, tenant).store));
}

/** Moderators, their keys and profiles, and the audit log, in D1 (MOD-20..25). */
export function moderators(env: Bindings, tenant = currentTenant()): ModeratorService {
  return perTenant(moderatorServices, env, tenant, () => createModeratorService(createD1ModeratorStore(env.DB, { tenant })));
}

/** The directory's businesses and their join links (TEN-1..8). A joining member is made in their business. */
export function tenants(env: Bindings): TenantService {
  let t = tenantServices.get(env);
  if (!t) tenantServices.set(env, (t = createTenantService(createD1TenantStore(env.DB), { issueMember: (tenant, input, actor) => moderators(env, tenant).issue(input, actor) })));
  return t;
}

/** A member's tenant, from their id (the session cookie names the member, not the tenant). */
export async function tenantOfMember(env: Bindings, id: string): Promise<string | null> {
  return (await env.DB.prepare("SELECT tenant_id FROM moderators WHERE id = ?1").bind(id).first<{ tenant_id: string }>())?.tenant_id ?? null;
}

/**
 * yaxb-core's kiosk, wired to this Worker: provider keys from secrets, threads, moderation and the
 * agent's long-term store in D1, Vectorize search when VECTORIZE and AI are bound. One instance per
 * isolate, so compiled agents are reused across requests.
 */
export function kiosk(env: Bindings): Kiosk {
  let k = kiosks.get(env);
  if (!k) {
    k = createKiosk({
      env: stringEnv(env),
      threads: createD1ThreadStore(env.DB),
      moderation: createD1ModerationStore(env.DB),
      feedback: createD1FeedbackStore(env.DB),
      // Storage "server": the agent's /memories/ in D1 through Deep Agents' StoreBackend.
      store: new KvStore(createD1Kv(env.DB)),
      vector: env.VECTORIZE && env.AI ? createVectorizeRetriever({ index: env.VECTORIZE, ai: env.AI }) : undefined,
      // Slot filling for journeys from the Service Catalogue: their fields come from the published service.
      journeyFields: (journey, step) => catalogueFields(env, journey, step),
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
    });
    kiosks.set(env, k);
  }
  return k;
}
