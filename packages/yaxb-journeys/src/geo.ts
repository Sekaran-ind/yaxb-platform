// Places (VIS-2, VIS-5): a `location` field's answer is a schema.org GeoCoordinates, an `area`
// field's a schema.org GeoShape (a closed polygon). Distances, "inside this area" and the nearest
// site are worked out on the device with Turf.js; nothing about a place is sent anywhere for that.
//
//   { "@type": "GeoCoordinates", latitude: 13.0827, longitude: 80.2707 }
//   { "@type": "GeoShape", polygon: "13.08,80.27 13.09,80.27 13.09,80.28 13.08,80.27" }
//
// schema.org's polygon is four or more space-separated "latitude,longitude" points, the first and
// last the same.
import turfDistance from "@turf/distance";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point, polygon, featureCollection } from "@turf/helpers";
import nearestPoint from "@turf/nearest-point";
import turfArea from "@turf/area";

export type GeoCoordinates = { "@type": "GeoCoordinates"; latitude: number; longitude: number };
export type GeoShape = { "@type": "GeoShape"; polygon: string };
export type LatLng = { lat: number; lng: number };

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const valid = (p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/** A point as a GeoCoordinates (rounded to about 10 cm). */
export const geoPoint = (p: LatLng): GeoCoordinates => ({ "@type": "GeoCoordinates", latitude: round(p.lat), longitude: round(p.lng) });

/** A GeoCoordinates read back, or null. */
export function latLngOf(v: unknown): LatLng | null {
  const o = v as Partial<GeoCoordinates> | null;
  if (!o || typeof o !== "object" || typeof o.latitude !== "number" || typeof o.longitude !== "number") return null;
  const p = { lat: o.latitude, lng: o.longitude };
  return valid(p) ? p : null;
}
export const isGeoCoordinates = (v: unknown): v is GeoCoordinates => latLngOf(v) !== null && (v as { "@type"?: unknown })["@type"] === "GeoCoordinates";

/** A region from its corners (at least three), closed, as a GeoShape. */
export function geoShape(corners: readonly LatLng[]): GeoShape {
  const ring = [...corners];
  const [first, last] = [ring[0], ring[ring.length - 1]];
  if (first && last && (first.lat !== last.lat || first.lng !== last.lng)) ring.push(first);
  return { "@type": "GeoShape", polygon: ring.map((p) => `${round(p.lat)},${round(p.lng)}`).join(" ") };
}

/** A GeoShape's corners (closed ring), or null when it isn't a polygon of at least three corners. */
export function shapeCorners(v: unknown): LatLng[] | null {
  const o = v as Partial<GeoShape> | null;
  if (!o || typeof o !== "object" || typeof o.polygon !== "string") return null;
  const pts = o.polygon.trim().split(/\s+/).map((s) => {
    const [a, b] = s.split(",").map(Number);
    return { lat: a!, lng: b! };
  });
  if (pts.length < 4 || !pts.every(valid)) return null;
  const [f, l] = [pts[0]!, pts[pts.length - 1]!];
  return f.lat === l.lat && f.lng === l.lng ? pts : null;
}
export const isGeoShape = (v: unknown): v is GeoShape => shapeCorners(v) !== null && (v as { "@type"?: unknown })["@type"] === "GeoShape";

const turfPoint = (p: LatLng) => point([p.lng, p.lat]);
const turfPolygon = (corners: readonly LatLng[]) => polygon([corners.map((c) => [c.lng, c.lat])]);

/** Metres between two points. */
export const distanceMetres = (a: LatLng, b: LatLng) => turfDistance(turfPoint(a), turfPoint(b), { units: "meters" });

/** Is the point inside the area (its corners, or a GeoShape)? */
export function insideArea(p: LatLng, area: readonly LatLng[] | GeoShape): boolean {
  // Corners are closed into a ring, as a GeoShape's are.
  const corners = Array.isArray(area) ? shapeCorners(geoShape(area as readonly LatLng[])) : shapeCorners(area);
  if (!corners || corners.length < 4) return false;
  return booleanPointInPolygon(turfPoint(p), turfPolygon(corners));
}

/** Square metres an area covers. */
export function areaSquareMetres(area: GeoShape): number {
  const corners = shapeCorners(area);
  return corners ? turfArea(turfPolygon(corners)) : 0;
}

/** The nearest of some places (each with an id), with how far it is. */
export function nearestPlace<T extends LatLng & { id: string }>(p: LatLng, places: readonly T[]): { place: T; metres: number } | null {
  const ok = places.filter(valid);
  if (!ok.length) return null;
  const hit = nearestPoint(turfPoint(p), featureCollection(ok.map((x) => point([x.lng, x.lat], { id: x.id }))));
  const place = ok.find((x) => x.id === hit.properties.id)!;
  return { place, metres: distanceMetres(p, place) };
}
