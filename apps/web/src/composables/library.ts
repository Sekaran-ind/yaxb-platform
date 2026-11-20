// Services loaded into this kiosk from the Service Catalogue (LIB-18..19). The kiosk always has its
// built-in services (and chat, notebook, sources, settings, the team); on top of those, whoever runs
// it loads published catalogue services. The choice is kept in this browser. Each service's
// journeys are offered to those who may start them: visitors get the ones open to anyone; a
// signed-in member also gets the ones their roles start (the server says which, `allowed`).
import { JOURNEY_SERVICES, kioskContent } from "@sekaran-ind/yaxb-core/content";
import { trackWrite } from "@/lib/browser/sync-hook";
import { compileBundle, DEFAULT_ROLES, journeyRolesNeeded, MANAGER_OF_REQUESTER, roleLabel, type Journey, type Organisation, type Role, type RunActor, type Service } from "@sekaran-ind/yaxb-journeys";
import { HOUSEHOLD_ENTRY, HOUSEHOLD_ROLE_LABELS, householdJourneys } from "@sekaran-ind/yaxb-core/household";
import { useHousehold } from "@/composables/household";
import { applyRoster, ATTENDANCE_ID } from "@/composables/attendance";
import { accountLevel } from "@/composables/identity";
import { offers } from "@/lib/surface";
import { computed, ref, shallowRef } from "vue";
import { api } from "@/lib/api";

export type CatalogueJourney = { id: string; title: string; summary: string | null; initiate: string[]; complete: string[]; allowed: boolean };
export type CatalogueService = {
  entry_id: string;
  library: string;
  id: string;
  title: string;
  summary: string | null;
  icon: string | null;
  revision: number | null;
  published_at: string | null;
  /** The latest revision's state: only "accepted" services are offered to add to a kiosk. */
  state?: string;
  /** Where it records events (MET-1): none, box or server. */
  storage?: "none" | "box" | "server";
  /** Days its records are kept on the server (absent: 30). */
  retain_days?: number | null;
  roles: Role[];
  journeys: CatalogueJourney[];
  yaml: string;
};
/** Whether the team has someone for a role: signed in, invited (not yet signed in), or nobody (LIB-37). */
export type Staffing = "ready" | "invited" | "nobody";
type Viewer = { roles: string[]; member: boolean; admin: boolean; id?: string; name?: string };
/** A published connector (CNX-2): what it does and the secrets it needs (never their values). */
export type PublishedConnector = { entry_id: string; id: string; title: string; summary: string | null; host: string; operations: { id: string; label: string; method: string; handler: string }[]; secrets: string[]; where?: "server" | "box" };
/** A published routine set off by an event (RTN-1): kiosks forward the events it waits for. */
export type RoutineTriggerRow = { entry_id: string; id: string; title: string; event: { service: string; kind: string; journey?: string; outcome?: string } };
type Published = { roles: Role[]; services: CatalogueService[]; organisation?: Organisation | null; connectors?: PublishedConnector[]; routines?: RoutineTriggerRow[]; staffing?: Record<string, Staffing>; viewer?: Viewer };

const KEY = "yaxb.kiosk.catalogue";
function readLoaded(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function saveLoaded(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* private mode: the choice lasts this page */
  }
}

const published = shallowRef<CatalogueService[]>([]);
const roles = shallowRef<Role[]>([...DEFAULT_ROLES]);
const staffing = shallowRef<Record<string, Staffing>>({});
/** The published organisation (ORG-1): units, roles, reporting lines; null until one is published. */
const organisation = shallowRef<Organisation | null>(null);
export const publishedOrganisation = computed(() => organisation.value);
const connectors = shallowRef<PublishedConnector[]>([]);
export const publishedConnectors = computed(() => connectors.value);
const routineTriggers = shallowRef<RoutineTriggerRow[]>([]);
export const publishedRoutineTriggers = computed(() => routineTriggers.value);
/** Handler names journeys may use: the built-in ones and the published connectors' (CNX-6). */
export const journeyServiceNames = computed(() => [...JOURNEY_SERVICES, ...connectors.value.flatMap((c) => c.operations.map((o) => o.handler))]);
const viewer = shallowRef<Viewer>({ roles: [], member: false, admin: false });
const loadedIds = ref<string[]>(readLoaded());
const ready = ref(false);
let loading: Promise<void> | null = null;

/** Fetch the published catalogue again (the Services screen does on opening). Offline, the kiosk keeps what it has. */
export function loadCatalogue(): Promise<void> {
  loading ??= (async () => {
    try {
      const p = await api<Published>("/api/library/published");
      published.value = p.services;
      roles.value = p.roles;
      staffing.value = p.staffing ?? {};
      organisation.value = p.organisation ?? null;
      connectors.value = p.connectors ?? [];
      routineTriggers.value = p.routines ?? [];
      if (p.viewer) viewer.value = p.viewer;
    } catch {
      /* no network or no Worker: built-in content only */
    } finally {
      ready.value = true;
      loading = null;
    }
  })();
  return loading;
}
/** Kept for callers that only need the roles. */
export const loadLibraryContent = loadCatalogue;

/** Service data on the box (sync v2): which catalogue services this business's kiosks have loaded. */
export const SERVICE_DATA_ID = "kiosk-services";
export function applyServiceData(id: string, data: unknown | null) {
  if (id === ATTENDANCE_ID) return applyRoster(data);
  if (id !== SERVICE_DATA_ID) return;
  const list = data && typeof data === "object" && Array.isArray((data as { loaded?: unknown }).loaded) ? ((data as { loaded: unknown[] }).loaded.filter((x) => typeof x === "string") as string[]) : [];
  loadedIds.value = list;
  saveLoaded(list);
}
const trackLoaded = () => trackWrite("service-data", SERVICE_DATA_ID, { loaded: loadedIds.value });
export function loadIntoKiosk(entryId: string) {
  if (!loadedIds.value.includes(entryId)) loadedIds.value = [...loadedIds.value, entryId];
  saveLoaded(loadedIds.value);
  trackLoaded();
}
export function removeFromKiosk(entryId: string) {
  loadedIds.value = loadedIds.value.filter((x) => x !== entryId);
  saveLoaded(loadedIds.value);
  trackLoaded();
}

/** Published services, and whether this kiosk has each one loaded. */
export const catalogue = computed(() => published.value.map((s) => ({ ...s, loaded: loadedIds.value.includes(s.entry_id) })));
export const catalogueReady = computed(() => ready.value);

/** The loaded services, compiled: the service, its journeys, and the catalogue's facts about them. */
export const loadedServices = computed(() =>
  published.value
    .filter((s) => loadedIds.value.includes(s.entry_id))
    .flatMap((meta) => {
      const b = compileBundle(meta.yaml, { services: JOURNEY_SERVICES });
      const service: Service | undefined = b.services[0];
      return service ? [{ meta, service, journeys: b.journeys }] : [];
    }),
);

/** Built-in journeys, plus the loaded services' journeys this viewer may start (one with a built-in's id replaces it). */
export const kioskJourneys = computed<Journey[]>(() => {
  const extra = loadedServices.value.flatMap((s) => s.journeys.filter((j) => s.meta.journeys.find((m) => m.id === j.id)?.allowed));
  const ids = new Set(extra.map((j) => j.id));
  // At home (Family): the built-in Household service's journeys (EDN-22).
  const home = offers("household") ? householdJourneys() : [];
  return [...kioskContent.journeys.filter((j) => !ids.has(j.id)), ...extra, ...home];
});

export const roleCatalogue = computed(() => roles.value);
export const roleName = (id: string) => (offers("household") && id in HOUSEHOLD_ROLE_LABELS ? HOUSEHOLD_ROLE_LABELS[id as keyof typeof HOUSEHOLD_ROLE_LABELS] : roleLabel(id, roles.value));

/** Who is at this kiosk, for a catalogue journey's runner: the person starting it, with their roles. */
export const kioskActor = computed<RunActor>(() => ({ starter: true, roles: [...viewer.value.roles, ...useHousehold().roles.value], level: accountLevel.value }));
export const viewerIsMember = computed(() => viewer.value.member);

/** The catalogue entry a journey comes from (null for a built-in journey). */
export function entryOfJourney(journeyId: string): string | null {
  if (offers("household") && householdJourneys().some((j) => j.id === journeyId)) return HOUSEHOLD_ENTRY;
  return loadedServices.value.find((s) => s.journeys.some((j) => j.id === journeyId))?.meta.entry_id ?? null;
}

export type RoleNeed = { role: string; label: string; staffing: Staffing; why: string[] };

/**
 * The roles a service needs people for (LIB-37): who starts its journeys (other than visitors),
 * who answers their screens and who finishes them, and whether the team has someone for each.
 */
export function needsOf(entryId: string): RoleNeed[] {
  const meta = published.value.find((s) => s.entry_id === entryId);
  if (!meta) return [];
  const journeys = compileBundle(meta.yaml, { services: JOURNEY_SERVICES }).journeys;
  const out = new Map<string, Set<string>>();
  const WHY = { start: "start", answer: "answer a screen of", finish: "finish" } as const;
  for (const j of journeys)
    for (const n of journeyRolesNeeded(j)) {
      if (!out.has(n.role)) out.set(n.role, new Set());
      for (const f of n.for) out.get(n.role)!.add(`${WHY[f]} ${j.title}`);
    }
  // "The requester's manager" is whoever leads the requester's unit: staffed when the organisation is published.
  return [...out].map(([role, why]) => ({
    role,
    label: roleLabel(role, roles.value),
    staffing: role === MANAGER_OF_REQUESTER ? (organisation.value ? "ready" : "nobody") : (staffing.value[role] ?? "nobody"),
    why: [...why],
  }));
}

/** Who is at this kiosk: a signed-in member (id, name, roles), or nobody (a visitor). */
export const kioskViewer = computed(() => viewer.value);

/** A published catalogue journey, compiled, with its service (for cases kept on this device). */
export function publishedJourney(entryId: string, journeyId: string) {
  const meta = published.value.find((s) => s.entry_id === entryId);
  const journey = meta && compileBundle(meta.yaml, { services: JOURNEY_SERVICES }).journeys.find((j) => j.id === journeyId);
  return meta && journey ? { journey, entry_id: meta.entry_id, service_id: meta.id, service_title: meta.title, revision: meta.revision } : null;
}
