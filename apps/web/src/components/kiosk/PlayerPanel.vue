<script setup lang="ts">
// The kiosk's player (ConsolePlayer): the orb, the status, the voice bars, the notebook line and
// the person's controls (PlayerButtons, in the "actions" slot). Speaking is done from the message
// box (PLY-1): the microphone and the reading controls are there, not here.
//   full   the console column    strip  the pod player's bar    mini  orb, status and controls
// Slots: "meta" (the notebook and model status) and "actions" (the controls).
import BrandLogo from "@/components/site/BrandLogo.vue";
import { computed } from "vue";
import { cn } from "@/lib/cn";
import ConsolePlayer from "@/components/site/ConsolePlayer.vue";
import type { KioskStatus } from "@/lib/types";

const props = withDefaults(
  defineProps<{
    status: KioskStatus;
    title: string;
    isPlaying: boolean;
    listening: boolean;
    interim: string;
    voiceSupported: boolean;
    variant?: "full" | "strip" | "mini";
  }>(),
  { variant: "full" },
);

const working = computed(() => props.status === "Fetching" || props.status === "Thinking");
const busy = computed(() => props.status !== "Ready" && props.status !== "Fetch failed");
const live = computed(() => props.isPlaying || props.listening);
// Voice bars: fixed heights (a gentle arc) with staggered timing, so idle looks calm and live looks alive.
const BARS = Array.from({ length: 28 }, (_, i) => ({ h: 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / 28) ** 1.5, delay: `${((i * 137) % 100) / 100}s` }));
const STATUS_TEXT: Partial<Record<KioskStatus, string>> = { Ready: "Ready when you are" };
</script>

<template>
  <ConsolePlayer :variant="variant" :eyebrow="title" :status="STATUS_TEXT[status] ?? status" :busy="busy" label="Kiosk player">
    <template #controls><slot name="controls" /></template>
    <template #orb="{ size }"><BrandLogo :class="cn(size, working && 'animate-pulse')" /></template>
    <template #under-status>
      <p v-if="listening && variant !== 'mini'" :class="cn('text-white/60 italic', variant === 'full' ? 'mt-2 min-h-6 max-w-xs text-center text-sm' : 'truncate text-xs')">{{ interim || "…" }}</p>
    </template>
    <template v-if="$slots.meta && !(listening && variant !== 'full')" #meta><slot name="meta" /></template>
    <template #body>
      <div class="flex h-20 items-center gap-[3px]" aria-hidden="true">
        <span v-for="(b, i) in BARS" :key="i" :class="cn('voice-bar', live && 'voice-bar-live', !live && 'opacity-40')" :style="{ height: `${Math.round(b.h * 100)}%`, animationDelay: b.delay }" />
      </div>
    </template>
    <template v-if="variant === 'strip'" #strip-body>
      <div class="hidden h-10 items-center gap-[3px] sm:flex" aria-hidden="true">
        <span v-for="(b, i) in BARS" :key="i" :class="cn('voice-bar', live && 'voice-bar-live', !live && 'opacity-40')" :style="{ height: `${Math.round(b.h * 100)}%`, animationDelay: b.delay }" />
      </div>
    </template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <template v-if="!voiceSupported" #foot><p class="text-center text-xs text-white/60">Voice input needs Chrome or Edge. You can still type.</p></template>
  </ConsolePlayer>
</template>
