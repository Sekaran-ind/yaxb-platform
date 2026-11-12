<script setup lang="ts">
// Reviewing answers (MOD-10..13): the answers visitors and moderators sent to be checked, and one
// answer's review: a rating, each cited source relevant or not, the sources that should have been
// cited, context, and optionally a proposed knowledge-base entry. Earlier reviews stay as history.
import { RATINGS, type Rating, type Review, type ReviewAnswer } from "@sekaran-ind/yaxb-core/reviews";
import { ArrowLeft, Check, History, Plus, RefreshCw, Share2, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ModeratorSignIn from "./ModeratorSignIn.vue";
import { api, ApiError } from "@/lib/api";
import { LANGUAGES } from "@/lib/languages";

type Item = { answer: ReviewAnswer; review: Review | null };
type Detail = { answer: ReviewAnswer; history: Review[]; titles: Record<string, string> };

const route = useRoute();
const router = useRouter();
const signedOut = ref(false);
const error = ref<string | null>(null);
const state = ref<"open" | "reviewed" | "">("open");
const items = ref<Item[] | null>(null);
const detail = ref<Detail | null>(null);
const saved = ref<string | null>(null);
const busy = ref(false);

const draft = ref({ rating: "" as Rating | "", marks: {} as Record<string, boolean>, missing: [] as string[], newMissing: "", context: "", propose: false, proposal: { question: "", answer: "", category: "", red_flag: false } });

const answerId = computed(() => (typeof route.query.answer === "string" ? route.query.answer : null));
const languageLabel = (code: string | null) => LANGUAGES.find((l) => l.code === code)?.label ?? code ?? "";
const when = (iso: string) => new Date(iso).toLocaleString();
/** The answer without its sources line, which is shown as the source list instead. */
const body = (text: string) => text.replace(/\n*\(sources?:[^)]*\)\s*/gi, "\n").trim();

async function guard<T>(fn: () => Promise<T>) {
  error.value = null;
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) signedOut.value = true;
    else error.value = (e as Error).message;
    return null;
  }
}

async function loadList() {
  const r = await guard(() => api<{ items: Item[] }>(`/api/reviews/answers${state.value ? `?state=${state.value}` : ""}`));
  if (r) {
    items.value = r.items;
    signedOut.value = false;
  }
}

async function loadDetail(id: string) {
  saved.value = null;
  const d = await guard(() => api<Detail>(`/api/reviews/answers/${encodeURIComponent(id)}`));
  if (!d) return;
  signedOut.value = false;
  detail.value = d;
  const last = d.history[0];
  draft.value = {
    rating: last?.rating ?? "",
    marks: Object.fromEntries(d.answer.refs.map((r) => [r.id, last?.marks[r.id] ?? true])),
    missing: [...(last?.missing ?? [])].map((m) => (m.startsWith("url:") ? `https://${m.slice(4)}` : m)),
    newMissing: "",
    context: last?.context ?? "",
    propose: Boolean(last?.proposal),
    proposal: last?.proposal ? { ...last.proposal } : { question: d.answer.question, answer: body(d.answer.answer), category: "", red_flag: false },
  };
}

function addMissing() {
  const v = draft.value.newMissing.trim();
  if (v && !draft.value.missing.includes(v)) draft.value.missing.push(v);
  draft.value.newMissing = "";
}

async function save() {
  if (!detail.value || !draft.value.rating) return;
  busy.value = true;
  const d = draft.value;
  const r = await guard(() =>
    api<{ review: Review }>(`/api/reviews/answers/${detail.value!.answer.id}`, {
      rating: d.rating,
      marks: d.marks,
      missing: d.missing,
      context: d.context,
      proposal: d.propose ? d.proposal : null,
    }),
  );
  busy.value = false;
  if (r) {
    await loadDetail(detail.value.answer.id);
    saved.value = "Review saved.";
  }
}

const open = (id: string | null) => {
  const { answer: _, ...rest } = route.query;
  return router.push({ query: id ? { ...rest, answer: id } : rest });
};

watch(answerId, (id) => (id ? loadDetail(id) : ((detail.value = null), loadList())), { immediate: true });
watch(state, loadList);
</script>

<template>
  <div class="space-y-6">
    <ModeratorSignIn v-if="signedOut" why="Moderators: sign in with your key to review answers." @signed-in="answerId ? loadDetail(answerId) : loadList()" />
    <p v-if="error" role="alert" class="rounded-md bg-danger/10 px-4 py-3 text-sm text-red-800">{{ error }}</p>

    <!-- one answer -->
    <template v-if="!signedOut && answerId && detail">
      <div class="flex items-center justify-between gap-3">
        <button type="button" class="inline-flex items-center gap-1 text-sm text-brand-dark hover:underline" @click="open(null)"><ArrowLeft class="size-4" aria-hidden="true" /> All answers</button>
        <RouterLink :to="{ path: '/kiosk/team', query: { share: `/kiosk/review?answer=${detail.answer.id}` } }" class="btn-ghost h-8 text-xs" title="Send a link to this answer to a team member"><Share2 class="size-3.5" aria-hidden="true" /> Share in team chat</RouterLink>
      </div>

      <section class="card space-y-3 p-5">
        <p class="text-xs text-gray-500">
          {{ when(detail.answer.created_at) }} · {{ detail.answer.notebook?.title ?? "No notebook" }} · {{ detail.answer.mode === "local" ? "On this device" : "AI agent" }}<template v-if="detail.answer.language"> · {{ languageLabel(detail.answer.language) }}</template> ·
          sent by {{ detail.answer.origin === "moderator" ? "a moderator" : "a visitor" }}
        </p>
        <h2 class="font-semibold text-ink">{{ detail.answer.question }}</h2>
        <p class="border-t border-gray-100 pt-3 text-sm leading-relaxed whitespace-pre-wrap text-ink">{{ body(detail.answer.answer) }}</p>
      </section>

      <form class="card space-y-5 p-5" @submit.prevent="save">
        <fieldset>
          <legend class="mb-2 text-sm font-medium text-ink">The answer is</legend>
          <div class="flex flex-wrap gap-2">
            <label v-for="(label, key) in RATINGS" :key="key" :class="['cursor-pointer rounded-full border px-3 py-1 text-sm', draft.rating === key ? 'border-brand bg-brand-dark text-on-brand' : 'border-gray-300 text-ink hover:border-brand']">
              <input v-model="draft.rating" type="radio" name="rating" :value="key" class="sr-only" />{{ label }}
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend class="mb-2 text-sm font-medium text-ink">Sources it cited</legend>
          <p v-if="!detail.answer.refs.length" class="text-sm text-gray-500">None. (A correct "not covered" answer cites nothing.)</p>
          <ul class="space-y-2">
            <li v-for="r in detail.answer.refs" :key="r.id" class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-mist px-3 py-2 text-sm">
              <span class="min-w-0">
                <code class="text-xs">{{ r.id }}</code>
                <span class="ml-2 text-gray-700">{{ detail.titles[r.id] ?? r.label ?? "" }}</span>
              </span>
              <span class="flex gap-1" role="group" :aria-label="`Is ${r.id} relevant?`">
                <button type="button" :aria-pressed="draft.marks[r.id] === true" :class="['inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs', draft.marks[r.id] ? 'bg-success text-white' : 'bg-surface text-ink']" @click="draft.marks[r.id] = true"><Check class="size-3" aria-hidden="true" /> Relevant</button>
                <button type="button" :aria-pressed="draft.marks[r.id] === false" :class="['inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs', draft.marks[r.id] === false ? 'bg-danger text-white' : 'bg-surface text-ink']" @click="draft.marks[r.id] = false"><X class="size-3" aria-hidden="true" /> Not relevant</button>
              </span>
            </li>
          </ul>
        </fieldset>

        <fieldset>
          <legend class="mb-1 text-sm font-medium text-ink">Sources it should have cited</legend>
          <p class="mb-2 text-xs text-gray-500">A knowledge-base id (<code>curated:qa-004</code>), a notebook source (<code>notebook:…</code>) or a web address.</p>
          <ul v-if="draft.missing.length" class="mb-2 flex flex-wrap gap-1.5">
            <li v-for="(m, i) in draft.missing" :key="m" class="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs text-ink">
              {{ m }}<button type="button" :aria-label="`Remove ${m}`" @click="draft.missing.splice(i, 1)"><X class="size-3" aria-hidden="true" /></button>
            </li>
          </ul>
          <div class="flex gap-2">
            <input v-model="draft.newMissing" class="input max-w-md" placeholder="curated:qa-010 or https://…" aria-label="Missing source" @keydown.enter.prevent="addMissing" />
            <button type="button" class="btn-light" @click="addMissing"><Plus class="size-4" aria-hidden="true" /> Add</button>
          </div>
        </fieldset>

        <div>
          <label for="rv-context" class="mb-1 block text-sm font-medium text-ink">Context</label>
          <textarea id="rv-context" v-model="draft.context" rows="3" maxlength="2000" class="input" placeholder="What the right answer is, and why." />
        </div>

        <fieldset class="rounded-lg border border-gray-200 p-4">
          <legend class="px-1 text-sm font-medium text-ink"><label class="inline-flex items-center gap-2"><input v-model="draft.propose" type="checkbox" class="size-4 accent-brand" /> Propose a knowledge-base entry</label></legend>
          <p class="text-xs text-gray-500">A curator adds it to the knowledge base after the usual approval.</p>
          <div v-if="draft.propose" class="mt-3 space-y-3">
            <input v-model="draft.proposal.question" class="input" maxlength="500" required aria-label="Question" placeholder="Question" />
            <textarea v-model="draft.proposal.answer" rows="4" maxlength="4000" class="input" required aria-label="Answer" placeholder="Answer" />
            <div class="flex flex-wrap items-center gap-3">
              <input v-model="draft.proposal.category" class="input max-w-xs" maxlength="80" required aria-label="Category" placeholder="Category" />
              <label class="inline-flex items-center gap-2 text-sm"><input v-model="draft.proposal.red_flag" type="checkbox" class="size-4 accent-brand" /> Red flag (always escalate)</label>
            </div>
          </div>
        </fieldset>

        <div class="flex items-center gap-3">
          <button type="submit" class="btn-primary" :disabled="busy || !draft.rating">{{ detail.history.length ? "Save a new review" : "Save review" }}</button>
          <span v-if="saved" role="status" class="text-sm text-ink">{{ saved }}</span>
        </div>
      </form>

      <section v-if="detail.history.length" class="card p-5">
        <h3 class="mb-2 flex items-center gap-2 font-semibold text-ink"><History class="size-4" aria-hidden="true" /> Reviews</h3>
        <ol class="divide-y divide-gray-100 text-sm">
          <li v-for="(h, i) in detail.history" :key="h.id" class="py-2">
            <p class="text-ink">
              <strong>{{ RATINGS[h.rating] }}</strong> · {{ h.moderator_name }} · {{ when(h.at) }}<span v-if="i === 0" class="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-dark">counts</span>
            </p>
            <p class="text-xs text-gray-500">
              {{ Object.values(h.marks).filter(Boolean).length }} relevant · {{ Object.values(h.marks).filter((v) => !v).length }} not relevant · {{ h.missing.length }} missing<template v-if="h.proposal"> · proposed an entry</template>
            </p>
            <p v-if="h.context" class="mt-1 text-gray-700">{{ h.context }}</p>
          </li>
        </ol>
      </section>
    </template>

    <!-- the list -->
    <template v-else-if="!signedOut && !answerId">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex gap-1" role="group" aria-label="Show">
          <button v-for="s in [{ v: 'open', l: 'To review' }, { v: 'reviewed', l: 'Reviewed' }, { v: '', l: 'All' }] as const" :key="s.v" type="button" :aria-pressed="state === s.v" :class="['rounded-full px-3 py-1 text-sm', state === s.v ? 'bg-brand-dark text-on-brand' : 'bg-mist text-ink']" @click="state = s.v">{{ s.l }}</button>
        </div>
        <div class="flex items-center gap-3 text-xs">
          <RouterLink to="/kiosk/quality" class="font-medium text-brand-dark hover:underline">Quality (F1)</RouterLink>
          <button type="button" class="inline-flex items-center gap-1 hover:text-ink" @click="loadList"><RefreshCw class="size-3.5" aria-hidden="true" /> Refresh</button>
        </div>
      </div>
      <p v-if="items && !items.length" class="text-sm text-gray-400">Nothing here. Answers appear when someone taps "Ask a moderator to check this answer" in the kiosk.</p>
      <ul class="space-y-2">
        <li v-for="it in items ?? []" :key="it.answer.id">
          <button type="button" class="card block w-full p-4 text-left hover:ring-2 hover:ring-brand/30" @click="open(it.answer.id)">
            <p class="font-medium text-ink">{{ it.answer.question }}</p>
            <p class="mt-1 text-xs text-gray-500">
              {{ when(it.answer.created_at) }} · {{ it.answer.notebook?.title ?? "No notebook" }} · {{ it.answer.refs.length }} source{{ it.answer.refs.length === 1 ? "" : "s" }} cited
              <template v-if="it.review"> · <strong class="text-ink">{{ RATINGS[it.review.rating] }}</strong> by {{ it.review.moderator_name }}</template>
            </p>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>
