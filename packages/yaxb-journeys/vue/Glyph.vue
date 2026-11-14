<script setup lang="ts">
// The few glyphs the components need themselves, so the package has no icon dependency.
defineProps<{ name: "chevron" | "more" | "check" | "cross" | "spinner" | "circle" | "up" | "down" | "back" | "lock" }>();
</script>

<template>
  <svg class="yj-icon" :class="name === 'spinner' && 'yj-spin'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-if="name === 'chevron'" d="m6 9 6 6 6-6" />
    <template v-else-if="name === 'more'"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></template>
    <template v-else-if="name === 'check'"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></template>
    <template v-else-if="name === 'cross'"><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></template>
    <path v-else-if="name === 'up'" d="M12 19V5m-7 7 7-7 7 7" />
    <path v-else-if="name === 'down'" d="M12 5v14m7-7-7 7-7-7" />
    <path v-else-if="name === 'back'" d="M19 12H5m7 7-7-7 7-7" />
    <template v-else-if="name === 'lock'"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></template>
    <path v-else-if="name === 'spinner'" d="M21 12a9 9 0 1 1-6.22-8.56" />
    <circle v-else cx="12" cy="12" r="10" />
  </svg>
</template>
