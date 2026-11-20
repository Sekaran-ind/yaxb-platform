<script setup lang="ts">
// A chart (VIS-3, VIS-6's `chart` block): Observable Plot, themed from the package's tokens so every
// theme works, redrawn when the theme or the width changes. Bars or a line over labelled values, with
// the numbers also in a table for screen readers. Loaded only where shown.
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as Plot from "@observablehq/plot";

export type ChartPoint = { label: string; value: number };
const props = withDefaults(defineProps<{ data: ChartPoint[]; kind?: "bar" | "line"; title?: string | null; height?: number; unit?: string }>(), { kind: "bar", title: null, height: 200, unit: "" });
const el = ref<HTMLElement | null>(null);
let resize: ResizeObserver | null = null;
let themes: MutationObserver | null = null;

const token = (name: string, fallback: string) => (el.value ? getComputedStyle(el.value).getPropertyValue(name).trim() : "") || fallback;

const empty = () => !props.data.some((d) => Number.isFinite(d.value) && d.value !== 0);
function draw() {
  if (!el.value) return;
  if (empty()) return void el.value.replaceChildren();
  const width = Math.max(240, el.value.clientWidth);
  const ink = token("--yj-body", "#3f3f46");
  const accent = token("--yj-accent", "#14b8a6");
  const line = token("--yj-line", "#e4e4e7");
  const data = props.data.filter((d) => Number.isFinite(d.value));
  const chart = Plot.plot({
    width,
    height: props.height,
    marginLeft: 40,
    marginBottom: 36,
    style: { background: "transparent", color: ink, fontSize: "12px", fontFamily: "inherit" },
    x: { label: null, domain: data.map((d) => d.label), tickRotate: data.length > 8 && width < 640 ? -35 : 0, type: "band" },
    // A fixed floor: all-zero data has no scale of its own.
    y: { label: props.unit || null, grid: true, nice: true, domain: [0, Math.max(1, ...data.map((d) => d.value))] },
    marks: [
      Plot.ruleY([0], { stroke: line }),
      ...(props.kind === "line"
        ? [Plot.lineY(data, { x: "label", y: "value", stroke: accent, strokeWidth: 2 }), Plot.dot(data, { x: "label", y: "value", fill: accent, r: 3 })]
        : [Plot.barY(data, { x: "label", y: "value", fill: accent, rx: 3 })]),
      Plot.tip(data, Plot.pointerX({ x: "label", y: "value", title: (d: ChartPoint) => `${d.label}: ${d.value}${props.unit ? ` ${props.unit}` : ""}` })),
    ],
  });
  chart.setAttribute("aria-hidden", "true");
  el.value.replaceChildren(chart);
}

onMounted(() => {
  draw();
  resize = new ResizeObserver(() => draw());
  resize.observe(el.value!);
  themes = new MutationObserver(() => draw());
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
});
onBeforeUnmount(() => {
  resize?.disconnect();
  themes?.disconnect();
});
watch(() => [props.data, props.kind], draw, { deep: true });
</script>

<template>
  <figure class="yj-chart">
    <figcaption v-if="title" class="yj-chart-title">{{ title }}</figcaption>
    <div ref="el" class="yj-chart-plot" />
    <p v-if="!data.some((d) => Number.isFinite(d.value) && d.value !== 0)" class="yj-small yj-muted">Nothing to show yet.</p>
    <table class="yj-sr-only">
      <caption>{{ title ?? "Chart" }}</caption>
      <tbody>
        <tr v-for="d in data" :key="d.label"><th scope="row">{{ d.label }}</th><td>{{ d.value }}{{ unit ? ` ${unit}` : "" }}</td></tr>
      </tbody>
    </table>
  </figure>
</template>

<style>
.yj-chart { margin: 0; display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.yj-chart-title { font-size: 0.875rem; font-weight: 600; color: var(--yj-ink); }
.yj-chart-plot { width: 100%; min-width: 0; }
.yj-chart-plot svg { max-width: 100%; height: auto; overflow: visible; }
</style>
