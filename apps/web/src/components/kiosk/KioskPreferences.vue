<script setup lang="ts">
// The visitor's preferences inside the kiosk (the profile button in the player): it takes the
// place of the kiosk's screens until closed. There is no separate settings page.
import { ArrowLeft } from "@lucide/vue";
import SettingsPanel from "@/components/settings/SettingsPanel.vue";

defineProps<{ nickname: string | null }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <section aria-labelledby="prefs-title" class="space-y-4">
    <header class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <button type="button" class="btn-ghost size-9 p-0" aria-label="Back to the kiosk" @click="emit('close')"><ArrowLeft class="size-4" aria-hidden="true" /></button>
        <div class="min-w-0">
          <h2 id="prefs-title" class="truncate text-lg font-semibold text-ink">Preferences</h2>
          <p class="truncate text-xs text-gray-500">{{ nickname ? `Signed in as ${nickname}` : "Not signed in" }} · saved on this device</p>
        </div>
      </div>
      <button type="button" class="btn-primary h-9 px-4 text-sm" @click="emit('close')">Done</button>
    </header>
    <SettingsPanel />
  </section>
</template>
