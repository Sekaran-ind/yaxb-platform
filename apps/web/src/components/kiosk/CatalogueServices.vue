<script setup lang="ts">
// The services added to this kiosk from the Service Catalogue (LIB-18..19, LIB-37), shown in the
// notebook: load one (checking the team has someone for every role it needs), remove one, and start
// a journey, which runs in the conversation. Journeys a viewer can't start show who starts them.
import { AlertTriangle, ChevronRight, FileText, Library, Lock, Plus, Users, X } from "@lucide/vue";
import { cn } from "@/lib/cn";
import AddServiceFlow from "./AddServiceFlow.vue";
import { computed, ref } from "vue";
import { iconFor } from "@/lib/icons";
import { NATIVE } from "@/lib/platform";
import { catalogue, catalogueReady, loadedServices, needsOf, removeFromKiosk, roleName, type CatalogueJourney } from "@/composables/library";

// staff: they manage each service's documents and SOPs (its kiosk notebook, RST-3); docCount says how many it has.
const props = defineProps<{ staff?: boolean; docCount?: (entryId: string) => number }>();
const emit = defineEmits<{ start: [journeyId: string]; documents: [entryId: string, title: string] }>();

const picking = ref(false);
// Only published services are offered: one whose latest revision was rejected, or is still a draft
// or in review, isn't (a kiosk that already has it keeps its accepted revision).
const available = computed(() => catalogue.value.filter((s) => !s.loaded && (s.state ?? "accepted") === "accepted"));
const startedBy = (j: CatalogueJourney) => j.initiate.filter((r) => r !== "visitor").map(roleName).join(" or ");
const finishedBy = (j: CatalogueJourney) => j.complete.map(roleName).join(" or ");

/** The service being added (its three steps), and the loaded one whose people and storage are open. */
const adding = ref<string | null>(null);
const managing = ref<string | null>(null);
const unstaffed = (entryId: string) => needsOf(entryId).filter((n) => n.staffing !== "ready");
</script>

<template>
  <!-- Services added from the Service Catalogue. -->
  <section aria-labelledby="svc-catalogue" class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="svc-catalogue" class="flex items-center gap-2 text-base font-semibold text-ink"><Library class="size-4 text-brand" aria-hidden="true" /> Services</h3>
      <button v-if="catalogueReady" type="button" class="btn-light h-8 px-3 text-xs" :aria-expanded="picking" @click="picking = !picking"><Plus class="size-3.5" aria-hidden="true" /> Load a service</button>
    </div>
    <div v-if="picking" class="rounded-2xl bg-mist p-3">
      <p v-if="!available.length" class="text-sm text-gray-600">Every published service is loaded<template v-if="!catalogue.length">: nothing is published yet</template>.</p>
      <ul class="grid gap-2 @lg:grid-cols-2">
        <li v-for="s in available" :key="s.entry_id" :class="cn('card flex flex-wrap items-start justify-between gap-2 p-3', adding === s.entry_id && '@lg:col-span-2')">
          <span class="min-w-0">
            <span class="block text-sm font-medium text-ink">{{ s.title }}</span>
            <span class="block text-xs text-gray-500">{{ s.journeys.length }} journey{{ s.journeys.length === 1 ? "" : "s" }} · {{ s.library }}</span>
          </span>
          <button v-if="adding !== s.entry_id" type="button" class="btn-primary h-8 px-3 text-xs" @click="adding = s.entry_id">Add</button>
          <!-- Adding: what it needs, the people for its roles, and its storage (LIB-60..62). -->
          <AddServiceFlow v-else :entry-id="s.entry_id" @done="(adding = null), (picking = false)" @cancel="adding = null" />
        </li>
      </ul>
      <RouterLink v-if="!NATIVE" to="/catalogue" class="mt-2 inline-block text-sm font-medium text-ink hover:underline">Design a service in the catalogue →</RouterLink>
    </div>
    <p v-if="!loadedServices.length && !picking" class="text-sm text-gray-500">No catalogue services are loaded on this kiosk.</p>

    <article v-for="s in loadedServices" :key="s.meta.entry_id" :aria-labelledby="`cat-${s.meta.entry_id}`" class="space-y-2">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h4 :id="`cat-${s.meta.entry_id}`" class="flex items-center gap-2 font-semibold text-ink">
            <component :is="iconFor(s.meta.icon ?? undefined)" v-if="iconFor(s.meta.icon ?? undefined)" class="size-4 text-brand" aria-hidden="true" />{{ s.meta.title }}
          </h4>
          <p v-if="s.meta.summary" class="text-sm text-gray-500">{{ s.meta.summary }}</p>
          <p v-if="s.meta.roles.length" class="mt-1 text-xs text-gray-500">Delivered by {{ s.meta.roles.map((r) => r.label).join(", ") }}</p>
          <p v-if="unstaffed(s.meta.entry_id).length" class="caution mt-1 flex items-center gap-1.5 px-2 py-1 text-xs">
            <AlertTriangle class="size-3.5 shrink-0" aria-hidden="true" /> Nobody can act yet for: {{ unstaffed(s.meta.entry_id).map((n) => n.label).join(", ") }}. Their requests wait.
          </p>
        </div>
        <div class="flex shrink-0 flex-wrap justify-end gap-1">
          <button v-if="props.staff" type="button" class="btn-light h-8 px-2 text-xs" :aria-expanded="managing === s.meta.entry_id" @click="managing = managing === s.meta.entry_id ? null : s.meta.entry_id">
            <Users class="size-3.5" aria-hidden="true" /> People and storage
          </button>
          <button v-if="props.staff" type="button" class="btn-light h-8 px-2 text-xs" @click="emit('documents', s.meta.entry_id, s.meta.title)">
            <FileText class="size-3.5" aria-hidden="true" /> Documents and SOPs<template v-if="props.docCount"> ({{ props.docCount(s.meta.entry_id) }})</template>
          </button>
          <button type="button" class="btn-ghost h-8 px-2 text-xs" :aria-label="`Remove ${s.meta.title} from this kiosk`" @click="removeFromKiosk(s.meta.entry_id)"><X class="size-3.5" aria-hidden="true" /> Remove</button>
        </div>
      </div>
      <AddServiceFlow v-if="managing === s.meta.entry_id" :entry-id="s.meta.entry_id" loaded @done="managing = null" @cancel="managing = null" />
      <ul class="grid gap-2 @lg:grid-cols-2">
        <li v-for="j in s.meta.journeys" :key="j.id">
          <button v-if="j.allowed" type="button" class="card flex w-full items-center gap-3 p-3 text-left transition hover:border-gray-300" @click="emit('start', j.id)">
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-ink">{{ j.title }}</span>
              <span v-if="j.summary" class="line-clamp-2 block text-xs text-gray-500">{{ j.summary }}</span>
              <span v-if="finishedBy(j)" class="block text-xs text-gray-500">Finished by {{ finishedBy(j) }}</span>
            </span>
            <ChevronRight class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
          </button>
          <div v-else class="card flex items-center gap-3 p-3 opacity-80">
            <Lock class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-ink">{{ j.title }}</span>
              <span class="block text-xs text-gray-500">Started by {{ startedBy(j) }}. Staff with that role sign in under For staff.</span>
            </span>
          </div>
        </li>
      </ul>
    </article>
  </section>

</template>
