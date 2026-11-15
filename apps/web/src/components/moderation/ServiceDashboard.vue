<script setup lang="ts">
// Service dashboards (MET-3..5): for a service that keeps records (on the box or the server), how its
// journeys go (started, finished, completion, requests open and closed, a funnel per journey, how
// long people take, how long each role takes to pick a request up, where services fail) and the
// activity log (what staff did, by name). Built from events, which are facts, never answers.
// A service without storage keeps no records, so it has no dashboard: it says so.
import { activityLog, serviceMetrics, type ServiceEvent } from "@sekaran-ind/yaxb-core/metrics";
import { compileBundle } from "@sekaran-ind/yaxb-journeys";
import { JOURNEY_SERVICES } from "@sekaran-ind/yaxb-core/content";
import { Activity, BarChart3, Loader2, RotateCcw } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ModeratorSignIn from "./ModeratorSignIn.vue";
import { catalogue, loadCatalogue, roleName } from "@/composables/library";
import { loadEvents } from "@/composables/service-events";

const route = useRoute();
const router = useRouter();
void loadCatalogue();
const services = computed(() => catalogue.value);
const chosenId = computed(() => (typeof route.query.service === "string" ? route.query.service : (services.value.find((s) => s.storage && s.storage !== "none")?.entry_id ?? services.value[0]?.entry_id ?? null)));
const chosen = computed(() => services.value.find((s) => s.entry_id === chosenId.value) ?? null);
const choose = (id: string) => void router.push({ path: "/kiosk", query: { ...route.query, screen: "services", staff: "dashboards", service: id } });

const events = ref<ServiceEvent[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const signedOut = ref(false);
async function load() {
  const s = chosen.value;
  events.value = [];
  error.value = null;
  signedOut.value = false;
  if (!s || !s.storage || s.storage === "none") return;
  loading.value = true;
  try {
    events.value = await loadEvents(s.entry_id);
  } catch (e) {
    if ((e as { status?: number }).status === 401 || (e as { status?: number }).status === 403) signedOut.value = true;
    else error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(chosen, load, { immediate: true });

/** The journeys and their screens in order, for the funnel. */
const journeys = computed(() => {
  if (!chosen.value) return [];
  const b = compileBundle(chosen.value.yaml, { services: JOURNEY_SERVICES });
  return b.journeys.map((j) => ({
    id: j.id,
    title: j.title,
    steps: Object.entries(j.steps).map(([id, st]) => ({ id, label: st.label ?? id })),
    // An outcome is named by its result screen's title (untemplated), else its id.
    outcomes: Object.values(j.steps).flatMap((st) => (st.result?.outcome ? [{ id: st.result.outcome, label: st.result.title && !st.result.title.includes("{{") ? st.result.title : st.result.outcome }] : [])),
  }));
});
const m = computed(() => serviceMetrics(events.value, journeys.value));
const log = computed(() => activityLog(events.value).slice(0, 50));
const weeks = computed(() => m.value.weeks.slice(-8));
const maxWeek = computed(() => Math.max(1, ...weeks.value.map((w) => w.started)));

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const dur = (ms: number | null) => {
  if (ms === null) return "–";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 90) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
};
const weekLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short", timeZone: "UTC" });
const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ACTION: Record<string, string> = {
  "request.picked_up": "picked up",
  "request.answered": "answered their part of",
  "request.closed": "closed",
  "request.declined": "declined",
  "request.reassigned": "reassigned",
};
const journeyTitle = (id: string) => journeys.value.find((j) => j.id === id)?.title ?? id;
const STORAGE: Record<string, string> = { box: "on the organisation's box", server: "on the server" };
</script>

<template>
  <section class="space-y-6" aria-labelledby="dash-title">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 id="dash-title" class="flex items-center gap-2 text-lg font-semibold text-ink"><BarChart3 class="size-5 text-brand" aria-hidden="true" /> Service dashboards</h2>
        <p class="text-sm text-gray-600">How each service's journeys go, from its records: facts only, never anyone's answers.</p>
      </div>
      <div class="flex items-center gap-2">
        <label class="sr-only" for="dash-service">Service</label>
        <select id="dash-service" class="input w-auto max-w-72" :value="chosenId ?? ''" @change="choose(($event.target as HTMLSelectElement).value)">
          <option v-for="s in services" :key="s.entry_id" :value="s.entry_id">{{ s.title }}{{ !s.storage || s.storage === "none" ? " (no records)" : "" }}</option>
        </select>
        <button type="button" class="btn-ghost h-10 px-3" aria-label="Refresh" title="Refresh" :disabled="loading" @click="load"><RotateCcw class="size-4" aria-hidden="true" /></button>
      </div>
    </div>

    <p v-if="!chosen" class="rounded-xl bg-mist px-4 py-3 text-sm text-gray-600">No published service yet.</p>
    <p v-else-if="!chosen.storage || chosen.storage === 'none'" class="rounded-xl bg-mist px-4 py-3 text-sm text-gray-600">
      {{ chosen.title }} keeps no records: nothing about its journeys leaves the devices, so it has no dashboard or activity log. An administrator can choose its storage when adding it to a kiosk (My notebook → Services → People and storage).
    </p>
    <ModeratorSignIn v-else-if="signedOut" why="Administrators, moderators and reviewers: sign in with your key to see the service's records." @signed-in="load" />
    <p v-else-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <p v-else-if="loading" role="status" class="flex items-center gap-2 text-sm text-gray-600"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Reading the records…</p>

    <template v-else>
      <p class="text-xs text-gray-500">{{ events.length }} records, kept {{ STORAGE[chosen.storage] }}.</p>
      <!-- The headline numbers -->
      <dl class="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
        <div class="rounded-2xl bg-mist p-3"><dt class="text-xs text-gray-600">Started</dt><dd class="text-2xl font-semibold text-ink">{{ m.started }}</dd></div>
        <div class="rounded-2xl bg-mist p-3"><dt class="text-xs text-gray-600">Finished</dt><dd class="text-2xl font-semibold text-ink">{{ m.finished }} <span class="text-sm font-normal text-gray-500">{{ pct(m.completion) }}</span></dd></div>
        <div class="rounded-2xl bg-mist p-3"><dt class="text-xs text-gray-600">Requests open</dt><dd class="text-2xl font-semibold text-ink">{{ m.open }} <span class="text-sm font-normal text-gray-500">of {{ m.handed }} handed over</span></dd></div>
        <div class="rounded-2xl bg-mist p-3"><dt class="text-xs text-gray-600">Closed · declined</dt><dd class="text-2xl font-semibold text-ink">{{ m.closed }} <span class="text-sm font-normal text-gray-500">· {{ m.declined }}</span></dd></div>
      </dl>

      <!-- What the service achieved (OUT-1) -->
      <div v-if="m.outcomes.length" class="space-y-2">
        <h3 class="font-semibold text-ink">Outcomes</h3>
        <ul class="flex flex-wrap gap-2">
          <li v-for="o in m.outcomes" :key="o.outcome" class="rounded-2xl bg-mist px-3 py-2 text-sm" :title="o.outcome">
            <span class="text-body">{{ o.label }}</span> <span class="font-semibold tabular-nums text-ink">{{ o.count }}</span>
          </li>
        </ul>
      </div>

      <!-- Journeys started per week (one series: no legend; finished is the text beside each bar) -->
      <div v-if="weeks.length" class="space-y-2">
        <h3 class="font-semibold text-ink">Journeys started per week</h3>
        <ul class="space-y-1.5">
          <li v-for="w in weeks" :key="w.week" class="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm" :title="`Week of ${weekLabel(w.week)}: ${w.started} started, ${w.finished} finished`">
            <span class="text-gray-600">{{ weekLabel(w.week) }}</span>
            <span class="h-3 rounded-r-[4px] bg-brand" :style="{ width: `${Math.max(2, (w.started / maxWeek) * 100)}%` }" />
            <span class="tabular-nums text-body">{{ w.started }} <span class="text-gray-500">· {{ w.finished }} finished</span></span>
          </li>
        </ul>
      </div>

      <!-- Each journey -->
      <article v-for="j in m.journeys" :key="j.journey" class="card space-y-3 p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3 class="font-semibold text-ink">{{ j.title }}</h3>
          <p class="text-sm text-gray-600">{{ j.started }} started · {{ j.finished }} finished ({{ pct(j.completion) }}) · median {{ dur(j.medianMs) }}<template v-if="j.success !== null"> · {{ pct(j.success) }} ended well</template></p>
        </div>
        <div v-if="j.funnel.length">
          <h4 class="eyebrow mb-1.5">Where people get to</h4>
          <ul class="space-y-1">
            <li v-for="f in j.funnel" :key="f.step" class="grid grid-cols-[minmax(6rem,12rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm" :title="`${f.label}: ${f.reached} reached, ${f.stoppedHere} stopped here`">
              <span class="truncate text-body">{{ f.label }}</span>
              <span class="h-2.5 rounded-r-[4px] bg-brand/70" :style="{ width: `${Math.max(2, (f.reached / Math.max(1, j.started)) * 100)}%` }" />
              <span class="tabular-nums text-gray-600">{{ f.reached }}<template v-if="f.stoppedHere"> · {{ f.stoppedHere }} stopped</template></span>
            </li>
          </ul>
        </div>
        <dl class="grid gap-x-6 gap-y-1 text-sm @lg:grid-cols-2">
          <template v-if="j.waits.length">
            <dt class="text-gray-500">Waiting to be picked up</dt>
            <dd class="text-body">{{ j.waits.map((w) => `${roleName(w.role)}: ${dur(w.medianMs)} (${w.picked})`).join(" · ") }}</dd>
          </template>
          <template v-if="j.reassigned"><dt class="text-gray-500">Reassigned</dt><dd class="text-body">{{ j.reassigned }}</dd></template>
          <template v-if="j.failed.length"><dt class="text-gray-500">Services that failed</dt><dd class="text-body">{{ j.failed.map((f) => `${f.step} (${f.count})`).join(", ") }}</dd></template>
          <template v-if="j.words"><dt class="text-gray-500">Forms filled from people's words</dt><dd class="text-body">{{ j.words }}</dd></template>
          <template v-if="j.outcomes.length"><dt class="text-gray-500">Outcomes</dt><dd class="text-body">{{ j.outcomes.map((o) => `${o.label}: ${o.count}`).join(" · ") }}</dd></template>
        </dl>
      </article>

      <!-- The activity log -->
      <div class="space-y-2">
        <h3 class="flex items-center gap-2 font-semibold text-ink"><Activity class="size-4 text-brand" aria-hidden="true" /> Activity</h3>
        <ol v-if="log.length" class="divide-y divide-gray-200 rounded-2xl ring-1 ring-gray-200">
          <li v-for="(a, i) in log" :key="i" class="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
            <span class="text-body"><span class="font-medium text-ink">{{ a.actor ?? "Someone" }}</span> {{ ACTION[a.kind] ?? a.kind }} a request: {{ journeyTitle(a.journey) }}<template v-if="a.role"> ({{ roleName(a.role) }})</template></span>
            <span class="text-xs text-gray-500">{{ when(a.at) }}</span>
          </li>
        </ol>
        <p v-else class="rounded-xl bg-mist px-3 py-2 text-sm text-gray-600">No staff actions recorded yet.</p>
      </div>
    </template>
  </section>
</template>
