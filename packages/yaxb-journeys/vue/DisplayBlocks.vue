<script setup lang="ts">
// What a screen or a result shows (VIS-6): maps, charts and timelines, from the data the runner filled
// in. Each kind of data is read loosely (a place, a list of places, an area; { label, value } pairs or
// a mapping of numbers; dated items), and each component loads only when a block needs it.
import { computed, defineAsyncComponent } from "vue";
import { isGeoShape, latLngOf, type ShownBlock } from "@sekaran-ind/yaxb-journeys";
import type { ChartPoint } from "./PlotChart.vue";
import type { TimelineItem } from "./EventTimeline.vue";
import type { MapPlace } from "./MapView.vue";

const MapView = defineAsyncComponent(() => import("./MapView.vue"));
const PlotChart = defineAsyncComponent(() => import("./PlotChart.vue"));
const EventTimeline = defineAsyncComponent(() => import("./EventTimeline.vue"));

const props = defineProps<{ blocks: ShownBlock[] }>();
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);
const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function places(data: unknown): { places: MapPlace[]; areas: { "@type": "GeoShape"; polygon: string }[] } {
  const out: MapPlace[] = [];
  const areas: { "@type": "GeoShape"; polygon: string }[] = [];
  list(data).forEach((d, i) => {
    if (isGeoShape(d)) return void areas.push(d);
    const o = (d ?? {}) as Record<string, unknown>;
    const p = latLngOf(o) ?? latLngOf(o.geo) ?? (typeof o.lat === "number" && typeof o.lng === "number" ? { lat: o.lat, lng: o.lng } : null);
    if (p) out.push({ id: text(o.id) || String(i), label: text(o.name) || text(o.label) || `Place ${i + 1}`, ...p });
  });
  return { places: out, areas };
}
function points(data: unknown): ChartPoint[] {
  if (data && typeof data === "object" && !Array.isArray(data)) return Object.entries(data as Record<string, unknown>).filter(([, v]) => typeof v === "number").map(([label, value]) => ({ label, value: value as number }));
  return list(data).flatMap((d) => {
    const o = (d ?? {}) as Record<string, unknown>;
    const value = typeof o.value === "number" ? o.value : Number(o.value);
    const label = text(o.label) || text(o.name);
    return label && Number.isFinite(value) ? [{ label, value }] : [];
  });
}
function events(data: unknown): TimelineItem[] {
  return list(data).flatMap((d, i) => {
    const o = (d ?? {}) as Record<string, unknown>;
    const startDate = text(o.startDate) || text(o.date) || text(o.at);
    const name = text(o.name) || text(o.title);
    return startDate && name ? [{ id: text(o.id) || String(i), name, startDate, ...(text(o.lane) ? { lane: text(o.lane) } : {}), ...(text(o.description) ? { description: text(o.description) } : {}) }] : [];
  });
}
const shown = computed(() =>
  props.blocks.map((b) =>
    b.type === "map" ? { ...b, map: places(b.data) } : b.type === "chart" ? { ...b, chart: points(b.data) } : { ...b, timeline: events(b.data) },
  ),
);
</script>

<template>
  <div class="yj-blocks">
    <template v-for="(b, i) in shown" :key="i">
      <div v-if="b.type === 'map' && 'map' in b && (b.map.places.length || b.map.areas.length)" class="yj-block-map">
        <p v-if="b.title" class="yj-chart-title">{{ b.title }}</p>
        <MapView :places="b.map.places" :areas="b.map.areas" :label="b.title ?? 'Map'" height="14rem" />
      </div>
      <PlotChart v-else-if="b.type === 'chart' && 'chart' in b && b.chart.length" :data="b.chart" :kind="b.kind ?? 'bar'" :title="b.title" />
      <EventTimeline v-else-if="b.type === 'timeline' && 'timeline' in b && b.timeline.length" :items="b.timeline" :title="b.title" />
    </template>
  </div>
</template>

<style>
.yj-blocks { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
.yj-block-map { display: flex; flex-direction: column; gap: 0.25rem; }
</style>
