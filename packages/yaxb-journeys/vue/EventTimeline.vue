<script setup lang="ts">
// A timeline (VIS-4): schema.org Events (`name`, `startDate`, optional `lane` and `description`),
// laid out on a time axis (d3-scale) that scrolls and zooms (d3-zoom: wheel, drag, pinch; or the
// buttons), with a lane per kind. Narrow, or by choice, it is a list by day. Loaded only where shown.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { scaleTime } from "d3-scale";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";

export type TimelineItem = { id: string; name: string; startDate: string; lane?: string; description?: string };
const props = withDefaults(defineProps<{ items: TimelineItem[]; title?: string | null }>(), { title: null });
const emit = defineEmits<{ select: [id: string] }>();

const box = ref<HTMLElement | null>(null);
const svg = ref<SVGSVGElement | null>(null);
const width = ref(640);
const asList = ref(false);
const transform = ref<ZoomTransform>(zoomIdentity);
let resize: ResizeObserver | null = null;
let behaviour: ZoomBehavior<SVGSVGElement, unknown> | null = null;

/** A day alone ("2026-11-23") is that day on this device's clock, with no time to show. */
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const parse = (s: string) => (DAY_ONLY.test(s) ? new Date(`${s}T00:00`) : new Date(s));
const dated = computed(() =>
  props.items
    .map((i) => ({ ...i, at: parse(i.startDate), allDay: DAY_ONLY.test(i.startDate) }))
    .filter((i) => !Number.isNaN(i.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime()),
);
const narrow = computed(() => width.value < 560);
const list = computed(() => asList.value || narrow.value);
const lanes = computed(() => [...new Set(dated.value.map((i) => i.lane ?? ""))]);
const LANE = 44;
const TOP = 28;
const LEFT = 96;
const height = computed(() => TOP + Math.max(1, lanes.value.length) * LANE + 8);
const base = computed(() => {
  const times = dated.value.map((i) => i.at.getTime());
  const lo = Math.min(...times, Date.now());
  const hi = Math.max(...times, Date.now());
  const pad = Math.max((hi - lo) * 0.05, 86_400_000);
  return scaleTime().domain([new Date(lo - pad), new Date(hi + pad)]).range([LEFT, Math.max(LEFT + 100, width.value - 16)]);
});
const x = computed(() => transform.value.rescaleX(base.value));
const ticks = computed(() => x.value.ticks(Math.max(2, Math.floor((width.value - LEFT) / 110))));
const tickText = (d: Date) => x.value.tickFormat()(d);
const laneY = (lane: string | undefined) => TOP + lanes.value.indexOf(lane ?? "") * LANE + LANE / 2;
const fmt = (d: Date) => d.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const day = (d: Date) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "long", year: "numeric" });
const byDay = computed(() => {
  const groups = new Map<string, typeof dated.value>();
  for (const i of dated.value) groups.set(day(i.at), [...(groups.get(day(i.at)) ?? []), i]);
  return [...groups];
});

function attach() {
  if (!svg.value || list.value) return;
  behaviour = d3zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 60])
    .translateExtent([[LEFT - 2000, 0], [width.value + 2000, height.value]])
    .on("zoom", (e: { transform: ZoomTransform }) => (transform.value = e.transform));
  select(svg.value).call(behaviour);
}
const zoomBy = (k: number) => svg.value && behaviour && select(svg.value).call(behaviour.scaleBy, k);
const reset = () => svg.value && behaviour && select(svg.value).call(behaviour.transform, zoomIdentity);

onMounted(() => {
  resize = new ResizeObserver(() => (width.value = box.value?.clientWidth ?? 640));
  resize.observe(box.value!);
  width.value = box.value?.clientWidth ?? 640;
  attach();
});
onBeforeUnmount(() => resize?.disconnect());
watch(list, (l) => !l && setTimeout(attach));
</script>

<template>
  <section ref="box" class="yj-timeline" :aria-label="title ?? 'Timeline'">
    <div class="yj-timeline-head">
      <h4 v-if="title" class="yj-timeline-title">{{ title }}</h4>
      <div v-if="!narrow" class="yj-timeline-tools">
        <template v-if="!asList">
          <button type="button" class="yj-btn yj-select-sm" aria-label="Zoom in" @click="zoomBy(1.6)">+</button>
          <button type="button" class="yj-btn yj-select-sm" aria-label="Zoom out" @click="zoomBy(1 / 1.6)">−</button>
          <button type="button" class="yj-btn yj-select-sm" @click="reset">Fit</button>
        </template>
        <button type="button" class="yj-btn yj-select-sm" @click="asList = !asList">{{ asList ? "As a timeline" : "As a list" }}</button>
      </div>
    </div>
    <p v-if="!dated.length" class="yj-small yj-muted">Nothing dated yet.</p>
    <ol v-else-if="list" class="yj-timeline-list">
      <li v-for="[d, items] in byDay" :key="d">
        <p class="yj-timeline-day">{{ d }}</p>
        <ul>
          <li v-for="i in items" :key="i.id">
            <button type="button" class="yj-timeline-item" @click="emit('select', i.id)">
              <span class="yj-timeline-time">{{ i.allDay ? "All day" : i.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }}</span>
              <span>
                <span class="yj-timeline-name">{{ i.name }}</span>
                <span v-if="i.lane" class="yj-small yj-muted"> · {{ i.lane }}</span>
                <span v-if="i.description" class="yj-small yj-muted yj-block">{{ i.description }}</span>
              </span>
            </button>
          </li>
        </ul>
      </li>
    </ol>
    <svg v-else ref="svg" class="yj-timeline-svg" :width="width" :height="height" role="img" :aria-label="`${dated.length} events from ${fmt(dated[0]!.at)} to ${fmt(dated[dated.length - 1]!.at)}. Use 'As a list' to read them.`">
      <g v-for="(l, li) in lanes" :key="l">
        <rect :x="0" :y="TOP + li * LANE" :width="width" :height="LANE" :class="li % 2 ? 'yj-tl-lane-alt' : 'yj-tl-lane'" />
        <text :x="8" :y="TOP + li * LANE + LANE / 2 + 4" class="yj-tl-lane-label">{{ l || "Events" }}</text>
      </g>
      <g v-for="t in ticks" :key="t.getTime()">
        <line :x1="x(t)" :x2="x(t)" :y1="TOP - 4" :y2="height" class="yj-tl-grid" />
        <text :x="x(t)" :y="TOP - 10" text-anchor="middle" class="yj-tl-tick">{{ tickText(t) }}</text>
      </g>
      <line :x1="x(new Date())" :x2="x(new Date())" :y1="TOP" :y2="height" class="yj-tl-now" />
      <g v-for="i in dated" :key="i.id" class="yj-tl-event" @click="emit('select', i.id)">
        <circle v-if="x(i.at) >= LEFT" :cx="x(i.at)" :cy="laneY(i.lane)" r="6" />
        <text v-if="x(i.at) >= LEFT" :x="x(i.at) > width - 170 ? x(i.at) - 9 : x(i.at) + 9" :text-anchor="x(i.at) > width - 170 ? 'end' : 'start'" :y="laneY(i.lane) + 4" class="yj-tl-label">{{ i.name.length > 28 ? `${i.name.slice(0, 27)}…` : i.name }}<title>{{ i.name }} · {{ fmt(i.at) }}</title></text>
      </g>
    </svg>
  </section>
</template>

<style>
.yj-timeline { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
.yj-timeline-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; }
.yj-timeline-title { margin: 0; font-size: 0.875rem; font-weight: 600; color: var(--yj-ink); }
.yj-timeline-tools { display: flex; gap: 0.25rem; }
.yj-timeline-svg { display: block; max-width: 100%; touch-action: none; cursor: grab; border-radius: 0.75rem; border: 1px solid var(--yj-line); background: var(--yj-surface); }
.yj-tl-lane { fill: var(--yj-surface); }
.yj-tl-lane-alt { fill: var(--yj-mist); }
.yj-tl-lane-label { fill: var(--yj-muted); font-size: 11px; }
.yj-tl-grid { stroke: var(--yj-line); }
.yj-tl-tick { fill: var(--yj-muted); font-size: 11px; }
.yj-tl-now { stroke: var(--yj-accent); stroke-dasharray: 3 3; }
.yj-tl-event { cursor: pointer; }
.yj-tl-event circle { fill: var(--yj-accent); stroke: var(--yj-surface); stroke-width: 2; }
.yj-tl-label { fill: var(--yj-ink); font-size: 12px; }
.yj-timeline-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
.yj-timeline-list ul { list-style: none; margin: 0.25rem 0 0; padding: 0 0 0 0.75rem; border-left: 2px solid var(--yj-line); display: flex; flex-direction: column; gap: 0.25rem; }
.yj-timeline-day { margin: 0; font-size: 0.75rem; font-weight: 600; color: var(--yj-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.yj-timeline-item { display: flex; gap: 0.75rem; width: 100%; text-align: left; background: none; border: 0; padding: 0.25rem 0; color: inherit; font: inherit; cursor: pointer; }
.yj-timeline-time { color: var(--yj-muted); font-size: 0.8125rem; min-width: 3.5rem; font-variant-numeric: tabular-nums; }
.yj-timeline-name { color: var(--yj-ink); font-size: 0.875rem; }
.yj-block { display: block; }
</style>
