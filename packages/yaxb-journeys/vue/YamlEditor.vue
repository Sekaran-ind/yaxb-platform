<script setup lang="ts">
// The YAML editor: CodeMirror 6 (yaml-codemirror.ts), loaded only when an editor is shown, with
// YAML highlighting, line numbers, and the compiler's problems as marks on their lines (the message
// on hover). Tab indents; Escape, then Tab, leaves the editor. Until CodeMirror has loaded (or if it
// can't load), a plain textarea with a line gutter does the same job, so nothing waits on it.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { EditorMark, YamlEditorHandle } from "./yaml-codemirror";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    /** Lines to mark: line → "error" | "warning". */
    marks?: Map<number, "error" | "warning">;
    /** Problems with their messages (shown on hover); used instead of `marks` when given. */
    problems?: readonly { line: number; level: "error" | "warning"; message: string }[];
    readonly?: boolean;
    describedby?: string;
    /** CSS height of the editor, e.g. "24rem". */
    height?: string;
  }>(),
  { marks: () => new Map() },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const set = (v: string) => emit("update:modelValue", v);

const allMarks = computed<EditorMark[]>(() => props.problems?.map((p) => ({ line: p.line, level: p.level, message: p.message })) ?? [...props.marks].map(([line, level]) => ({ line, level })));
const markOf = computed(() => {
  const m = new Map<number, "error" | "warning">();
  for (const x of allMarks.value) if (m.get(x.line) !== "error") m.set(x.line, x.level);
  return m;
});

// ---- CodeMirror, on demand -----------------------------------------------------------------
const host = ref<HTMLElement | null>(null);
const cm = shallowRef<YamlEditorHandle | null>(null);
let alive = true;
onMounted(async () => {
  try {
    const { createYamlEditor } = await import("./yaml-codemirror");
    if (!alive || !host.value) return;
    cm.value = createYamlEditor(host.value, { doc: props.modelValue, label: props.label, describedby: props.describedby, readonly: props.readonly, onChange: set });
    cm.value.setMarks(allMarks.value);
  } catch {
    /* the textarea stays */
  }
});
onBeforeUnmount(() => {
  alive = false;
  cm.value?.destroy();
});
watch(
  () => props.modelValue,
  (v) => cm.value?.setDoc(v),
);
watch(allMarks, (m) => cm.value?.setMarks(m));
watch(
  () => props.readonly,
  (r) => cm.value?.setReadonly(Boolean(r)),
);

// ---- the textarea, until then --------------------------------------------------------------
const editor = ref<HTMLTextAreaElement | null>(null);
const gutter = ref<HTMLElement | null>(null);
const lineCount = computed(() => props.modelValue.split("\n").length);
const syncGutter = () => {
  if (gutter.value && editor.value) gutter.value.scrollTop = editor.value.scrollTop;
};
let released = false;
function onKeydown(e: KeyboardEvent) {
  if (props.readonly) return;
  const el = e.target as HTMLTextAreaElement;
  if (e.key === "Escape") {
    released = true;
    return;
  }
  if (e.key !== "Tab" || released || e.ctrlKey || e.metaKey || e.altKey) {
    if (e.key !== "Shift") released = false;
    return;
  }
  e.preventDefault();
  const { selectionStart: start, selectionEnd: end, value } = el;
  if (e.shiftKey) {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const cut = value.startsWith("  ", lineStart) ? 2 : value.startsWith(" ", lineStart) ? 1 : 0;
    if (!cut) return;
    el.setRangeText("", lineStart, lineStart + cut, "preserve");
    el.setSelectionRange(Math.max(lineStart, start - cut), Math.max(lineStart, end - cut));
  } else {
    el.setRangeText("  ", start, end, "end");
  }
  set(el.value);
}

/** Select a line and scroll it into view. */
function goToLine(line: number) {
  if (cm.value) return cm.value.goToLine(line);
  const el = editor.value;
  if (!el) return;
  const lines = props.modelValue.split("\n");
  const start = lines.slice(0, line - 1).reduce((n: number, l: string) => n + l.length + 1, 0);
  el.focus();
  el.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
  el.scrollTop = Math.max(0, (line - 4) * lh);
  syncGutter();
}
defineExpose({ goToLine });
</script>

<template>
  <div class="yj">
    <div class="yj-editor" :class="cm && 'yj-editor-cm'" :style="height ? { height } : undefined">
      <div v-show="cm" ref="host" class="yj-cm-host" />
      <template v-if="!cm">
        <div ref="gutter" class="yj-gutter" aria-hidden="true">
          <span v-for="n in lineCount" :key="n" :class="markOf.get(n) && `yj-gutter-${markOf.get(n)}`">{{ n }}</span>
        </div>
        <textarea
          ref="editor"
          class="yj-code-input"
          :value="modelValue"
          :readonly="readonly"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          wrap="off"
          :aria-label="label"
          :aria-describedby="describedby"
          @input="set(($event.target as HTMLTextAreaElement).value)"
          @scroll="syncGutter"
          @keydown="onKeydown"
        />
      </template>
    </div>
    <p v-if="!readonly" class="yj-help">Tab indents. Press Escape, then Tab, to leave the editor.</p>
  </div>
</template>
