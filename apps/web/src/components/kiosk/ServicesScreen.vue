<script setup lang="ts">
// What the visitor can do here, from the kiosk's service config (yaxb-core content/services): each
// item opens a screen or runs a journey.
import { kioskContent } from "@sekaran-ind/yaxb-core/content";
import type { ServiceHandler } from "@sekaran-ind/yaxb-core/journeys";
import type { Layout } from "@sekaran-ind/yaxb-core/screens";
import { servicesFor, type ServiceItem } from "@sekaran-ind/yaxb-core/services";
import { ChevronRight } from "@lucide/vue";
import { computed } from "vue";
import type { NotebookRecord } from "@/lib/browser/store";
import { iconFor } from "@/lib/icons";
import JourneyPanel from "./JourneyPanel.vue";

const props = defineProps<{ layout: Layout; openJourney: string | null; services: Record<string, ServiceHandler>; notebook: NotebookRecord | null }>();
const emit = defineEmits<{ openJourney: [id: string | null]; openScreen: [id: string]; speak: [text: string] }>();

const journey = computed(() => (props.openJourney ? kioskContent.journeys.find((j) => j.id === props.openJourney) : undefined));
const offered = computed(() => servicesFor(kioskContent.services, { layout: props.layout, journeys: kioskContent.journeys.map((j) => j.id) }));
const summaryOf = (item: ServiceItem) => item.summary ?? (item.journey ? kioskContent.journeys.find((j) => j.id === item.journey)?.summary : undefined);
const open = (item: ServiceItem) => (item.journey ? emit("openJourney", item.journey) : item.screen && emit("openScreen", item.screen));
</script>

<template>
  <JourneyPanel v-if="journey" :key="journey.id" :journey="journey" :services="services" :notebook="notebook" @close="emit('openJourney', null)" @speak="(t) => emit('speak', t)" />
  <div v-else class="space-y-6">
    <section v-for="s in offered" :key="s.id" :aria-labelledby="`svc-${s.id}`">
      <h3 :id="`svc-${s.id}`" class="flex items-center gap-2 font-semibold text-ink">
        <component :is="iconFor(s.icon)" v-if="iconFor(s.icon)" class="size-4 text-brand" aria-hidden="true" /> {{ s.title }}
      </h3>
      <p v-if="s.summary" class="mb-2 text-sm text-gray-600">{{ s.summary }}</p>
      <ul class="grid gap-2 sm:grid-cols-2">
        <li v-for="item in s.items" :key="item.key">
          <button type="button" class="card flex w-full items-center gap-3 p-3 text-left hover:ring-brand" @click="open(item)">
            <component :is="iconFor(item.icon)" v-if="iconFor(item.icon)" class="size-5 shrink-0 text-brand" aria-hidden="true" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-ink">{{ item.label }}</span>
              <span v-if="summaryOf(item)" class="block text-xs text-gray-500">{{ summaryOf(item) }}</span>
            </span>
            <ChevronRight class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
