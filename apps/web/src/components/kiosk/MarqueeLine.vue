<script setup lang="ts">
// One line of text that scrolls sideways only when it doesn't fit (and not with reduced motion).
import { onBeforeUnmount, onMounted, ref } from "vue";
import { cn } from "@/lib/cn";

const box = ref<HTMLElement | null>(null);
const item = ref<HTMLElement | null>(null);
const overflow = ref(false);
const measure = () => (overflow.value = Boolean(box.value && item.value && item.value.scrollWidth > box.value.clientWidth + 1));
let ro: ResizeObserver | null = null;
onMounted(() => {
  measure();
  ro = new ResizeObserver(measure);
  if (box.value) ro.observe(box.value);
  if (item.value) ro.observe(item.value);
});
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <div ref="box" :class="cn('overflow-hidden whitespace-nowrap', overflow && 'marquee')">
    <span :class="overflow ? 'marquee-track' : 'block'">
      <span ref="item" class="inline-block"><slot /></span>
      <span v-if="overflow" aria-hidden="true" class="inline-block pl-10"><slot /></span>
    </span>
  </div>
</template>
