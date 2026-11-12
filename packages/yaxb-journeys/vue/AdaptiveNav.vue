<script setup lang="ts">
// clinux-core's AdaptiveSectionNav (the same one the YAXB kiosk uses): one navigation chrome for
// every layout. It owns the chrome only; each screen's content is the caller's slot named by the
// screen's id.
//   tabs       pill tabs over one screen
//   sidebar    a vertical list beside one screen
//   accordion  every screen as a collapsible section
//   panes      every screen at once (a config's fixed choice, never switchable)
// Below the compact breakpoint every mode collapses to one screen plus a section menu. Visitors can
// switch between tabs, sidebar and accordion; the choice is remembered per `storageKey`.
// `lockMode` uses `mode` as given, with no switch menu and nothing remembered (the studio's preview).
import { COMPACT_BREAKPOINT, resolveActiveScreen, resolveNavMode, SWITCHABLE_NAV_MODES, type NavMode } from "@sekaran-ind/yaxb-journeys/screens";
import { computed, ref, useId, watch } from "vue";
import Glyph from "./Glyph.vue";
import { useIcons } from "./icons";
import PopMenu from "./PopMenu.vue";

export type NavScreen = { id: string; label: string; icon?: string; badge?: string };

// fill: take the parent's height; the navigation stays put and only the screen scrolls.
const props = defineProps<{ screens: NavScreen[]; mode?: NavMode; storageKey: string; active: string | null; width: number; bodyClass?: string; fill?: boolean; lockMode?: boolean }>();
const emit = defineEmits<{ "update:active": [id: string] }>();
const uid = useId();
const icon = useIcons();

const key = computed(() => `yaxb.nav.${props.storageKey}`);
function read(): string | null {
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

const mode = computed<NavMode>(() => (props.lockMode ? (props.mode ?? "tabs") : resolveNavMode({ configMode: props.mode, storedMode: stored.value })));
const current = computed(() => resolveActiveScreen(props.screens, props.active));
const currentScreen = computed(() => props.screens.find((s) => s.id === current.value));
const compact = computed(() => props.width < COMPACT_BREAKPOINT || (mode.value !== "panes" && props.screens.length === 1));
const switchable = computed(() => !props.lockMode && mode.value !== "panes");
const pick = (id: string) => emit("update:active", id);
</script>

<template>
  <!-- Compact: one screen and a section menu. -->
  <div v-if="compact" class="yj yj-nav" :class="fill && 'yj-nav-fill'">
    <div class="yj-nav-head">
      <h2 v-if="currentScreen" class="yj-nav-title">
        <component :is="icon(currentScreen.icon)" v-if="icon(currentScreen.icon)" class="yj-icon" aria-hidden="true" />{{ currentScreen.label }}
      </h2>
      <PopMenu v-if="screens.length > 1" v-slot="{ close }" label="Choose a screen">
        <button v-for="s in screens" :key="s.id" type="button" role="menuitemradio" :aria-checked="s.id === current" class="yj-menu-item" @click="pick(s.id), close()">
          <span class="yj-label"><component :is="icon(s.icon)" v-if="icon(s.icon)" class="yj-icon" aria-hidden="true" />{{ s.label }}</span>
          <span v-if="s.badge" class="yj-badge">{{ s.badge }}</span>
        </button>
      </PopMenu>
    </div>
    <div class="yj-cq yj-nav-body" :class="bodyClass"><slot v-if="current" :name="current" /></div>
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
  <div v-else-if="mode === 'sidebar'" class="yj yj-nav yj-sidebar">
    <nav class="yj-side" aria-label="Screens">
      <button v-for="s in screens" :key="s.id" type="button" class="yj-side-item" :aria-current="s.id === current ? 'page' : undefined" @click="pick(s.id)">
        <span class="yj-label"><component :is="icon(s.icon)" v-if="icon(s.icon)" class="yj-icon" aria-hidden="true" />{{ s.label }}</span>
        <span v-if="s.badge" class="yj-badge">{{ s.badge }}</span>
      </button>
      <PopMenu v-if="switchable" v-slot="{ close }" label="Change display" align="start">
        <button v-for="m in SWITCHABLE_NAV_MODES" :key="m" type="button" role="menuitemradio" :aria-checked="m === mode" class="yj-menu-item" @click="choose(m), close()">{{ m[0]!.toUpperCase() + m.slice(1) }}</button>
      </PopMenu>
    </nav>
    <div class="yj-cq yj-grow" :class="bodyClass"><slot v-if="current" :name="current" /></div>
  </div>

  <!-- Accordion. -->
  <div v-else-if="mode === 'accordion'" class="yj yj-nav">
    <div v-if="switchable" class="yj-acc-tools">
      <PopMenu v-slot="{ close }" label="Change display">
        <button v-for="m in SWITCHABLE_NAV_MODES" :key="m" type="button" role="menuitemradio" :aria-checked="m === mode" class="yj-menu-item" @click="choose(m), close()">{{ m[0]!.toUpperCase() + m.slice(1) }}</button>
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
      <div role="tablist" aria-label="Screens" class="yj-tablist">
        <button
          v-for="s in screens"
          :id="`${uid}-tab-${s.id}`"
          :key="s.id"
          type="button"
          role="tab"
          class="yj-tab"
          :aria-selected="s.id === current"
          :aria-controls="`${uid}-panel`"
          @click="pick(s.id)"
        >
          <span class="yj-label"><component :is="icon(s.icon)" v-if="icon(s.icon)" class="yj-icon" aria-hidden="true" />{{ s.label }}<span v-if="s.badge" class="yj-badge">{{ s.badge }}</span></span>
        </button>
      </div>
      <PopMenu v-if="switchable" v-slot="{ close }" label="Change display">
        <button v-for="m in SWITCHABLE_NAV_MODES" :key="m" type="button" role="menuitemradio" :aria-checked="m === mode" class="yj-menu-item" @click="choose(m), close()">{{ m[0]!.toUpperCase() + m.slice(1) }}</button>
      </PopMenu>
    </div>
    <div :id="`${uid}-panel`" role="tabpanel" :aria-labelledby="`${uid}-tab-${current}`" class="yj-cq yj-nav-body" :class="bodyClass"><slot v-if="current" :name="current" /></div>
  </div>
</template>
