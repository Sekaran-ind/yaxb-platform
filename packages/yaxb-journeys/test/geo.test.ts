// Places (VIS-2, VIS-5): schema.org GeoCoordinates and GeoShape answers, and distance, inside an
// area and the nearest site, worked out on the device with Turf.js.
import { describe, expect, it } from "vitest";
import { areaSquareMetres, distanceMetres, fieldProblem, geoPoint, geoShape, insideArea, isGeoCoordinates, isGeoShape, latLngOf, nearestPlace, shapeCorners, type Field } from "../src/index.js";

const CHENNAI = { lat: 13.0827, lng: 80.2707 };
const MADURAI = { lat: 9.9252, lng: 78.1198 };
const SQUARE = [
  { lat: 13.08, lng: 80.27 },
  { lat: 13.09, lng: 80.27 },
  { lat: 13.09, lng: 80.28 },
  { lat: 13.08, lng: 80.28 },
];

describe("places as schema.org values (VIS-5)", () => {
  it("keeps a point as GeoCoordinates and an area as a closed GeoShape", () => {
    expect(geoPoint({ lat: 13.08270049, lng: 80.27070051 })).toEqual({ "@type": "GeoCoordinates", latitude: 13.0827, longitude: 80.270701 });
    const shape = geoShape(SQUARE);
    expect(shape.polygon).toBe("13.08,80.27 13.09,80.27 13.09,80.28 13.08,80.28 13.08,80.27");
    expect(shapeCorners(shape)).toHaveLength(5);
    expect(isGeoShape(shape)).toBe(true);
    expect(isGeoShape({ "@type": "GeoShape", polygon: "13.08,80.27 13.09,80.27" })).toBe(false);
    expect(isGeoCoordinates({ "@type": "GeoCoordinates", latitude: 91, longitude: 0 })).toBe(false);
    expect(latLngOf(geoPoint(CHENNAI))).toEqual(CHENNAI);
  });
  it("checks location and area answers", () => {
    const loc: Field = { id: "where", type: "location", label: "Where", required: true };
    const area: Field = { id: "plot", type: "area", label: "The plot" };
    expect(fieldProblem(loc, null)).toMatch(/required/);
    expect(fieldProblem(loc, { lat: 1, lng: 2 })).toMatch(/place on the map/);
    expect(fieldProblem(loc, geoPoint(CHENNAI))).toBeNull();
    expect(fieldProblem(area, geoShape(SQUARE.slice(0, 2)))).toMatch(/at least three corners/);
    expect(fieldProblem(area, geoShape(SQUARE))).toBeNull();
  });
});

describe("worked out on the device (VIS-2)", () => {
  it("measures, finds what's inside, and the nearest site", () => {
    expect(Math.round(distanceMetres(CHENNAI, MADURAI) / 1000)).toBe(422);
    expect(insideArea({ lat: 13.085, lng: 80.275 }, SQUARE)).toBe(true);
    expect(insideArea({ lat: 13.085, lng: 80.275 }, geoShape(SQUARE))).toBe(true);
    expect(insideArea({ lat: 13.1, lng: 80.275 }, geoShape(SQUARE))).toBe(false);
    expect(Math.round(areaSquareMetres(geoShape(SQUARE)) / 1000)).toBeGreaterThan(1000);
    const near = nearestPlace(CHENNAI, [{ id: "mdu", ...MADURAI }, { id: "che", lat: 13.06, lng: 80.25 }]);
    expect(near?.place.id).toBe("che");
    expect(near!.metres).toBeLessThan(5000);
    expect(nearestPlace(CHENNAI, [])).toBeNull();
  });
});
