<script setup lang="ts">
// A request's (case's) state as a chip: one word and one colour per state, everywhere requests show
// (the work queue, CaseView). The longer "Waiting for Organiser" goes beside it as a fact.
import type { CaseSummary } from "@sekaran-ind/yaxb-core/cases";
import { cn } from "@/lib/cn";

defineProps<{ status: CaseSummary["status"] }>();
const LOOK: Record<CaseSummary["status"], [string, string]> = {
  waiting: ["Waiting", "bg-info/10 text-info"],
  to_finish: ["To close", "bg-info/10 text-info"],
  done: ["Done", "bg-success/10 text-ink"],
  declined: ["Declined", "bg-danger/10 text-red-800"],
};
</script>

<template>
  <span :class="cn('inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', LOOK[status][1])">{{ LOOK[status][0] }}</span>
</template>
