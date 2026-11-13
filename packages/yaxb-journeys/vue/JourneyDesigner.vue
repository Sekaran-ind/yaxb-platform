<script setup lang="ts">
// One journey of a service, as screens. A screen asks questions (written as YAML: the fields of a
// questionnaire), runs a service, decides where to go, or ends with a result. Screens follow one
// another in order unless one says where to go next. Who may start and finish the journey comes
// from the service's roles (the side panel adds them).
import { idFromName, newScreen, type JourneyDesign, type StepKind } from "@sekaran-ind/yaxb-journeys/forms";
import type { Role } from "@sekaran-ind/yaxb-journeys/journeys";
import { load } from "js-yaml";
import { computed, nextTick, ref, useId, watch } from "vue";
import ConfirmAction from "./ConfirmAction.vue";
import Glyph from "./Glyph.vue";
import QuestionsEditor from "./QuestionsEditor.vue";
import RolePicker from "./RolePicker.vue";

// part: the journey's details and roles, its screens, or both (the service designer's steps show one at a time).
const props = withDefaults(defineProps<{ modelValue: JourneyDesign; roles: readonly Role[]; serviceNames?: readonly string[]; readonly?: boolean; part?: "details" | "screens" | "all" }>(), {
  part: "all",
});
const emit = defineEmits<{ "update:modelValue": [journey: JourneyDesign]; addRole: [role: Role] }>();

// Add a role to the service without leaving the journey.
const roleName = ref("");
function addRole() {
  const label = roleName.value.trim();
  const roleId = idFromName(label);
  if (!label || !roleId || props.roles.some((r) => r.id === roleId)) return;
  emit("addRole", { id: roleId, label });
  roleName.value = "";
}
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
/** The other screens, by name (their ids are what the YAML keeps). */
const others = (sid: string) => j.value.screens.filter((s) => s.id && s.id !== sid).map((s) => ({ id: s.id, name: s.label ? `${s.label} (${s.id})` : s.id }));

// Ids follow names while they are still the made-up ones ("journey-2", "screen-3") or were made from the name.
watch(
  () => j.value.title,
  (title, before) => {
    if (props.readonly) return;
    if (/^journey-\d+$/.test(j.value.id) || j.value.id === idFromName(before ?? "")) j.value.id = idFromName(title) || j.value.id;
  },
);
function setScreenLabel(i: number, label: string) {
  const s = j.value.screens[i]!;
  const before = s.label;
  s.label = label;
  if (!/^screen-\d+$/.test(s.id) && s.id !== idFromName(before)) return;
  const base = idFromName(label);
  if (!base) return;
  let n = 1;
  let next = base;
  while (j.value.screens.some((x, k) => k !== i && x.id === next)) next = `${base}-${++n}`;
  // The screens that pointed at the old id point at the new one.
  for (const x of j.value.screens) {
    if (x.next === s.id) x.next = next;
    for (const b of x.branches) if (b.to === s.id) b.to = next;
  }
  if (j.value.start === s.id) j.value.start = next;
  s.id = next;
}

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
const root = ref<HTMLElement | null>(null);
/** Move a screen, and keep focus on the moved screen's button (or its other one at the end). */
async function move(i: number, by: number) {
  const list = j.value.screens;
  const k = i + by;
  if (k < 0 || k >= list.length) return;
  [list[i], list[k]] = [list[k]!, list[i]!];
  if (open.value === i) open.value = k;
  else if (open.value === k) open.value = i;
  await nextTick();
  const at = (dir: string) => root.value?.querySelector<HTMLButtonElement>(`[data-move="${k}-${dir}"]`);
  const same = at(by < 0 ? "up" : "down");
  (same && !same.disabled ? same : at(by < 0 ? "down" : "up"))?.focus();
}
function removeScreen(i: number) {
  j.value.screens.splice(i, 1);
  if (open.value === i) open.value = null;
  else if (open.value !== null && open.value > i) open.value--;
}
const open = ref<number | null>(0);
</script>

<template>
  <div ref="root" class="yj yj-stack yj-form">
    <fieldset v-if="part !== 'screens'" class="yj-fieldset" :disabled="readonly">
      <legend class="yj-sr-only">About this journey</legend>
      <div class="yj-form-grid">
        <div class="yj-span-2">
          <label :for="id('title')" class="yj-field-label">Journey name <span class="yj-required" aria-hidden="true">*</span></label>
          <input :id="id('title')" v-model="j.title" class="yj-input" placeholder="Check in for your visit" />
        </div>
        <div class="yj-span-2">
          <label :for="id('summary')" class="yj-field-label">What it does, in a sentence</label>
          <input :id="id('summary')" v-model="j.summary" class="yj-input" />
        </div>
      </div>
      <div class="yj-form-grid yj-mt">
        <RolePicker v-model="j.initiate" :roles="roles" legend="Who may start it" with-visitor :disabled="readonly" hint="None ticked, or Visitor: anyone at the kiosk." />
        <RolePicker v-model="j.complete" :roles="roles" legend="Who finishes it" :disabled="readonly" hint="None ticked: whoever started it." />
      </div>
      <form v-if="!readonly" class="yj-row yj-mt" @submit.prevent="addRole">
        <label :for="id('newrole')" class="yj-small yj-muted">A role that isn't listed:</label>
        <input :id="id('newrole')" v-model="roleName" class="yj-input yj-select-sm" placeholder="Front desk" maxlength="40" />
        <button type="submit" class="yj-btn yj-select-sm" :disabled="!roleName.trim()">Add role</button>
      </form>
      <details class="yj-details yj-mt">
        <summary>More: the journey's id, icon and first screen</summary>
        <div class="yj-form-grid yj-mt">
          <div>
            <label :for="id('id')" class="yj-field-label">Journey id <span class="yj-required" aria-hidden="true">*</span></label>
            <input :id="id('id')" v-model="j.id" class="yj-input yj-mono" placeholder="check-in" />
          </div>
          <div>
            <label :for="id('icon')" class="yj-field-label">Icon</label>
            <input :id="id('icon')" v-model="j.icon" class="yj-input" />
          </div>
          <div>
            <label :for="id('start')" class="yj-field-label">First screen</label>
            <select :id="id('start')" v-model="j.start" class="yj-input">
              <option value="">The first in the list</option>
              <option v-for="s in j.screens.filter((x) => x.id)" :key="s.id" :value="s.id">{{ s.label || s.id }}</option>
            </select>
          </div>
        </div>
      </details>
    </fieldset>

    <fieldset v-if="part !== 'details'" class="yj-fieldset" :disabled="readonly">
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
              <button type="button" class="yj-btn yj-btn-quiet yj-btn-icon" :data-move="`${i}-up`" :disabled="i === 0" :aria-label="`Move screen ${s.label || s.id} up`" :title="`Move screen ${s.label || s.id} up`" @click="move(i, -1)"><Glyph name="up" /></button>
              <button type="button" class="yj-btn yj-btn-quiet yj-btn-icon" :data-move="`${i}-down`" :disabled="i === j.screens.length - 1" :aria-label="`Move screen ${s.label || s.id} down`" :title="`Move screen ${s.label || s.id} down`" @click="move(i, 1)"><Glyph name="down" /></button>
              <ConfirmAction label="Remove" :aria-label="`Remove screen ${s.label || s.id}`" :message="`Remove screen ${i + 1}, “${s.label || s.id}”, and its questions?`" @confirm="removeScreen(i)" />
            </div>
          </div>

          <div v-if="open === i" class="yj-stack yj-mt">
            <div class="yj-form-grid">
              <div>
                <label :for="id(`label${i}`)" class="yj-field-label">Screen title</label>
                <input :id="id(`label${i}`)" :value="s.label" class="yj-input" @input="setScreenLabel(i, ($event.target as HTMLInputElement).value)" />
              </div>
              <div>
                <label :for="id(`kind${i}`)" class="yj-field-label">What it does</label>
                <select :id="id(`kind${i}`)" :value="s.kind" class="yj-input" @change="setKind(i, ($event.target as HTMLSelectElement).value as StepKind)">
                  <option v-for="k in KINDS" :key="k.id" :value="k.id">{{ k.label }}</option>
                </select>
              </div>

              <template v-if="s.kind === 'ask'">
                <div class="yj-span-2">
                  <label :for="id(`ask${i}`)" class="yj-field-label">What the screen says first</label>
                  <input :id="id(`ask${i}`)" v-model="s.ask" class="yj-input" placeholder="The screen title when empty" />
                </div>
                <div class="yj-span-2">
                  <QuestionsEditor v-model="s.fieldsYaml" :readonly="readonly" :label="`Questions on “${s.label || s.id}”`" />
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
                  <option v-for="t in others(s.id)" :key="t.id" :value="t.id">{{ t.name }}</option>
                </select>
              </div>
              <div v-if="s.kind === 'decide' || s.then === 'branches'" class="yj-stack">
                <div v-for="(b, bi) in s.branches" :key="bi" class="yj-branch">
                  <input v-if="bi < s.branches.length - 1" v-model="b.if" class="yj-input yj-mono" :aria-label="`Condition ${bi + 1} of screen ${s.id}`" placeholder="answers.questions.fever == true" />
                  <span v-else class="yj-small yj-muted">Otherwise</span>
                  <span aria-hidden="true">→</span>
                  <select v-model="b.to" class="yj-input yj-select-sm" :aria-label="`Go to, branch ${bi + 1} of screen ${s.id}`">
                    <option value="">Choose…</option>
                    <option v-for="t in others(s.id)" :key="t.id" :value="t.id">{{ t.name }}</option>
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
