// Services loaded into this kiosk from the Service Catalogue (LIB-18..19). The kiosk always has its
// built-in services (and chat, notebook, sources, settings, the team); on top of those, whoever runs
// it loads published catalogue services. The choice is kept in this browser. Each service's
// journeys are offered to those who may start them: visitors get the ones open to anyone; a
// signed-in member also gets the ones their roles start (the server says which, `allowed`).
import { JOURNEY_SERVICES, kioskContent } from "@sekaran-ind/yaxb-core/content";
import { compileBundle, DEFAULT_ROLES, roleLabel, type Journey, type Role, type Service } from "@sekaran-ind/yaxb-journeys";
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
type Published = { roles: Role[]; services: CatalogueService[] };

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
