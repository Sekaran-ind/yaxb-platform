<script setup lang="ts">
// The kiosk's player (ConsolePlayer): the orb, the status, the voice bars, the notebook line and
// the voice controls (pause, the microphone, stop).
//   full   the console column    strip  the pod player's bar    mini  orb, status and mic
// Slots: "meta" (the notebook and model status) and "controls" (the profile button).
import { Mic, MicOff, Pause, Play, Sparkles, Square } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/cn";
import ConsolePlayer from "@/components/site/ConsolePlayer.vue";
import type { KioskStatus } from "@/lib/types";

const props = withDefaults(
  defineProps<{
    status: KioskStatus;
    title: string;
    isPlaying: boolean;
    speaking: boolean;
    listening: boolean;
    interim: string;
    voiceSupported: boolean;
    canAsk: boolean;
    variant?: "full" | "strip" | "mini";
  }>(),
  { variant: "full" },
);
const emit = defineEmits<{ mic: []; pauseResume: []; stop: [] }>();

const working = computed(() => props.status === "Fetching" || props.status === "Thinking");
const busy = computed(() => props.status !== "Ready" && props.status !== "Fetch failed");
const micDisabled = computed(() => !props.voiceSupported || (!props.canAsk && !props.listening));
const small = computed(() => props.variant !== "full");
const live = computed(() => props.isPlaying || props.listening);
// Voice bars: fixed heights (a gentle arc) with staggered timing, so idle looks calm and live looks alive.
const BARS = Array.from({ length: 28 }, (_, i) => ({ h: 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / 28) ** 1.5, delay: `${((i * 137) % 100) / 100}s` }));
const STATUS_TEXT: Partial<Record<KioskStatus, string>> = { Ready: "Ready when you are" };
</script>

<template>
  <ConsolePlayer :variant="variant" :eyebrow="title" :status="STATUS_TEXT[status] ?? status" :busy="busy" label="Kiosk player">
    <template #controls><slot name="controls" /></template>
    <template #orb="{ size }"><Sparkles :class="cn('text-white/85', working && 'animate-pulse text-brand', size)" aria-hidden="true" /></template>
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
    <template #actions>
      <button v-if="variant !== 'mini'" type="button" :class="cn('console-btn', small ? 'size-9' : 'size-12')" :disabled="!speaking" :aria-label="status === 'Paused' ? 'Resume speech' : 'Pause speech'" @click="emit('pauseResume')">
        <Play v-if="status === 'Paused'" :class="small ? 'size-4' : 'size-5'" />
        <Pause v-else :class="small ? 'size-4' : 'size-5'" />
      </button>
      <button
        type="button"
        :class="cn('flex items-center justify-center rounded-full bg-brand text-console transition duration-200 hover:brightness-110 disabled:opacity-40', listening && 'ring-8 ring-brand/25', variant === 'full' ? 'size-20 shadow-[0_0_40px_-6px_var(--color-brand)]' : 'size-11')"
        :disabled="micDisabled"
        :aria-pressed="listening"
        :aria-label="listening ? 'Stop listening' : 'Ask by voice'"
        :title="voiceSupported ? 'Ask by voice' : 'Voice input is not supported here'"
        @click="emit('mic')"
      >
        <MicOff v-if="listening" :class="variant === 'full' ? 'size-8' : 'size-5'" />
        <Mic v-else :class="variant === 'full' ? 'size-8' : 'size-5'" />
      </button>
      <button v-if="variant !== 'mini'" type="button" :class="cn('console-btn', small ? 'size-9' : 'size-12')" aria-label="Stop" @click="emit('stop')">
        <Square :class="small ? 'size-4' : 'size-5'" />
      </button>
    </template>
    <template v-if="!voiceSupported" #foot><p class="text-center text-xs text-white/60">Voice input needs Chrome or Edge. You can still type.</p></template>
  </ConsolePlayer>
</template>
