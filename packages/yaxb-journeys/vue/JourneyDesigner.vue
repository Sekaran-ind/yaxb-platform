<script setup lang="ts">
// One journey of a service, as screens. A screen asks questions (written as YAML: the fields of a
// questionnaire), runs a service, decides where to go, or ends with a result. Screens follow one
// another in order unless one says where to go next. Who may start and finish the journey comes
// from the service's roles (the side panel adds them).
import { newScreen, type JourneyDesign, type StepKind } from "@sekaran-ind/yaxb-journeys/forms";
import type { Role } from "@sekaran-ind/yaxb-journeys/journeys";
import { load } from "js-yaml";
import { computed, ref, useId, watch } from "vue";
import RolePicker from "./RolePicker.vue";

const props = defineProps<{ modelValue: JourneyDesign; roles: readonly Role[]; serviceNames?: readonly string[]; readonly?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [journey: JourneyDesign] }>();
const uid = useId();
const id = (name: string) => `${uid}-${name}`;

const clone = (j: JourneyDesign): JourneyDesign => JSON.parse(JSON.stringify(j));
const j = ref<JourneyDesign>(clone(props.modelValue));
watch(
  () => props.modelValue,
  (v) => {
    if (JSON.stringify(v) !== JSON.stringify(j.value)) j.value = clone(v);
  },
  { deep: true },
);
watch(j, (v) => emit("update:modelValue", clone(v)), { deep: true });

const KINDS: { id: StepKind; label: string }[] = [
  { id: "ask", label: "Questions" },
  { id: "service", label: "Run a service" },
  { id: "decide", label: "Decide where to go" },
  { id: "final", label: "End with a result" },
];
const WITH_PLACEHOLDER = 'message: "Summarise {{answers.questions.name}}"';
const screenIds = computed(() => j.value.screens.map((s) => s.id).filter(Boolean));
const others = (sid: string) => screenIds.value.filter((x) => x !== sid);

/** How the questions YAML reads: a count, or what's wrong. */
function questionsNote(text: string): { ok: boolean; text: string } {
  if (!text.trim()) return { ok: false, text: "No questions yet." };
  try {
    const v = load(text);
    if (!Array.isArray(v)) return { ok: false, text: "Questions are a YAML list: each line starts with -" };
    return { ok: true, text: `${v.length} question${v.length === 1 ? "" : "s"}` };
  } catch (e) {
    return { ok: false, text: (e as Error).message.split("\n")[0]! };
  }
}

function addScreen(kind: StepKind) {
  let n = j.value.screens.length + 1;
  while (screenIds.value.includes(`screen-${n}`)) n++;
  const s = { ...newScreen(`screen-${n}`, kind), label: KINDS.find((k) => k.id === kind)!.label };
  if (kind === "ask") s.fieldsYaml = "- { id: answer, type: text, label: Your answer }";
  if (kind === "decide") s.branches = [{ if: "", to: "" }, { to: "" }];
  // A new screen goes before the ending, if the journey has one at the end.
  const last = j.value.screens.at(-1);
  if (kind !== "final" && last?.kind === "final") j.value.screens.splice(j.value.screens.length - 1, 0, s);
  else j.value.screens.push(s);
}
function setKind(i: number, kind: StepKind) {
  const s = j.value.screens[i]!;
  s.kind = kind;
  if (kind === "decide" && !s.branches.length) s.branches = [{ if: "", to: "" }, { to: "" }];
}
function setThen(i: number, then: "step" | "branches") {
  const s = j.value.screens[i]!;
  s.then = then;
  if (then === "branches" && !s.branches.length) s.branches = [{ if: "", to: s.next }, { to: "" }];
}
const move = (i: number, by: number) => {
  const list = j.value.screens;
  const k = i + by;
  if (k < 0 || k >= list.length) return;
  [list[i], list[k]] = [list[k]!, list[i]!];
};
const open = ref<number | null>(0);
</script>

<template>
  <div class="yj yj-stack yj-form">
    <fieldset class="yj-fieldset" :disabled="readonly">
      <div class="yj-form-grid">
        <div>
          <label :for="id('id')" class="yj-field-label">Journey id <span class="yj-required" aria-hidden="true">*</span></label>
          <input :id="id('id')" v-model="j.id" class="yj-input" placeholder="check-in" />
        </div>
        <div>
          <label :for="id('title')" class="yj-field-label">Journey title <span class="yj-required" aria-hidden="true">*</span></label>
          <input :id="id('title')" v-model="j.title" class="yj-input" placeholder="Check in for your visit" />
        </div>
        <div class="yj-span-2">
          <label :for="id('summary')" class="yj-field-label">Summary</label>
          <input :id="id('summary')" v-model="j.summary" class="yj-input" />
        </div>
        <div>
          <label :for="id('icon')" class="yj-field-label">Icon</label>
          <input :id="id('icon')" v-model="j.icon" class="yj-input" />
        </div>
        <div>
          <label :for="id('start')" class="yj-field-label">First screen</label>
          <select :id="id('start')" v-model="j.start" class="yj-input">
            <option value="">The first in the list</option>
            <option v-for="s in screenIds" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>
      <div class="yj-form-grid">
        <RolePicker v-model="j.initiate" :roles="roles" legend="Who may start it" with-visitor :disabled="readonly" hint="None ticked, or Visitor: anyone at the kiosk." />
        <RolePicker v-model="j.complete" :roles="roles" legend="Who finishes it" :disabled="readonly" :hint="roles.length ? undefined : 'Add roles in the Roles panel.'" />
      </div>
    </fieldset>

    <fieldset class="yj-fieldset" :disabled="readonly">
      <legend class="yj-title">Screens</legend>
      <ol class="yj-stack">
        <li v-for="(s, i) in j.screens" :key="i" class="yj-card yj-step">
          <div class="yj-head">
            <button type="button" class="yj-screen-toggle" :aria-expanded="open === i" @click="open = open === i ? null : i">
              <span class="yj-item-kind">Screen {{ i + 1 }} · {{ KINDS.find((k) => k.id === s.kind)?.label }}</span>
              <span class="yj-title yj-block">{{ s.label || s.id }}</span>
              <span v-if="s.kind === 'ask'" class="yj-help yj-block">{{ questionsNote(s.fieldsYaml).text }}</span>
            </button>
            <div v-if="!readonly" class="yj-row">
              <button type="button" class="yj-btn yj-btn-quiet" :disabled="i === 0" :aria-label="`Move screen ${s.id} up`" @click="move(i, -1)">↑</button>
              <button type="button" class="yj-btn yj-btn-quiet" :disabled="i === j.screens.length - 1" :aria-label="`Move screen ${s.id} down`" @click="move(i, 1)">↓</button>
              <button type="button" class="yj-btn yj-btn-quiet" :aria-label="`Remove screen ${s.id}`" @click="j.screens.splice(i, 1)">Remove</button>
            </div>
          </div>

          <div v-if="open === i" class="yj-stack yj-mt">
            <div class="yj-form-grid">
              <div>
                <label :for="id(`sid${i}`)" class="yj-field-label">Screen id</label>
                <input :id="id(`sid${i}`)" v-model="s.id" class="yj-input" />
              </div>
              <div>
                <label :for="id(`kind${i}`)" class="yj-field-label">Kind</label>
                <select :id="id(`kind${i}`)" :value="s.kind" class="yj-input" @change="setKind(i, ($event.target as HTMLSelectElement).value as StepKind)">
                  <option v-for="k in KINDS" :key="k.id" :value="k.id">{{ k.label }}</option>
                </select>
              </div>
              <div class="yj-span-2">
                <label :for="id(`label${i}`)" class="yj-field-label">Screen title</label>
                <input :id="id(`label${i}`)" v-model="s.label" class="yj-input" />
              </div>

              <template v-if="s.kind === 'ask'">
                <div class="yj-span-2">
                  <label :for="id(`ask${i}`)" class="yj-field-label">Prompt</label>
                  <input :id="id(`ask${i}`)" v-model="s.ask" class="yj-input" placeholder="The screen title when empty" />
                </div>
                <div class="yj-span-2">
                  <label :for="id(`q${i}`)" class="yj-field-label">Questions (YAML)</label>
                  <textarea :id="id(`q${i}`)" v-model="s.fieldsYaml" class="yj-input yj-mono" rows="7" spellcheck="false" :aria-describedby="id(`qn${i}`)" />
                  <p :id="id(`qn${i}`)" class="yj-help" :class="questionsNote(s.fieldsYaml).ok ? '' : 'yj-status-bad'">
                    {{ questionsNote(s.fieldsYaml).text }} · types: text, textarea, select (with options), boolean, number, date, source, language; <code v-pre class="yj-code">when: "values.x == true"</code> asks one only sometimes.
                  </p>
                </div>
                <div>
                  <label :for="id(`sub${i}`)" class="yj-field-label">Button label</label>
                  <input :id="id(`sub${i}`)" v-model="s.submitLabel" class="yj-input" placeholder="Continue" />
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
                  <label :for="id(`with${i}`)" class="yj-field-label">Input (YAML)</label>
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

            <div v-if="s.kind !== 'final'" class="yj-stack">
              <div v-if="s.kind !== 'decide'" class="yj-row">
                <span class="yj-field-label">Then</span>
                <div class="yj-segment" role="group" :aria-label="`Then, after screen ${s.id}`">
                  <button type="button" :aria-pressed="s.then === 'step'" @click="setThen(i, 'step')">Go to a screen</button>
                  <button type="button" :aria-pressed="s.then === 'branches'" @click="setThen(i, 'branches')">Branch on answers</button>
                </div>
                <select v-if="s.then === 'step'" v-model="s.next" class="yj-input yj-select-sm" :aria-label="`Next screen after ${s.id}`">
                  <option value="">The next screen in the list</option>
                  <option v-for="t in others(s.id)" :key="t" :value="t">{{ t }}</option>
                </select>
              </div>
              <div v-if="s.kind === 'decide' || s.then === 'branches'" class="yj-stack">
                <div v-for="(b, bi) in s.branches" :key="bi" class="yj-branch">
                  <input v-if="bi < s.branches.length - 1" v-model="b.if" class="yj-input yj-mono" :aria-label="`Condition ${bi + 1} of screen ${s.id}`" placeholder="answers.questions.fever == true" />
                  <span v-else class="yj-small yj-muted">Otherwise</span>
                  <span aria-hidden="true">→</span>
                  <select v-model="b.to" class="yj-input yj-select-sm" :aria-label="`Go to, branch ${bi + 1} of screen ${s.id}`">
                    <option value="">Choose…</option>
                    <option v-for="t in others(s.id)" :key="t" :value="t">{{ t }}</option>
                  </select>
                  <button v-if="bi < s.branches.length - 1 && !readonly" type="button" class="yj-btn yj-btn-quiet" :aria-label="`Remove branch ${bi + 1}`" @click="s.branches.splice(bi, 1)">×</button>
                </div>
                <button v-if="!readonly" type="button" class="yj-btn yj-select-sm" @click="s.branches.splice(s.branches.length - 1, 0, { if: '', to: '' })">Add a condition</button>
              </div>
            </div>
          </div>
        </li>
      </ol>
      <div v-if="!readonly" class="yj-row yj-mt">
        <button v-for="k in KINDS" :key="k.id" type="button" class="yj-btn" @click="addScreen(k.id), (open = null)">+ {{ k.label }}</button>
      </div>
    </fieldset>
  </div>
</template>
