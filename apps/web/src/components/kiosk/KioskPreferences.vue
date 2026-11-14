<script setup lang="ts">
// The visitor's preferences inside the kiosk (the profile button in the player): they take the
// place of the kiosk's screens until the visitor goes back. Every change applies at once, so there
// is nothing to finish: the one way out is the back link (docs/ux/patterns.md, Exits). There is no
// separate settings page.
import { ArrowLeft } from "@lucide/vue";
import SettingsPanel from "@/components/settings/SettingsPanel.vue";

defineProps<{ nickname: string | null; fill?: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <section aria-labelledby="prefs-title" :class="fill ? 'flex h-full min-h-0 flex-col gap-3' : 'space-y-4'">
    <header class="min-w-0">
      <button type="button" class="btn-ghost -ml-2 h-9 px-2 text-sm" @click="emit('close')"><ArrowLeft class="size-4" aria-hidden="true" /> Back</button>
      <h2 id="prefs-title" class="mt-1 text-lg font-semibold text-ink">Preferences</h2>
      <p class="text-xs text-gray-500">{{ nickname ? `Signed in as ${nickname}` : "Not signed in" }} · changes apply at once and stay on this device</p>
    </header>
    <SettingsPanel :fill="fill" :class="fill && 'min-h-0 flex-1'" />
  </section>
</template>
