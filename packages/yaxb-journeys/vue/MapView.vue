<script setup lang="ts">
// A map of places (VIS-1, VIS-6's `map` block): a circle marker per place, drawn by Leaflet itself
// (no marker images), and areas as shapes. `selected` pans to that place. Loaded only where shown.
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { shapeCorners, type GeoShape } from "@sekaran-ind/yaxb-journeys";
import { DEFAULT_VIEW, OSM_TILES, useGeo } from "./geo";

export type MapPlace = { id: string; lat: number; lng: number; label: string };
const props = withDefaults(defineProps<{ places?: MapPlace[]; areas?: GeoShape[]; selected?: string | null; height?: string; label?: string }>(), { places: () => [], areas: () => [], selected: null, height: "16rem", label: "Map" });
const emit = defineEmits<{ select: [id: string] }>();
const geo = useGeo();
const el = ref<HTMLElement | null>(null);
let map: L.Map | null = null;
let layer: L.LayerGroup | null = null;
let resize: ResizeObserver | null = null;
const brand = () => getComputedStyle(document.documentElement).getPropertyValue("--yj-accent").trim() || "#0f766e";

function draw() {
  if (!map || !layer) return;
  layer.clearLayers();
  const bounds: [number, number][] = [];
  for (const a of props.areas) {
    const c = shapeCorners(a);
    if (!c) continue;
    L.polygon(c.map((x) => [x.lat, x.lng] as [number, number]), { color: brand(), weight: 2, fillOpacity: 0.15 }).addTo(layer);
    bounds.push(...c.map((x) => [x.lat, x.lng] as [number, number]));
  }
  for (const p of props.places.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng))) {
    const active = p.id === props.selected;
    L.circleMarker([p.lat, p.lng], { radius: active ? 10 : 7, color: brand(), weight: active ? 3 : 2, fillOpacity: 0.55 })
      .bindTooltip(p.label)
      .on("click", () => emit("select", p.id))
      .addTo(layer);
    bounds.push([p.lat, p.lng]);
  }
  if (bounds.length === 1) map.setView(bounds[0]!, 15);
  else if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 16 });
  else map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
}

onMounted(() => {
  const tiles = geo.tiles ?? OSM_TILES;
  map = L.map(el.value!, { scrollWheelZoom: false });
  L.tileLayer(tiles.url, { maxZoom: 19, attribution: tiles.attribution }).addTo(map);
  layer = L.layerGroup().addTo(map);
  draw();
  resize = new ResizeObserver(() => map?.invalidateSize());
  resize.observe(el.value!);
});
onBeforeUnmount(() => {
  resize?.disconnect();
  map?.remove();
});
watch(() => [props.places, props.areas, props.selected], draw, { deep: true });
</script>

<template>
  <div ref="el" class="yj-map" :style="{ height }" role="region" :aria-label="label" />
</template>

<style>
.yj-map { border-radius: 0.75rem; border: 1px solid var(--yj-line); z-index: 0; }
</style>
