<script setup lang="ts">
// The catalogue's Routines screen (RTN-1..5, 7): the business's published routines (what sets each
// off, what it does, when it runs next), Run now for an administrator, the two starters for whoever
// writes routines (an administrator or an automator; a reviewer approves them like services), and,
// for an administrator, the switch that pauses every routine and the daily limits.
import type { LibraryEntry } from "@sekaran-ind/yaxb-core/library";
import type { RoutineLimits, RoutineSettings, RoutineTrigger, RoutineUsage } from "@sekaran-ind/yaxb-core/routines";
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { Loader2, Play, Plus, Workflow } from "@lucide/vue";
import { computed, ref } from "vue";
import EntryStatus from "./EntryStatus.vue";
import { api } from "@/lib/api";
import { triggerText } from "@/lib/routines";

const props = defineProps<{ entries: readonly LibraryEntry[] }>();
const emit = defineEmits<{ open: [id: string]; start: [starter: string] }>();

type Row = { entry_id: string; id: string; title: string; summary: string | null; on: RoutineTrigger; actions: string[]; next: string | null };
type Overview = { routines: Row[]; settings: RoutineSettings; usage: RoutineUsage; writer: boolean; manage: boolean; starters: { id: string; title: string }[] };
const data = ref<Overview | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref<string | null>(null);
const limits = ref<RoutineLimits | null>(null);

async function load() {
  error.value = null;
  try {
    data.value = await api<Overview>("/api/routines");
    limits.value = { ...data.value.settings.limits };
  } catch (e) {
    error.value = (e as Error).message;
  }
}
void load();

/** Routines not published yet (drafts, in review, rejected), from the catalogue's entries. */
const drafts = computed(() => props.entries.filter((e) => (e.kind as string) === "routine" && e.status !== "archived" && !data.value?.routines.some((r) => r.entry_id === e.id)));
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const ACTIONS: Record<string, string> = { message: "a message", summary: "a summary", connector: "a connector call", record: "an outcome" };
const doesText = (a: string[]) => [...new Set(a)].map((x) => ACTIONS[x] ?? x).join(", ");

async function act(key: string, fn: () => Promise<string | void>) {
  busy.value = key;
  error.value = notice.value = null;
  try {
    notice.value = (await fn()) ?? null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}
const STATUS: Record<string, string> = {
  done: "It ran.",
  failed: "It stopped at an action that failed:",
  skipped: "Its condition didn't hold, so it did nothing.",
  limited: "Today's limit is reached, so it did nothing.",
  paused: "Routines are paused, so it did nothing.",
};
const runNow = (r: Row) =>
  act(r.entry_id, async () => {
    const out = await api<{ run: { status: string; steps: { ok: boolean; note: string }[] } | null }>(`/api/routines/${r.entry_id}/run`, {});
    // The failing action's reason is shown here only: the run log keeps facts, not words.
    const why = out.run?.steps.find((s) => !s.ok)?.note;
    return out.run ? `${r.title}: ${STATUS[out.run.status] ?? out.run.status}${why ? ` ${why}` : ""}` : undefined;
  });
const save = (paused: boolean) =>
  act("settings", async () => {
    const out = await api<{ settings: RoutineSettings }>("/api/routines/settings", { paused, limits: limits.value }, "PUT");
    data.value = { ...data.value!, settings: out.settings };
    limits.value = { ...out.settings.limits };
    return paused ? "Every routine is paused." : "Saved.";
  });
</script>

<template>
  <section aria-label="Routines" class="max-w-4xl space-y-4">
    <p class="text-sm text-gray-600">
      A routine does something on its own: at a time (every Monday at 9), on a service's date, or when something happens in a service (a late check-in). It can message a role, summarise a service, call a connector or record an outcome. It never pays anything. Administrators and automators write them; a reviewer approves each, like a service.
    </p>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
    <p v-if="notice" role="status" class="rounded-lg bg-mist px-3 py-2 text-sm text-ink">{{ notice }}</p>
    <p v-if="!data && !error" class="flex items-center gap-2 text-sm text-gray-500"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Loading the routines…</p>

    <template v-if="data">
      <p v-if="data.settings.paused" class="caution">Every routine is paused. Nothing runs until an administrator turns them back on.</p>

      <p v-if="!data.routines.length" class="rounded-lg bg-mist px-4 py-3 text-sm text-gray-600">No routine is published yet.</p>
      <ul v-else class="grid gap-3 @2xl:grid-cols-2">
        <li v-for="r in data.routines" :key="r.entry_id" class="card flex flex-col gap-2 p-4">
          <button type="button" class="flex items-start gap-2 text-left" @click="emit('open', r.entry_id)">
            <Workflow class="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
            <span>
              <span class="block font-semibold text-ink">{{ r.title }}</span>
              <span v-if="r.summary" class="block text-sm text-gray-600">{{ r.summary }}</span>
            </span>
          </button>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            <dt class="text-gray-500">When</dt>
            <dd class="text-ink">{{ triggerText(r.on) }}</dd>
            <dt class="text-gray-500">Does</dt>
            <dd class="text-ink">{{ doesText(r.actions) }}</dd>
            <template v-if="r.next">
              <dt class="text-gray-500">Next</dt>
              <dd class="text-ink">{{ when(r.next) }}</dd>
            </template>
          </dl>
          <div v-if="data.manage" class="mt-auto">
            <ConfirmAction label="Run now" confirm-label="Run now" :message="`Run “${r.title}” now, for real? Its messages and calls go out.`" trigger-class="btn-light h-8 px-3 text-sm" :busy="busy === r.entry_id" @confirm="runNow(r)">
              <Loader2 v-if="busy === r.entry_id" class="size-4 animate-spin" aria-hidden="true" /><Play v-else class="size-4" aria-hidden="true" /> Run now
            </ConfirmAction>
          </div>
        </li>
      </ul>

      <div v-if="drafts.length" class="space-y-2">
        <h3 class="text-sm font-semibold text-ink">Not published yet</h3>
        <ul class="space-y-1">
          <li v-for="e in drafts" :key="e.id">
            <button type="button" class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-mist" @click="emit('open', e.id)">
              <span class="text-ink">{{ e.title }}</span>
              <EntryStatus :status="e.status" />
            </button>
          </li>
        </ul>
      </div>

      <div v-if="data.writer" class="space-y-2">
        <h3 class="text-sm font-semibold text-ink">Start a routine</h3>
        <div class="flex flex-wrap gap-2">
          <button v-for="s in data.starters" :key="s.id" type="button" class="btn-light" @click="emit('start', s.id)"><Plus class="size-4" aria-hidden="true" /> {{ s.title }}</button>
          <button type="button" class="btn-ghost" @click="emit('start', 'blank')"><Plus class="size-4" aria-hidden="true" /> A blank routine</button>
        </div>
        <p class="text-xs text-gray-500">Try a new routine with a dry run before you submit it: it shows what it would send, and sends nothing.</p>
      </div>
      <p v-else class="text-xs text-gray-500">Administrators and automators write routines.</p>

      <form v-if="data.manage && limits" class="space-y-3 rounded-xl bg-mist p-4" @submit.prevent="save(data.settings.paused)">
        <h3 class="text-sm font-semibold text-ink">Limits for every routine</h3>
        <p class="text-xs text-gray-500">Today so far: {{ data.usage.runs }} runs, {{ data.usage.messages }} messages, {{ data.usage.connector_calls }} connector calls.</p>
        <div class="grid gap-3 @lg:grid-cols-3">
          <label class="block text-sm text-ink">Runs a day <input v-model.number="limits.runsPerDay" type="number" min="0" max="5000" class="input mt-1 w-full" /></label>
          <label class="block text-sm text-ink">Messages a day <input v-model.number="limits.messagesPerDay" type="number" min="0" max="1000" class="input mt-1 w-full" /></label>
          <label class="block text-sm text-ink">Connector calls a day <input v-model.number="limits.connectorCallsPerDay" type="number" min="0" max="5000" class="input mt-1 w-full" /></label>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="btn-primary" :disabled="busy === 'settings'">Save the limits</button>
          <ConfirmAction
            v-if="!data.settings.paused"
            label="Pause every routine"
            confirm-label="Pause them"
            message="Pause every routine? Nothing runs until you turn them back on, and missed runs aren't made up."
            trigger-class="btn-light"
            :busy="busy === 'settings'"
            @confirm="save(true)"
          />
          <button v-else type="button" class="btn-light" :disabled="busy === 'settings'" @click="save(false)">Turn routines back on</button>
        </div>
      </form>
    </template>
  </section>
</template>
