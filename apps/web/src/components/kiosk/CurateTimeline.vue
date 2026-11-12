<script setup lang="ts">
// Curation view: questions the agent escalated and session feedback (moderators only, MOD-40),
// above the curated Q&A timeline.
import { AlertTriangle, Lock, MessageCircleQuestion, RefreshCw } from "@lucide/vue";
import { computed, ref } from "vue";
import { useAgentResource } from "@/composables/resource";
import type { FeedbackSummary } from "@sekaran-ind/yaxb-core/feedback";
import type { CuratedItem, ModerationItem } from "@/lib/types";

const moderation = useAgentResource<{ items: ModerationItem[] }>("moderation");
const curated = useAgentResource<{ items: CuratedItem[] }>("curated");
const feedback = useAgentResource<FeedbackSummary>("feedback");
const MODE_LABELS: Record<string, string> = { agent: "AI agent", local: "On this device", auto: "Automatic" };
const RATINGS = ["good", "fine", "bad", "skipped"] as const;
const BAR = { good: "bg-success", fine: "bg-info", bad: "bg-danger", skipped: "bg-gray-300" } as const;
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");
const signInNeeded = computed(() => moderation.error.value === "Moderator sign-in required.");

const token = ref("");
const signInError = ref<string | null>(null);
const busy = ref(false);
async function signIn() {
  busy.value = true;
  try {
    const res = await fetch("/api/moderator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token.value }) });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Sign-in failed.");
    signInError.value = null;
    token.value = "";
    await moderation.refresh();
    await feedback.refresh();
  } catch (e) {
    signInError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-8">
    <section aria-labelledby="mod-heading">
      <div class="mb-3 flex items-center justify-between">
        <h3 id="mod-heading" class="font-semibold text-ink">Awaiting moderation</h3>
        <RouterLink v-if="!signInNeeded" to="/kiosk/moderator" class="text-xs font-medium text-brand-dark hover:underline">My moderator profile</RouterLink>
        <button type="button" class="inline-flex items-center gap-1 text-xs hover:text-ink" @click="moderation.refresh()"><RefreshCw class="size-3.5" aria-hidden="true" /> Refresh</button>
      </div>
      <form v-if="signInNeeded" class="flex flex-wrap items-center gap-2 rounded-lg bg-mist px-4 py-3 text-sm" @submit.prevent="signIn">
        <Lock class="size-4 text-gray-500" aria-hidden="true" />
        <label for="moderator-token">Moderators: sign in with your key to see escalated questions.</label>
        <input id="moderator-token" v-model="token" type="password" autocomplete="current-password" required class="input max-w-xs" placeholder="yaxb_mod_…" />
        <button type="submit" class="btn-primary" :disabled="busy">Sign in</button>
        <p v-if="signInError" role="alert" class="w-full text-red-800">{{ signInError }}</p>
      </form>
      <p v-else-if="moderation.error.value" class="text-sm text-red-800">{{ moderation.error.value }}</p>
      <p v-if="moderation.data.value?.items.length === 0" class="text-sm text-gray-400">Nothing escalated yet.</p>
      <ul class="space-y-2">
        <li v-for="m in moderation.data.value?.items ?? []" :key="m.id" class="rounded-lg border-l-4 border-warning bg-warning/10 px-4 py-3 text-sm">
          <p class="font-medium text-ink">{{ m.question }}</p>
          <p class="mt-1 text-xs text-gray-600">{{ m.reason }} · {{ new Date(m.created_at).toLocaleString() }}</p>
        </li>
      </ul>
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
              · score {{ feedback.data.value.score > 0 ? "+" : "" }}{{ feedback.data.value.score }} <span class="text-xs text-gray-500">(good minus bad, over rated sessions, from -1 to +1)</span></template
            >
          </p>
          <div class="flex h-3 overflow-hidden rounded-full bg-mist" role="img" :aria-label="RATINGS.map((r) => `${r} ${feedback.data.value!.counts[r]}`).join(', ')">
            <span v-for="r in RATINGS" :key="r" :class="BAR[r]" :style="{ width: pct(feedback.data.value.counts[r], feedback.data.value.total) }" />
          </div>
          <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
            <li v-for="r in RATINGS" :key="r" class="inline-flex items-center gap-1.5"><span :class="['size-2.5 rounded-full', BAR[r]]" aria-hidden="true" />{{ r[0]!.toUpperCase() + r.slice(1) }} {{ feedback.data.value.counts[r] }}</li>
          </ul>
        </div>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
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
            <p class="mt-1 text-xs text-gray-500">{{ c.rating }} · {{ new Date(c.created_at).toLocaleString() }}</p>
          </li>
        </ul>
      </template>
    </section>

    <section aria-labelledby="timeline-heading">
      <h3 id="timeline-heading" class="mb-4"><span class="rounded-r-full bg-info px-3 py-1 text-sm font-bold text-white">Today</span></h3>
      <p v-if="curated.error.value" class="text-sm text-red-800">{{ curated.error.value }}</p>
      <ol class="relative space-y-6 border-l-2 border-gray-200 pl-6">
        <li v-for="item in curated.data.value?.items ?? []" :key="item.id" class="relative">
          <span class="absolute top-1 -left-[33px] flex size-4 items-center justify-center rounded-full bg-white ring-2 ring-info" />
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
