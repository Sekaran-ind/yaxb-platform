<script setup lang="ts">
// A journey as a form: details, who starts and who finishes it, and its steps. Each step asks
// (a questionnaire, or fields as YAML), runs a service, decides between branches, or ends with a
// result. Bind with v-model to a JourneyForm (forms.ts); formToJourney and toYaml give the YAML.
import { newStep, type JourneyForm, type StepKind } from "@sekaran-ind/yaxb-journeys/forms";
import type { Role } from "@sekaran-ind/yaxb-journeys/journeys";
import { computed, ref, useId, watch } from "vue";
import RolePicker from "./RolePicker.vue";

const props = defineProps<{
  modelValue: JourneyForm;
  roles: readonly Role[];
  /** Questionnaires an ask step may use (id and title). */
  questionnaires: readonly { id: string; title: string }[];
  /** Handler names a service step may call; free text when absent. */
  serviceNames?: readonly string[];
  readonly?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [form: JourneyForm] }>();
const uid = useId();
const id = (name: string) => `${uid}-${name}`;

const clone = (f: JourneyForm): JourneyForm => JSON.parse(JSON.stringify(f));
const form = ref<JourneyForm>(clone(props.modelValue));
watch(
  () => props.modelValue,
  (v) => {
    if (JSON.stringify(v) !== JSON.stringify(form.value)) form.value = clone(v);
  },
  { deep: true },
);
watch(form, (f) => emit("update:modelValue", clone(f)), { deep: true });

const stepIds = computed(() => form.value.steps.map((s) => s.id).filter(Boolean));
const WITH_PLACEHOLDER = 'message: "Summarise {{answers.ask.text}}"';
const KINDS: { id: StepKind; label: string }[] = [
  { id: "ask", label: "Ask questions" },
  { id: "service", label: "Run a service" },
  { id: "decide", label: "Decide (branches)" },
  { id: "final", label: "End with a result" },
];

function addStep(kind: StepKind) {
  let n = form.value.steps.length + 1;
  while (stepIds.value.includes(`step-${n}`)) n++;
  form.value.steps.push({ ...newStep(`step-${n}`, kind), ...(kind === "decide" ? { branches: [{ if: "", to: "" }, { to: "" }] } : {}) });
}
function setKind(i: number, kind: StepKind) {
  const s = form.value.steps[i]!;
  s.kind = kind;
  if (kind === "decide" && !s.branches.length) s.branches = [{ if: "", to: "" }, { to: "" }];
}
function setThen(i: number, then: "step" | "branches") {
  const s = form.value.steps[i]!;
  s.then = then;
  if (then === "branches" && !s.branches.length) s.branches = [{ if: "", to: s.next }, { to: "" }];
}
const move = (i: number, by: number) => {
  const steps = form.value.steps;
  const j = i + by;
  if (j < 0 || j >= steps.length) return;
  [steps[i], steps[j]] = [steps[j]!, steps[i]!];
};
</script>

<template>
  <div class="yj yj-stack yj-form">
    <fieldset class="yj-fieldset" :disabled="readonly">
      <legend class="yj-title">Journey</legend>
      <div class="yj-form-grid">
        <div>
          <label :for="id('id')" class="yj-field-label">Id <span class="yj-required" aria-hidden="true">*</span></label>
          <input :id="id('id')" v-model="form.id" class="yj-input" placeholder="visit-check-in" />
        </div>
        <div>
          <label :for="id('title')" class="yj-field-label">Title <span class="yj-required" aria-hidden="true">*</span></label>
          <input :id="id('title')" v-model="form.title" class="yj-input" placeholder="Check in for your visit" />
        </div>
        <div class="yj-span-2">
          <label :for="id('summary')" class="yj-field-label">Summary</label>
          <input :id="id('summary')" v-model="form.summary" class="yj-input" />
        </div>
        <div>
          <label :for="id('icon')" class="yj-field-label">Icon</label>
          <input :id="id('icon')" v-model="form.icon" class="yj-input" />
        </div>
        <div>
          <label :for="id('category')" class="yj-field-label">Category</label>
          <input :id="id('category')" v-model="form.category" class="yj-input" />
        </div>
        <div>
          <label :for="id('version')" class="yj-field-label">Version</label>
          <input :id="id('version')" v-model.number="form.version" class="yj-input" type="number" min="1" step="1" />
        </div>
        <div>
          <label :for="id('start')" class="yj-field-label">First step <span class="yj-required" aria-hidden="true">*</span></label>
          <select :id="id('start')" v-model="form.start" class="yj-input">
            <option value="">Choose…</option>
            <option v-for="s in stepIds" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>
      <div class="yj-form-grid">
        <RolePicker v-model="form.initiate" :roles="roles" legend="Who may start it" with-visitor :disabled="readonly" hint="None ticked, or Visitor: anyone at the kiosk." />
        <RolePicker v-model="form.complete" :roles="roles" legend="Who finishes it" :disabled="readonly" />
      </div>
    </fieldset>

    <fieldset class="yj-fieldset" :disabled="readonly">
      <legend class="yj-title">Steps</legend>
      <ol class="yj-stack">
        <li v-for="(s, i) in form.steps" :key="i" class="yj-card yj-step">
          <div class="yj-head">
            <p class="yj-item-kind">Step {{ i + 1 }}<span v-if="s.id === form.start"> · first</span></p>
            <div v-if="!readonly" class="yj-row">
              <button type="button" class="yj-btn yj-btn-quiet" :disabled="i === 0" :aria-label="`Move step ${s.id} up`" @click="move(i, -1)">↑</button>
              <button type="button" class="yj-btn yj-btn-quiet" :disabled="i === form.steps.length - 1" :aria-label="`Move step ${s.id} down`" @click="move(i, 1)">↓</button>
              <button type="button" class="yj-btn yj-btn-quiet" :aria-label="`Remove step ${s.id}`" @click="form.steps.splice(i, 1)">Remove</button>
            </div>
          </div>
          <div class="yj-form-grid">
            <div>
              <label :for="id(`id${i}`)" class="yj-field-label">Step id</label>
              <input :id="id(`id${i}`)" v-model="s.id" class="yj-input" />
            </div>
            <div>
              <label :for="id(`kind${i}`)" class="yj-field-label">Kind</label>
              <select :id="id(`kind${i}`)" :value="s.kind" class="yj-input" @change="setKind(i, ($event.target as HTMLSelectElement).value as StepKind)">
                <option v-for="k in KINDS" :key="k.id" :value="k.id">{{ k.label }}</option>
              </select>
            </div>
            <div class="yj-span-2">
              <label :for="id(`label${i}`)" class="yj-field-label">Label in the progress list</label>
              <input :id="id(`label${i}`)" v-model="s.label" class="yj-input" />
            </div>

            <template v-if="s.kind === 'ask'">
              <div>
                <label :for="id(`q${i}`)" class="yj-field-label">Questionnaire</label>
                <select :id="id(`q${i}`)" v-model="s.questionnaire" class="yj-input">
                  <option value="">None: list the fields here</option>
                  <option v-for="q in questionnaires" :key="q.id" :value="q.id">{{ q.title }} ({{ q.id }})</option>
                  <option v-if="s.questionnaire && !questionnaires.some((q) => q.id === s.questionnaire)" :value="s.questionnaire">{{ s.questionnaire }} (not in this library)</option>
                </select>
              </div>
              <div>
                <label :for="id(`sub${i}`)" class="yj-field-label">Button label</label>
                <input :id="id(`sub${i}`)" v-model="s.submitLabel" class="yj-input" placeholder="Continue" />
              </div>
              <div class="yj-span-2">
                <label :for="id(`ask${i}`)" class="yj-field-label">Prompt</label>
                <input :id="id(`ask${i}`)" v-model="s.ask" class="yj-input" :placeholder="s.questionnaire ? 'The questionnaire\'s summary when empty' : 'What should the visitor answer?'" />
              </div>
              <div v-if="!s.questionnaire" class="yj-span-2">
                <label :for="id(`f${i}`)" class="yj-field-label">Fields (YAML list)</label>
                <textarea :id="id(`f${i}`)" v-model="s.fieldsYaml" class="yj-input yj-mono" rows="5" spellcheck="false" placeholder="- { id: name, type: text, label: Your name, required: true }" />
              </div>
            </template>

            <template v-else-if="s.kind === 'service'">
              <div>
                <label :for="id(`svc${i}`)" class="yj-field-label">Service</label>
                <select v-if="serviceNames?.length" :id="id(`svc${i}`)" v-model="s.service" class="yj-input">
                  <option value="">Choose…</option>
                  <option v-for="n in serviceNames" :key="n" :value="n">{{ n }}</option>
                </select>
                <input v-else :id="id(`svc${i}`)" v-model="s.service" class="yj-input" placeholder="agent.ask" />
              </div>
              <div>
                <label :for="id(`err${i}`)" class="yj-field-label">If it fails</label>
                <select :id="id(`err${i}`)" v-model="s.onError" class="yj-input">
                  <option value="fail">Stop the journey</option>
                  <option value="continue">Carry on</option>
                </select>
              </div>
              <div class="yj-span-2">
                <label :for="id(`with${i}`)" class="yj-field-label">Input (YAML mapping; templates such as <code v-pre class="yj-code">{{answers.ask.name}}</code> allowed)</label>
                <textarea :id="id(`with${i}`)" v-model="s.withYaml" class="yj-input yj-mono" rows="3" spellcheck="false" :placeholder="WITH_PLACEHOLDER" />
              </div>
            </template>

            <template v-else-if="s.kind === 'final'">
              <div class="yj-span-2">
                <label :for="id(`rt${i}`)" class="yj-field-label">Result title</label>
                <input :id="id(`rt${i}`)" v-model="s.resultTitle" class="yj-input" />
              </div>
              <div class="yj-span-2">
                <label :for="id(`rx${i}`)" class="yj-field-label">Result text</label>
                <textarea :id="id(`rx${i}`)" v-model="s.resultText" class="yj-input" rows="3" />
              </div>
            </template>
          </div>

          <!-- Where to go next. -->
          <div v-if="s.kind !== 'final'" class="yj-stack yj-mt">
            <div v-if="s.kind !== 'decide'" class="yj-row">
              <span class="yj-field-label">Then</span>
              <div class="yj-segment" role="group" :aria-label="`Then, for step ${s.id}`">
                <button type="button" :aria-pressed="s.then === 'step'" @click="setThen(i, 'step')">Go to a step</button>
                <button type="button" :aria-pressed="s.then === 'branches'" @click="setThen(i, 'branches')">Branch on answers</button>
              </div>
              <select v-if="s.then === 'step'" v-model="s.next" class="yj-input yj-select-sm" :aria-label="`Next step after ${s.id}`">
                <option value="">Choose…</option>
                <option v-for="t in stepIds.filter((x) => x !== s.id)" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
            <div v-if="s.kind === 'decide' || s.then === 'branches'" class="yj-stack">
              <div v-for="(b, bi) in s.branches" :key="bi" class="yj-branch">
                <input
                  v-if="bi < s.branches.length - 1"
                  v-model="b.if"
                  class="yj-input yj-mono"
                  :aria-label="`Condition ${bi + 1} of step ${s.id}`"
                  placeholder="answers.ask.severity == 'severe'"
                />
                <span v-else class="yj-small yj-muted">Otherwise</span>
                <span aria-hidden="true">→</span>
                <select v-model="b.to" class="yj-input yj-select-sm" :aria-label="`Go to, branch ${bi + 1} of step ${s.id}`">
                  <option value="">Choose…</option>
                  <option v-for="t in stepIds.filter((x) => x !== s.id)" :key="t" :value="t">{{ t }}</option>
                </select>
                <button v-if="bi < s.branches.length - 1 && !readonly" type="button" class="yj-btn yj-btn-quiet" :aria-label="`Remove branch ${bi + 1}`" @click="s.branches.splice(bi, 1)">×</button>
              </div>
              <button v-if="!readonly" type="button" class="yj-btn yj-select-sm" @click="s.branches.splice(s.branches.length - 1, 0, { if: '', to: '' })">Add a condition</button>
            </div>
          </div>
        </li>
      </ol>
      <div v-if="!readonly" class="yj-row yj-mt">
        <button v-for="k in KINDS" :key="k.id" type="button" class="yj-btn" @click="addStep(k.id)">+ {{ k.label }}</button>
      </div>
    </fieldset>
  </div>
</template>
