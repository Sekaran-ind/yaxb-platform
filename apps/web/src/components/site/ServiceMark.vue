<script setup lang="ts">
// A service's mark: its icon when it has one we know, else its first letter on a colour taken from
// its id (the same service always gets the same colour). The colour is mixed with the theme's own
// surface and ink, so it reads in every theme, dark ones included.
import { computed } from "vue";
import { iconFor } from "@/lib/icons";
import { cn } from "@/lib/cn";

const props = defineProps<{ icon?: string | null; title: string; id?: string; size?: "sm" | "md" }>();
const Icon = computed(() => iconFor(props.icon ?? undefined));
const letter = computed(() => (props.title.trim().match(/\p{L}|\p{N}/u)?.[0] ?? "?").toUpperCase());
const hue = computed(() => {
  let h = 0;
  for (const ch of props.id ?? props.title) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
});
const style = computed(() =>
  Icon.value
    ? undefined
    : {
        background: `color-mix(in oklab, hsl(${hue.value} 70% 50%) 18%, var(--color-surface))`,
        color: `color-mix(in oklab, hsl(${hue.value} 70% 38%) 70%, var(--color-ink))`,
      },
);
</script>

<template>
  <span
    :class="cn('grid shrink-0 place-items-center font-semibold', size === 'sm' ? 'size-6 rounded-lg text-xs' : 'size-10 rounded-xl text-base', Icon ? 'bg-mist text-ink' : '')"
    :style="style"
    aria-hidden="true"
  >
    <component :is="Icon" v-if="Icon" :class="size === 'sm' ? 'size-3.5' : 'size-5'" />
    <template v-else>{{ letter }}</template>
  </span>
</template>
