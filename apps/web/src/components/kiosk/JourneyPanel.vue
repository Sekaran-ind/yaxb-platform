<script setup lang="ts">
// Runs a journey on yaxb-core's journey engine. Each step is a question for the visitor or a
// service: the assistant, an on-device model, or the notebook (handlers from the shell).
// A question can also be answered in the visitor's own words: slot filling reads them into the
// form's fields as suggestions to check (lib/browser/slots), never as answers given for them.
// A catalogue journey runs as the person at the kiosk (their roles): when it reaches a screen another
// role answers, or ends with roles that finish it, it is handed over as a case (LIB-33..38), and the
// visitor gets its reference. `resume` carries on a case from where it stopped, as its next person.
import { createRunner, type Journey, type RunState, type ServiceHandler, type SlotConfirm, type SlotVia } from "@sekaran-ind/yaxb-core/journeys";
import { progressOf, summarizeJourney, summarizeRun } from "@sekaran-ind/yaxb-core/journeys";
import { ArrowLeft, CheckCircle2, Circle, Copy, Loader2, Mic, MicOff, NotebookPen, RotateCcw, Sparkles, Square, Volume2, Wand2, XCircle } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { effectiveSelection, settings, useProviders } from "@/composables/settings";
import { useSpeechInput } from "@/composables/speech";
import { extractWithModel, matchOnDevice } from "@/lib/browser/slots";
import type { NotebookRecord } from "@/lib/browser/store";
import { cn } from "@/lib/cn";
import { speechLangFor } from "@/lib/languages";
import JourneyField from "./JourneyField.vue";
import { kioskActor, roleName } from "@/composables/library";
import { actCase, deliveryText, resendCase, startCase, type CaseDetail } from "@/composables/cases";
import type { CaseSummary, Delivery } from "@sekaran-ind/yaxb-core/cases";

const props = defineProps<{
  journey: Journey;
  services: Record<string, ServiceHandler>;
  notebook: NotebookRecord | null;
  /** The catalogue entry the journey is from: it can then be handed over between roles. */
  entry?: string | null;
  /** A case to carry on (from the work queue, or a visitor's reference). */
  resume?: CaseDetail | null;
  backLabel?: string;
}>();
const emit = defineEmits<{ close: []; speak: [text: string]; done: []; handed: [c: CaseSummary] }>();

const state = shallowRef<RunState | null>(null);
const handsOver = computed(() => Boolean(props.resume || props.entry));
const runner = createRunner(props.journey, {
  services: props.services,
  onChange: (s) => (state.value = s),
  ...(handsOver.value ? { actor: props.resume?.actor ?? kioskActor.value } : {}),
});

// ---- hand-over (LIB-33..38) ---------------------------------------------------------------------
const finishers = computed(() => (props.journey.roles?.complete ?? []).filter((r) => r !== "visitor"));
const handed = ref<CaseSummary | null>(null);
/** How far it got when the kiosk keeps requests on its devices (LIB-43..45). */
const delivery = ref<Delivery | null>(null);
const handing = ref(false);
const handError = ref<string | null>(null);
/** Store the run: a new case, or this person's part of the case being resumed. */
async function handOver() {
  if (handing.value || handed.value) return;
  handing.value = true;
  handError.value = null;
  const snap = runner.snapshot();
  try {
    let r: { case: CaseSummary; delivery: Delivery | null };
    if (props.resume) {
      const before = props.resume.case.run;
      const answers = Object.fromEntries(Object.entries(snap.answers).filter(([k]) => !Object.hasOwn(before.answers, k)));
      const steps = Object.fromEntries(Object.entries(snap.steps).filter(([k]) => !Object.hasOwn(before.steps, k)));
      // Opened where it isn't this person's turn: nothing of theirs to send.
      if (!Object.keys(answers).length) return;
      r = await actCase(props.resume, answers, steps);
    } else r = await startCase(props.entry!, props.journey.id, snap.answers, snap.steps);
    handed.value = r.case;
    delivery.value = r.delivery;
    emit("handed", r.case);
  } catch (e) {
    handError.value = (e as Error).message;
  } finally {
    handing.value = false;
  }
}
const resending = ref(false);
async function sendAgain() {
  if (!handed.value) return;
  resending.value = true;
  try {
    delivery.value = (await resendCase(handed.value.id)) ?? delivery.value;
  } finally {
    resending.value = false;
  }
}
/** Who it went to, in words. */
const handedTo = computed(() => {
  const c = handed.value;
  if (!c) return "";
  if (c.status === "waiting") return c.waiting_role ? roleName(c.waiting_role) : "the person who started it";
  if (c.status === "to_finish") return c.finish_roles.map(roleName).join(" or ");
  return "";
});
const values = ref<Record<string, unknown>>({});
const problems = ref<string[]>([]);
const copied = ref(false);

/** Who finishes this journey (its roles.complete), to tell the visitor who takes it from here. */
const completers = computed(() => (props.journey.roles?.complete ?? []).map(roleName));
const promptStep = computed(() => state.value?.prompt?.step ?? null);
const currentLabel = computed(() => (state.value?.current ? (props.journey.steps[state.value.current]?.label ?? state.value.current) : ""));

// ---- summaries (JRN-20, JRN-22) ---------------------------------------------------------------
const about = computed(() => summarizeJourney(props.journey));
const run = computed(() => (state.value?.status === "done" ? summarizeRun(props.journey, state.value) : null));
const saved = ref<string | null>(null);
async function saveRun() {
  const add = props.services["notebook.add"];
  if (!run.value || !add) return;
  try {
    const final = Object.values(props.journey.steps).find((s) => s.final) ?? props.journey.steps[props.journey.start]!;
    await add({ title: `${props.journey.title} (${new Date().toLocaleDateString()})`, text: run.value.markdown }, { journey: props.journey, step: final, scope: { answers: state.value?.answers ?? {} } });
    saved.value = "Saved to your notebook.";
  } catch (e) {
    saved.value = (e as Error).message;
  }
}

// ---- slot filling -----------------------------------------------------------------------------
const said = ref("");
const suggested = ref<Record<string, SlotVia>>({});
const confirms = ref<SlotConfirm[]>([]);
const missing = ref<string[]>([]);
const slotBusy = ref(false);
const slotNote = ref<string | null>(null);
const { data: catalog } = useProviders();
const selection = computed(() => effectiveSelection(settings, catalog.value));
const stepFields = computed(() => (promptStep.value ? (props.journey.steps[promptStep.value]?.fields ?? []) : []));
const labelOf = (id: string) => stepFields.value.find((f) => f.id === id)?.label ?? id;
const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || v === false;

// A new question starts from its fields' defaults.
watch(promptStep, (step) => {
  const fields = step ? (props.journey.steps[step]?.fields ?? []) : [];
  values.value = Object.fromEntries(fields.map((f) => [f.id, f.default ?? (f.type === "boolean" ? false : "")]));
  problems.value = [];
  said.value = "";
  suggested.value = {};
  confirms.value = [];
  missing.value = [];
  slotNote.value = null;
});

/** Suggestions go into empty fields, or ones filled by an earlier suggestion, never over what the visitor typed. */
function applyFills(fills: { field: string; value: unknown; via: SlotVia }[]) {
  const next = { ...values.value };
  const marks = { ...suggested.value };
  let n = 0;
  for (const f of fills) {
    if (!isEmpty(next[f.field]) && !marks[f.field]) continue;
    next[f.field] = typeof f.value === "number" ? String(f.value) : f.value;
    marks[f.field] = f.via;
    n++;
  }
  values.value = next;
  suggested.value = marks;
  missing.value = missing.value.filter((id) => isEmpty(next[id]));
  return n;
}

async function fillFromWords() {
  const text = said.value.trim();
  if (!text || !stepFields.value.length) return;
  slotBusy.value = true;
  slotNote.value = null;
  try {
    const m = await matchOnDevice(stepFields.value, text, settings.agent);
    const n = applyFills(m.fills);
    confirms.value = m.confirm;
    missing.value = m.missing.filter((id) => isEmpty(values.value[id]));
    slotNote.value =
      n || m.confirm.length ? `Filled ${n} field${n === 1 ? "" : "s"} from what you said. Check them before you continue.` : "Nothing in that matched this form. You can fill it in below.";
  } catch (e) {
    slotNote.value = `Couldn't read that on this device: ${(e as Error).message}`;
  } finally {
    slotBusy.value = false;
  }
}

async function fillWithModel() {
  if (!selection.value || !promptStep.value) return;
  slotBusy.value = true;
  try {
    const fills = await extractWithModel(props.journey.id, promptStep.value, said.value.trim(), selection.value);
    const n = applyFills(fills);
    slotNote.value = n ? `The assistant filled ${n} more field${n === 1 ? "" : "s"}. Check them before you continue.` : "The assistant found nothing more for this form.";
  } catch (e) {
    slotNote.value = (e as Error).message;
  } finally {
    slotBusy.value = false;
  }
}

function pick(c: SlotConfirm, value: string) {
  applyFills([{ field: c.field, value, via: "label" }]);
  confirms.value = confirms.value.filter((x) => x !== c);
}

function onFieldChange(id: string, v: unknown) {
  values.value = { ...values.value, [id]: v };
  // The visitor's own edit: no longer a suggestion.
  const rest = { ...suggested.value };
  delete rest[id];
  suggested.value = rest;
}

const voice = useSpeechInput(
  (text) => {
    said.value = said.value ? `${said.value} ${text}` : text;
    void fillFromWords();
  },
  () => speechLangFor(settings.agent.language),
);

// Tell the shell when the journey finishes (the activity log records that a service was used), and
// hand it over when it now needs someone else.
watch(
  () => state.value?.status,
  (s) => {
    if (s === "done") emit("done");
    if (!handsOver.value) return;
    if (s === "waiting" || (s === "done" && (props.resume || finishers.value.length))) void handOver();
  },
);

async function submit() {
  const r = await runner.answer(values.value);
  if ("problems" in r) problems.value = r.problems;
}
async function copy() {
  if (!state.value?.result) return;
  await navigator.clipboard.writeText(state.value.result.text).catch(() => undefined);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
const restart = () => {
  handed.value = null;
  delivery.value = null;
  handError.value = null;
  void (props.resume ? runner.resume(props.resume.case.run, props.resume.actor) : runner.start());
};

onMounted(restart);
onBeforeUnmount(() => {
  if (runner.state.status === "running") runner.stop();
});
</script>

<template>
  <div class="space-y-4">
    <div>
      <button type="button" class="btn-ghost -ml-2 h-9 px-2 text-sm" @click="emit('close')"><ArrowLeft class="size-4" aria-hidden="true" /> {{ backLabel ?? "Services" }}</button>
      <h3 class="mt-1 text-lg font-semibold text-ink">{{ journey.title }}</h3>
      <p v-if="journey.summary" class="text-sm text-gray-600">{{ journey.summary }}</p>
      <p class="mt-1 text-xs text-gray-500">{{ about.privacy }}</p>
    </div>

    <ol v-if="state && (state.trail.length || state.status === 'running' || state.status === 'asking')" class="flex flex-wrap gap-2 text-xs" aria-label="Progress">
      <li v-for="(t, i) in progressOf(journey, state.trail)" :key="`${t.step}-${i}`" :class="cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1', t.ok ? 'bg-success/10 text-ink' : 'bg-danger/10 text-red-800')">
        <CheckCircle2 v-if="t.ok" class="size-3.5" aria-hidden="true" /><XCircle v-else class="size-3.5" aria-hidden="true" />{{ t.label }}
      </li>
      <li v-if="state.status === 'running'" class="inline-flex items-center gap-1 rounded-full bg-info/10 px-2.5 py-1 text-info"><Loader2 class="size-3.5 animate-spin" aria-hidden="true" /> {{ currentLabel }}</li>
      <li v-if="state.status === 'asking'" class="inline-flex items-center gap-1 rounded-full bg-mist px-2.5 py-1 text-gray-600"><Circle class="size-3.5" aria-hidden="true" /> {{ currentLabel }}</li>
    </ol>

    <form v-if="state?.status === 'asking' && state.prompt" class="card space-y-3 p-4" @submit.prevent="submit">
      <p class="font-medium text-ink">{{ state.prompt.text }}</p>
      <div v-if="state.prompt.fields.some((f) => f.type !== 'source')" class="space-y-2 rounded-lg bg-mist p-3">
        <label for="journey-said" class="block text-sm font-medium text-ink">Say or type it in your own words</label>
        <div class="flex gap-2">
          <textarea id="journey-said" v-model="said" class="input min-h-16" placeholder="e.g. I'm Ravi from Chennai, I've had a bad cough for 3 days" @keydown.enter.exact.prevent="fillFromWords" />
          <div class="flex flex-col gap-2">
            <button v-if="voice.supported.value" type="button" class="btn-light px-3" :aria-label="voice.listening.value ? 'Stop listening' : 'Speak'" @click="voice.listening.value ? voice.stop() : voice.start()">
              <MicOff v-if="voice.listening.value" class="size-4" aria-hidden="true" /><Mic v-else class="size-4" aria-hidden="true" />
            </button>
            <button type="button" class="btn-light px-3" :disabled="slotBusy || !said.trim()" aria-label="Fill the form from this" title="Fill the form from this" @click="fillFromWords">
              <Loader2 v-if="slotBusy" class="size-4 animate-spin" aria-hidden="true" /><Wand2 v-else class="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <p v-if="voice.interim.value" class="text-xs text-gray-500">{{ voice.interim.value }}</p>
        <p v-if="slotNote" role="status" class="text-sm text-ink">{{ slotNote }}</p>
        <div v-for="c in confirms" :key="c.field" class="flex flex-wrap items-center gap-2 text-sm">
          <span class="text-gray-600">{{ c.label }}: which one?</span>
          <button v-for="o in c.options" :key="o.value" type="button" class="rounded-full bg-surface px-3 py-1 text-ink shadow-sm ring-1 ring-gray-200 hover:ring-brand" @click="pick(c, o.value)">{{ o.label }}</button>
        </div>
        <button v-if="missing.length && selection && said.trim()" type="button" class="inline-flex items-center gap-1 text-sm font-medium text-brand-dark hover:underline" :disabled="slotBusy" @click="fillWithModel">
          <Sparkles class="size-4" aria-hidden="true" /> Fill the rest with the assistant ({{ missing.map(labelOf).join(", ") }})
        </button>
      </div>
      <JourneyField
        v-for="f in state.prompt.fields"
        :key="`${state.prompt.step}-${f.id}`"
        :field="f"
        :value="values[f.id]"
        :notebook="notebook"
        :suggested="suggested[f.id]"
        @change="(v) => onFieldChange(f.id, v)"
      />
      <p v-if="problems.length" role="alert" class="text-sm text-red-800">{{ problems.join(" ") }}</p>
      <div class="flex justify-end"><button type="submit" class="btn-primary">{{ state.prompt.submitLabel ?? "Continue" }}</button></div>
    </form>

    <div v-if="state?.status === 'running'" class="flex items-center justify-between rounded-lg bg-info/5 px-4 py-3 text-sm text-ink">
      <span class="flex items-center gap-2"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Working on it… the first use of an on-device model downloads it.</span>
      <button type="button" class="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-ink" @click="runner.stop()"><Square class="size-3.5" aria-hidden="true" /> Stop</button>
    </div>

    <!-- Handed over: the reference, and who has it now. -->
    <div v-if="handing || handed || handError" class="card space-y-3 p-4" aria-live="polite">
      <p v-if="handing" class="flex items-center gap-2 text-sm text-ink"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Handing it over…</p>
      <template v-else-if="handed">
        <!-- The journey ended and goes to those who close it: the result is still the visitor's to read. -->
        <template v-if="state?.status === 'done' && state.result">
          <h4 class="font-semibold text-ink">{{ state.result.title }}</h4>
          <p v-if="state.result.text" class="leading-relaxed whitespace-pre-wrap text-ink">{{ state.result.text }}</p>
        </template>
        <h4 v-else class="font-semibold text-ink">{{ handed.status === "done" ? "Done" : `Sent to ${handedTo}` }}</h4>
        <p v-if="handed.status !== 'done'" class="text-sm text-ink">
          <template v-if="handed.status === 'waiting' && !handed.waiting_role">It goes back to the person who started it. They carry on with this reference.</template>
          <template v-else-if="handed.status === 'to_finish'">{{ handedTo }} closes it when it is done.</template>
          <template v-else>It is in {{ handedTo }}'s work queue. They carry on from here.</template>
        </p>
        <div class="flex flex-wrap items-center gap-3 rounded-lg bg-mist px-3 py-2">
          <span class="text-sm text-gray-600">Reference</span>
          <span class="font-mono text-lg font-semibold tracking-wider text-ink">{{ handed.ref }}</span>
          <button type="button" class="btn-ghost h-8 px-2 text-xs" @click="emit('speak', `Your reference is ${handed.ref.split('').join(' ')}`)"><Volume2 class="size-3.5" aria-hidden="true" /> Read it out</button>
        </div>
        <!-- Kept on devices: how far it got, and send it again when nobody could take it. -->
        <div v-if="delivery" class="flex flex-wrap items-center gap-2 text-sm" :class="delivery.state === 'not-sent' || delivery.state === 'expired' ? 'caution rounded-lg px-3 py-2' : 'text-gray-700'" role="status">
          <span class="min-w-0 flex-1">{{ deliveryText(delivery) }}</span>
          <button v-if="delivery.state === 'not-sent' || delivery.state === 'expired'" type="button" class="btn-light h-8 px-3 text-xs" :disabled="resending" @click="sendAgain">
            <Loader2 v-if="resending" class="size-3.5 animate-spin" aria-hidden="true" /><RotateCcw v-else class="size-3.5" aria-hidden="true" /> Send it again
          </button>
        </div>
        <p v-if="!resume" class="text-xs text-gray-500">Keep the reference: under Services, “Check a request” shows where it is and lets you add a note.</p>
        <div class="flex flex-wrap gap-2">
          <button v-if="run && services['notebook.add']" type="button" class="btn-light" @click="saveRun"><NotebookPen class="size-4" aria-hidden="true" /> Save to notebook</button>
          <button type="button" class="btn-primary ml-auto" @click="emit('close')">Done</button>
        </div>
        <p v-if="saved" role="status" class="text-sm text-ink">{{ saved }}</p>
      </template>
      <div v-else-if="handError" role="alert" class="space-y-2 text-sm text-red-800">
        <p>It couldn't be handed over: {{ handError }}</p>
        <button type="button" class="btn-light" @click="handOver"><RotateCcw class="size-4" aria-hidden="true" /> Try again</button>
      </div>
    </div>

    <div v-if="state?.status === 'done' && state.result && !handed && !handing" class="card space-y-3 p-4">
      <h4 class="font-semibold text-ink">{{ state.result.title }}</h4>
      <p class="leading-relaxed whitespace-pre-wrap text-ink">{{ state.result.text }}</p>
      <p v-if="completers.length && !handsOver" class="rounded-lg bg-info/10 px-3 py-2 text-sm text-ink">Next: {{ completers.join(" or ") }} will complete this with you.</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-light" @click="emit('speak', state.result.text)"><Volume2 class="size-4" aria-hidden="true" /> Read aloud</button>
        <button type="button" class="btn-light" @click="copy"><Copy class="size-4" aria-hidden="true" /> {{ copied ? "Copied" : "Copy" }}</button>
        <button type="button" class="btn-light" @click="restart"><RotateCcw class="size-4" aria-hidden="true" /> Start again</button>
        <button v-if="run && services['notebook.add']" type="button" class="btn-light" @click="saveRun"><NotebookPen class="size-4" aria-hidden="true" /> Save to notebook</button>
        <button type="button" class="btn-primary ml-auto" @click="emit('close')">Done</button>
      </div>
      <p v-if="saved" role="status" class="text-sm text-ink">{{ saved }}</p>
      <details v-if="run && (run.answers.length || run.steps.length)" class="rounded-lg bg-mist px-3 py-2 text-sm">
        <summary class="cursor-pointer font-medium text-ink">What this service did</summary>
        <ol class="mt-2 space-y-1">
          <li v-for="(st, i) in run.steps" :key="i" class="flex items-center gap-2"><CheckCircle2 v-if="st.ok" class="size-4 text-success" aria-hidden="true" /><XCircle v-else class="size-4 text-danger" aria-hidden="true" />{{ st.label }}</li>
        </ol>
        <dl v-if="run.answers.length" class="mt-2 grid gap-x-4 gap-y-1 @lg:grid-cols-[auto_1fr]">
          <template v-for="(a, i) in run.answers" :key="i"><dt class="text-gray-500">{{ a.field }}</dt><dd class="text-ink">{{ a.value }}</dd></template>
        </dl>
      </details>
    </div>

    <div v-if="state?.status === 'failed'" role="alert" class="space-y-2 rounded-lg bg-danger/10 px-4 py-3 text-sm text-red-800">
      <p>{{ state.error }}</p>
      <button type="button" class="btn-light" @click="restart"><RotateCcw class="size-4" aria-hidden="true" /> Start again</button>
    </div>
  </div>
</template>
