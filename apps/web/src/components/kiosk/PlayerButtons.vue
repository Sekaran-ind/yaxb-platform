<script setup lang="ts">
// The kiosk's personal controls as round console buttons in the player (PLY-2, PLY-3): the profile,
// conversations, contacts, the child lock and the preferences; at the front desk, End session and
// the staff lock. Full shows them with their labels, Pod (strip) as a row of icons, and Mini shows
// the profile and a "More" button that opens the rest.
import { MoreHorizontal } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, type Component } from "vue";
import { cn } from "@/lib/cn";

export type PlayerButton = {
  id: string;
  label: string;
  icon?: Component;
  /** Shown instead of the icon (the profile's initials). */
  initials?: string;
  /** A count beside it (conversations). */
  badge?: number;
  pressed?: boolean;
  /** Stands out: the profile when signed in, the child lock when on. */
  accent?: boolean;
};

const props = withDefaults(defineProps<{ buttons: PlayerButton[]; variant?: "full" | "strip" | "mini" }>(), { variant: "full" });
const emit = defineEmits<{ pick: [id: string] }>();

const moreOpen = ref(false);
const root = ref<HTMLElement | null>(null);
// Mini: the profile stays, the rest go under More.
const first = computed(() => props.buttons.find((b) => b.id === "profile") ?? null);
const rest = computed(() => props.buttons.filter((b) => b !== first.value));
const shown = computed(() => (props.variant === "mini" ? (first.value ? [first.value] : []) : props.buttons));

function pick(id: string) {
  moreOpen.value = false;
  emit("pick", id);
}
const closeOutside = (e: PointerEvent) => {
  if (moreOpen.value && root.value && !root.value.contains(e.target as Node)) moreOpen.value = false;
};
document.addEventListener("pointerdown", closeOutside);
onBeforeUnmount(() => document.removeEventListener("pointerdown", closeOutside));

const round = (b: PlayerButton, size: string) =>
  cn(
    "console-btn relative",
    size,
    b.accent && "bg-brand text-console ring-brand/40 hover:bg-brand hover:brightness-110",
    b.pressed && "bg-white text-console ring-white hover:bg-white",
  );
</script>

<template>
  <div ref="root" :class="cn('relative', variant === 'full' ? 'flex flex-wrap justify-center gap-x-1 gap-y-3' : 'flex items-center gap-2')" role="group" aria-label="Your controls">
    <template v-for="b in shown" :key="b.id">
      <!-- Full: a round button with its label under it. -->
      <button v-if="variant === 'full'" type="button" class="group flex w-20 flex-col items-center gap-1.5" :aria-pressed="b.pressed" :aria-label="b.badge ? `${b.label} (${b.badge})` : b.label" @click="pick(b.id)">
        <span :class="round(b, 'size-12')">
          <span v-if="b.initials" class="text-sm font-semibold">{{ b.initials }}</span>
          <component :is="b.icon" v-else class="size-5" aria-hidden="true" />
          <span v-if="b.badge" class="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-console">{{ b.badge }}</span>
        </span>
        <span class="max-w-full truncate text-[11px] text-white/70 group-hover:text-white">{{ b.label }}</span>
      </button>
      <!-- Pod and Mini: the icon, its label as the hint. -->
      <button v-else type="button" :class="round(b, 'size-9')" :aria-pressed="b.pressed" :aria-label="b.badge ? `${b.label} (${b.badge})` : b.label" :title="b.label" @click="pick(b.id)">
        <span v-if="b.initials" class="text-xs font-semibold">{{ b.initials }}</span>
        <component :is="b.icon" v-else class="size-4" aria-hidden="true" />
        <span v-if="b.badge" class="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[9px] font-semibold text-console">{{ b.badge }}</span>
      </button>
    </template>

    <template v-if="variant === 'mini' && rest.length">
      <button type="button" class="console-btn size-9" :aria-expanded="moreOpen" aria-haspopup="true" aria-label="More controls" title="More" @click="moreOpen = !moreOpen">
        <MoreHorizontal class="size-4" aria-hidden="true" />
      </button>
      <ul v-if="moreOpen" class="absolute bg-console top-full right-0 z-40 mt-2 w-56 rounded-2xl p-1.5 shadow-xl ring-1 ring-white/10">
        <li v-for="b in rest" :key="b.id">
          <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10 hover:text-white" :aria-pressed="b.pressed" @click="pick(b.id)">
            <span v-if="b.initials" class="grid size-5 place-items-center text-[10px] font-semibold">{{ b.initials }}</span>
            <component :is="b.icon" v-else class="size-4 shrink-0" aria-hidden="true" />
            <span class="flex-1">{{ b.label }}</span>
            <span v-if="b.badge" class="rounded-full bg-brand px-1.5 text-[11px] font-semibold text-console">{{ b.badge }}</span>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>
