<script setup lang="ts">
// The kiosk's console: the original Details (orb, waveform, status) and Controls (mic, pause, stop).
//   full   the console column    strip  the pod player's bar    mini  orb, status and mic
import { Loader2, Mic, MicOff, Pause, Play, Square } from "@lucide/vue";
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
const orbSize = computed(() => (props.variant === "mini" ? 44 : props.variant === "strip" ? 64 : 140));
const small = computed(() => props.variant !== "full");
const wave = computed(() => (props.isPlaying || props.listening ? "/Waveform.gif" : "/SWaveform.png"));
</script>

<template>
  <div
    :class="
      cn(
        'console',
        variant === 'full' && 'flex h-[600px] flex-col items-center justify-between',
        variant === 'strip' && 'flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-4',
        variant === 'mini' && 'flex items-center justify-between gap-3 rounded-2xl px-4 py-3',
      )
    "
  >
    <div :class="variant === 'full' ? 'flex flex-col items-center' : 'flex min-w-0 items-center gap-3'">
      <div :class="cn('console-orb flex shrink-0 items-center justify-center overflow-hidden rounded-full', variant === 'full' && 'mt-10')" :style="{ width: `${orbSize}px`, height: `${orbSize}px` }">
        <img :src="working ? '/XDZT.gif' : '/icon.png'" alt="" class="h-1/2 w-auto rotate-180" />
      </div>
      <div :class="variant === 'full' ? 'flex flex-col items-center' : 'min-w-0'">
        <h2 :class="cn('font-medium tracking-wide uppercase', variant === 'full' ? 'mt-8 text-center text-2xl' : variant === 'strip' ? 'truncate text-lg' : 'truncate text-sm')">{{ title }}</h2>
        <img v-if="variant === 'full'" :src="wave" alt="" class="mt-6 h-[100px] w-auto max-w-[250px]" />
        <p :class="cn('flex items-center gap-2 text-sm font-semibold text-gray-300', variant === 'full' && 'mt-4')" role="status" aria-live="polite">
          {{ status }}<Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" />
        </p>
        <p v-if="listening && variant !== 'mini'" :class="cn('text-gray-400 italic', variant === 'full' ? 'mt-2 min-h-6 max-w-xs text-center text-sm' : 'truncate text-xs')">{{ interim || "…" }}</p>
      </div>
    </div>

    <img v-if="variant === 'strip'" :src="wave" alt="" class="hidden h-[48px] w-auto sm:block" />

    <div :class="cn('flex items-center', variant === 'full' ? 'mb-4 gap-5' : 'gap-2')">
      <button v-if="variant !== 'mini'" type="button" :class="cn('console-btn', small ? 'size-9' : 'size-12')" :disabled="!speaking" :aria-label="status === 'Paused' ? 'Resume speech' : 'Pause speech'" @click="emit('pauseResume')">
        <Play v-if="status === 'Paused'" :class="small ? 'size-4' : 'size-5'" />
        <Pause v-else :class="small ? 'size-4' : 'size-5'" />
      </button>
      <button
        type="button"
        :class="cn('console-btn bg-brand/20 text-brand hover:text-white', variant === 'full' ? 'size-20' : 'size-12')"
        :disabled="micDisabled"
        :aria-pressed="listening"
        :aria-label="listening ? 'Stop listening' : 'Ask by voice'"
        :title="voiceSupported ? 'Ask by voice' : 'Voice input is not supported in this browser'"
        @click="emit('mic')"
      >
        <MicOff v-if="listening" :class="variant === 'full' ? 'size-8' : 'size-5'" />
        <Mic v-else :class="variant === 'full' ? 'size-8' : 'size-5'" />
      </button>
      <button v-if="variant !== 'mini'" type="button" :class="cn('console-btn', small ? 'size-9' : 'size-12')" aria-label="Stop" @click="emit('stop')">
        <Square :class="small ? 'size-4' : 'size-5'" />
      </button>
    </div>
    <p v-if="variant === 'full' && !voiceSupported" class="text-center text-xs text-gray-400">Voice input needs Chrome or Edge. You can still type.</p>
  </div>
</template>
