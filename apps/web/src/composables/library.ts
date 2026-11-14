// Services loaded into this kiosk from the Service Catalogue (LIB-18..19). The kiosk always has its
// built-in services (and chat, notebook, sources, settings, the team); on top of those, whoever runs
// it loads published catalogue services. The choice is kept in this browser. Each service's
// journeys are offered to those who may start them: visitors get the ones open to anyone; a
// signed-in member also gets the ones their roles start (the server says which, `allowed`).
import { JOURNEY_SERVICES, kioskContent } from "@sekaran-ind/yaxb-core/content";
import { compileBundle, DEFAULT_ROLES, journeyRolesNeeded, roleLabel, type Journey, type Role, type RunActor, type Service } from "@sekaran-ind/yaxb-journeys";
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
  roles: Role[];
  journeys: CatalogueJourney[];
  yaml: string;
};
/** Whether the team has someone for a role: signed in, invited (not yet signed in), or nobody (LIB-37). */
export type Staffing = "ready" | "invited" | "nobody";
type Viewer = { roles: string[]; member: boolean; admin: boolean; id?: string; name?: string };
type Published = { roles: Role[]; services: CatalogueService[]; staffing?: Record<string, Staffing>; viewer?: Viewer };

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

export function loadIntoKiosk(entryId: string) {
  if (!loadedIds.value.includes(entryId)) loadedIds.value = [...loadedIds.value, entryId];
  saveLoaded(loadedIds.value);
}
export function removeFromKiosk(entryId: string) {
  loadedIds.value = loadedIds.value.filter((x) => x !== entryId);
  saveLoaded(loadedIds.value);
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
  return [...kioskContent.journeys.filter((j) => !ids.has(j.id)), ...extra];
});

export const roleCatalogue = computed(() => roles.value);
export const roleName = (id: string) => roleLabel(id, roles.value);

/** Who is at this kiosk, for a catalogue journey's runner: the person starting it, with their roles. */
export const kioskActor = computed<RunActor>(() => ({ starter: true, roles: viewer.value.roles }));
export const viewerIsMember = computed(() => viewer.value.member);

/** The catalogue entry a journey comes from (null for a built-in journey). */
export function entryOfJourney(journeyId: string): string | null {
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
  return [...out].map(([role, why]) => ({ role, label: roleLabel(role, roles.value), staffing: staffing.value[role] ?? "nobody", why: [...why] }));
}

/** Who is at this kiosk: a signed-in member (id, name, roles), or nobody (a visitor). */
export const kioskViewer = computed(() => viewer.value);

/** A published catalogue journey, compiled, with its service (for cases kept on this device). */
export function publishedJourney(entryId: string, journeyId: string) {
  const meta = published.value.find((s) => s.entry_id === entryId);
  const journey = meta && compileBundle(meta.yaml, { services: JOURNEY_SERVICES }).journeys.find((j) => j.id === journeyId);
  return meta && journey ? { journey, entry_id: meta.entry_id, service_id: meta.id, service_title: meta.title, revision: meta.revision } : null;
}
