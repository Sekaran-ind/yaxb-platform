<script setup lang="ts">
// What the visitor can do here, from the kiosk's service config (yaxb-core content/services): each
// item opens a screen, runs a journey, or (For staff) opens a staff section here, inside Services.
// Cards are laid out by the kiosk's own width (container queries), not the window's, so the Mini
// kiosk on a wide screen gets one clean column.
import { kioskContent } from "@sekaran-ind/yaxb-core/content";
import type { ServiceHandler } from "@sekaran-ind/yaxb-core/journeys";
import type { Layout } from "@sekaran-ind/yaxb-core/screens";
import { servicesFor, type ServiceItem } from "@sekaran-ind/yaxb-core/services";
import { ArrowLeft, ChevronDown, ChevronRight, Info } from "@lucide/vue";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { NotebookRecord } from "@/lib/browser/store";
import { cn } from "@/lib/cn";
import { iconFor } from "@/lib/icons";
import { NATIVE } from "@/lib/platform";
import JourneyPanel from "./JourneyPanel.vue";
import JourneySummaryCard from "./JourneySummaryCard.vue";
import KioskStaff from "./KioskStaff.vue";

// highlight: service item keys the visitor's profile brings forward (yaxb-core accounts preferencesFrom).
const props = defineProps<{ layout: Layout; openJourney: string | null; services: Record<string, ServiceHandler>; notebook: NotebookRecord | null; highlight?: string[] }>();
const emit = defineEmits<{ openJourney: [id: string | null]; openScreen: [id: string]; speak: [text: string]; journeyDone: [id: string] }>();

const route = useRoute();
const router = useRouter();
const journey = computed(() => (props.openJourney ? kioskContent.journeys.find((j) => j.id === props.openJourney) : undefined));
// The native app is for visitors: staff work in the web kiosk, where their sign-in is a cookie.
const offered = computed(() => servicesFor(kioskContent.services, { layout: props.layout, journeys: kioskContent.journeys.map((j) => j.id) }).filter((s) => !(NATIVE && s.id === "staff")));
const forYou = computed(() => {
  const items = offered.value.flatMap((s) => s.items);
  return (props.highlight ?? []).map((key) => items.find((i) => i.key === key)).filter((i): i is ServiceItem => Boolean(i));
});
const journeyOf = (item: ServiceItem) => (item.journey ? kioskContent.journeys.find((j) => j.id === item.journey) : undefined);
const about = ref<string | null>(null);
const showAll = ref(false);
const summaryOf = (item: ServiceItem) => item.summary ?? (item.journey ? kioskContent.journeys.find((j) => j.id === item.journey)?.summary : undefined);

/** A staff section open inside Services (/kiosk?screen=services&staff=team). */
const staffSection = computed(() => (!NATIVE && typeof route.query.staff === "string" ? route.query.staff : null));
function open(item: ServiceItem) {
  if (item.staff) return void router.push({ path: "/kiosk", query: { screen: "services", staff: item.staff } });
  if (item.journey) return emit("openJourney", item.journey);
  if (item.screen) emit("openScreen", item.screen);
}
const backToServices = () => void router.push({ path: "/kiosk", query: { screen: "services" } });
</script>

<template>
  <JourneyPanel v-if="journey" :key="journey.id" :journey="journey" :services="services" :notebook="notebook" @close="emit('openJourney', null)" @speak="(t) => emit('speak', t)" @done="emit('journeyDone', journey.id)" />

  <div v-else-if="staffSection" class="space-y-3">
    <button type="button" class="btn-ghost h-8 px-2 text-sm" @click="backToServices"><ArrowLeft class="size-4" aria-hidden="true" /> Services</button>
    <KioskStaff />
  </div>

  <div v-else class="@container space-y-7">
    <section v-if="forYou.length" aria-labelledby="svc-for-you">
      <h3 id="svc-for-you" class="eyebrow">For you</h3>
      <p class="mt-1 mb-3 text-sm text-gray-500">From the interests in your profile.</p>
      <ul class="grid gap-2 @lg:grid-cols-2">
        <li v-for="item in forYou" :key="`for-you-${item.key}`">
          <button type="button" class="card flex w-full items-center gap-3 p-3 text-left transition hover:border-gray-300" @click="open(item)">
            <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-mist text-ink"><component :is="iconFor(item.icon)" v-if="iconFor(item.icon)" class="size-4" aria-hidden="true" /></span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-ink">{{ item.label }}</span>
              <span v-if="summaryOf(item)" class="block text-xs text-gray-500">{{ summaryOf(item) }}</span>
            </span>
            <ChevronRight class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
          </button>
        </li>
      </ul>
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

    <section aria-labelledby="svc-about-all">
      <button id="svc-about-all" type="button" class="inline-flex items-center gap-1 text-sm font-medium text-ink hover:underline" :aria-expanded="showAll" @click="showAll = !showAll">
        <ChevronDown :class="['size-4 transition-transform', showAll ? 'rotate-180' : '']" aria-hidden="true" /> How each service works
      </button>
      <div v-if="showAll" class="mt-3 grid gap-3 @lg:grid-cols-2">
        <JourneySummaryCard v-for="j in kioskContent.journeys" :key="j.id" :journey="j" />
      </div>
    </section>
  </div>
</template>
