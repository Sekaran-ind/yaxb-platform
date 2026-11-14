<script setup lang="ts">
// Runs a journey: progress, the current questions (a questionnaire's sections in the adaptive
// nav), services as they run, and the result. Handlers are the host's (or the studio's stand-ins).
// It starts again whenever the journey's definition changes, so an editor's preview stays live.
// With an `actor`, it stops where someone else answers (a screen with another role) and says who
// has it now; "Continue as" hands it to them in place (the preview's way to try a hand-over).
import { createRunner, fieldProblem, fieldVisible, progressOf, roleLabel, type Journey, type Role, type RunActor, type RunState, type Runner, type Scope, type ServiceHandler } from "@sekaran-ind/yaxb-journeys/journeys";
import type { NavMode } from "@sekaran-ind/yaxb-journeys/screens";
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import Glyph from "./Glyph.vue";
import type { LanguageOption, SourceOption } from "./QuestionField.vue";
import QuestionnaireForm from "./QuestionnaireForm.vue";

const props = defineProps<{
  journey: Journey;
  services?: Record<string, ServiceHandler>;
  context?: Scope;
  width: number;
  /** Offer a way out: a back link at the top, and Done at the result. */
  closable?: boolean;
  /** Where the back link goes, e.g. "Services" ("← Services"). */
  backLabel?: string;
  navMode?: NavMode;
  switchable?: boolean;
  /** @deprecated The default now. */
  lockMode?: boolean;
  sources?: SourceOption[];
  languages?: LanguageOption[];
  /** Who is running it; absent: one person answers every screen. */
  actor?: RunActor;
  /** Role names, for "Waiting for …". */
  roles?: readonly Role[];
  /** The name of the person who started it (the preview: "Visitor"). */
  starterLabel?: string;
}>();
const emit = defineEmits<{ close: []; done: [state: RunState]; continueAs: [role: string | null] }>();
const nameOf = (role: string | null) => (role ? roleLabel(role, props.roles) : (props.starterLabel ?? "the person who started it"));
const finishers = computed(() => (props.journey.roles?.complete ?? []).filter((r) => r !== "visitor"));

const state = shallowRef<RunState | null>(null);
const values = ref<Record<string, unknown>>({});
const problems = ref<string[]>([]);
const invalid = ref<string[]>([]);
const copied = ref(false);
const form = ref<InstanceType<typeof QuestionnaireForm> | null>(null);
let runner: Runner | null = null;
let shown = "";

function defaults(step: string | undefined) {
  const fields = step ? (props.journey.steps[step]?.fields ?? []) : [];
  return Object.fromEntries(fields.map((f) => [f.id, f.default ?? (f.type === "boolean" ? false : "")]));
}

function onChange(s: RunState) {
  state.value = s;
  // A new question starts from its fields' defaults.
  const key = s.status === "asking" ? (s.prompt?.step ?? "") : "";
  if (key !== shown) {
    shown = key;
    values.value = defaults(s.prompt?.step);
    problems.value = [];
    invalid.value = [];
  }
  if (s.status === "done") emit("done", s);
}

function start() {
  if (runner?.state.status === "running") runner.stop();
  shown = "";
  runner = createRunner(props.journey, { services: props.services ?? {}, context: props.context ?? {}, onChange, ...(props.actor ? { actor: props.actor } : {}) });
  void runner.start();
}
watch(() => JSON.stringify(props.journey), start, { immediate: true });
// The host switched who is acting (the preview's "View as"): a waiting run carries on as them.
watch(
  () => JSON.stringify(props.actor ?? null),
  () => {
    if (runner && props.actor && state.value?.status === "waiting") void runner.continueAs(props.actor);
  },
);
onBeforeUnmount(() => {
  if (runner?.state.status === "running") runner.stop();
});

const scope = computed<Scope>(() => ({ answers: state.value?.answers ?? {}, steps: state.value?.steps ?? {}, context: props.context ?? {} }));
const currentLabel = computed(() => (state.value?.current ? (props.journey.steps[state.value.current]?.label ?? state.value.current) : ""));

// A marked field is cleared as soon as its answer is fixed.
watch(values, (v) => {
  if (!invalid.value.length) return;
  const fields = state.value?.prompt?.fields ?? [];
  invalid.value = invalid.value.filter((id) => {
    const f = fields.find((x) => x.id === id);
    return f && fieldVisible(f, v, scope.value) && fieldProblem(f, v[id]);
  });
  if (!invalid.value.length) problems.value = [];
});

async function submit() {
  if (!runner || !state.value?.prompt) return;
  const fields = state.value.prompt.fields;
  invalid.value = fields.filter((f) => fieldVisible(f, values.value, scope.value) && fieldProblem(f, values.value[f.id])).map((f) => f.id);
  const r = await runner.answer(values.value);
  if ("problems" in r) {
    problems.value = r.problems;
    form.value?.reveal(invalid.value);
  }
}

async function copy() {
  if (!state.value?.result) return;
  await navigator.clipboard?.writeText(state.value.result.text).catch(() => undefined);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="yj yj-stack yj-runner">
    <button v-if="closable" type="button" class="yj-back" @click="emit('close')"><Glyph name="back" />{{ backLabel ?? "Back" }}</button>
    <div>
      <h3 class="yj-title">{{ journey.title }}</h3>
      <p v-if="journey.summary" class="yj-small yj-muted">{{ journey.summary }}</p>
    </div>

    <ol v-if="state && (state.trail.length || state.status === 'running' || state.status === 'asking')" class="yj-row" aria-label="Progress">
      <li v-for="(t, i) in progressOf(journey, state.trail)" :key="`${t.step}-${i}`" class="yj-chip" :class="t.ok ? 'yj-chip-ok' : 'yj-chip-bad'"><Glyph :name="t.ok ? 'check' : 'cross'" />{{ t.label }}</li>
      <li v-if="state.status === 'running'" class="yj-chip yj-chip-busy"><Glyph name="spinner" />{{ currentLabel }}</li>
      <li v-if="state.status === 'asking' || state.status === 'waiting'" class="yj-chip"><Glyph name="circle" />{{ currentLabel }}</li>
    </ol>

    <!-- Handed over: someone else answers this screen. -->
    <div v-if="state?.status === 'waiting' && state.waiting" class="yj-card yj-stack yj-handover" role="status">
      <p class="yj-title">Handed over to {{ nameOf(state.waiting.role) }}</p>
      <p class="yj-small yj-muted">
        “{{ currentLabel }}” is answered by {{ nameOf(state.waiting.role) }}. In the kiosk the journey is kept as a request with a reference, and waits in their work queue{{ state.waiting.role ? "" : " until they come back with the reference" }}.
      </p>
      <div class="yj-row"><button type="button" class="yj-btn yj-btn-primary" @click="emit('continueAs', state.waiting.role)">Continue as {{ nameOf(state.waiting.role) }}</button></div>
    </div>

    <form v-if="state?.status === 'asking' && state.prompt" class="yj-card yj-stack" novalidate @submit.prevent="submit">
      <p class="yj-title">{{ state.prompt.text }}</p>
      <QuestionnaireForm
        ref="form"
        v-model="values"
        :fields="state.prompt.fields"
        :sections="state.prompt.sections"
        :scope="scope"
        :width="width"
        :storage-key="`questionnaire.${journey.id}.${state.prompt.step}`"
        :nav-mode="navMode"
        :switchable="switchable"
        :sources="sources"
        :languages="languages"
        :invalid="invalid"
      />
      <p v-if="problems.length" role="alert" class="yj-alert">{{ problems.join(" ") }}</p>
      <div class="yj-section-foot"><button type="submit" class="yj-btn yj-btn-primary">{{ state.prompt.submitLabel ?? "Continue" }}</button></div>
    </form>

    <div v-if="state?.status === 'running'" class="yj-note yj-head" role="status">
      <span class="yj-label"><Glyph name="spinner" /> Working on it…</span>
      <button type="button" class="yj-btn yj-btn-quiet" @click="runner?.stop()">Stop</button>
    </div>

    <div v-if="state?.status === 'done' && state.result" class="yj-card yj-stack" role="status">
      <h4 class="yj-title">{{ state.result.title }}</h4>
      <p class="yj-result-text">{{ state.result.text }}</p>
      <div class="yj-row">
        <button type="button" class="yj-btn" @click="copy">{{ copied ? "Copied" : "Copy" }}</button>
        <button type="button" class="yj-btn" @click="start">Start again</button>
        <button v-if="closable" type="button" class="yj-btn yj-btn-primary yj-push" @click="emit('close')">Done</button>
      </div>
      <p v-if="actor && finishers.length" class="yj-note yj-small">In the kiosk it now goes to {{ finishers.map((r) => nameOf(r)).join(" or ") }}, who closes it.</p>
      <slot name="result" :state="state" />
    </div>

    <div v-if="state?.status === 'failed'" role="alert" class="yj-alert yj-stack">
      <p>{{ state.error }}</p>
      <button type="button" class="yj-btn" @click="start">Start again</button>
    </div>
  </div>
</template>
