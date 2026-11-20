// Maps in the kiosk (VIS-1, VIS-2, VIS-8): place search goes through the Worker (Nominatim, cached
// per business); the device's position is asked for only when a person taps "Use my location" on a
// place field, and never while the child safety lock is on.
import type { GeoHost, PlaceHit } from "@sekaran-ind/yaxb-journeys/vue";
import { useChildMode } from "./child";
import { api } from "@/lib/api";

export function kioskGeoHost(): GeoHost {
  let child: ReturnType<typeof useChildMode> | null = null;
  return {
    async search(query, signal) {
      if (signal?.aborted) return [];
      return (await api<{ items: PlaceHit[] }>(`/api/places/search?q=${encodeURIComponent(query)}`)).items;
    },
    locate: () => !(child ??= useChildMode()).on.value,
    ...(import.meta.env.VITE_TILE_URL ? { tiles: { url: import.meta.env.VITE_TILE_URL as string, attribution: (import.meta.env.VITE_TILE_ATTRIBUTION as string | undefined) ?? "" } } : {}),
  };
}
export const geoHost = kioskGeoHost();
