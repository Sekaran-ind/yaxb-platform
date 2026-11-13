<script setup lang="ts">
// clinux-core's AdaptiveSectionNav (the same one the YAXB kiosk uses): one navigation chrome for
// every layout. It does one job, moving between sibling sections; it owns the chrome only, and each
// screen's content is the caller's slot named by the screen's id.
//   tabs       pill tabs over one screen (a surface's screens, a few sub-sections)
//   sidebar    a vertical list beside one screen (many sections, such as preferences)
//   accordion  every screen as a collapsible section
//   panes      every screen at once (a config's fixed choice)
// Narrow (below the compact breakpoint, by the nav's own width): a few screens stay visible as tabs
// that share the width; more become a section menu, a button that names the current section.
// The mode is the host's choice by purpose and size (docs/ux/patterns.md, Navigation). Only with
// `switchable` does the nav offer a "Display" menu to change it, remembered per `storageKey` (the
// package's studio uses that; YAXB doesn't). `lockMode` is the old name for the default.
// Slot `lead`: something before the tabs or the section menu, such as a back link.
import { COMPACT_BREAKPOINT, resolveActiveScreen, resolveNavMode, SWITCHABLE_NAV_MODES, type NavMode } from "@sekaran-ind/yaxb-journeys/screens";
import { computed, ref, useId, watch } from "vue";
import Glyph from "./Glyph.vue";
import { useIcons } from "./icons";
import PopMenu from "./PopMenu.vue";

export type NavScreen = { id: string; label: string; icon?: string; badge?: string };

/** Up to this many screens stay visible as tabs when the nav is narrow; more go into a menu. */
const COMPACT_TABS = 4;

// fill: take the parent's height; the navigation stays put and only the screen scrolls.
const props = defineProps<{
  screens: NavScreen[];
  mode?: NavMode;
  storageKey: string;
  active: string | null;
  width: number;
  bodyClass?: string;
  fill?: boolean;
  /** Offer a "Display" menu (tabs, sidebar, accordion) and remember the choice. Off by default. */
  switchable?: boolean;
  /** @deprecated The default now: the mode is used as given. */
  lockMode?: boolean;
  /** Name for the navigation landmark, e.g. "Kiosk screens". */
  label?: string;
}>();
const emit = defineEmits<{ "update:active": [id: string] }>();
const uid = useId();
const icon = useIcons();

const key = computed(() => `yaxb.nav.${props.storageKey}`);
function read(): string | null {
  if (!props.switchable) return null;
  try {
    return localStorage.getItem(key.value);
  } catch {
    return null;
  }
}
const stored = ref<string | null>(read());
watch(key, () => (stored.value = read()));
function choose(mode: NavMode) {
  if (!SWITCHABLE_NAV_MODES.includes(mode)) return;
  stored.value = mode;
  try {
    localStorage.setItem(key.value, mode);
  } catch {
    /* best effort */
  }
}

const switchable = computed(() => Boolean(props.switchable) && !props.lockMode);
const mode = computed<NavMode>(() => (switchable.value ? resolveNavMode({ configMode: props.mode, storedMode: stored.value }) : (props.mode ?? "tabs")));
const current = computed(() => resolveActiveScreen(props.screens, props.active));
const currentScreen = computed(() => props.screens.find((s) => s.id === current.value));
const compact = computed(() => props.width < COMPACT_BREAKPOINT || (mode.value !== "panes" && props.screens.length === 1));
/** Narrow, with few screens: they share the width as tabs. Otherwise a section menu. */
const compactTabs = computed(() => compact.value && props.screens.length > 1 && props.screens.length <= COMPACT_TABS);
const showSwitch = computed(() => switchable.value && mode.value !== "panes");
const pick = (id: string) => emit("update:active", id);
const MODE_LABEL: Record<string, string> = { tabs: "Tabs", sidebar: "Side list", accordion: "Sections" };
const navLabel = computed(() => props.label ?? "Sections");

/** Arrow keys move between tabs (the tablist pattern); Home and End go to the ends. */
function onTabKey(e: KeyboardEvent) {
  const i = props.screens.findIndex((s) => s.id === current.value);
  const n = props.screens.length;
  const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
  if (to < 0) return;
  e.preventDefault();
  pick(props.screens[to]!.id);
  const list = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("[role=tab]");
  list[to]?.focus();
}
</script>

<template>
  <!-- Narrow: the screens as tabs sharing the width, or a section menu that names the current one. -->
  <div v-if="compact" class="yj yj-nav" :class="fill && 'yj-nav-fill'">
    <div v-if="compactTabs" class="yj-tabs-row">
      <slot name="lead" />
      <div role="tablist" :aria-label="navLabel" class="yj-tablist yj-tablist-fit" @keydown="onTabKey">
        <button
          v-for="s in screens"
          :id="`${uid}-tab-${s.id}`"
          :key="s.id"
          type="button"
          role="tab"
          class="yj-tab"
          :aria-selected="s.id === current"
          :tabindex="s.id === current ? 0 : -1"
          :aria-controls="`${uid}-panel`"
          :title="s.label"
          @click="pick(s.id)"
        >
          <span class="yj-label"><component :is="icon(s.icon)" v-if="icon(s.icon)" class="yj-icon" aria-hidden="true" /><span class="yj-tab-text">{{ s.label }}</span><span v-if="s.badge" class="yj-badge">{{ s.badge }}</span></span>
        </button>
      </div>
    </div>
    <div v-else class="yj-nav-head">
      <slot name="lead" />
      <PopMenu v-if="screens.length > 1" :label="`${navLabel}: ${currentScreen?.label ?? ''}. Choose another`" align="start" class="yj-section-menu">
        <template #button>
          <span class="yj-section-button">
            <component :is="icon(currentScreen?.icon)" v-if="icon(currentScreen?.icon)" class="yj-icon" aria-hidden="true" />
            <span class="yj-section-name">{{ currentScreen?.label }}</span>
            <Glyph name="chevron" />
          </span>
        </template>
        <template #default="{ close }">
          <button v-for="s in screens" :key="s.id" type="button" role="menuitemradio" :aria-checked="s.id === current" class="yj-menu-item" @click="pick(s.id), close()">
            <span class="yj-label"><component :is="icon(s.icon)" v-if="icon(s.icon)" class="yj-icon" aria-hidden="true" />{{ s.label }}</span>
            <span v-if="s.badge" class="yj-badge">{{ s.badge }}</span>
          </button>
        </template>
      </PopMenu>
      <h2 v-else-if="currentScreen" class="yj-nav-title">
        <component :is="icon(currentScreen.icon)" v-if="icon(currentScreen.icon)" class="yj-icon" aria-hidden="true" />{{ currentScreen.label }}
      </h2>
    </div>
    <div :id="`${uid}-panel`" :role="compactTabs ? 'tabpanel' : undefined" :aria-labelledby="compactTabs ? `${uid}-tab-${current}` : undefined" class="yj-cq yj-nav-body" :class="bodyClass">
      <slot v-if="current" :name="current" />
    </div>
  </div>

  <!-- Panes: every screen at once. -->
  <div v-else-if="mode === 'panes'" class="yj yj-nav yj-cq">
    <div class="yj-panes">
      <section v-for="s in screens" :key="s.id" :aria-label="s.label" class="yj-pane">
        <h2 class="yj-pane-title">{{ s.label }}</h2>
        <div class="yj-cq yj-pane-body"><slot :name="s.id" /></div>
      </section>
    </div>
  </div>

  <!-- Sidebar. -->
  <div v-else-if="mode === 'sidebar'" class="yj yj-nav yj-sidebar" :class="fill && 'yj-nav-fill'">
    <nav class="yj-side" :aria-label="navLabel">
      <slot name="lead" />
      <button v-for="s in screens" :key="s.id" type="button" class="yj-side-item" :aria-current="s.id === current ? 'page' : undefined" @click="pick(s.id)">
        <span class="yj-label"><component :is="icon(s.icon)" v-if="icon(s.icon)" class="yj-icon" aria-hidden="true" />{{ s.label }}</span>
        <span v-if="s.badge" class="yj-badge">{{ s.badge }}</span>
      </button>
      <PopMenu v-if="showSwitch" v-slot="{ close }" label="Display" align="start">
        <button v-for="m in SWITCHABLE_NAV_MODES" :key="m" type="button" role="menuitemradio" :aria-checked="m === mode" class="yj-menu-item" @click="choose(m), close()">{{ MODE_LABEL[m] }}</button>
      </PopMenu>
    </nav>
    <div class="yj-cq yj-grow yj-nav-body" :class="bodyClass"><slot v-if="current" :name="current" /></div>
  </div>

  <!-- Accordion. -->
  <div v-else-if="mode === 'accordion'" class="yj yj-nav">
    <div v-if="showSwitch || $slots.lead" class="yj-acc-tools">
      <slot name="lead" />
      <PopMenu v-if="showSwitch" v-slot="{ close }" label="Display">
        <button v-for="m in SWITCHABLE_NAV_MODES" :key="m" type="button" role="menuitemradio" :aria-checked="m === mode" class="yj-menu-item" @click="choose(m), close()">{{ MODE_LABEL[m] }}</button>
      </PopMenu>
    </div>
    <div class="yj-accordion">
      <section v-for="s in screens" :key="s.id">
        <h2>
          <button type="button" class="yj-acc-head" :aria-expanded="s.id === current" :aria-controls="`${uid}-${s.id}`" @click="pick(s.id)">
            <span class="yj-label"><component :is="icon(s.icon)" v-if="icon(s.icon)" class="yj-icon" aria-hidden="true" />{{ s.label }}<span v-if="s.badge" class="yj-badge">{{ s.badge }}</span></span>
            <span class="yj-chevron"><Glyph name="chevron" /></span>
          </button>
        </h2>
        <div v-if="s.id === current" :id="`${uid}-${s.id}`" class="yj-cq yj-acc-body" :class="bodyClass"><slot :name="s.id" /></div>
      </section>
    </div>
  </div>

  <!-- Tabs. -->
  <div v-else class="yj yj-nav" :class="fill && 'yj-nav-fill'">
    <div class="yj-tabs-row">
      <slot name="lead" />
      <div role="tablist" :aria-label="navLabel" class="yj-tablist" @keydown="onTabKey">
        <button
          v-for="s in screens"
          :id="`${uid}-tab-${s.id}`"
          :key="s.id"
          type="button"
          role="tab"
          class="yj-tab"
          :aria-selected="s.id === current"
          :tabindex="s.id === current ? 0 : -1"
          :aria-controls="`${uid}-panel`"
          @click="pick(s.id)"
        >
          <span class="yj-label"><component :is="icon(s.icon)" v-if="icon(s.icon)" class="yj-icon" aria-hidden="true" />{{ s.label }}<span v-if="s.badge" class="yj-badge">{{ s.badge }}</span></span>
        </button>
      </div>
      <PopMenu v-if="showSwitch" v-slot="{ close }" label="Display" class="yj-push">
        <button v-for="m in SWITCHABLE_NAV_MODES" :key="m" type="button" role="menuitemradio" :aria-checked="m === mode" class="yj-menu-item" @click="choose(m), close()">{{ MODE_LABEL[m] }}</button>
      </PopMenu>
    </div>
    <div :id="`${uid}-panel`" role="tabpanel" :aria-labelledby="`${uid}-tab-${current}`" class="yj-cq yj-nav-body" :class="bodyClass"><slot v-if="current" :name="current" /></div>
  </div>
</template>
