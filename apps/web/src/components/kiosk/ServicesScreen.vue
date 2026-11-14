<script setup lang="ts">
// What the visitor can do here, from the kiosk's service config (yaxb-core content/services): each
// item opens a screen, runs a journey, or (For staff) opens a staff section here, inside Services.
// Cards are laid out by the kiosk's own width (container queries), not the window's, so the Mini
// kiosk on a wide screen gets one clean column. Services loaded from the Service Catalogue live in
// the Notebook (CatalogueServices, LIB-49); a pointer here says so, and every journey runs in the
// conversation (the shell's startJourney). ?load=<id> still loads one here. Requests (cases, LIB-33..38) are here too: a signed-in member's work queue, and "Check a
// request" by reference for anyone; ?case=<id or reference> opens one.
import type { ServiceHandler } from "@sekaran-ind/yaxb-core/journeys";
import type { Layout } from "@sekaran-ind/yaxb-core/screens";
import { servicesFor, type ServiceItem } from "@sekaran-ind/yaxb-core/services";
import { ChevronDown, ChevronRight, Inbox, Info } from "@lucide/vue";
import { kioskContent } from "@sekaran-ind/yaxb-core/content";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { NotebookRecord } from "@/lib/browser/store";
import { cn } from "@/lib/cn";
import { iconFor } from "@/lib/icons";
import { NATIVE } from "@/lib/platform";
import RequestList from "./RequestList.vue";
import JourneySummaryCard from "./JourneySummaryCard.vue";
import KioskStaff from "./KioskStaff.vue";
import {
  catalogue,
  kioskJourneys,
  loadCatalogue,
  loadIntoKiosk,
  kioskViewer,
} from "@/composables/library";
import { caseQueue, onDevices, refreshQueue, startCaseNetwork } from "@/composables/cases";
import { collect } from "@/composables/case-network";
import RequestBoard from "./RequestBoard.vue";

// highlight: service item keys the visitor's profile brings forward (yaxb-core accounts preferencesFrom).
const props = defineProps<{ layout: Layout; services: Record<string, ServiceHandler>; notebook: NotebookRecord | null; highlight?: string[] }>();
// Every journey runs in the conversation (LIB-50): Services asks the shell to start it there.
const emit = defineEmits<{ openJourney: [id: string]; openScreen: [id: string]; speak: [text: string]; request: [ref: string] }>();

const route = useRoute();
const router = useRouter();
// The catalogue's published services; /kiosk?load=<id> (the catalogue's "Open in a kiosk") loads one.
onMounted(async () => {
  void refreshQueue();
  await loadCatalogue();
  // Requests kept on devices: join the team's channel and collect from the box and the relay.
  if (onDevices.value) {
    startCaseNetwork();
    void collect().then(refreshQueue);
  }
  const load = route.query.load;
  if (typeof load === "string" && catalogue.value.some((s) => s.entry_id === load)) {
    loadIntoKiosk(load);
    const { load: _, ...query } = route.query;
    void router.replace({ path: route.path, query });
  }
});
// The native app is for visitors: staff work in the web kiosk, where their sign-in is a cookie.
const offered = computed(() => servicesFor(kioskContent.services, { layout: props.layout, journeys: kioskJourneys.value.map((j) => j.id) }).filter((s) => !(NATIVE && s.id === "staff") && s.id !== "ask"));
const journeyOf = (item: ServiceItem) => (item.journey ? kioskJourneys.value.find((j) => j.id === item.journey) : undefined);
const about = ref<string | null>(null);
const showAll = ref(false);
const summaryOf = (item: ServiceItem) => item.summary ?? (item.journey ? journeyOf(item)?.summary : undefined);

/** A staff section open inside Services (/kiosk?screen=services&staff=team). */
const staffSection = computed(() => (!NATIVE && typeof route.query.staff === "string" ? route.query.staff : null));
function open(item: ServiceItem) {
  if (item.staff) return void router.push({ path: "/kiosk", query: { screen: "services", staff: item.staff } });
  if (item.journey) return emit("openJourney", item.journey);
  if (item.screen) emit("openScreen", item.screen);
}
const backToServices = () => void router.push({ path: "/kiosk", query: { screen: "services" } });

// ---- requests (cases) --------------------------------------------------------------------------
/** A request opens in the conversation, unfolded (LIB-52). */
const openRequest = (ref: string) => emit("request", ref);
// Work waiting for this member comes first on Services; what they started and the others' open
// requests sit with "Check a request", lower down, so a visitor with nothing sees services first.
const otherGroups = computed(() =>
  [
    { id: "started", title: "You started", items: caseQueue.value.started },
    { id: "others", title: "Other open requests", items: caseQueue.value.others },
  ].filter((g) => g.items.length),
);

</script>

<template>
  <KioskStaff v-if="staffSection" @back="backToServices" />

  <div v-else class="@container space-y-7">
    <!-- Work waiting for this member's roles comes first. -->
    <section v-if="caseQueue.mine.length" aria-labelledby="svc-waiting" class="space-y-3">
      <h3 id="svc-waiting" class="flex items-center gap-2 text-base font-semibold text-ink">
        <Inbox class="size-4 text-brand" aria-hidden="true" /> Waiting for you
        <span class="rounded-full bg-brand-dark px-2 py-0.5 text-xs font-medium text-on-brand">{{ caseQueue.mine.length }}</span>
      </h3>
      <RequestList :items="caseQueue.mine" @open="openRequest" />
    </section>

    <section v-for="s in offered" :key="s.id" :aria-labelledby="`svc-${s.id}`">
      <h3 :id="`svc-${s.id}`" class="flex items-center gap-2 text-base font-semibold text-ink">
        <component :is="iconFor(s.icon)" v-if="iconFor(s.icon)" class="size-4 text-brand" aria-hidden="true" /> {{ s.title }}
      </h3>
      <p v-if="s.summary" class="mt-0.5 mb-3 text-sm text-gray-500">{{ s.summary }}</p>
      <ul class="grid gap-2 @lg:grid-cols-2">
        <li v-for="item in s.items" :key="item.key" :class="cn(about === item.key && '@lg:col-span-2')">
          <!-- One card: the item, with a small "about" icon inside it for journeys. -->
          <div :class="cn('card flex items-center transition hover:border-gray-300', about === item.key && 'rounded-b-none')">
            <button type="button" class="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-3 text-left" @click="open(item)">
              <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-mist text-ink"><component :is="iconFor(item.icon)" v-if="iconFor(item.icon)" class="size-4" aria-hidden="true" /></span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium text-ink">{{ item.label }}</span>
                <span v-if="summaryOf(item)" class="line-clamp-2 block text-xs text-gray-500">{{ summaryOf(item) }}</span>
              </span>
            </button>
            <button
              v-if="journeyOf(item)"
              type="button"
              :class="cn('grid size-8 shrink-0 place-items-center rounded-full transition', about === item.key ? 'bg-mist text-ink' : 'text-gray-400 hover:bg-mist hover:text-ink')"
              :aria-expanded="about === item.key"
              :aria-label="`How ${item.label} works`"
              :title="`How ${item.label} works`"
              @click="about = about === item.key ? null : item.key"
            >
              <Info class="size-4" aria-hidden="true" />
            </button>
            <button type="button" class="grid size-8 shrink-0 place-items-center text-gray-400 hover:text-ink" :aria-label="`Open ${item.label}`" tabindex="-1" @click="open(item)"><ChevronRight class="size-4" aria-hidden="true" /></button>
          </div>
          <JourneySummaryCard v-if="about === item.key && journeyOf(item)" :journey="journeyOf(item)!" compact class="rounded-b-2xl border border-t-0 border-gray-200/70 bg-mist p-3" />
        </li>
      </ul>
    </section>

    <!-- Moderators: who has which request kept on devices, and reassigning an idle one. -->
    <RequestBoard v-if="onDevices && (kioskViewer.admin || kioskViewer.roles.includes('moderator') || kioskViewer.roles.includes('administrator'))" />

    <!-- Staff: what they started and the other open requests they may see. (Visitors check theirs by
         typing the reference in Ask Me.) -->
    <section v-if="otherGroups.length" aria-labelledby="svc-requests" class="space-y-3">
      <h3 id="svc-requests" class="flex items-center gap-2 text-base font-semibold text-ink"><Inbox class="size-4 text-brand" aria-hidden="true" /> Requests</h3>
      <div v-for="g in otherGroups" :key="g.id">
        <h4 class="eyebrow mb-2">{{ g.title }} ({{ g.items.length }})</h4>
        <RequestList :items="g.items" @open="openRequest" />
      </div>
    </section>

    <section aria-labelledby="svc-about-all">
      <button id="svc-about-all" type="button" class="inline-flex items-center gap-1 text-sm font-medium text-ink hover:underline" :aria-expanded="showAll" @click="showAll = !showAll">
        <ChevronDown :class="['size-4 transition-transform', showAll ? 'rotate-180' : '']" aria-hidden="true" /> How each service works
      </button>
      <div v-if="showAll" class="mt-3 grid gap-3 @lg:grid-cols-2">
        <JourneySummaryCard v-for="j in kioskJourneys" :key="j.id" :journey="j" />
      </div>
    </section>
  </div>
</template>
