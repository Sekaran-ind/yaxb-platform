<script setup lang="ts">
// The conversation's context loader (LIB-49): a section that slides up over the conversation and
// lists what can be loaded into it. /journeys: the journeys anyone at the kiosk can start, by
// service (the kiosk's own and those added from the Service Catalogue). /staff: requests waiting for
// this member's roles, then the journeys only staff start. Picking one runs it in the conversation.
import { canInitiate, VISITOR_ROLE, type Journey } from "@sekaran-ind/yaxb-journeys";
import { kioskContent } from "@sekaran-ind/yaxb-core/content";
import { ChevronRight, Inbox, Search, X } from "@lucide/vue";
import { computed, nextTick, onMounted, ref } from "vue";
import { caseQueue, refreshQueue, statusText } from "@/composables/cases";
import { kioskJourneys, kioskViewer, loadedServices, roleName } from "@/composables/library";
import { iconFor } from "@/lib/icons";
import type { ContextPick } from "@/lib/types";

const props = defineProps<{ mode: "journeys" | "staff" }>();
const emit = defineEmits<{ pick: [pick: ContextPick]; close: [] }>();

const query = ref("");
const search = ref<HTMLInputElement | null>(null);
onMounted(async () => {
  if (props.mode === "staff") void refreshQueue();
  await nextTick();
  search.value?.focus();
});

/** Open to anyone: no starters, or visitors among them. */
const forAnyone = (j: Journey) => !j.roles?.initiate?.length || j.roles.initiate.includes(VISITOR_ROLE);
const matches = (j: { title: string; summary?: string | null }) => {
  const q = query.value.trim().toLowerCase();
  return !q || j.title.toLowerCase().includes(q) || (j.summary ?? "").toLowerCase().includes(q);
};

type Group = { id: string; title: string; icon?: string | null; journeys: Journey[] };
const groups = computed<Group[]>(() => {
  const roles = kioskViewer.value.roles;
  const want = (j: Journey) => (props.mode === "journeys" ? forAnyone(j) : !forAnyone(j) && canInitiate(j, roles)) && matches(j);
  const catalogueIds = new Set(loadedServices.value.flatMap((s) => s.journeys.map((j) => j.id)));
  const builtIn = kioskContent.services
    .map((s) => ({
      id: s.id,
      title: s.title,
      icon: s.icon,
      journeys: s.items.flatMap((i) => (i.journey && !catalogueIds.has(i.journey) ? kioskJourneys.value.filter((j) => j.id === i.journey) : [])).filter(want),
    }))
    .filter((g) => g.journeys.length);
  const fromCatalogue = loadedServices.value.map((s) => ({ id: s.meta.entry_id, title: s.meta.title, icon: s.meta.icon, journeys: s.journeys.filter(want) })).filter((g) => g.journeys.length);
  return [...fromCatalogue, ...builtIn];
});
const waiting = computed(() => (props.mode === "staff" ? caseQueue.value.mine.filter((c) => matches({ title: c.journey_title, summary: c.ref })) : []));
const empty = computed(() => !groups.value.length && !waiting.value.length);
</script>

<template>
  <!-- Not modal: the conversation stays behind it. Escape anywhere in it closes it (focus returns to the composer). -->
  <section role="dialog" aria-labelledby="ctx-title" class="flex max-h-full flex-col overflow-hidden rounded-t-3xl border border-b-0 border-gray-200 bg-surface shadow-[var(--shadow-lift)]" @keydown.esc.stop.prevent="emit('close')">
    <div class="flex items-center gap-2 border-b border-gray-100 px-4 pt-3 pb-2">
      <span class="font-mono text-sm text-gray-500">/{{ mode }}</span>
      <h3 id="ctx-title" class="flex-1 text-sm font-semibold text-ink">{{ mode === "staff" ? "For staff" : "Start a journey here" }}</h3>
      <button type="button" class="grid size-10 place-items-center rounded-full text-gray-500 hover:bg-mist hover:text-ink" aria-label="Close" @click="emit('close')"><X class="size-4" aria-hidden="true" /></button>
    </div>
    <div class="px-4 pt-3">
      <label for="ctx-search" class="sr-only">Search</label>
      <div class="flex items-center gap-2 rounded-full bg-mist px-3">
        <Search class="size-4 text-gray-500" aria-hidden="true" />
        <input id="ctx-search" ref="search" v-model="query" class="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink outline-none" :placeholder="mode === 'staff' ? 'Search requests and staff journeys' : 'Search journeys'" />
      </div>
    </div>
    <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 [scrollbar-width:thin]">
      <p v-if="mode === 'staff' && !kioskViewer.member" class="rounded-lg bg-mist px-3 py-2 text-sm text-gray-700">Staff journeys and requests show here once you sign in with your own key, under Quick tools → For staff.</p>
      <div v-if="waiting.length">
        <h4 class="eyebrow mb-2">Waiting for you</h4>
        <ul class="space-y-1.5">
          <li v-for="c in waiting" :key="c.id">
            <button type="button" class="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-mist" @click="emit('pick', { kind: 'request', ref: c.ref })">
              <Inbox class="size-4 shrink-0 text-brand" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium text-ink">{{ c.journey_title }}</span>
                <span class="block text-xs text-gray-500"><span class="font-mono">{{ c.ref }}</span> · {{ statusText(c, roleName) }}</span>
              </span>
              <ChevronRight class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>
      <div v-for="g in groups" :key="g.id">
        <h4 class="eyebrow mb-2 flex items-center gap-1.5"><component :is="iconFor(g.icon ?? undefined)" v-if="iconFor(g.icon ?? undefined)" class="size-3.5" aria-hidden="true" />{{ g.title }}</h4>
        <ul class="space-y-1.5">
          <li v-for="j in g.journeys" :key="j.id">
            <button type="button" class="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-mist" @click="emit('pick', { kind: 'journey', id: j.id, title: j.title })">
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium text-ink">{{ j.title }}</span>
                <span v-if="j.summary" class="line-clamp-1 block text-xs text-gray-500">{{ j.summary }}</span>
              </span>
              <ChevronRight class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>
      <p v-if="empty && (mode === 'journeys' || kioskViewer.member)" class="text-sm text-gray-600">
        {{ query ? "Nothing matches." : mode === "staff" ? "Nothing is waiting for your roles, and no journey is for staff only." : "No journeys yet. Add services from the Service Catalogue in My notebook." }}
      </p>
    </div>
  </section>
</template>
