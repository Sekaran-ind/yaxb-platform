<script setup lang="ts">
// Requests (cases) as cards in the Services grid: the journey, its state chip, then one line of facts
// (where it stands, the reference, the last change). Opening one shows CaseView.
import type { CaseSummary } from "@sekaran-ind/yaxb-core/cases";
import { ChevronRight } from "@lucide/vue";
import { statusText } from "@/composables/cases";
import { roleName } from "@/composables/library";
import RequestStatus from "./RequestStatus.vue";

defineProps<{ items: CaseSummary[] }>();
const emit = defineEmits<{ open: [id: string] }>();
const when = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
</script>

<template>
  <ul class="grid gap-2 @lg:grid-cols-2">
    <li v-for="c in items" :key="c.id">
      <button type="button" class="card flex w-full items-center gap-3 p-3 text-left transition hover:border-gray-300" @click="emit('open', c.id)">
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-2">
            <span class="min-w-0 truncate text-sm font-medium text-ink">{{ c.journey_title }}</span>
            <RequestStatus :status="c.status" />
          </span>
          <span class="block text-xs text-gray-500">{{ statusText(c, roleName) }} · <span class="font-mono">{{ c.ref }}</span> · {{ when(c.updated_at) }}</span>
        </span>
        <ChevronRight class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
      </button>
    </li>
  </ul>
</template>
