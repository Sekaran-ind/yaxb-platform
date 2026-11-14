<script setup lang="ts">
// One service's items as cards, sized by the container (one, two or three columns).
import type { Journey } from "@sekaran-ind/yaxb-journeys/journeys";
import type { Service, ServiceItem } from "@sekaran-ind/yaxb-journeys/services";
import { computed } from "vue";
import Glyph from "./Glyph.vue";
import { useIcons } from "./icons";

// locked: item key → why it can't be opened here (who may start it), shown on the card.
const props = defineProps<{ service: Service; journeys: Journey[]; locked?: Record<string, string> }>();
const emit = defineEmits<{ open: [item: ServiceItem] }>();
const icon = useIcons();
const byId = computed(() => new Map(props.journeys.map((j) => [j.id, j])));
const kind = (i: ServiceItem) => (i.journey ? "Journey" : i.screen ? "Screen" : "Staff");
const summary = (i: ServiceItem) => i.summary ?? (i.journey ? byId.value.get(i.journey)?.summary : undefined);
</script>

<template>
  <div class="yj yj-stack">
    <p v-if="service.summary" class="yj-small yj-muted">{{ service.summary }}</p>
    <ul class="yj-items">
      <li v-for="i in service.items" :key="i.key">
        <button type="button" class="yj-item" :class="locked?.[i.key] && 'yj-item-locked'" :aria-disabled="locked?.[i.key] ? 'true' : undefined" @click="emit('open', i)">
          <span class="yj-item-icon" aria-hidden="true"><component :is="icon(i.icon)" v-if="icon(i.icon)" class="yj-icon" /><span v-else>{{ i.label.slice(0, 1) }}</span></span>
          <span>
            <span class="yj-item-kind">{{ kind(i) }}</span>
            <span class="yj-title yj-block">{{ i.label }}</span>
            <span v-if="summary(i)" class="yj-small yj-muted yj-block">{{ summary(i) }}</span>
            <span v-if="locked?.[i.key]" class="yj-help yj-block yj-m0"><Glyph name="lock" /> {{ locked[i.key] }}</span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>
