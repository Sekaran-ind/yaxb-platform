<script setup lang="ts">
// The F1 dashboard (MOD-30..34): for each notebook, and the knowledge base, how well the kiosk
// cites the right sources (precision, recall, F1) and how often its answers are right (accuracy),
// from moderators' reviews. No number below MIN_REVIEWS reviews. Below the table: the selected
// row's weeks and its worst answers, and the proposed knowledge-base entries.
import { RATINGS, type ScoreRow } from "@sekaran-ind/yaxb-core/reviews";
import { ChevronDown, ChevronUp, ClipboardCopy, RefreshCw } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import ModeratorSignIn from "./ModeratorSignIn.vue";
import { api, ApiError } from "@/lib/api";

type Scores = { rows: ScoreRow[]; reviews: number; min: number };
type Proposal = { answer_id: string; notebook: { id: string; title: string } | null; entry: Record<string, unknown> | null };
type Column = "title" | "f1" | "precision" | "recall" | "accuracy" | "reviews";

const scores = ref<Scores | null>(null);
const proposals = ref<Proposal[]>([]);
const signedOut = ref(false);
const error = ref<string | null>(null);
const weeks = ref(0);
const sortBy = ref<Column>("f1");
const ascending = ref(true);
const selected = ref<string | null>(null);
const copied = ref<string | null>(null);

const COLUMNS: { id: Column; label: string; hint?: string }[] = [
  { id: "title", label: "Notebook" },
  { id: "f1", label: "F1", hint: "Balance of precision and recall" },
  { id: "precision", label: "Precision", hint: "Cited sources that were relevant" },
  { id: "recall", label: "Recall", hint: "Relevant sources that were cited" },
  { id: "accuracy", label: "Accuracy", hint: "Answers rated correct" },
  { id: "reviews", label: "Reviews" },
];

async function load() {
  error.value = null;
  try {
    const [s, p] = await Promise.all([api<Scores>(`/api/reviews/scores${weeks.value ? `?weeks=${weeks.value}` : ""}`), api<{ items: Proposal[] }>("/api/reviews/proposals")]);
    scores.value = s;
    proposals.value = p.items;
    signedOut.value = false;
    selected.value ??= s.rows.find((r) => r.worst.length)?.id ?? s.rows[0]?.id ?? null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) signedOut.value = true;
    else error.value = (e as Error).message;
  }
}

/** Unscored rows (null) always sort last. */
const rows = computed(() => {
  const list = [...(scores.value?.rows ?? [])];
  const dir = ascending.value ? 1 : -1;
  return list.sort((a, b) => {
    if (sortBy.value === "title") return dir * a.title.localeCompare(b.title);
    const x = a[sortBy.value];
    const y = b[sortBy.value];
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return dir * ((x as number) - (y as number)) || a.title.localeCompare(b.title);
  });
});
const current = computed(() => scores.value?.rows.find((r) => r.id === selected.value) ?? null);

function sort(c: Column) {
  if (sortBy.value === c) ascending.value = !ascending.value;
  else {
    sortBy.value = c;
    ascending.value = c === "title" || c === "f1" || c === "precision" || c === "recall" || c === "accuracy";
  }
}
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const f1Text = (v: number | null) => (v === null ? "—" : v.toFixed(2));
const tone = (v: number | null) => (v === null ? "text-gray-400" : v >= 0.8 ? "text-green-800" : v >= 0.6 ? "text-ink" : "text-red-800");

async function copy(p: Proposal) {
  await navigator.clipboard.writeText(JSON.stringify(p.entry, null, 2));
  copied.value = p.answer_id;
  setTimeout(() => (copied.value = null), 2000);
}

onMounted(load);
watch(weeks, load);
</script>

<template>
  <div class="space-y-6">
    <ModeratorSignIn v-if="signedOut" why="Moderators: sign in with your key to see quality scores." @signed-in="load" />
    <p v-if="error" role="alert" class="rounded-md bg-danger/10 px-4 py-3 text-sm text-red-800">{{ error }}</p>

    <template v-if="scores && !signedOut">
      <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p class="text-gray-600">
          From {{ scores.reviews }} reviewed answer{{ scores.reviews === 1 ? "" : "s" }}. Scores need at least {{ scores.min }} reviews.
          <RouterLink to="/kiosk/review" class="font-medium text-brand-dark hover:underline">Review answers</RouterLink>
        </p>
        <div class="flex items-center gap-3">
          <label for="q-weeks" class="text-xs text-gray-500">Period</label>
          <select id="q-weeks" v-model.number="weeks" class="input w-auto py-1 text-sm">
            <option :value="0">All time</option>
            <option :value="4">Last 4 weeks</option>
            <option :value="12">Last 12 weeks</option>
            <option :value="52">Last year</option>
          </select>
          <button type="button" class="inline-flex items-center gap-1 text-xs hover:text-ink" @click="load"><RefreshCw class="size-3.5" aria-hidden="true" /> Refresh</button>
        </div>
      </div>

      <div class="card overflow-x-auto p-0">
        <table class="w-full min-w-[36rem] text-sm">
          <thead>
            <tr class="border-b border-gray-100 text-xs text-gray-500">
              <th v-for="c in COLUMNS" :key="c.id" scope="col" :class="['px-4 py-2 font-medium', c.id === 'title' ? 'text-left' : 'text-right']" :aria-sort="sortBy === c.id ? (ascending ? 'ascending' : 'descending') : 'none'">
                <button type="button" class="inline-flex items-center gap-1 hover:text-ink" :title="c.hint" @click="sort(c.id)">
                  {{ c.label }}
                  <template v-if="sortBy === c.id"><ChevronUp v-if="ascending" class="size-3" aria-hidden="true" /><ChevronDown v-else class="size-3" aria-hidden="true" /></template>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" :class="['cursor-pointer border-t border-gray-50 hover:bg-mist', selected === r.id && 'bg-mist']" @click="selected = r.id">
              <th scope="row" class="px-4 py-2 text-left font-medium text-ink">
                <button type="button" class="text-left hover:underline" :aria-pressed="selected === r.id" @click.stop="selected = r.id">{{ r.title }}</button>
                <span v-if="r.id === 'knowledge-base'" class="ml-1 text-xs font-normal text-gray-500">(curated sources)</span>
              </th>
              <td :class="['px-4 py-2 text-right font-semibold tabular-nums', tone(r.f1)]">{{ f1Text(r.f1) }}</td>
              <td class="px-4 py-2 text-right tabular-nums">{{ pct(r.precision) }}</td>
              <td class="px-4 py-2 text-right tabular-nums">{{ pct(r.recall) }}</td>
              <td :class="['px-4 py-2 text-right tabular-nums', tone(r.accuracy)]">{{ pct(r.accuracy) }}</td>
              <td class="px-4 py-2 text-right text-gray-600 tabular-nums">
                {{ r.reviews }}<span v-if="r.reviews < scores.min" class="block text-xs text-gray-400">not enough reviews yet</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section v-if="current" class="grid gap-4 md:grid-cols-2" :aria-label="`Details for ${current.title}`">
        <div class="card p-4">
          <h3 class="mb-1 font-semibold text-ink">{{ current.title }} by week</h3>
          <p class="mb-2 text-xs text-gray-500">{{ current.tp }} relevant · {{ current.fp }} not relevant · {{ current.fn }} missing sources, overall.</p>
          <p v-if="!current.weeks.length" class="text-sm text-gray-400">No reviews yet.</p>
          <table v-else class="w-full text-sm">
            <thead><tr class="text-xs text-gray-500"><th scope="col" class="py-1 text-left font-normal">Week of</th><th scope="col" class="text-right font-normal">F1</th><th scope="col" class="text-right font-normal">Accuracy</th><th scope="col" class="text-right font-normal">Reviews</th></tr></thead>
            <tbody>
              <tr v-for="w in [...current.weeks].reverse()" :key="w.week" class="border-t border-gray-50">
                <td class="py-1.5">{{ new Date(`${w.week}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) }}</td>
                <td :class="['text-right tabular-nums', tone(w.f1)]">{{ f1Text(w.f1) }}</td>
                <td class="text-right tabular-nums">{{ pct(w.accuracy) }}</td>
                <td class="text-right text-gray-600 tabular-nums">{{ w.reviews }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card p-4">
          <h3 class="mb-2 font-semibold text-ink">Look at these first</h3>
          <p v-if="!current.worst.length" class="text-sm text-gray-400">No weak answers among the reviews.</p>
          <ol class="space-y-2 text-sm">
            <li v-for="w in current.worst" :key="w.answer_id">
              <RouterLink :to="{ path: '/kiosk/review', query: { answer: w.answer_id } }" class="block rounded-lg bg-mist px-3 py-2 hover:ring-2 hover:ring-brand/30">
                <span class="text-ink">{{ w.question }}</span>
                <span class="mt-0.5 block text-xs text-gray-500">{{ RATINGS[w.rating] }} · F1 {{ f1Text(w.f1) }}</span>
              </RouterLink>
            </li>
          </ol>
        </div>
      </section>

      <section v-if="proposals.length" aria-labelledby="proposals-heading">
        <h3 id="proposals-heading" class="mb-1 font-semibold text-ink">Proposed knowledge-base entries</h3>
        <p class="mb-3 text-sm text-gray-500">From reviews. A curator copies an entry into <code>content/curated_qa.json</code> and approves it as usual.</p>
        <ul class="space-y-2">
          <li v-for="p in proposals" :key="p.answer_id" class="card flex items-start justify-between gap-3 p-4 text-sm">
            <div class="min-w-0">
              <p class="font-medium text-ink">{{ p.entry?.question }}</p>
              <p class="mt-1 text-gray-700">{{ p.entry?.answer }}</p>
              <p class="mt-1 text-xs text-gray-500">{{ p.entry?.category }} · proposed by {{ p.entry?.proposed_by }}<template v-if="p.notebook"> · from {{ p.notebook.title }}</template></p>
            </div>
            <button type="button" class="btn-light shrink-0" @click="copy(p)"><ClipboardCopy class="size-4" aria-hidden="true" /> {{ copied === p.answer_id ? "Copied" : "Copy JSON" }}</button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
