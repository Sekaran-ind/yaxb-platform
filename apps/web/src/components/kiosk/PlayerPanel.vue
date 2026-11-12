<script setup lang="ts">
// The kiosk's console: the original Details (orb, waveform, status) and Controls (mic, pause, stop).
//   full   the console column    strip  the pod player's bar    mini  orb, status and mic
import { Loader2, Mic, MicOff, Pause, Play, Sparkles, Square } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/cn";
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
const orbSize = computed(() => (props.variant === "mini" ? 36 : props.variant === "strip" ? 52 : 128));
const small = computed(() => props.variant !== "full");
const live = computed(() => props.isPlaying || props.listening);
// Voice bars: fixed heights (a gentle arc) with staggered timing, so idle looks calm and live looks alive.
const BARS = Array.from({ length: 28 }, (_, i) => ({ h: 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / 28) ** 1.5, delay: `${((i * 137) % 100) / 100}s` }));
const STATUS_TEXT: Partial<Record<KioskStatus, string>> = { Ready: "Ready when you are" };
</script>

<template>
  <div
    :class="
      cn(
        'console',
        variant === 'full' && 'flex h-[600px] flex-col items-center justify-between px-6 py-8',
        variant === 'strip' && 'flex flex-wrap items-center justify-between gap-4 px-5 py-4',
        variant === 'mini' && 'flex items-center justify-between gap-3 rounded-2xl px-4 py-3',
      )
    "
  >
    <div :class="variant === 'full' ? 'flex flex-col items-center' : 'flex min-w-0 items-center gap-3'">
      <div :class="cn('console-orb flex shrink-0 items-center justify-center overflow-hidden rounded-full', variant === 'full' && 'mt-6')" :style="{ width: `${orbSize}px`, height: `${orbSize}px` }">
        <Sparkles :class="cn('text-white/85', working && 'animate-pulse text-brand', variant === 'full' ? 'size-10' : variant === 'strip' ? 'size-6' : 'size-4')" aria-hidden="true" />
      </div>
      <div :class="variant === 'full' ? 'flex flex-col items-center' : 'min-w-0'">
        <p :class="cn('font-semibold tracking-[0.22em] text-white/60 uppercase', variant === 'full' ? 'mt-8 text-xs' : 'truncate text-[10px]')">{{ title }}</p>
        <p :class="cn('flex items-center gap-2 font-medium tracking-tight text-white', variant === 'full' ? 'mt-2 text-xl' : 'text-sm')" role="status" aria-live="polite">
          {{ STATUS_TEXT[status] ?? status }}<Loader2 v-if="busy" class="size-4 animate-spin text-brand" aria-hidden="true" />
        </p>
        <p v-if="listening && variant !== 'mini'" :class="cn('text-white/50 italic', variant === 'full' ? 'mt-2 min-h-6 max-w-xs text-center text-sm' : 'truncate text-xs')">{{ interim || "…" }}</p>
      </div>
    </div>

    <div v-if="variant !== 'mini'" :class="cn('flex items-center gap-[3px]', variant === 'full' ? 'h-20' : 'hidden h-10 sm:flex')" aria-hidden="true">
      <span v-for="(b, i) in BARS" :key="i" :class="cn('voice-bar', live && 'voice-bar-live', !live && 'opacity-40')" :style="{ height: `${Math.round(b.h * 100)}%`, animationDelay: b.delay }" />
    </div>

    <div :class="cn('flex items-center', variant === 'full' ? 'gap-5' : 'gap-2')">
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
    </div>
    <p v-if="variant === 'full' && !voiceSupported" class="text-center text-xs text-white/50">Voice input needs Chrome or Edge. You can still type.</p>
  </div>
</template>
