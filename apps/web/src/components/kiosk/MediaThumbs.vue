<script setup lang="ts">
// Photos in a request or a summary (MED-1): shown from this device, or fetched from the box by the
// media host when this device never had them (a staff device opening a request). Opens full size.
import type { MediaRef } from "@sekaran-ind/yaxb-core/journeys";
import { useMedia } from "@sekaran-ind/yaxb-journeys/vue";
import { onMounted, ref } from "vue";

const props = defineProps<{ media: MediaRef[]; label: string }>();
const host = useMedia();
const urls = ref<Record<string, string | null>>({});
onMounted(async () => {
  for (const r of props.media) urls.value = { ...urls.value, [r.hash]: await host.url(r).catch(() => null) };
});
</script>

<template>
  <ul class="mt-1 flex flex-wrap gap-2">
    <li v-for="r in media" :key="r.hash">
      <audio v-if="urls[r.hash] && r.type.startsWith('audio/')" :src="urls[r.hash]!" controls class="max-w-full" :aria-label="label" />
      <a v-else-if="urls[r.hash]" :href="urls[r.hash]!" target="_blank" rel="noreferrer" class="block">
        <img :src="urls[r.hash]!" :alt="r.text ? `${label}: ${r.text.slice(0, 80)}` : label" class="size-24 rounded-lg object-cover ring-1 ring-gray-200" />
      </a>
      <span v-else-if="r.hash in urls" class="grid size-24 place-items-center rounded-lg bg-surface text-center text-xs text-gray-500 ring-1 ring-gray-200">Not on this device or the box</span>
      <span v-else class="grid size-24 place-items-center rounded-lg bg-surface text-xs text-gray-500 ring-1 ring-gray-200">Loading…</span>
    </li>
  </ul>
</template>
