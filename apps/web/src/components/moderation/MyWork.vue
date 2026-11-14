<script setup lang="ts">
// My work (WRK-1..3), one page for moderators and reviewers: the requests waiting for one of their
// roles (journeys handed over to them), the requests they started, the escalated questions still
// open, and the answers people asked a moderator to check. Each opens where the work is done.
import type { ModerationItem } from "@sekaran-ind/yaxb-core/stores";
import type { ReviewAnswer } from "@sekaran-ind/yaxb-core/reviews";
import { ArrowRight, Inbox, Loader2, MessageSquareWarning, RotateCcw, ShieldCheck } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import ModeratorSignIn from "./ModeratorSignIn.vue";
import RequestList from "@/components/kiosk/RequestList.vue";
import { caseQueue, refreshQueue } from "@/composables/cases";
import { kioskViewer, roleName } from "@/composables/library";
import { api, ApiError } from "@/lib/api";

const router = useRouter();
const questions = ref<ModerationItem[]>([]);
const answers = ref<ReviewAnswer[]>([]);
const signedOut = ref(false);
const loading = ref(true);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    await refreshQueue().catch(() => undefined);
    const [q, a] = await Promise.all([
      api<{ items: ModerationItem[] }>("/api/agent/moderation?state=open"),
      api<{ items: ReviewAnswer[] }>("/api/reviews/answers?state=open"),
    ]);
    questions.value = q.items;
    answers.value = a.items;
    signedOut.value = false;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) signedOut.value = true;
    else error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const mine = computed(() => caseQueue.value.mine);
const started = computed(() => caseQueue.value.started);
const roles = computed(() => kioskViewer.value.roles.map(roleName).join(", "));
const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const openCase = (ref: string) => void router.push({ path: "/kiosk", query: { screen: "services", case: ref } });
const openStaff = (staff: string) => void router.push({ path: "/kiosk", query: { screen: "services", staff } });
const total = computed(() => mine.value.length + questions.value.length + answers.value.length);
</script>

<template>
  <section class="space-y-6" aria-labelledby="work-title">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 id="work-title" class="text-lg font-semibold text-ink">My work</h2>
        <p class="text-sm text-gray-600">
          <template v-if="loading">Gathering what waits for you…</template>
          <template v-else-if="!signedOut">{{ total ? `${total} thing${total === 1 ? "" : "s"} waiting for you` : "Nothing is waiting for you." }}<template v-if="roles"> · as {{ roles }}</template></template>
        </p>
      </div>
      <button type="button" class="btn-ghost h-10 px-3 text-sm" :disabled="loading" @click="load"><RotateCcw class="size-4" aria-hidden="true" /> Refresh</button>
    </div>

    <ModeratorSignIn v-if="signedOut" why="Moderators and reviewers: sign in with your key to see your work." @signed-in="load" />
    <p v-else-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <p v-else-if="loading" role="status" class="flex items-center gap-2 text-sm text-gray-600"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Loading…</p>

    <template v-else>
      <!-- Requests: journeys handed to one of your roles -->
      <div class="space-y-2">
        <h3 class="flex items-center gap-2 font-semibold text-ink"><Inbox class="size-4 text-brand" aria-hidden="true" /> Requests for you <span class="text-sm font-normal text-gray-500">{{ mine.length }}</span></h3>
        <RequestList v-if="mine.length" :items="mine" @open="openCase" />
        <p v-else class="rounded-xl bg-mist px-3 py-2 text-sm text-gray-600">No request is waiting for your roles.</p>
        <details v-if="started.length" class="text-sm">
          <summary class="cursor-pointer text-gray-600">Requests you started ({{ started.length }})</summary>
          <div class="mt-2"><RequestList :items="started" @open="openCase" /></div>
        </details>
      </div>

      <!-- Escalated questions -->
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h3 class="flex items-center gap-2 font-semibold text-ink"><MessageSquareWarning class="size-4 text-brand" aria-hidden="true" /> Questions to look at <span class="text-sm font-normal text-gray-500">{{ questions.length }}</span></h3>
          <button v-if="questions.length" type="button" class="btn-ghost h-9 px-2 text-sm" @click="openStaff('moderation')">Moderation queue <ArrowRight class="size-4" aria-hidden="true" /></button>
        </div>
        <ul v-if="questions.length" class="space-y-1.5">
          <li v-for="q in questions.slice(0, 5)" :key="q.id">
            <button type="button" class="w-full rounded-xl bg-mist px-3 py-2 text-left hover:bg-gray-100" @click="openStaff('moderation')">
              <span class="line-clamp-1 block text-sm text-ink">{{ q.question }}</span>
              <span class="block text-xs text-gray-500">{{ q.reason }} · {{ when(q.created_at) }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="rounded-xl bg-mist px-3 py-2 text-sm text-gray-600">No escalated question is open.</p>
      </div>

      <!-- Answers to check -->
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h3 class="flex items-center gap-2 font-semibold text-ink"><ShieldCheck class="size-4 text-brand" aria-hidden="true" /> Answers to check <span class="text-sm font-normal text-gray-500">{{ answers.length }}</span></h3>
          <button v-if="answers.length" type="button" class="btn-ghost h-9 px-2 text-sm" @click="openStaff('review')">Review answers <ArrowRight class="size-4" aria-hidden="true" /></button>
        </div>
        <ul v-if="answers.length" class="space-y-1.5">
          <li v-for="a in answers.slice(0, 5)" :key="a.id">
            <button type="button" class="w-full rounded-xl bg-mist px-3 py-2 text-left hover:bg-gray-100" @click="openStaff('review')">
              <span class="line-clamp-1 block text-sm text-ink">{{ a.question }}</span>
              <span class="block text-xs text-gray-500">{{ a.notebook?.title ?? "Knowledge base" }} · {{ when(a.created_at) }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="rounded-xl bg-mist px-3 py-2 text-sm text-gray-600">No answer is waiting for a check.</p>
      </div>
    </template>
  </section>
</template>
