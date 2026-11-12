<script setup lang="ts">
// Curation view: questions the agent escalated (open or handled, MOD-4) and session feedback
// (moderators only, MOD-40), above the curated Q&A timeline.
import { AlertTriangle, CheckCircle2, MessageCircleQuestion, RefreshCw } from "@lucide/vue";
import { ref, watch } from "vue";
import ModeratorSignIn from "@/components/moderation/ModeratorSignIn.vue";
import { useAgentResource } from "@/composables/resource";
import { api, ApiError } from "@/lib/api";
import type { FeedbackSummary } from "@sekaran-ind/yaxb-core/feedback";
import type { CuratedItem, ModerationItem } from "@/lib/types";

const items = ref<ModerationItem[] | null>(null);
const queueError = ref<string | null>(null);
const signInNeeded = ref(false);
const state = ref<"open" | "handled" | "">("open");
const reason = ref("");
const reasons = ref<string[]>([]);
const handling = ref<string | null>(null);
const note = ref("");
async function loadQueue() {
  queueError.value = null;
  try {
    const q = new URLSearchParams({ ...(state.value ? { state: state.value } : {}), ...(reason.value ? { reason: reason.value } : {}) });
    const r = await api<{ items: ModerationItem[] }>(`/api/agent/moderation${q.size ? `?${q}` : ""}`);
    items.value = r.items;
    signInNeeded.value = false;
    for (const i of r.items) if (!reasons.value.includes(i.reason)) reasons.value.push(i.reason);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) signInNeeded.value = true;
    else queueError.value = (e as Error).message;
  }
}
async function markHandled(id: string) {
  try {
    await api(`/api/reviews/moderation/${id}/handle`, { note: note.value });
    handling.value = null;
    note.value = "";
    await loadQueue();
  } catch (e) {
    queueError.value = (e as Error).message;
  }
}
async function signedIn() {
  await loadQueue();
  await feedback.refresh();
}
void loadQueue();
watch([state, reason], loadQueue);
const curated = useAgentResource<{ items: CuratedItem[] }>("curated");
const feedback = useAgentResource<FeedbackSummary>("feedback");
const MODE_LABELS: Record<string, string> = { agent: "AI agent", local: "On this device", auto: "Automatic" };
const RATINGS = ["good", "fine", "bad", "skipped"] as const;
const BAR = { good: "bg-success", fine: "bg-info", bad: "bg-danger", skipped: "bg-gray-300" } as const;
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");
</script>

<template>
  <div class="space-y-8">
    <section aria-labelledby="mod-heading">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="mod-heading" class="font-semibold text-ink">Escalated questions</h3>
        <div v-if="!signInNeeded" class="flex flex-wrap items-center gap-3 text-xs">
          <RouterLink to="/kiosk/review" class="font-medium text-brand-dark hover:underline">Review answers</RouterLink>
          <RouterLink to="/kiosk/quality" class="font-medium text-brand-dark hover:underline">Quality (F1)</RouterLink>
          <RouterLink to="/kiosk/team" class="font-medium text-brand-dark hover:underline">Team</RouterLink>
          <RouterLink to="/kiosk/moderator" class="font-medium text-brand-dark hover:underline">My moderator profile</RouterLink>
          <button type="button" class="inline-flex items-center gap-1 hover:text-ink" @click="loadQueue"><RefreshCw class="size-3.5" aria-hidden="true" /> Refresh</button>
        </div>
      </div>
      <ModeratorSignIn v-if="signInNeeded" why="Moderators: sign in with your key to see escalated questions." @signed-in="signedIn" />
      <template v-else>
        <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <div class="flex gap-1" role="group" aria-label="Show">
            <button v-for="s in [{ v: 'open', l: 'Open' }, { v: 'handled', l: 'Handled' }, { v: '', l: 'All' }] as const" :key="s.v" type="button" :aria-pressed="state === s.v" :class="['rounded-full px-3 py-1', state === s.v ? 'bg-brand-dark text-on-brand' : 'bg-mist text-ink']" @click="state = s.v">{{ s.l }}</button>
          </div>
          <label for="mod-reason" class="sr-only">Reason</label>
          <select id="mod-reason" v-model="reason" class="input w-auto py-1 text-sm">
            <option value="">Any reason</option>
            <option v-for="r in reasons" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <p v-if="queueError" role="alert" class="text-sm text-red-800">{{ queueError }}</p>
        <p v-if="items?.length === 0" class="text-sm text-gray-400">Nothing here.</p>
        <ul class="space-y-2">
          <li v-for="m in items ?? []" :key="m.id" :class="['rounded-lg border-l-4 px-4 py-3 text-sm', m.state === 'handled' ? 'border-success bg-success/10' : 'border-warning bg-warning/10']">
            <p class="font-medium text-ink">{{ m.question }}</p>
            <p class="mt-1 text-xs text-gray-600">{{ m.reason }} Â· {{ new Date(m.created_at).toLocaleString() }}</p>
            <p v-if="m.state === 'handled'" class="mt-2 flex items-start gap-1.5 text-xs text-ink">
              <CheckCircle2 class="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>Handled by {{ m.handled_by }}<template v-if="m.handled_at"> Â· {{ new Date(m.handled_at).toLocaleString() }}</template><template v-if="m.note">: {{ m.note }}</template></span>
            </p>
            <form v-else-if="handling === m.id" class="mt-2 flex flex-wrap gap-2" @submit.prevent="markHandled(m.id)">
              <label :for="`note-${m.id}`" class="sr-only">Note</label>
              <input :id="`note-${m.id}`" v-model="note" class="input max-w-md py-1" required maxlength="1000" placeholder="What was done" />
              <button type="submit" class="btn-primary py-1">Mark handled</button>
              <button type="button" class="btn-light py-1" @click="handling = null">Cancel</button>
            </form>
            <button v-else type="button" class="mt-2 text-xs font-medium text-brand-dark hover:underline" @click="(handling = m.id), (note = '')">Mark handledâ€¦</button>
          </li>
        </ul>
      </template>
    </section>

    <section v-if="feedback.data.value" aria-labelledby="fb-heading">
      <div class="mb-3 flex items-center justify-between">
        <h3 id="fb-heading" class="font-semibold text-ink">Session feedback</h3>
        <button type="button" class="inline-flex items-center gap-1 text-xs hover:text-ink" @click="feedback.refresh()"><RefreshCw class="size-3.5" aria-hidden="true" /> Refresh</button>
      </div>
      <p v-if="!feedback.data.value.total" class="text-sm text-gray-400">No feedback yet.</p>
      <template v-else>
        <div class="card space-y-3 p-4">
          <p class="text-sm text-ink">
            {{ feedback.data.value.total }} session{{ feedback.data.value.total === 1 ? "" : "s" }}<template v-if="feedback.data.value.score !== null">
              Â· score {{ feedback.data.value.score > 0 ? "+" : "" }}{{ feedback.data.value.score }} <span class="text-xs text-gray-500">(good minus bad, over rated sessions, from -1 to +1)</span></template
            >
          </p>
          <div class="flex h-3 overflow-hidden rounded-full bg-mist" role="img" :aria-label="RATINGS.map((r) => `${r} ${feedback.data.value!.counts[r]}`).join(', ')">
            <span v-for="r in RATINGS" :key="r" :class="BAR[r]" :style="{ width: pct(feedback.data.value.counts[r], feedback.data.value.total) }" />
          </div>
          <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
            <li v-for="r in RATINGS" :key="r" class="inline-flex items-center gap-1.5"><span :class="['size-2.5 rounded-full', BAR[r]]" aria-hidden="true" />{{ r[0]!.toUpperCase() + r.slice(1) }} {{ feedback.data.value.counts[r] }}</li>
          </ul>
        </div>
        <div class="mt-3 grid gap-3 @lg:grid-cols-2">
          <table class="card w-full p-0 text-sm">
            <caption class="px-4 pt-3 text-left text-xs font-medium text-gray-500">By day</caption>
            <thead><tr class="text-xs text-gray-500"><th class="px-4 py-1 text-left font-normal">Day</th><th class="px-2 font-normal">Good</th><th class="px-2 font-normal">Fine</th><th class="px-2 font-normal">Bad</th></tr></thead>
            <tbody>
              <tr v-for="d in feedback.data.value.byDay.slice(0, 7)" :key="d.day" class="border-t border-gray-100"><td class="px-4 py-1.5">{{ d.day }}</td><td class="text-center">{{ d.good }}</td><td class="text-center">{{ d.fine }}</td><td class="text-center">{{ d.bad }}</td></tr>
            </tbody>
          </table>
          <table class="card w-full p-0 text-sm">
            <caption class="px-4 pt-3 text-left text-xs font-medium text-gray-500">By answer mode</caption>
            <thead><tr class="text-xs text-gray-500"><th class="px-4 py-1 text-left font-normal">Mode</th><th class="px-2 font-normal">Good</th><th class="px-2 font-normal">Fine</th><th class="px-2 font-normal">Bad</th></tr></thead>
            <tbody>
              <tr v-for="m in feedback.data.value.byMode" :key="m.mode" class="border-t border-gray-100"><td class="px-4 py-1.5">{{ MODE_LABELS[m.mode] ?? m.mode }}</td><td class="text-center">{{ m.good }}</td><td class="text-center">{{ m.fine }}</td><td class="text-center">{{ m.bad }}</td></tr>
            </tbody>
          </table>
        </div>
        <ul v-if="feedback.data.value.comments.length" class="mt-3 space-y-2">
          <li v-for="c in feedback.data.value.comments" :key="c.id" class="rounded-lg bg-mist px-4 py-2 text-sm">
            <p class="text-ink">{{ c.comment }}</p>
            <p class="mt-1 text-xs text-gray-500">{{ c.rating }} Â· {{ new Date(c.created_at).toLocaleString() }}</p>
          </li>
        </ul>
      </template>
    </section>

    <section aria-labelledby="timeline-heading">
      <h3 id="timeline-heading" class="mb-4"><span class="rounded-r-full bg-info px-3 py-1 text-sm font-bold text-white">Today</span></h3>
      <p v-if="curated.error.value" class="text-sm text-red-800">{{ curated.error.value }}</p>
      <ol class="relative space-y-6 border-l-2 border-gray-200 pl-6">
        <li v-for="item in curated.data.value?.items ?? []" :key="item.id" class="relative">
          <span class="absolute top-1 -left-[33px] flex size-4 items-center justify-center rounded-full bg-surface ring-2 ring-info" />
          <div class="card p-4">
            <p class="flex items-start gap-2 font-medium text-ink">
              <AlertTriangle v-if="item.red_flag" class="mt-0.5 size-4 shrink-0 text-danger" aria-label="Red flag" />
              <MessageCircleQuestion v-else class="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
              {{ item.question }}
            </p>
            <p class="mt-3 border-t border-gray-100 pt-3 text-sm">{{ item.answer }}</p>
            <p v-if="item.category" class="mt-2 text-xs text-gray-400">{{ item.category }}</p>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>
