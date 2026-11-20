<script setup lang="ts">
// The Scheduler (SCH-1..8), in Quick tools: this person's to-dos, the birthdays and anniversaries of
// their friends and family, their events, and the dates of the services this kiosk offers (a
// marathon's race day). "Tell the Scheduler" reads a sentence into an entry to confirm (the
// Scheduler agent: on the device, then the AI model for what it couldn't tell); or add one by hand.
import { REPEATS, SCHEDULE_KINDS, dayOf, isoDay, occurrences, type Occurrence, type ScheduleDraft, type ScheduleItem } from "@sekaran-ind/yaxb-core/schedule";
import { occurrenceEvents } from "@sekaran-ind/yaxb-core/timeline";
import { EventTimeline } from "@sekaran-ind/yaxb-journeys/vue";
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { ArrowLeft, Cake, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Circle, Heart, Loader2, Pencil, Plus, Sparkles, Trash2 } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import SegmentedControl from "@/components/site/SegmentedControl.vue";
import { pendingScheduleText, useSchedule } from "@/composables/schedule";
import { useProviders } from "@/composables/settings";
import { cn } from "@/lib/cn";

const emit = defineEmits<{ back: [] }>();
const s = useSchedule();
const { data: catalog } = useProviders();

// ---- tell the Scheduler -------------------------------------------------------------------------
const said = ref("");
const reading = ref(false);
const via = ref<"device" | "assistant" | null>(null);
type Editing = ScheduleDraft & { id?: string; notes: string | null };
const editing = ref<Editing | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

async function read() {
  if (!said.value.trim()) return;
  reading.value = true;
  error.value = notice.value = null;
  try {
    const r = await s.draft(said.value, catalog.value);
    editing.value = { ...r.draft, notes: null };
    via.value = r.via;
  } finally {
    reading.value = false;
  }
}
// Words from /schedule, now or later (the Scheduler may already be open in Quick tools).
watch(
  pendingScheduleText,
  (text) => {
    if (!text) return;
    said.value = text;
    pendingScheduleText.value = "";
    void read();
  },
  { immediate: true },
);
const byHand = () => ((editing.value = { kind: "todo", title: "", date: null, time: null, repeat: "none", person: null, notes: null }), (via.value = null));
const edit = (i: ScheduleItem) => ((editing.value = { id: i.id, kind: i.kind, title: i.title, date: i.date, time: i.time, repeat: i.repeat, person: i.person, notes: i.notes }), (via.value = null));
async function save() {
  const e = editing.value;
  if (!e || !e.title.trim()) return void (error.value = "Give it a title.");
  if (e.kind !== "todo" && !e.date) return void (error.value = "Choose the day.");
  await s.save({ ...e, date: e.date || null, time: e.time || null, person: e.kind === "birthday" || e.kind === "anniversary" ? e.person || null : null });
  notice.value = `${e.id ? "Changed" : "Added"}: ${e.title}.`;
  editing.value = null;
  said.value = "";
}
const KIND: Record<string, string> = { todo: "To-do", birthday: "Birthday", anniversary: "Anniversary", event: "Event", service: "Service date" };
const REPEAT: Record<string, string> = { none: "Doesn't repeat", weekly: "Every week", monthly: "Every month", yearly: "Every year" };

// ---- views --------------------------------------------------------------------------------------
type View = "upcoming" | "month" | "timeline" | "todos" | "people";
const view = ref<View>("upcoming");
const VIEWS = [
  { value: "upcoming" as const, label: "Upcoming" },
  { value: "month" as const, label: "Month" },
  { value: "timeline" as const, label: "Timeline" },
  { value: "todos" as const, label: "To-dos" },
  { value: "people" as const, label: "Birthdays" },
];
const today = s.today();
const soon = computed(() => s.upcoming(30));
/** VIS-4: the past month and the next three on a timeline, a lane per kind. */
const timeline = computed(() => {
  const from = dayOf(today);
  return occurrenceEvents(occurrences(s.items.value, isoDay(new Date(from.getFullYear(), from.getMonth() - 1, from.getDate())), isoDay(new Date(from.getFullYear(), from.getMonth() + 3, from.getDate())), s.services.value));
});
const label = (iso: string) => {
  const d = dayOf(iso);
  const diff = Math.round((d.getTime() - dayOf(today).getTime()) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
};
const grouped = computed(() => {
  const out: { day: string; items: Occurrence[] }[] = [];
  for (const o of soon.value.dated) {
    const g = out.find((x) => x.day === o.date);
    if (g) g.items.push(o);
    else out.push({ day: o.date, items: [o] });
  }
  return out;
});
const itemOf = (o: Occurrence) => s.items.value.find((i) => i.id === o.id) ?? null;

// The month: a grid from Monday, with each day's entries.
const month = ref(new Date(dayOf(today).getFullYear(), dayOf(today).getMonth(), 1));
const monthDays = computed(() => {
  const first = month.value;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => isoDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  const occ = occurrences(s.items.value, days[0]!, days[41]!, s.services.value);
  return days.map((d) => ({ day: d, inMonth: dayOf(d).getMonth() === first.getMonth(), items: occ.filter((o) => o.date === d) }));
});
const picked = ref<string>(today);
const pickedItems = computed(() => monthDays.value.find((d) => d.day === picked.value)?.items ?? []);
const moveMonth = (n: number) => (month.value = new Date(month.value.getFullYear(), month.value.getMonth() + n, 1));

const todos = computed(() => s.items.value.filter((i) => i.kind === "todo").sort((a, b) => Number(a.done) - Number(b.done) || (a.date ?? "9").localeCompare(b.date ?? "9")));
const people = computed(() => {
  const next = occurrences(s.items.value.filter((i) => i.kind === "birthday" || i.kind === "anniversary"), today, isoDay(new Date(dayOf(today).getFullYear() + 1, dayOf(today).getMonth(), dayOf(today).getDate() - 1)));
  return next;
});
const kindIcon = (k: string) => (k === "birthday" ? Cake : k === "anniversary" ? Heart : k === "service" ? CalendarDays : k === "todo" ? CheckCircle2 : CalendarDays);
const when = (o: Pick<Occurrence, "time">) => (o.time ? ` · ${o.time}` : "");
</script>

<template>
  <section class="@container space-y-5" aria-labelledby="sched-title">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <button type="button" class="btn-ghost -ml-2 h-9 px-2 text-sm" @click="emit('back')"><ArrowLeft class="size-4" aria-hidden="true" /> Quick tools</button>
        <h2 id="sched-title" class="flex items-center gap-2 text-xl font-semibold text-ink"><CalendarDays class="size-5 text-brand" aria-hidden="true" /> Scheduler</h2>
        <p class="text-sm text-gray-600">Your to-dos, birthdays and anniversaries, and your services' dates. Kept on this device{{ " " }}with your profile.</p>
      </div>
    </div>

    <!-- Tell the Scheduler (the Scheduler agent) -->
    <form class="card space-y-2 p-4" @submit.prevent="read">
      <label for="sched-said" class="flex items-center gap-2 text-sm font-medium text-ink"><Sparkles class="size-4 text-brand" aria-hidden="true" /> Tell the Scheduler</label>
      <div class="flex flex-wrap gap-2">
        <input id="sched-said" v-model="said" class="input min-w-0 basis-full @lg:basis-0 @lg:flex-1" placeholder="e.g. Mum's birthday on 3 March, or remind me to renew the passport next Friday" autocomplete="off" />
        <button type="submit" class="btn-primary h-11" :disabled="reading || !said.trim()"><Loader2 v-if="reading" class="size-4 animate-spin" aria-hidden="true" /> Read it</button>
        <button type="button" class="btn-light h-11" @click="byHand"><Plus class="size-4" aria-hidden="true" /> Add by hand</button>
      </div>
    </form>

    <!-- The entry to confirm (or change) -->
    <form v-if="editing" class="card space-y-3 p-4" @submit.prevent="save">
      <p class="text-sm text-gray-600">{{ editing.id ? "Change this entry" : via === "assistant" ? "The assistant read this. Check it, then add it." : via === "device" ? "Read on this device. Check it, then add it." : "A new entry" }}</p>
      <div class="grid gap-3 @lg:grid-cols-2">
        <label class="block text-sm"><span class="mb-1 block font-medium text-ink">What it is</span>
          <select v-model="editing.kind" class="input"><option v-for="k in SCHEDULE_KINDS" :key="k" :value="k">{{ KIND[k] }}</option></select>
        </label>
        <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Title</span><input v-model="editing.title" class="input" maxlength="120" required /></label>
        <label v-if="editing.kind === 'birthday' || editing.kind === 'anniversary'" class="block text-sm"><span class="mb-1 block font-medium text-ink">Whose</span><input v-model="editing.person" class="input" maxlength="80" placeholder="Mum, Ravi…" /></label>
        <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Day <span v-if="editing.kind === 'todo'" class="font-normal text-gray-500">(optional)</span></span><input v-model="editing.date" type="date" class="input" /></label>
        <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Time <span class="font-normal text-gray-500">(optional)</span></span><input v-model="editing.time" type="time" class="input" /></label>
        <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Repeats</span>
          <select v-model="editing.repeat" class="input"><option v-for="r in REPEATS" :key="r" :value="r">{{ REPEAT[r] }}</option></select>
        </label>
      </div>
      <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
      <div class="flex gap-2">
        <button type="submit" class="btn-primary h-10">{{ editing.id ? "Save" : "Add it" }}</button>
        <button type="button" class="btn-ghost h-10" @click="(editing = null), (error = null)">Cancel</button>
      </div>
    </form>
    <p v-if="notice" role="status" class="rounded-lg bg-mist px-3 py-2 text-sm text-ink">{{ notice }}</p>

    <SegmentedControl v-model="view" :options="VIEWS" label="View" />

    <!-- Timeline (VIS-4): the past month and the next three, zoomable; a list on narrow screens -->
    <EventTimeline v-if="view === 'timeline'" :items="timeline" title="The past month and the next three" />

    <!-- Upcoming: the next 30 days, and the to-dos that wait -->
    <div v-if="view === 'upcoming'" class="space-y-4">
      <div v-if="soon.overdue.length" class="caution rounded-xl p-3">
        <p class="text-sm font-medium">Overdue</p>
        <ul class="mt-1 space-y-1 text-sm">
          <li v-for="i in soon.overdue" :key="i.id" class="flex items-center gap-2">
            <button type="button" class="grid size-8 place-items-center" :aria-label="`Mark done: ${i.title}`" @click="s.toggleDone(i.id)"><Circle class="size-4" aria-hidden="true" /></button>{{ i.title }} · {{ label(i.date!) }}
          </li>
        </ul>
      </div>
      <p v-if="!grouped.length && !soon.undated.length" class="rounded-lg bg-mist px-3 py-4 text-center text-sm text-gray-600">Nothing in the next 30 days. Tell the Scheduler something to remember.</p>
      <section v-for="g in grouped" :key="g.day">
        <h3 class="eyebrow mb-1.5">{{ label(g.day) }}</h3>
        <ul class="space-y-1.5">
          <li v-for="o in g.items" :key="`${o.id}-${o.date}`" class="card flex items-center gap-3 p-3">
            <button v-if="o.kind === 'todo'" type="button" class="grid size-9 shrink-0 place-items-center rounded-full hover:bg-mist" :aria-label="`${o.done ? 'Not done' : 'Done'}: ${o.title}`" @click="s.toggleDone(o.id)">
              <CheckCircle2 v-if="o.done" class="size-5 text-success" aria-hidden="true" /><Circle v-else class="size-5 text-gray-400" aria-hidden="true" />
            </button>
            <component :is="kindIcon(o.kind)" v-else class="size-5 shrink-0 text-brand" aria-hidden="true" />
            <span class="min-w-0 flex-1">
              <span :class="cn('block text-sm font-medium text-ink', o.done && 'text-gray-400 line-through')">{{ o.title }}<template v-if="o.years"> · {{ o.kind === "birthday" ? `turns ${o.years}` : `${o.years} years` }}</template></span>
              <span class="block text-xs text-gray-500">{{ o.service ? o.service.title : KIND[o.kind] }}{{ when(o) }}</span>
            </span>
            <button v-if="itemOf(o)" type="button" class="btn-ghost h-9 px-2" :aria-label="`Change ${o.title}`" @click="edit(itemOf(o)!)"><Pencil class="size-4" aria-hidden="true" /></button>
          </li>
        </ul>
      </section>
      <section v-if="soon.undated.length">
        <h3 class="eyebrow mb-1.5">Some day</h3>
        <ul class="space-y-1.5">
          <li v-for="i in soon.undated" :key="i.id" class="card flex items-center gap-3 p-3">
            <button type="button" class="grid size-9 place-items-center rounded-full hover:bg-mist" :aria-label="`Done: ${i.title}`" @click="s.toggleDone(i.id)"><Circle class="size-5 text-gray-400" aria-hidden="true" /></button>
            <span class="flex-1 text-sm text-ink">{{ i.title }}</span>
            <button type="button" class="btn-ghost h-9 px-2" :aria-label="`Change ${i.title}`" @click="edit(i)"><Pencil class="size-4" aria-hidden="true" /></button>
          </li>
        </ul>
      </section>
    </div>

    <!-- Month -->
    <div v-else-if="view === 'month'" class="space-y-3">
      <div class="flex items-center justify-between">
        <button type="button" class="btn-ghost h-10 px-2" aria-label="Previous month" @click="moveMonth(-1)"><ChevronLeft class="size-4" aria-hidden="true" /></button>
        <h3 class="font-semibold text-ink">{{ month.toLocaleDateString([], { month: "long", year: "numeric" }) }}</h3>
        <button type="button" class="btn-ghost h-10 px-2" aria-label="Next month" @click="moveMonth(1)"><ChevronRight class="size-4" aria-hidden="true" /></button>
      </div>
      <div class="grid grid-cols-7 gap-1 text-center text-xs text-gray-500" aria-hidden="true"><span v-for="d in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']" :key="d">{{ d }}</span></div>
      <div class="grid grid-cols-7 gap-1" role="grid" aria-label="Days">
        <button
          v-for="d in monthDays"
          :key="d.day"
          type="button"
          :class="cn('flex aspect-square flex-col items-center justify-start rounded-lg p-1 text-sm transition', d.inMonth ? 'text-ink' : 'text-gray-400', d.day === picked ? 'bg-brand-dark text-on-brand' : d.day === today ? 'ring-2 ring-brand' : 'hover:bg-mist')"
          :aria-pressed="d.day === picked"
          :aria-label="`${dayOf(d.day).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}${d.items.length ? `, ${d.items.length} entr${d.items.length === 1 ? 'y' : 'ies'}` : ''}`"
          @click="picked = d.day"
        >
          {{ dayOf(d.day).getDate() }}
          <span v-if="d.items.length" class="mt-auto flex gap-0.5" aria-hidden="true"><span v-for="(o, k) in d.items.slice(0, 3)" :key="k" :class="cn('size-1.5 rounded-full', o.kind === 'service' ? 'bg-info' : d.day === picked ? 'bg-on-brand' : 'bg-brand')" /></span>
        </button>
      </div>
      <div>
        <h4 class="eyebrow mb-1.5">{{ label(picked) }}</h4>
        <p v-if="!pickedItems.length" class="text-sm text-gray-500">Nothing on this day.</p>
        <ul class="space-y-1.5">
          <li v-for="o in pickedItems" :key="`${o.id}-${o.date}`" class="flex items-center gap-2 text-sm">
            <component :is="kindIcon(o.kind)" class="size-4 text-brand" aria-hidden="true" /><span class="text-ink">{{ o.title }}</span><span class="text-xs text-gray-500">{{ o.service?.title ?? KIND[o.kind] }}{{ when(o) }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- To-dos -->
    <ul v-else-if="view === 'todos'" class="space-y-1.5">
      <li v-if="!todos.length" class="rounded-lg bg-mist px-3 py-4 text-center text-sm text-gray-600">No to-dos. Tell the Scheduler: "buy running shoes".</li>
      <li v-for="i in todos" :key="i.id" class="card flex items-center gap-3 p-3">
        <button type="button" class="grid size-9 place-items-center rounded-full hover:bg-mist" :aria-label="`${i.done ? 'Not done' : 'Done'}: ${i.title}`" @click="s.toggleDone(i.id)">
          <CheckCircle2 v-if="i.done" class="size-5 text-success" aria-hidden="true" /><Circle v-else class="size-5 text-gray-400" aria-hidden="true" />
        </button>
        <span class="min-w-0 flex-1">
          <span :class="cn('block text-sm text-ink', i.done && 'text-gray-400 line-through')">{{ i.title }}</span>
          <span v-if="i.date" class="block text-xs text-gray-500">{{ label(i.date) }}{{ i.time ? ` · ${i.time}` : "" }}</span>
        </span>
        <button type="button" class="btn-ghost h-9 px-2" :aria-label="`Change ${i.title}`" @click="edit(i)"><Pencil class="size-4" aria-hidden="true" /></button>
        <ConfirmAction label="Delete" :aria-label="`Delete ${i.title}`" :message="`Delete “${i.title}”?`" trigger-class="btn-ghost h-9 px-2 text-red-800" @confirm="s.remove(i.id)"><Trash2 class="size-4" aria-hidden="true" /></ConfirmAction>
      </li>
    </ul>

    <!-- Birthdays and anniversaries, by the next one -->
    <ul v-else-if="view === 'people'" class="space-y-1.5">
      <li v-if="!people.length" class="rounded-lg bg-mist px-3 py-4 text-center text-sm text-gray-600">No birthdays or anniversaries yet. Tell the Scheduler: "Mum's birthday on 3 March".</li>
      <li v-for="o in people" :key="o.id" class="card flex items-center gap-3 p-3">
        <component :is="kindIcon(o.kind)" class="size-5 shrink-0 text-brand" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium text-ink">{{ o.title }}</span>
          <span class="block text-xs text-gray-500">{{ label(o.date) }}<template v-if="o.years"> · {{ o.kind === "birthday" ? `turns ${o.years}` : `${o.years} years` }}</template></span>
        </span>
        <button v-if="itemOf(o)" type="button" class="btn-ghost h-9 px-2" :aria-label="`Change ${o.title}`" @click="edit(itemOf(o)!)"><Pencil class="size-4" aria-hidden="true" /></button>
        <ConfirmAction v-if="itemOf(o)" label="Delete" :aria-label="`Delete ${o.title}`" :message="`Delete “${o.title}”?`" trigger-class="btn-ghost h-9 px-2 text-red-800" @confirm="s.remove(o.id)"><Trash2 class="size-4" aria-hidden="true" /></ConfirmAction>
      </li>
    </ul>
  </section>
</template>
