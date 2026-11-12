<script setup lang="ts">
// The few glyphs the components need themselves, so the package has no icon dependency.
defineProps<{ name: "chevron" | "more" | "check" | "cross" | "spinner" | "circle" }>();
</script>

<template>
  <svg class="yj-icon" :class="name === 'spinner' && 'yj-spin'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-if="name === 'chevron'" d="m6 9 6 6 6-6" />
    <template v-else-if="name === 'more'"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></template>
    <template v-else-if="name === 'check'"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></template>
    <template v-else-if="name === 'cross'"><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></template>
    <path v-else-if="name === 'spinner'" d="M21 12a9 9 0 1 1-6.22-8.56" />
    <circle v-else cx="12" cy="12" r="10" />
  </svg>
</template>
