<script setup lang="ts">
import { ChevronLeft } from "@lucide/vue";
import { useRoute } from "vue-router";
import SiteFooter from "@/components/site/SiteFooter.vue";
import SiteNavbar from "@/components/site/SiteNavbar.vue";
import CallLayer from "@/components/team/CallLayer.vue";
import TextDialog from "@/components/site/TextDialog.vue";
import { NATIVE } from "@/lib/platform";
import { restricted } from "@/composables/restricted";
import { startSync } from "@/composables/sync";
import { askPersistence } from "@/lib/browser/storage-meter";
import { watch } from "vue";

// Sync v2 with the box, when Storage is "box" (SYN-5).
startSync();

// Kiosks and installed apps ask the browser to keep their data (STO-2): the native app, an app
// installed from the browser, and a front desk. A website visitor isn't asked (Firefox shows a
// prompt); they can ask from Preferences → Storage.
const installed = NATIVE || (typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches);
watch(
  restricted,
  (frontDesk) => {
    if (installed || frontDesk) void askPersistence();
  },
  { immediate: true },
);

const route = useRoute();
</script>

<template>
  <template v-if="NATIVE">
    <!-- The native app: the kiosk fills the screen, inside the device's safe areas. -->
    <div class="native-safe flex min-h-dvh flex-col">
      <nav v-if="route.path !== '/kiosk'" class="flex h-12 items-center border-b border-gray-200/60 px-2" aria-label="App">
        <RouterLink to="/kiosk" class="btn-ghost"><ChevronLeft class="size-4" aria-hidden="true" /> Kiosk</RouterLink>
      </nav>
      <main id="main" class="flex-1"><RouterView /></main>
    </div>
  </template>
  <template v-else>
    <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:p-2">Skip to content</a>
    <!-- At the front desk (Restricted Mode) the kiosk is all there is. -->
    <SiteNavbar v-if="!restricted" />
    <main id="main" class="flex-1">
      <RouterView />
    </main>
    <SiteFooter v-if="!restricted" />
    <!-- A team call or a ringing call, above every page (TEAM-20). -->
    <CallLayer />
    <TextDialog />
  </template>
</template>
