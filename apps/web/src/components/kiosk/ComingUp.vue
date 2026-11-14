<script setup lang="ts">
// What's coming up (SCH-8), on Ask Me before a conversation starts: today and the next few days from
// the Scheduler (this person's entries and their services' dates), and the to-dos that wait.
import { dayOf } from "@sekaran-ind/yaxb-core/schedule";
import { Cake, CalendarDays, CheckCircle2, Heart } from "@lucide/vue";
import { computed } from "vue";
import { useSchedule } from "@/composables/schedule";

const emit = defineEmits<{ open: [] }>();
const s = useSchedule();
const soon = computed(() => s.upcoming(7));
const shown = computed(() => soon.value.dated.slice(0, 4));
const waiting = computed(() => soon.value.overdue.length + soon.value.undated.length);
const today = s.today();
const when = (iso: string) => {
  const diff = Math.round((dayOf(iso).getTime() - dayOf(today).getTime()) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : dayOf(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
};
const icon = (k: string) => (k === "birthday" ? Cake : k === "anniversary" ? Heart : k === "todo" ? CheckCircle2 : CalendarDays);
</script>

<template>
  <section v-if="shown.length || waiting" class="mx-auto mt-8 w-full max-w-md text-left" aria-labelledby="coming-up">
    <div class="mb-2 flex items-center justify-between">
      <h3 id="coming-up" class="eyebrow">Coming up</h3>
      <button type="button" class="text-xs font-medium text-ink hover:underline" @click="emit('open')">Open the Scheduler</button>
    </div>
    <ul class="space-y-1.5">
      <li v-for="o in shown" :key="`${o.id}-${o.date}`" class="flex items-center gap-3 rounded-xl bg-mist px-3 py-2">
        <component :is="icon(o.kind)" class="size-4 shrink-0 text-brand" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-sm text-ink">{{ o.title }}<template v-if="o.years"> · {{ o.kind === "birthday" ? `turns ${o.years}` : `${o.years} years` }}</template></span>
        <span class="shrink-0 text-xs text-gray-500">{{ when(o.date) }}{{ o.time ? ` ${o.time}` : "" }}</span>
      </li>
    </ul>
    <p v-if="waiting" class="mt-2 text-xs text-gray-600">{{ waiting }} to-do{{ waiting === 1 ? "" : "s" }} waiting.</p>
  </section>
</template>
