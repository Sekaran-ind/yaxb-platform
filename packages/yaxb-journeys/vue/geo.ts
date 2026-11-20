// Where maps get their tiles and place search (VIS-1, VIS-2, VIS-8): the host app provides a geo host
// with provideGeo(). The kiosk's searches through its Worker (Nominatim, cached), and says whether the
// device's position may be asked for (never with the child lock on). Without a host, maps use
// OpenStreetMap's tiles and there is no search.
import { inject, provide, type InjectionKey } from "vue";

export type PlaceHit = { lat: number; lng: number; label: string };
export type GeoHost = {
  /** Find a place by its name or address; [] when nothing matched. */
  search?(query: string, signal?: AbortSignal): Promise<PlaceHit[]>;
  /** False while the device's position may not be asked for (the child lock, VIS-8). */
  locate?(): boolean;
  /** Tiles: a provider's, or a PMTiles file on R2 or the box later. */
  tiles?: { url: string; attribution: string };
};

export const OSM_TILES = { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' };
/** India, for maps with nothing on them yet. */
export const DEFAULT_VIEW = { center: [22.5, 79] as [number, number], zoom: 4 };

export const GEO_KEY: InjectionKey<GeoHost> = Symbol("yaxb-journeys.geo");
export const provideGeo = (host: GeoHost) => provide(GEO_KEY, host);
export const useGeo = (): GeoHost => inject(GEO_KEY, {});
