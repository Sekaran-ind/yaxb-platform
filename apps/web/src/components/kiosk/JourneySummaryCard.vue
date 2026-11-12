<script setup lang="ts">
// What a journey does (JRN-20), from its definition: the steps in order, what it asks for, what it
// uses, and whether anything leaves the device.
import { summarizeJourney, type Journey } from "@sekaran-ind/yaxb-core/journeys";
import { Bot, Cpu, HelpCircle, NotebookPen, ShieldCheck, Split, Flag } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/cn";

const props = defineProps<{ journey: Journey; compact?: boolean }>();
const s = computed(() => summarizeJourney(props.journey));
const STEP_ICONS = { ask: HelpCircle, service: Cpu, decide: Split, final: Flag } as const;
const WHERE_ICONS = { device: Cpu, assistant: Bot, notebook: NotebookPen } as const;
</script>

<template>
  <div :class="cn('space-y-3 text-sm', !compact && 'card p-4')">
    <div v-if="!compact">
      <h4 class="font-semibold text-ink">{{ s.title }}</h4>
      <p v-if="s.summary" class="text-gray-600">{{ s.summary }}</p>
    </div>
    <p :class="cn('flex items-start gap-2 rounded-lg px-3 py-2', s.leavesDevice ? 'bg-warning/15 text-ink' : 'bg-success/10 text-ink')">
      <Bot v-if="s.leavesDevice" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <ShieldCheck v-else class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
      {{ s.privacy }}
    </p>
    <ol class="space-y-1.5" :aria-label="`Steps of ${s.title}`">
      <li v-for="(step, i) in s.steps" :key="step.id" class="flex items-start gap-2">
        <span class="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-mist text-xs text-gray-600">{{ i + 1 }}</span>
        <component :is="STEP_ICONS[step.kind]" class="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
        <span class="min-w-0">
          <span class="text-ink">{{ step.label }}</span>
          <span v-if="step.asks.length" class="block text-xs text-gray-500">Asks: {{ step.asks.join(", ") }}</span>
          <span v-if="step.service" class="flex items-center gap-1 text-xs text-gray-500">
            <component :is="WHERE_ICONS[step.service.where]" class="size-3" aria-hidden="true" /> Uses {{ step.service.label }}
          </span>
        </span>
      </li>
    </ol>
  </div>
</template>
