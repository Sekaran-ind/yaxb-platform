<script setup lang="ts">
// The Service Catalogue's player (ConsolePlayer), plain like the kiosk's: the catalogue's mark,
// what is open ("now playing": the catalogue, or the service being designed and its step), and the
// counts. Its controls (New service, Open the kiosk, staff sign in, Preferences) are pills on the
// catalogue's tab row (CataloguePills), as the kiosk's are.
import { Library, PencilRuler } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/cn";
import ConsolePlayer from "@/components/site/ConsolePlayer.vue";

const props = withDefaults(
  defineProps<{
    who: { name: string; guest: boolean; roles: string } | null;
    counts: { published: number; mine: number; review: number | null };
    /** The service open on the right, if any. */
    current: { title: string; status: string } | null;
    /** The designer's step, while designing. */
    step?: { index: number; total: number; label: string } | null;
    loading?: boolean;
    variant?: "full" | "strip" | "mini";
  }>(),
  { variant: "full", step: null },
);
const status = computed(() => (props.loading ? "Loading the catalogue" : (props.current?.title ?? "Ready to design")));
const stepText = computed(() => (props.step ? `Step ${props.step.index + 1} of ${props.step.total}: ${props.step.label}` : ""));
const countsText = computed(() => {
  const c = props.counts;
  return [`${c.published} published`, `${c.mine} ${props.who?.guest ? "yours" : "in all"}`, ...(c.review === null ? [] : [`${c.review} in review`])].join(" · ");
});
// Full shows the state and step under the status, so its meta line keeps the counts.
const metaText = computed(() => (props.current && props.variant !== "full" ? [props.current.status, stepText.value].filter(Boolean).join(" · ") : countsText.value));

</script>

<template>
  <ConsolePlayer :variant="variant" eyebrow="Anjal - Service Catalogue" :status="status" :busy="loading" label="Catalogue player">
    <template #orb="{ size }">
      <PencilRuler v-if="current" :class="cn('text-white/85', size)" aria-hidden="true" />
      <Library v-else :class="cn('text-white/85', size)" aria-hidden="true" />
    </template>

    <template v-if="variant === 'full' && current" #under-status>
      <p class="mt-2 text-sm text-white/70">{{ current.status }}</p>
      <p v-if="stepText" class="mt-1 text-xs text-white/60">{{ stepText }}</p>
    </template>

    <template #meta>{{ metaText }}</template>

  </ConsolePlayer>
</template>
