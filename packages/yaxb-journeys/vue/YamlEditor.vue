<script setup lang="ts">
// A plain YAML editor: line numbers, marks for lines with problems, Tab to indent (Escape, then
// Tab, leaves it). No editor library: a textarea and a gutter that scroll together.
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    /** Lines to mark: line → "error" | "warning". */
    marks?: Map<number, "error" | "warning">;
    readonly?: boolean;
    describedby?: string;
    /** CSS height of the editor, e.g. "24rem". */
    height?: string;
  }>(),
  { marks: () => new Map() },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const editor = ref<HTMLTextAreaElement | null>(null);
const gutter = ref<HTMLElement | null>(null);
const lineCount = computed(() => props.modelValue.split("\n").length);
const set = (v: string) => emit("update:modelValue", v);
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
    <div class="yj-editor" :style="height ? { height } : undefined">
      <div ref="gutter" class="yj-gutter" aria-hidden="true">
        <span v-for="n in lineCount" :key="n" :class="marks.get(n) && `yj-gutter-${marks.get(n)}`">{{ n }}</span>
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
    </div>
    <p v-if="!readonly" class="yj-help">Tab indents. Press Escape, then Tab, to leave the editor.</p>
  </div>
</template>
