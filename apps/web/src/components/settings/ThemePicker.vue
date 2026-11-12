<script setup lang="ts">
// Choose the kiosk's theme: a row of swatch cards (Settings), or a compact menu (the kiosk header).
import { Check, MonitorSmartphone, Palette } from "@lucide/vue";
import { settings, updateSettings } from "@/composables/settings";
import { cn } from "@/lib/cn";
import { THEMES, type ThemeChoice } from "@/lib/themes";

defineProps<{ compact?: boolean }>();
const choose = (t: ThemeChoice) => updateSettings({ theme: t });
</script>

<template>
  <label v-if="compact" class="flex items-center gap-1.5 rounded-full bg-mist py-1 pr-1 pl-3 text-xs text-gray-600">
    <Palette class="size-4" aria-hidden="true" />
    <span class="sr-only">Theme</span>
    <select class="max-w-36 rounded-full border-0 bg-surface py-1 pr-7 pl-2 text-xs font-medium text-ink shadow-sm" :value="settings.theme" aria-label="Theme" @change="choose(($event.target as HTMLSelectElement).value as ThemeChoice)">
      <option value="system">Device</option>
      <option v-for="t in THEMES" :key="t.id" :value="t.id">{{ t.label }}</option>
    </select>
  </label>

  <div v-else role="radiogroup" aria-label="Theme" class="grid gap-3 @lg:grid-cols-3">
    <button
      type="button"
      role="radio"
      :aria-checked="settings.theme === 'system'"
      :class="cn('flex items-start gap-3 rounded-lg border p-3 text-left', settings.theme === 'system' ? 'border-brand-dark ring-2 ring-brand/40' : 'border-gray-200 hover:border-brand')"
      @click="choose('system')"
    >
      <MonitorSmartphone class="mt-0.5 size-5 shrink-0 text-gray-500" aria-hidden="true" />
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium text-ink">Device</span>
        <span class="block text-xs text-gray-500">Classic by day, Night when the device is dark</span>
      </span>
      <Check v-if="settings.theme === 'system'" class="size-4 text-brand-dark" aria-hidden="true" />
    </button>
    <button
      v-for="t in THEMES"
      :key="t.id"
      type="button"
      role="radio"
      :aria-checked="settings.theme === t.id"
      :class="cn('flex items-start gap-3 rounded-lg border p-3 text-left', settings.theme === t.id ? 'border-brand-dark ring-2 ring-brand/40' : 'border-gray-200 hover:border-brand')"
      @click="choose(t.id)"
    >
      <span class="mt-0.5 flex shrink-0 overflow-hidden rounded-full ring-1 ring-gray-300" aria-hidden="true">
        <span v-for="c in t.swatch" :key="c" class="size-3.5" :style="{ background: c }" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium text-ink">{{ t.label }}</span>
        <span class="block text-xs text-gray-500">{{ t.description }}</span>
      </span>
      <Check v-if="settings.theme === t.id" class="size-4 text-brand-dark" aria-hidden="true" />
    </button>
  </div>
</template>
