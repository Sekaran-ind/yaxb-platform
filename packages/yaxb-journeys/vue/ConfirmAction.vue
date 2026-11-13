<script setup lang="ts">
// A destructive action that asks first, inline: the one confirmation pattern in YAXB. The button
// opens a short panel in its place that says what will happen, with the action and Cancel. Focus
// moves to Cancel (the safe choice; or to the box to type in); Escape or Cancel closes the panel and
// returns focus to the button.
//   triggerClass   the host's button classes (default: a quiet danger button)
//   typeToConfirm  the action waits until this text is typed (erasing a profile)
//   skip           nothing would be lost: act at once, without asking
import { nextTick, ref, useId } from "vue";

const props = withDefaults(
  defineProps<{
    /** The button's text, and the confirming button's unless confirmLabel is given. */
    label: string;
    /** What happens, naming the thing: "Remove the journey "Check in" and its screens?" */
    message: string;
    confirmLabel?: string;
    /** For an icon-only button. */
    ariaLabel?: string;
    title?: string;
    triggerClass?: string;
    disabled?: boolean;
    busy?: boolean;
    typeToConfirm?: string;
    skip?: boolean;
  }>(),
  { confirmLabel: undefined, ariaLabel: undefined, title: undefined, triggerClass: "yj-btn yj-btn-quiet yj-btn-danger", typeToConfirm: undefined },
);
const emit = defineEmits<{ confirm: [] }>();
const uid = useId();
const open = ref(false);
const typed = ref("");
const trigger = ref<HTMLButtonElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const cancel = ref<HTMLButtonElement | null>(null);

async function ask() {
  if (props.skip) return emit("confirm");
  typed.value = "";
  open.value = true;
  await nextTick();
  (input.value ?? cancel.value)?.focus();
}
async function close() {
  open.value = false;
  await nextTick();
  if (trigger.value?.isConnected) trigger.value.focus();
}
function act() {
  emit("confirm");
  void close();
}
defineExpose({ close });
</script>

<template>
  <span class="yj-confirm">
    <button v-if="!open" ref="trigger" type="button" :class="triggerClass" :aria-label="ariaLabel" :title="title ?? ariaLabel" :disabled="disabled || busy" @click="ask">
      <slot>{{ label }}</slot>
    </button>
    <span v-else class="yj yj-confirm-panel" role="group" :aria-labelledby="`${uid}-msg`" @keydown.esc.stop.prevent="close">
      <span :id="`${uid}-msg`" class="yj-block">{{ message }}</span>
      <label v-if="typeToConfirm !== undefined" class="yj-block">
        <span class="yj-block yj-small">Type “{{ typeToConfirm }}” to confirm</span>
        <input ref="input" v-model="typed" class="yj-input" autocomplete="off" spellcheck="false" />
      </label>
      <span class="yj-confirm-actions">
        <button type="button" class="yj-btn yj-btn-danger" :disabled="busy || (typeToConfirm !== undefined && typed !== typeToConfirm)" @click="act">{{ confirmLabel ?? label }}</button>
        <button ref="cancel" type="button" class="yj-btn" @click="close">Cancel</button>
      </span>
    </span>
  </span>
</template>
