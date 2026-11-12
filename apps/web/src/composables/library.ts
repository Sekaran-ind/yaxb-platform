// The kiosk's content: its built-in services and journeys, plus what reviewers accepted in the
// journey library (LIB-8). Published documents come from /api/library/published, are compiled here
// (yaxb-journeys), and only the journeys this viewer may start are offered (their roles); a library
// service with the same id as a built-in one replaces it.
import { JOURNEY_SERVICES, kioskContent } from "@sekaran-ind/yaxb-core/content";
import { compileBundle, DEFAULT_ROLES, overlayServices, roleLabel, type Journey, type Role, type Service } from "@sekaran-ind/yaxb-journeys";
import { computed, shallowRef } from "vue";
import { api } from "@/lib/api";

type Published = { roles: Role[]; libraries: { id: string; name: string; sources: string[]; allowed: string[] }[] };

const SCREENS = kioskContent.screens.screens.map((s) => s.id);
const libraryServices = shallowRef<Service[]>([]);
const libraryJourneys = shallowRef<Journey[]>([]);
const roles = shallowRef<Role[]>([...DEFAULT_ROLES]);
let loading: Promise<void> | null = null;

/** Fetch the published library again (the Services screen does on opening). Offline, the kiosk keeps what it has. */
export function loadLibraryContent(): Promise<void> {
  loading ??= (async () => {
    try {
      const p = await api<Published>("/api/library/published");
      const services: Service[] = [];
      const journeys: Journey[] = [];
      for (const lib of p.libraries) {
        const b = compileBundle(lib.sources, { services: JOURNEY_SERVICES, screens: SCREENS });
        services.push(...b.services);
        journeys.push(...b.journeys.filter((j) => lib.allowed.includes(j.id)));
      }
      libraryServices.value = services;
      libraryJourneys.value = journeys;
      roles.value = p.roles;
    } catch {
      /* no network or no Worker (native without an API base): built-in content only */
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Built-in services with the library's over them. */
export const kioskServices = computed(() => overlayServices(kioskContent.services, libraryServices.value));

/** Built-in journeys, with library journeys added (a library journey replaces a built-in one with its id). */
export const kioskJourneys = computed(() => {
  const ids = new Set(libraryJourneys.value.map((j) => j.id));
  return [...kioskContent.journeys.filter((j) => !ids.has(j.id)), ...libraryJourneys.value];
});

export const roleCatalogue = computed(() => roles.value);
export const roleName = (id: string) => roleLabel(id, roles.value);
