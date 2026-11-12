<script setup lang="ts">
import { ChevronLeft } from "@lucide/vue";
import { useRoute } from "vue-router";
import SiteFooter from "@/components/site/SiteFooter.vue";
import SiteNavbar from "@/components/site/SiteNavbar.vue";
import { NATIVE } from "@/lib/platform";

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
    <SiteNavbar />
    <main id="main" class="flex-1">
      <RouterView />
    </main>
    <SiteFooter />
  </template>
</template>
