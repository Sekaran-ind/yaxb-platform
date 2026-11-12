<script setup lang="ts">
// One line of text that scrolls sideways only when it doesn't fit (and not with reduced motion).
import { onBeforeUnmount, onMounted, onUpdated, ref } from "vue";
import { cn } from "@/lib/cn";

const box = ref<HTMLElement | null>(null);
const item = ref<HTMLElement | null>(null);
const overflow = ref(false);
// Measured on the next frame, and only the box is observed: switching to scrolling changes the
// line's own layout, which must not feed back into the observer.
let frame = 0;
const measure = () => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const next = Boolean(box.value && item.value && item.value.scrollWidth > box.value.clientWidth + 1);
    if (next !== overflow.value) overflow.value = next;
  });
};
let ro: ResizeObserver | null = null;
onMounted(() => {
  measure();
  ro = new ResizeObserver(measure);
  if (box.value) ro.observe(box.value);
});
onUpdated(measure);
onBeforeUnmount(() => {
  ro?.disconnect();
  cancelAnimationFrame(frame);
});
</script>

<template>
  <div ref="box" :class="cn('overflow-hidden whitespace-nowrap', overflow && 'marquee')">
    <span :class="overflow ? 'marquee-track' : 'block'">
      <span ref="item" class="inline-block"><slot /></span>
      <span v-if="overflow" aria-hidden="true" class="inline-block pl-10"><slot /></span>
    </span>
  </div>
</template>
