<script setup lang="ts">
import type { EntryStatus } from "@sekaran-ind/yaxb-core/library";
import { cn } from "@/lib/cn";

defineProps<{ status: EntryStatus }>();
const LOOK: Record<EntryStatus, [string, string]> = {
  draft: ["Draft", "bg-mist text-gray-600"],
  in_review: ["In review", "bg-info/10 text-info"],
  accepted: ["Published", "bg-success/10 text-ink"],
  rejected: ["Rejected", "bg-danger/10 text-red-800"],
  archived: ["Archived", "bg-mist text-gray-500"],
};
</script>

<template>
  <span :class="cn('inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', LOOK[status][1])">{{ LOOK[status][0] }}</span>
</template>
