<script setup lang="ts">
// The questions on one screen, as a list a first-time designer can edit without YAML: add a
// question, open it to change its wording, answer type, options and whether it's needed, move it up
// or down, remove it. The value is the same YAML list the engine reads (fields.ts), so keys this
// editor doesn't show (default, keywords, entity…) are kept as they are. "Edit as YAML" opens the
// code view for everything else; YAML that isn't a list of questions opens there, with the reason.
import { FIELD_TYPES, idFromName, type Field, type FieldType } from "@sekaran-ind/yaxb-journeys";
import { dump, load } from "js-yaml";
import { computed, nextTick, ref, useId, watch } from "vue";
import ConfirmAction from "./ConfirmAction.vue";
import Glyph from "./Glyph.vue";
import YamlEditor from "./YamlEditor.vue";

const props = defineProps<{ modelValue: string; readonly?: boolean; label?: string }>();
const emit = defineEmits<{ "update:modelValue": [yaml: string] }>();
const uid = useId();
const id = (name: string) => `${uid}-${name}`;

/** The answer types in plain words. */
const TYPES: Record<FieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  password: "Secret (hidden as it's typed)",
  select: "Choose one from a list",
  boolean: "Yes or no",
  number: "A number",
  date: "A date",
  source: "A notebook source",
  language: "A language",
};

type Q = Field & Record<string, unknown>;
function parse(text: string): { ok: true; list: Q[] } | { ok: false; why: string } {
  if (!text.trim()) return { ok: true, list: [] };
  try {
    const v = load(text);
    if (!Array.isArray(v)) return { ok: false, why: "The questions are a YAML list: each one starts with '-'." };
    if (v.some((x) => !x || typeof x !== "object" || Array.isArray(x))) return { ok: false, why: "Each question is a mapping (id, type, label…)." };
    return { ok: true, list: v as Q[] };
  } catch (e) {
    return { ok: false, why: (e as Error).message.split("\n")[0]! };
  }
}
const toText = (list: Q[]) => (list.length ? dump(list, { flowLevel: 1, lineWidth: 200, noRefs: true }).trimEnd() : "");

const list = ref<Q[]>([]);
const parsed = ref(parse(props.modelValue));
const asYaml = ref(!parsed.value.ok);
const yamlText = ref(props.modelValue);
let mine = props.modelValue;
function readIn(text: string) {
  parsed.value = parse(text);
  yamlText.value = text;
  if (parsed.value.ok) list.value = JSON.parse(JSON.stringify(parsed.value.list));
  else asYaml.value = true;
}
readIn(props.modelValue);
watch(
  () => props.modelValue,
  (v) => v !== mine && readIn(v),
);
function write() {
  mine = toText(list.value);
  yamlText.value = mine;
  parsed.value = { ok: true, list: list.value };
  emit("update:modelValue", mine);
}
function onYaml(v: string) {
  yamlText.value = v;
  mine = v;
  parsed.value = parse(v);
  if (parsed.value.ok) list.value = JSON.parse(JSON.stringify(parsed.value.list));
  emit("update:modelValue", v);
}

// ---- editing ------------------------------------------------------------------------------
const open = ref<number | null>(null);
const nameOf = (q: Q, i: number) => q.label || q.id || `Question ${i + 1}`;
const autoId = (label: string) => idFromName(label).replace(/-/g, "_") || "question";
function uniqueId(base: string, except: number) {
  let n = 1;
  let out = base;
  while (list.value.some((q, i) => i !== except && q.id === out)) out = `${base}_${++n}`;
  return out;
}
function setLabel(i: number, label: string) {
  const q = list.value[i]!;
  // The id follows the wording until someone sets it themselves.
  if (!q.id || q.id === uniqueId(autoId(q.label ?? ""), i) || /^question(_\d+)?$/.test(q.id)) q.id = uniqueId(autoId(label), i);
  q.label = label;
  write();
}
function set<K extends keyof Q>(i: number, key: K, value: Q[K] | undefined) {
  const q = list.value[i]!;
  if (value === undefined || value === "" || value === false) delete q[key];
  else q[key] = value;
  if (key === "type" && value !== "select") delete q.options;
  if (key === "type" && value === "select" && !q.options?.length)
    q.options = [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];
  write();
}
const optionsText = (q: Q) => (q.options ?? []).map((o) => o.label).join("\n");
function setOptions(i: number, text: string) {
  const labels = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const old = list.value[i]!.options ?? [];
  list.value[i]!.options = labels.map((label) => old.find((o) => o.label === label) ?? { value: idFromName(label).replace(/-/g, "_") || label.toLowerCase(), label });
  write();
}
async function add() {
  const q: Q = { id: uniqueId("question", -1), type: "text", label: "" };
  list.value.push(q);
  write();
  open.value = list.value.length - 1;
  await nextTick();
  document.getElementById(id(`label${open.value}`))?.focus();
}
function remove(i: number) {
  list.value.splice(i, 1);
  if (open.value === i) open.value = null;
  else if (open.value !== null && open.value > i) open.value--;
  write();
}
const root = ref<HTMLElement | null>(null);
async function move(i: number, by: number) {
  const k = i + by;
  if (k < 0 || k >= list.value.length) return;
  [list.value[i], list.value[k]] = [list.value[k]!, list.value[i]!];
  if (open.value === i) open.value = k;
  else if (open.value === k) open.value = i;
  write();
  await nextTick();
  const at = (dir: string) => root.value?.querySelector<HTMLButtonElement>(`[data-qmove="${k}-${dir}"]`);
  const same = at(by < 0 ? "up" : "down");
  (same && !same.disabled ? same : at(by < 0 ? "down" : "up"))?.focus();
}
const summary = computed(() => (parsed.value.ok ? `${list.value.length} question${list.value.length === 1 ? "" : "s"}` : parsed.value.why));
</script>

<template>
  <div ref="root" class="yj yj-questions">
    <div class="yj-row yj-between">
      <span class="yj-field-label yj-m0">{{ label ?? "Questions" }}</span>
      <button type="button" class="yj-btn yj-btn-quiet yj-select-sm" :aria-pressed="asYaml" :disabled="asYaml && !parsed.ok" @click="asYaml = !asYaml">{{ asYaml ? "Edit as a list" : "Edit as YAML" }}</button>
    </div>

    <template v-if="asYaml">
      <p class="yj-help" :class="parsed.ok ? '' : 'yj-status-bad'" role="status">
        {{ summary }}<template v-if="!parsed.ok">. Fix it here to edit the questions as a list.</template> Types: {{ FIELD_TYPES.join(", ") }}; <code v-pre class="yj-code">when: "values.x == true"</code> asks one only sometimes.
      </p>
      <YamlEditor :model-value="yamlText" :label="`${label ?? 'Questions'} (YAML)`" :readonly="readonly" height="14rem" @update:model-value="onYaml" />
    </template>

    <template v-else>
      <p v-if="!list.length" class="yj-note yj-small">No questions yet. A screen that asks needs at least one.</p>
      <ol class="yj-qlist">
        <li v-for="(q, i) in list" :key="i" class="yj-qitem" :class="open === i && 'yj-qitem-open'">
          <div class="yj-qhead">
            <button type="button" class="yj-qtoggle" :aria-expanded="open === i" @click="open = open === i ? null : i">
              <span class="yj-title yj-small yj-block">{{ i + 1 }}. {{ nameOf(q, i) }}</span>
              <span class="yj-help yj-block yj-m0">{{ TYPES[q.type as FieldType] ?? q.type }}{{ q.required ? " · needed" : " · optional" }}{{ q.when ? " · only sometimes" : "" }}</span>
            </button>
            <div v-if="!readonly" class="yj-row yj-nowrap">
              <button type="button" class="yj-btn yj-btn-quiet yj-btn-icon" :data-qmove="`${i}-up`" :disabled="i === 0" :aria-label="`Move ${nameOf(q, i)} up`" :title="`Move ${nameOf(q, i)} up`" @click="move(i, -1)"><Glyph name="up" /></button>
              <button type="button" class="yj-btn yj-btn-quiet yj-btn-icon" :data-qmove="`${i}-down`" :disabled="i === list.length - 1" :aria-label="`Move ${nameOf(q, i)} down`" :title="`Move ${nameOf(q, i)} down`" @click="move(i, 1)"><Glyph name="down" /></button>
              <ConfirmAction label="Remove" :aria-label="`Remove ${nameOf(q, i)}`" :message="`Remove the question “${nameOf(q, i)}”?`" @confirm="remove(i)" />
            </div>
          </div>
          <fieldset v-if="open === i" class="yj-fieldset yj-form-grid yj-mt" :disabled="readonly">
            <legend class="yj-sr-only">Question {{ i + 1 }}</legend>
            <div class="yj-span-2">
              <label :for="id(`label${i}`)" class="yj-field-label">The question</label>
              <input :id="id(`label${i}`)" :value="q.label" class="yj-input" placeholder="What is your name?" @input="setLabel(i, ($event.target as HTMLInputElement).value)" />
            </div>
            <div>
              <label :for="id(`type${i}`)" class="yj-field-label">Answer</label>
              <select :id="id(`type${i}`)" :value="q.type" class="yj-input" @change="set(i, 'type', ($event.target as HTMLSelectElement).value as FieldType)">
                <option v-for="t in FIELD_TYPES" :key="t" :value="t">{{ TYPES[t] }}</option>
              </select>
            </div>
            <div class="yj-check yj-self-end">
              <input :id="id(`req${i}`)" type="checkbox" :checked="Boolean(q.required)" @change="set(i, 'required', ($event.target as HTMLInputElement).checked)" />
              <label :for="id(`req${i}`)">An answer is needed</label>
            </div>
            <div v-if="q.type === 'select'" class="yj-span-2">
              <label :for="id(`opts${i}`)" class="yj-field-label">Choices, one per line</label>
              <textarea :id="id(`opts${i}`)" :value="optionsText(q)" class="yj-input" rows="3" @change="setOptions(i, ($event.target as HTMLTextAreaElement).value)" />
            </div>
            <div v-if="q.type !== 'boolean' && q.type !== 'select'" class="yj-span-2">
              <label :for="id(`ph${i}`)" class="yj-field-label">Example answer (shown greyed in the box)</label>
              <input :id="id(`ph${i}`)" :value="q.placeholder ?? ''" class="yj-input" @input="set(i, 'placeholder', ($event.target as HTMLInputElement).value)" />
            </div>
            <details class="yj-span-2 yj-details">
              <summary>More: the answer's name and when to ask</summary>
              <div class="yj-form-grid yj-mt">
                <div>
                  <label :for="id(`id${i}`)" class="yj-field-label">Answer name</label>
                  <input :id="id(`id${i}`)" :value="q.id" class="yj-input yj-mono" pattern="[a-z][a-z0-9_\-]*" :aria-describedby="id(`idh${i}`)" @input="set(i, 'id', ($event.target as HTMLInputElement).value)" />
                  <p :id="id(`idh${i}`)" class="yj-help">Later screens use it: <code class="yj-code">answers.&lt;screen&gt;.{{ q.id }}</code></p>
                </div>
                <div>
                  <label :for="id(`when${i}`)" class="yj-field-label">Ask only when</label>
                  <input :id="id(`when${i}`)" :value="q.when ?? ''" class="yj-input yj-mono" placeholder="values.fever == true" @input="set(i, 'when', ($event.target as HTMLInputElement).value)" />
                  <p class="yj-help">Empty: always.</p>
                </div>
              </div>
            </details>
          </fieldset>
        </li>
      </ol>
      <button v-if="!readonly" type="button" class="yj-btn yj-select-sm" @click="add">+ Add a question</button>
    </template>
  </div>
</template>
