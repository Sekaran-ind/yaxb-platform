<script setup lang="ts">
// A questionnaire's questions. With several sections, each is a screen of the adaptive nav, with
// a "Next" button through them; with one, the questions are a plain list. Fields whose `when`
// doesn't hold are hidden. The values are the caller's (v-model).
import { fieldVisible, type Field, type Scope, type StepSection } from "@sekaran-ind/yaxb-journeys/journeys";
import type { NavMode } from "@sekaran-ind/yaxb-journeys/screens";
import { computed, ref, watch } from "vue";
import AdaptiveNav from "./AdaptiveNav.vue";
import QuestionField, { type LanguageOption, type SourceOption } from "./QuestionField.vue";

const props = defineProps<{
  fields: Field[];
  sections?: StepSection[];
  modelValue: Record<string, unknown>;
  /** answers and context, for `when` conditions that read earlier steps. */
  scope?: Scope;
  width: number;
  storageKey?: string;
  navMode?: NavMode;
  lockMode?: boolean;
  sources?: SourceOption[];
  languages?: LanguageOption[];
  /** Field ids to mark as needing attention. */
  invalid?: string[];
}>();
const emit = defineEmits<{ "update:modelValue": [values: Record<string, unknown>] }>();

const byId = computed(() => new Map(props.fields.map((f) => [f.id, f])));
const visible = (f: Field) => {
  try {
    return fieldVisible(f, props.modelValue, props.scope);
  } catch {
    return true;
  }
};
const sectionFields = (s: StepSection) => s.fields.map((id) => byId.value.get(id)).filter((f): f is Field => Boolean(f && visible(f)));
const paged = computed(() => (props.sections?.length ?? 0) > 1);
const empty = (v: unknown) => v === undefined || v === null || v === "";
const left = (s: StepSection) => sectionFields(s).filter((f) => f.required && empty(props.modelValue[f.id])).length;
const screens = computed(() => (props.sections ?? []).map((s) => ({ id: s.id, label: s.title, badge: left(s) ? `${left(s)} to do` : undefined })));

const active = ref<string | null>(props.sections?.[0]?.id ?? null);
watch(
  () => props.sections?.map((s) => s.id).join(","),
  () => {
    if (!props.sections?.some((s) => s.id === active.value)) active.value = props.sections?.[0]?.id ?? null;
  },
);
const nextOf = (s: StepSection) => {
  const list = props.sections ?? [];
  return list[list.findIndex((x) => x.id === s.id) + 1] ?? null;
};
const set = (id: string, v: unknown) => emit("update:modelValue", { ...props.modelValue, [id]: v });
const isInvalid = (id: string) => props.invalid?.includes(id) ?? false;

/** Open the first section with a field that needs attention (after a failed submit). */
function reveal(ids: string[]) {
  const s = props.sections?.find((x) => x.fields.some((f) => ids.includes(f)));
  if (s) active.value = s.id;
}
defineExpose({ reveal });
</script>

<template>
  <div class="yj yj-questionnaire">
    <AdaptiveNav v-if="paged" v-model:active="active" :screens="screens" :width="width" :storage-key="storageKey ?? 'questionnaire'" :mode="navMode ?? 'tabs'" :lock-mode="lockMode">
      <template v-for="s in sections" :key="s.id" #[s.id]>
        <p v-if="s.summary" class="yj-muted yj-small yj-section-summary">{{ s.summary }}</p>
        <div class="yj-form-fields">
          <QuestionField v-for="f in sectionFields(s)" :key="f.id" :field="f" :value="modelValue[f.id]" :sources="sources" :languages="languages" :invalid="isInvalid(f.id)" @change="(v) => set(f.id, v)" />
        </div>
        <div v-if="nextOf(s)" class="yj-section-foot">
          <button type="button" class="yj-btn" @click="active = nextOf(s)!.id">Next: {{ nextOf(s)!.title }}</button>
        </div>
      </template>
    </AdaptiveNav>
    <div v-else class="yj-form-fields">
      <QuestionField v-for="f in fields.filter(visible)" :key="f.id" :field="f" :value="modelValue[f.id]" :sources="sources" :languages="languages" :invalid="isInvalid(f.id)" @change="(v) => set(f.id, v)" />
    </div>
  </div>
</template>
