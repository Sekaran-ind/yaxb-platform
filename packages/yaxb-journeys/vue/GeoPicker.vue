<script setup lang="ts">
// A `location` field (VIS-5): tap the map, drag the pin, search for a place (through the host), or,
// only when the person taps "Use my location", the device's position, asked once (VIS-8). An `area`
// field: tap the map to add corners, then the area is the shape they make. Values are schema.org
// GeoCoordinates and GeoShape (geo.ts). Leaflet is loaded with this component only.
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { geoPoint, geoShape, latLngOf, shapeCorners, type Field, type LatLng } from "@sekaran-ind/yaxb-journeys";
import { DEFAULT_VIEW, OSM_TILES, useGeo, type PlaceHit } from "./geo";

const props = defineProps<{ field: Field; value: unknown }>();
const emit = defineEmits<{ change: [value: unknown] }>();
const uid = useId();
const geo = useGeo();
const area = computed(() => props.field.type === "area");
const el = ref<HTMLElement | null>(null);
const status = ref("");
const query = ref("");
const hits = ref<PlaceHit[]>([]);
const searching = ref(false);
const corners = ref<LatLng[]>([]);
let map: L.Map | null = null;
let marker: L.Marker | null = null;
let shape: L.Polygon | null = null;
let dots: L.LayerGroup | null = null;
let resize: ResizeObserver | null = null;
let search: AbortController | null = null;

const pin = L.divIcon({ className: "yj-geo-pin", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] });
const brand = () => getComputedStyle(document.documentElement).getPropertyValue("--yj-accent").trim() || "#0f766e";

function setPoint(p: LatLng, pan = true, zoom?: number) {
  emit("change", geoPoint(p));
  if (!map) return;
  if (!marker) {
    marker = L.marker([p.lat, p.lng], { icon: pin, draggable: true, keyboard: true, title: "The place (drag to adjust)" }).addTo(map);
    marker.on("dragend", () => setPoint({ lat: marker!.getLatLng().lat, lng: marker!.getLatLng().lng }, false));
  } else marker.setLatLng([p.lat, p.lng]);
  if (pan) map.setView([p.lat, p.lng], zoom ?? Math.max(map.getZoom(), 15));
}

function drawArea() {
  if (!map) return;
  dots?.clearLayers();
  for (const c of corners.value) L.circleMarker([c.lat, c.lng], { radius: 5, color: brand(), weight: 2, fillOpacity: 0.8 }).addTo(dots!);
  shape?.remove();
  shape = corners.value.length >= 3 ? L.polygon(corners.value.map((c) => [c.lat, c.lng] as [number, number]), { color: brand(), weight: 2, fillOpacity: 0.2 }).addTo(map) : null;
  emit("change", corners.value.length >= 3 ? geoShape(corners.value) : null);
}
const undo = () => {
  corners.value = corners.value.slice(0, -1);
  drawArea();
};
const clear = () => {
  corners.value = [];
  drawArea();
};

const canLocate = computed(() => typeof navigator !== "undefined" && Boolean(navigator.geolocation) && (geo.locate?.() ?? true));
function locate() {
  if (!canLocate.value) return;
  status.value = "Asking this device where it is…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      status.value = `Found, to within ${Math.round(pos.coords.accuracy)} m. Drag the pin or tap the map to adjust.`;
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (area.value) map?.setView([p.lat, p.lng], 16);
      else setPoint(p);
    },
    () => (status.value = "The device's location wasn't shared. Tap the map instead."),
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
  );
}

async function find() {
  const q = query.value.trim();
  if (!q || !geo.search) return;
  search?.abort();
  search = new AbortController();
  searching.value = true;
  status.value = "";
  try {
    hits.value = await geo.search(q, search.signal);
    if (!hits.value.length) status.value = "Nothing found by that name. Try the area or a landmark, or tap the map.";
  } catch (e) {
    if ((e as Error).name !== "AbortError") status.value = (e as Error).message;
  } finally {
    searching.value = false;
  }
}
function choose(h: PlaceHit) {
  hits.value = [];
  if (area.value) map?.setView([h.lat, h.lng], 16);
  else setPoint(h, true, 17);
  status.value = area.value ? "Now tap the area's corners." : "Check the pin, and drag it to the exact spot.";
}

onMounted(() => {
  const tiles = geo.tiles ?? OSM_TILES;
  map = L.map(el.value!, { scrollWheelZoom: false });
  L.tileLayer(tiles.url, { maxZoom: 19, attribution: tiles.attribution }).addTo(map);
  dots = L.layerGroup().addTo(map);
  map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
  map.on("click", (e: L.LeafletMouseEvent) => {
    const p = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (area.value) {
      corners.value = [...corners.value, p];
      drawArea();
    } else setPoint(p, false);
  });
  const p = latLngOf(props.value);
  if (p && !area.value) setPoint(p);
  const c = shapeCorners(props.value);
  if (c && area.value) {
    corners.value = c.slice(0, -1);
    drawArea();
    map.fitBounds(L.latLngBounds(c.map((x) => [x.lat, x.lng] as [number, number])), { padding: [24, 24] });
  }
  // Laid out inside panes that may be hidden: re-measure when the box changes.
  resize = new ResizeObserver(() => map?.invalidateSize());
  resize.observe(el.value!);
});
onBeforeUnmount(() => {
  search?.abort();
  resize?.disconnect();
  map?.remove();
});
watch(
  () => props.value,
  (v) => {
    const p = latLngOf(v);
    if (!area.value && p && marker && (marker.getLatLng().lat !== p.lat || marker.getLatLng().lng !== p.lng)) setPoint(p, false);
  },
);
</script>

<template>
  <div class="yj-geo">
    <form v-if="geo.search" class="yj-geo-search" role="search" @submit.prevent="find">
      <input :id="`${uid}-q`" v-model="query" class="yj-input" type="search" :aria-label="`Find a place for ${field.label}`" placeholder="A place, area or landmark" />
      <button type="submit" class="yj-btn" :disabled="searching || !query.trim()">{{ searching ? "Finding…" : "Find" }}</button>
    </form>
    <ul v-if="hits.length" class="yj-geo-hits">
      <li v-for="(h, i) in hits" :key="i"><button type="button" class="yj-geo-hit" @click="choose(h)">{{ h.label }}</button></li>
    </ul>
    <div ref="el" class="yj-geo-map" role="application" :aria-label="area ? `Map: tap the corners of ${field.label}` : `Map: tap to set ${field.label}`" />
    <div class="yj-geo-actions">
      <button v-if="canLocate" type="button" class="yj-btn" @click="locate">Use my location</button>
      <template v-if="area">
        <span class="yj-small yj-muted">{{ corners.length < 3 ? `Tap ${3 - corners.length} more corner${3 - corners.length === 1 ? "" : "s"}` : `${corners.length} corners` }}</span>
        <button v-if="corners.length" type="button" class="yj-btn" @click="undo">Undo a corner</button>
        <button v-if="corners.length" type="button" class="yj-btn" @click="clear">Start again</button>
      </template>
    </div>
    <p v-if="status" class="yj-small yj-muted" role="status">{{ status }}</p>
  </div>
</template>

<style>
.yj-geo { display: flex; flex-direction: column; gap: 0.5rem; }
.yj-geo-search { display: flex; gap: 0.5rem; }
.yj-geo-search .yj-input { flex: 1; min-width: 0; }
.yj-geo-hits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.yj-geo-hit { width: 100%; text-align: left; padding: 0.4rem 0.6rem; border-radius: 0.5rem; background: var(--yj-mist); color: inherit; border: 0; cursor: pointer; font: inherit; font-size: 0.875rem; }
.yj-geo-map { height: 16rem; border-radius: 0.75rem; border: 1px solid var(--yj-line); z-index: 0; cursor: crosshair; }
.yj-geo-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.yj-geo-pin span { display: block; width: 22px; height: 22px; border-radius: 50%; background: var(--yj-accent); border: 3px solid #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 0.4); }
/* OpenStreetMap's tiles are bright: dim them in dark themes. */
[data-theme="night"] .yj-geo-map .leaflet-tile-pane, [data-theme="contrast"] .yj-geo-map .leaflet-tile-pane, [data-theme="night"] .yj-map .leaflet-tile-pane, [data-theme="contrast"] .yj-map .leaflet-tile-pane { filter: brightness(0.72) saturate(0.85); }
</style>
