<script setup lang="ts">
// clinux-core's AdaptiveSectionNav for the kiosk (SPEC-24 §5): one navigation chrome for every
// layout. It owns the chrome only; each screen's content is the caller's scoped slot.
//   tabs       pill tabs over one screen (the kiosk's original look)
//   sidebar    a vertical list beside one screen
//   accordion  every screen as a collapsible section
//   panes      every screen at once (a screen config's fixed choice, never switchable)
// Below the compact breakpoint every mode collapses to one screen plus a section menu. Visitors can
// switch between tabs, sidebar and accordion; the choice is remembered per `storageKey`. The
// decisions (modes, breakpoint, active screen) are yaxb-core's screens module.
import { COMPACT_BREAKPOINT, resolveActiveScreen, resolveNavMode, SWITCHABLE_NAV_MODES, type NavMode } from "@sekaran-ind/yaxb-core/screens";
import { ChevronDown } from "@lucide/vue";
import { computed, ref, useId } from "vue";
import { cn } from "@/lib/cn";
import { iconFor } from "@/lib/icons";
import PopMenu from "./PopMenu.vue";

export type NavScreen = { id: string; label: string; icon?: string; badge?: string };

const props = defineProps<{ screens: NavScreen[]; mode?: NavMode; storageKey: string; active: string | null; width: number; bodyClass?: string }>();
const emit = defineEmits<{ "update:active": [id: string] }>();
const uid = useId();

const key = computed(() => `yaxb.nav.${props.storageKey}`);
function read(): string | null {
  try {
    return localStorage.getItem(key.value);
  } catch {
    return null;
  }
}
const stored = ref<string | null>(read());
function choose(mode: NavMode) {
  if (!SWITCHABLE_NAV_MODES.includes(mode)) return;
  stored.value = mode;
  try {
    localStorage.setItem(key.value, mode);
  } catch {
    /* best effort */
  }
}

const mode = computed(() => resolveNavMode({ configMode: props.mode, storedMode: stored.value }));
const current = computed(() => resolveActiveScreen(props.screens, props.active));
const currentScreen = computed(() => props.screens.find((s) => s.id === current.value));
const compact = computed(() => props.width < COMPACT_BREAKPOINT || (mode.value !== "panes" && props.screens.length === 1));
const switchable = computed(() => props.mode !== "panes");
const pick = (id: string) => emit("update:active", id);
const itemClass = (on: boolean) => cn("flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-mist", on && "font-semibold text-brand-dark");
</script>

<template>
  <!-- Compact: one screen and a section menu. -->
  <div v-if="compact">
    <div class="mb-2 flex items-center justify-between">
      <h2 v-if="currentScreen" class="inline-flex items-center gap-1.5 text-sm font-bold text-ink">
        <component :is="iconFor(currentScreen.icon)" v-if="iconFor(currentScreen.icon)" class="size-4" aria-hidden="true" />{{ currentScreen.label }}
      </h2>
      <PopMenu v-if="screens.length > 1" v-slot="{ close }" label="Choose a screen">
        <button v-for="s in screens" :key="s.id" type="button" role="menuitemradio" :aria-checked="s.id === current" :class="itemClass(s.id === current)" @click="pick(s.id), close()">
          <span class="inline-flex items-center gap-1.5"><component :is="iconFor(s.icon)" v-if="iconFor(s.icon)" class="size-4" aria-hidden="true" />{{ s.label }}</span>
          <span v-if="s.badge" class="rounded-full bg-mist px-1.5 text-[10px] font-bold text-gray-600">{{ s.badge }}</span>
        </button>
      </PopMenu>
    </div>
    <div :class="bodyClass"><slot v-if="current" :name="current" /></div>
  </div>

  <!-- Panes: every screen at once. -->
  <div v-else-if="mode === 'panes'" class="grid gap-4 md:grid-cols-2">
    <section v-for="s in screens" :key="s.id" :aria-label="s.label" class="rounded-xl bg-white p-3 ring-1 ring-gray-100">
      <h2 class="mb-2 text-xs font-bold tracking-wide text-gray-500 uppercase">{{ s.label }}</h2>
      <div class="max-h-[480px] overflow-y-auto"><slot :name="s.id" /></div>
    </section>
  </div>

  <!-- Sidebar. -->
  <div v-else-if="mode === 'sidebar'" class="flex gap-4">
    <nav class="flex w-44 shrink-0 flex-col gap-1" aria-label="Screens">
      <button v-for="s in screens" :key="s.id" type="button" :aria-current="s.id === current ? 'page' : undefined" :class="cn('rounded-lg px-3 py-2 text-left text-sm', s.id === current ? 'bg-brand text-white' : 'text-gray-600 hover:bg-mist')" @click="pick(s.id)">
        <span class="inline-flex items-center gap-1.5"><component :is="iconFor(s.icon)" v-if="iconFor(s.icon)" class="size-4" aria-hidden="true" />{{ s.label }}</span>
        <span v-if="s.badge" class="ml-1 rounded-full bg-mist px-1.5 text-[10px] font-bold text-gray-600">{{ s.badge }}</span>
      </button>
      <PopMenu v-if="switchable" v-slot="{ close }" label="Change display" align="start">
        <button v-for="m in SWITCHABLE_NAV_MODES" :key="m" type="button" role="menuitemradio" :aria-checked="m === mode" :class="itemClass(m === mode)" @click="choose(m), close()"><span class="capitalize">{{ m }}</span></button>
      </PopMenu>
    </nav>
    <div :class="cn('min-w-0 flex-1', bodyClass)"><slot v-if="current" :name="current" /></div>
  </div>

  <!-- Accordion. -->
  <div v-else-if="mode === 'accordion'">
    <div class="mb-1 flex justify-end">
      <PopMenu v-if="switchable" v-slot="{ close }" label="Change display">
        <button v-for="m in SWITCHABLE_NAV_MODES" :key="m" type="button" role="menuitemradio" :aria-checked="m === mode" :class="itemClass(m === mode)" @click="choose(m), close()"><span class="capitalize">{{ m }}</span></button>
      </PopMenu>
    </div>
    <div class="divide-y divide-gray-100 rounded-xl ring-1 ring-gray-100">
      <section v-for="s in screens" :key="s.id">
        <h2>
          <button type="button" :aria-expanded="s.id === current" :aria-controls="`${uid}-${s.id}`" class="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold text-ink hover:bg-mist" @click="pick(s.id)">
            <span class="inline-flex items-center gap-1.5"><component :is="iconFor(s.icon)" v-if="iconFor(s.icon)" class="size-4" aria-hidden="true" />{{ s.label }}</span>
            <ChevronDown :class="cn('size-4 text-gray-400 transition-transform', s.id === current && 'rotate-180')" aria-hidden="true" />
          </button>
        </h2>
        <div v-if="s.id === current" :id="`${uid}-${s.id}`" :class="cn('px-3 pb-3', bodyClass)"><slot :name="s.id" /></div>
      </section>
    </div>
  </div>

  <!-- Tabs. -->
  <div v-else>
    <div class="mb-3 flex items-center justify-between gap-2">
      <div role="tablist" aria-label="Screens" class="flex flex-wrap gap-1 rounded-full bg-mist p-1">
        <button
          v-for="s in screens"
          :id="`${uid}-tab-${s.id}`"
          :key="s.id"
          type="button"
          role="tab"
          :aria-selected="s.id === current"
          :aria-controls="`${uid}-panel`"
          :class="cn('rounded-full px-3 py-1.5 text-sm font-medium', s.id === current ? 'bg-white text-ink shadow-sm' : 'text-gray-600 hover:text-ink')"
          @click="pick(s.id)"
        >
          <span class="inline-flex items-center gap-1.5"><component :is="iconFor(s.icon)" v-if="iconFor(s.icon)" class="size-4" aria-hidden="true" />{{ s.label }}</span>
          <span v-if="s.badge" class="ml-1 rounded-full bg-mist px-1.5 text-[10px] font-bold text-gray-600">{{ s.badge }}</span>
        </button>
      </div>
      <PopMenu v-if="switchable" v-slot="{ close }" label="Change display">
        <button v-for="m in SWITCHABLE_NAV_MODES" :key="m" type="button" role="menuitemradio" :aria-checked="m === mode" :class="itemClass(m === mode)" @click="choose(m), close()"><span class="capitalize">{{ m }}</span></button>
      </PopMenu>
    </div>
    <div :id="`${uid}-panel`" role="tabpanel" :aria-labelledby="`${uid}-tab-${current}`" :class="bodyClass"><slot v-if="current" :name="current" /></div>
  </div>
</template>
