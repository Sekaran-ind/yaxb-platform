<script setup lang="ts">
// One case (LIB-33..38): a catalogue journey handed between people. It shows where the journey is,
// the answers so far, and its thread (who did what, and notes). Whoever's turn it is carries on in
// the journey panel from where it stopped; a finisher closes it; the role whose turn it is, a
// finisher or an administrator may decline it with a reason, which the person who started it reads.
import { summarizeRun, type RunState } from "@sekaran-ind/yaxb-core/journeys";
import type { ServiceHandler } from "@sekaran-ind/yaxb-core/journeys";
import { ArrowLeft, Check, CheckCircle2, Loader2, MessageSquare, Play, RotateCcw, Send, XCircle } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import JourneyPanel from "./JourneyPanel.vue";
import RequestStatus from "./RequestStatus.vue";
import { addNote, deliveryText, finishCase, openCase, refreshQueue, resendCase, statusText, type CaseDetail } from "@/composables/cases";
import { roleName } from "@/composables/library";
import type { NotebookRecord } from "@/lib/browser/store";

const props = defineProps<{ caseKey: string; services: Record<string, ServiceHandler>; notebook: NotebookRecord | null }>();
const emit = defineEmits<{ back: []; speak: [text: string] }>();

const detail = ref<CaseDetail | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const continuing = ref(false);
const note = ref("");
const closing = ref<"done" | "declined" | null>(null);
const closeNote = ref("");

async function load() {
  error.value = null;
  try {
    detail.value = await openCase(props.caseKey);
  } catch (e) {
    detail.value = null;
    error.value = (e as Error).message;
  }
}
watch(() => props.caseKey, load, { immediate: true });

const c = computed(() => detail.value?.case ?? null);
/** A visitor's case is theirs by its reference; everyone else uses its id. */
const key = computed(() => (c.value && detail.value?.actor.starter && c.value.started_by.startsWith("guest:") ? c.value.ref : (c.value?.id ?? props.caseKey)));
const closed = computed(() => c.value?.status === "done" || c.value?.status === "declined");
const waitingLabel = computed(() => (c.value?.waiting_step ? (c.value.journey.steps[c.value.waiting_step]?.label ?? c.value.waiting_step) : ""));
/** The answers so far, as the journey shows them (passwords are never stored). */
const run = computed(() => {
  const x = c.value;
  if (!x) return null;
  const state: RunState = { status: x.result ? "done" : "asking", current: x.run.current, waiting: null, prompt: null, answers: x.run.answers, steps: x.run.steps, trail: x.run.trail, result: x.result, error: null };
  return summarizeRun(x.journey, state);
});

/** What the last action did (role="status"). */
const notice = ref<string | null>(null);
async function act(fn: () => Promise<unknown>, done: () => string) {
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    await fn();
    notice.value = done();
    await load();
    void refreshQueue();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const sendNote = () =>
  act(async () => {
    await addNote(key.value, note.value);
    note.value = "";
  }, () => "Your note is added.");
const close = () =>
  act(async () => {
    await finishCase(key.value, closing.value!, closeNote.value);
    closeNote.value = "";
  }, () => {
    const msg = closing.value === "done" ? "Marked done." : "Declined.";
    closing.value = null;
    return `${msg} The person who started it reads this with the reference.`;
  });
function onHanded() {
  void refreshQueue();
}
async function backFromJourney() {
  continuing.value = false;
  await load();
}

/** Where it stands, from this viewer's side: their turn is "Waiting for you". */
const standing = computed(() => {
  const x = c.value;
  if (!x) return "";
  const step = x.status === "waiting" && waitingLabel.value ? `: ${waitingLabel.value}` : "";
  if (x.status === "waiting" && detail.value?.turn) return `Waiting for you${step}`;
  return statusText(x, roleName) + step;
});
/** Who has it now, for "nothing for you to do yet". */
const holder = computed(() => {
  const x = c.value;
  if (!x) return "";
  if (x.status === "waiting") return x.waiting_role ? roleName(x.waiting_role) : "The person who started it";
  return x.finish_roles.map(roleName).join(" or ");
});
/** The thread names the person reading it "You"; a visitor is never "Guest" (older events said so). */
function who(e: { actor_id: string; actor_name: string }): string {
  if (detail.value?.actor.starter && e.actor_id === c.value?.started_by) return "You";
  return e.actor_id.startsWith("guest:") ? "Visitor" : e.actor_name;
}

const KIND: Record<string, string> = { note: "wrote", finished: "marked it done", declined: "declined it", reassigned: "reassigned it" };

// Kept on devices (LIB-43..45): how far this device's last hand-over got, and send it again.
const lastDelivery = computed(() => detail.value?.deliveries?.[0] ?? null);
const stuck = computed(() => lastDelivery.value?.state === "expired" || lastDelivery.value?.state === "not-sent");
const resending = ref(false);
async function sendAgain() {
  if (!c.value) return;
  resending.value = true;
  try {
    await resendCase(c.value.id);
    await load();
  } finally {
    resending.value = false;
  }
}
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
</script>

<template>
  <JourneyPanel
    v-if="continuing && detail && c"
    :journey="c.journey"
    :services="services"
    :notebook="notebook"
    :resume="detail"
    :back-label="`Back to ${c.ref}`"
    @close="backFromJourney"
    @handed="onHanded"
    @speak="(t) => emit('speak', t)"
  />

  <section v-else class="space-y-4" aria-label="Request">
    <div class="flex items-center justify-between gap-2">
      <button type="button" class="btn-ghost -ml-2 h-10 px-2 text-sm" @click="emit('back')"><ArrowLeft class="size-4" aria-hidden="true" /> Services</button>
      <button v-if="c" type="button" class="btn-ghost h-10 px-3 text-sm" :disabled="busy" @click="load"><RotateCcw class="size-4" aria-hidden="true" /> Refresh</button>
    </div>
    <p v-if="error && !c" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <p v-else-if="!c" role="status" class="flex items-center gap-2 text-sm text-gray-600"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Opening the request…</p>

    <template v-else>
      <div>
        <p class="text-xs text-gray-500">{{ c.service_title }} · Reference <span class="font-mono font-medium text-ink">{{ c.ref }}</span></p>
        <h3 class="text-lg font-semibold text-ink">{{ c.journey_title }}</h3>
        <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600"><RequestStatus :status="c.status" /> {{ standing }}</p>
      </div>

      <!-- What this person can do now: one primary (Carry on, or Mark it done); Decline is quiet and last. -->
      <div v-if="!closed && (detail!.turn || detail!.mayFinish || detail!.mayDecline)" class="card space-y-3 p-4">
        <template v-if="!closing">
          <p class="text-sm text-ink">
            <template v-if="detail!.turn && c.status === 'waiting'">It's your turn: <span class="font-medium">{{ waitingLabel }}</span>.</template>
            <template v-else-if="detail!.mayFinish">The journey has ended. Mark it done when it is; the person who started it reads your note.</template>
            <template v-else>{{ holder }} has it now. You may decline it, with a reason.</template>
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <button v-if="detail!.turn && c.status === 'waiting'" type="button" class="btn-primary" @click="continuing = true"><Play class="size-4" aria-hidden="true" /> Carry on</button>
            <button v-if="detail!.mayFinish" type="button" class="btn-primary" :disabled="busy" @click="closing = 'done'"><Check class="size-4" aria-hidden="true" /> Mark it done</button>
            <button v-if="detail!.mayDecline" type="button" class="btn-ghost ml-auto" :disabled="busy" @click="closing = 'declined'"><XCircle class="size-4" aria-hidden="true" /> Decline</button>
          </div>
        </template>
        <form v-else class="space-y-2" @submit.prevent="close">
          <label for="case-close-note" class="block text-sm font-medium text-ink">{{ closing === "done" ? "A note for the person who started it (optional)" : `Why you decline ${c.ref} (the person who started it reads this)` }}</label>
          <textarea id="case-close-note" v-model="closeNote" class="input min-h-16" maxlength="1000" :required="closing === 'declined'" />
          <div class="flex flex-wrap gap-2">
            <button type="submit" class="btn-primary" :disabled="busy || (closing === 'declined' && !closeNote.trim())">
              <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" />{{ closing === "done" ? "Mark it done" : "Decline it" }}
            </button>
            <button type="button" class="btn-ghost" @click="closing = null">Cancel</button>
          </div>
        </form>
      </div>
      <p v-else-if="!closed" class="rounded-lg bg-mist px-3 py-2 text-sm text-gray-700">
        {{ holder }} has it now<template v-if="c.status === 'to_finish'">, to close it</template>. Nothing for you to do yet<template v-if="detail!.actor.starter">: come back with your reference, {{ c.ref }}</template>.
      </p>

      <div v-if="lastDelivery && !closed" class="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm" :class="stuck ? 'caution' : 'bg-mist text-gray-700'" role="status">
        <span class="min-w-0 flex-1">{{ deliveryText(lastDelivery) }}</span>
        <button v-if="stuck" type="button" class="btn-light h-10 px-3 text-sm" :disabled="resending" @click="sendAgain">
          <Loader2 v-if="resending" class="size-4 animate-spin" aria-hidden="true" /><RotateCcw v-else class="size-4" aria-hidden="true" /> Send it again
        </button>
      </div>

      <div v-if="c.result" class="card space-y-1 p-4">
        <h4 class="font-semibold text-ink">{{ c.result.title }}</h4>
        <p v-if="c.result.text" class="text-sm whitespace-pre-wrap text-ink">{{ c.result.text }}</p>
      </div>

      <details v-if="run && (run.answers.length || run.steps.length)" class="rounded-lg bg-mist px-3 py-2 text-sm" open>
        <summary class="cursor-pointer py-1 font-medium text-ink">The answers so far</summary>
        <ol class="mt-2 flex flex-wrap gap-2 text-xs" aria-label="Screens done">
          <li v-for="(st, i) in run.steps" :key="i" class="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-ink">
            <CheckCircle2 v-if="st.ok" class="size-3.5 text-success" aria-hidden="true" /><XCircle v-else class="size-3.5 text-danger" aria-hidden="true" />{{ st.label }}
          </li>
        </ol>
        <dl v-if="run.answers.length" class="mt-2 grid gap-x-4 gap-y-1 @lg:grid-cols-[auto_1fr]">
          <template v-for="(a, i) in run.answers" :key="i"><dt class="text-gray-500">{{ a.field }}</dt><dd class="mb-1 text-ink @lg:mb-0">{{ a.value }}</dd></template>
        </dl>
      </details>

      <!-- The thread: oldest first, like a conversation, with the composer at its end. -->
      <section aria-labelledby="case-thread" class="space-y-2">
        <h4 id="case-thread" class="flex items-center gap-2 text-sm font-semibold text-ink"><MessageSquare class="size-4 text-brand" aria-hidden="true" /> What happened</h4>
        <ol class="space-y-2">
          <li v-for="e in detail!.events" :key="e.id" class="rounded-lg px-3 py-2 text-sm" :class="e.kind === 'note' ? 'bg-surface ring-1 ring-gray-200' : 'bg-mist'">
            <!-- Started and answered name the screens in the line itself; notes and closing words follow it. -->
            <p v-if="e.kind === 'started' || e.kind === 'answered'" class="text-ink">
              <span class="font-medium">{{ who(e) }}</span> {{ e.kind === "started" ? (e.text ? "started it, answering" : "started it") : "answered" }} {{ e.text }}
              <span class="text-xs text-gray-500">· {{ when(e.at) }}</span>
            </p>
            <template v-else>
              <p class="text-xs text-gray-500"><span class="font-medium text-ink">{{ who(e) }}</span> {{ KIND[e.kind] }} · {{ when(e.at) }}</p>
              <p v-if="e.text" class="mt-0.5 whitespace-pre-wrap text-ink">{{ e.text }}</p>
            </template>
          </li>
        </ol>
        <form v-if="!closed" class="space-y-2" @submit.prevent="sendNote">
          <label for="case-note" class="block text-sm font-medium text-ink">Add a note</label>
          <textarea id="case-note" v-model="note" class="input min-h-16" maxlength="1000" aria-describedby="case-note-help" />
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p id="case-note-help" class="text-xs text-gray-500">Everyone on this request reads it.</p>
            <button type="submit" class="btn-light" :disabled="busy || !note.trim()"><Send class="size-4" aria-hidden="true" /> Add the note</button>
          </div>
        </form>
      </section>

      <p v-if="notice" role="status" class="text-sm text-ink">{{ notice }}</p>
      <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    </template>
  </section>
</template>
