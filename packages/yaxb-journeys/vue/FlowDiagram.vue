<script setup lang="ts">
// A journey's flow (JRN-43): its state machine (machine.ts) drawn as a diagram, top to bottom by
// distance from the start. Questions are boxes (a role's shows the role), services rounded, decisions
// diamonds, endings pills; lines carry the decision's condition. A step nothing reaches is drawn
// faded and dashed at the bottom, with what the design checks say about it.
import { journeyGraph, type FlowNode } from "@sekaran-ind/yaxb-journeys/machine";
import { roleLabel, type Journey, type Role } from "@sekaran-ind/yaxb-journeys/journeys";
import { computed } from "vue";

const props = defineProps<{ journey: Journey; roles?: readonly Role[] }>();

const W = 168;
const H = 46;
const GAP_X = 28;
const GAP_Y = 64;
const PAD = 16;

const graph = computed(() => journeyGraph(props.journey));
const rows = computed(() => {
  const by = new Map<number, FlowNode[]>();
  for (const n of graph.value.nodes) by.set(n.depth, [...(by.get(n.depth) ?? []), n]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, ns]) => ns);
});
const width = computed(() => Math.max(...rows.value.map((r) => r.length)) * (W + GAP_X) - GAP_X + PAD * 2);
const height = computed(() => rows.value.length * (H + GAP_Y) - GAP_Y + PAD * 2 + 8);
const pos = computed(() => {
  const out = new Map<string, { x: number; y: number }>();
  rows.value.forEach((row, r) => {
    const rowWidth = row.length * (W + GAP_X) - GAP_X;
    const left = (width.value - rowWidth) / 2;
    row.forEach((n, i) => out.set(n.id, { x: left + i * (W + GAP_X), y: PAD + r * (H + GAP_Y) }));
  });
  return out;
});
const edges = computed(() =>
  graph.value.edges.flatMap((e, i) => {
    const a = pos.value.get(e.from);
    const b = pos.value.get(e.to);
    if (!a || !b) return [];
    const back = b.y <= a.y;
    const x1 = a.x + W / 2;
    const y1 = a.y + H;
    const x2 = b.x + W / 2;
    const y2 = b.y;
    // A step back (a loop) goes round the right-hand side.
    const d = back
      ? `M ${a.x + W} ${a.y + H / 2} C ${a.x + W + 60} ${a.y + H / 2}, ${b.x + W + 60} ${b.y + H / 2}, ${b.x + W} ${b.y + H / 2}`
      : `M ${x1} ${y1} C ${x1} ${y1 + GAP_Y / 2}, ${x2} ${y2 - GAP_Y / 2}, ${x2} ${y2}`;
    const mid = back ? { x: Math.max(a.x, b.x) + W + 40, y: (a.y + b.y) / 2 + H / 2 } : { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    const faded = !graph.value.nodes.find((n) => n.id === e.from)?.reachable;
    return [{ key: `${e.from}-${e.event}-${i}`, d, label: e.label, mid, faded, back }];
  }),
);
const short = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const kindLabel: Record<FlowNode["kind"], string> = { ask: "Question", service: "Service", decide: "Decision", final: "Ending", failed: "Failed" };
const who = (n: FlowNode) => (n.role ? roleLabel(n.role, props.roles ?? []) : null);
</script>

<template>
  <div class="yj yj-flowdiagram">
    <svg :viewBox="`0 0 ${width} ${height}`" :width="width" :height="height" role="img" :aria-label="`Flow of ${journey.title}`">
      <defs>
        <marker :id="`yj-arrow-${journey.id}`" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="yj-fd-arrow" /></marker>
      </defs>
      <g v-for="e in edges" :key="e.key" :class="['yj-fd-edge', e.faded && 'yj-fd-faded']">
        <path :d="e.d" fill="none" :marker-end="`url(#yj-arrow-${journey.id})`" />
        <text v-if="e.label" :x="e.mid.x" :y="e.mid.y" text-anchor="middle" dominant-baseline="middle" class="yj-fd-label"><title>{{ e.label }}</title>{{ short(e.label, 26) }}</text>
      </g>
      <g v-for="n in graph.nodes" :key="n.id" :transform="`translate(${pos.get(n.id)!.x} ${pos.get(n.id)!.y})`" :class="['yj-fd-node', `yj-fd-${n.kind}`, !n.reachable && 'yj-fd-faded']">
        <title>{{ kindLabel[n.kind] }}: {{ n.label }}{{ who(n) ? ` (answered by ${who(n)})` : "" }}{{ n.reachable ? "" : " (never reached)" }}</title>
        <polygon v-if="n.kind === 'decide'" :points="`${W / 2},0 ${W},${H / 2} ${W / 2},${H} 0,${H / 2}`" />
        <rect v-else :width="W" :height="H" :rx="n.kind === 'final' || n.kind === 'failed' ? H / 2 : n.kind === 'service' ? 14 : 6" />
        <text :x="W / 2" :y="who(n) ? H / 2 - 7 : H / 2" text-anchor="middle" dominant-baseline="middle" class="yj-fd-title">{{ short(n.label) }}</text>
        <text v-if="who(n)" :x="W / 2" :y="H / 2 + 10" text-anchor="middle" dominant-baseline="middle" class="yj-fd-role">{{ short(who(n)!, 24) }}</text>
      </g>
    </svg>
  </div>
</template>
