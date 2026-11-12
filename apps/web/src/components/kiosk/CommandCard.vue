<script setup lang="ts">
// A kiosk command in the conversation (CMD-1..6): an "AI cover" saying what the kiosk understood
// and will do, around the content (what changes, a journey's summary, the kiosk's answer about
// itself, a refusal), with Yes / No when it changes something.
import { kioskContent } from "@sekaran-ind/yaxb-core/content";
import { ArrowRight, Ban, Check, CheckCircle2, LogIn, Sparkles, Undo2, X } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/cn";
import type { CommandCard } from "@/lib/types";
import JourneySummaryCard from "./JourneySummaryCard.vue";

const props = defineProps<{ card: CommandCard; canAskAssistant?: boolean }>();
const emit = defineEmits<{ yes: []; no: []; start: []; signIn: []; askAssistant: [] }>();

const journey = computed(() => (props.card.journey ? kioskContent.journeys.find((j) => j.id === props.card.journey) : undefined));
const STATE_NOTE: Partial<Record<CommandCard["state"], string>> = { done: "Done.", cancelled: "Cancelled. Nothing was changed." };
</script>

<template>
  <section
    :class="
      cn(
        'overflow-hidden rounded-xl ring-1',
        card.state === 'refused' ? 'ring-danger/30' : card.state === 'confirm' ? 'ring-brand/40' : 'ring-gray-200',
      )
    "
    :aria-label="card.title"
  >
    <!-- The AI cover: what the kiosk understood and will do. -->
    <header :class="cn('flex items-start gap-2 px-4 py-2.5 text-sm', card.state === 'refused' ? 'bg-danger/10 text-red-800' : 'bg-brand/10 text-ink')">
      <Ban v-if="card.state === 'refused'" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <Sparkles v-else class="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
      <span class="min-w-0">
        <span class="font-medium">{{ card.title }}</span>
        <span class="block text-xs text-gray-600">Understood as a kiosk command, handled on this device.</span>
      </span>
    </header>

    <div class="space-y-3 bg-surface px-4 py-3 text-sm">
      <p v-if="card.text" class="leading-relaxed whitespace-pre-wrap text-ink">{{ card.text }}</p>

      <table v-if="card.changes?.length" class="w-full text-left text-sm">
        <thead class="text-xs text-gray-500"><tr><th class="py-1 font-normal">Setting</th><th class="py-1 font-normal">Now</th><th class="py-1 font-normal">After</th></tr></thead>
        <tbody>
          <tr v-for="c in card.changes" :key="c.label" class="border-t border-gray-100">
            <td class="py-1.5 pr-3 text-gray-600">{{ c.label }}</td>
            <td class="py-1.5 pr-3 text-gray-500 line-through decoration-gray-300">{{ c.from }}</td>
            <td class="py-1.5 font-medium text-ink">{{ c.to }}</td>
          </tr>
        </tbody>
      </table>

      <JourneySummaryCard v-if="journey" :journey="journey" compact />

      <p v-if="STATE_NOTE[card.state]" role="status" class="flex items-center gap-1.5 text-gray-600">
        <CheckCircle2 v-if="card.state === 'done'" class="size-4 text-success" aria-hidden="true" /><Undo2 v-else class="size-4" aria-hidden="true" />{{ STATE_NOTE[card.state] }}
      </p>

      <div v-if="card.state === 'confirm'" class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-primary" :disabled="card.profile === undefined && card.command === 'profile.update'" @click="emit('yes')"><Check class="size-4" aria-hidden="true" /> Yes</button>
        <button type="button" class="btn-light" @click="emit('no')"><X class="size-4" aria-hidden="true" /> No</button>
        <span class="text-xs text-gray-500">You can also say "yes" or "no".</span>
      </div>
      <button v-if="card.state === 'confirm' && card.canAskAssistant && canAskAssistant" type="button" class="text-sm font-medium text-brand-dark hover:underline" @click="emit('askAssistant')">
        Ask the assistant to read what I said
      </button>
      <button v-if="card.state === 'needs-profile'" type="button" class="btn-light" @click="emit('signIn')"><LogIn class="size-4" aria-hidden="true" /> Sign in or create a profile</button>
      <button v-if="journey && card.state === 'info'" type="button" class="btn-primary" @click="emit('start')">Start <ArrowRight class="size-4" aria-hidden="true" /></button>
    </div>
  </section>
</template>
