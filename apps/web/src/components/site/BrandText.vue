<script setup lang="ts">
// The brand in text: every "Anjalai" shows as "Anjal" with "ai" in the accent gradient, so the
// name catches the eye wherever it appears (the wordmark, the platform cards, the diagram). Screen
// readers hear one word.
import { computed } from "vue";

const props = defineProps<{ text: string }>();
const parts = computed(() => props.text.split(/(Anjalai)/));
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <span v-if="part === 'Anjalai'" class="whitespace-nowrap" aria-label="Anjalai">Anjal<span class="brand-ai" aria-hidden="true">ai</span></span>
    <template v-else>{{ part }}</template>
  </template>
</template>
