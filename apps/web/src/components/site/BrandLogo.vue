<script setup lang="ts">
// The YAXB mark: the A with a person inside an orbit, in its violet-to-magenta gradient. One image
// for the site, the kiosk's player and the app icons (made from the same shape). Decorative unless a
// label is given.
import logoUrl from "@/assets/logo.svg?url";

defineProps<{ label?: string }>();
</script>

<template>
  <img :src="logoUrl" :alt="label ?? ''" :aria-hidden="label ? undefined : 'true'" draggable="false" class="select-none" />
</template>
