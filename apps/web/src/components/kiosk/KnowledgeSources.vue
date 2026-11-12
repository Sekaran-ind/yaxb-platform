<script setup lang="ts">
// The knowledge sources the agent answers from.
import { useAgentResource } from "@/composables/resource";
import type { KnowledgeSource } from "@/lib/types";

const { data, error } = useAgentResource<{ sources: KnowledgeSource[] }>("sources");
</script>

<template>
  <p v-if="error" class="p-4 text-sm text-red-800">Could not load the sources: {{ error }}</p>
  <p v-else-if="!data" class="p-4 text-sm text-gray-400">Loading…</p>
  <ol v-else class="divide-y divide-gray-100">
    <li v-for="(s, i) in data.sources" :key="s.id" class="flex items-start justify-between gap-4 px-2 py-4">
      <div class="flex gap-3">
        <span class="text-gray-400">{{ i + 1 }}.</span>
        <div>
          <p class="font-semibold text-ink">{{ s.title }}</p>
          <p class="mt-1 text-sm">{{ s.description }}</p>
          <p class="mt-1 text-xs text-gray-400">Moderator: {{ s.moderator }} · Curators: {{ s.curator }}<template v-if="s.baseline_date"> · Baseline {{ s.baseline_date }}</template></p>
        </div>
      </div>
      <span class="rounded-full bg-brand-dark px-2.5 py-0.5 text-xs font-medium text-on-brand">New</span>
    </li>
  </ol>
</template>
