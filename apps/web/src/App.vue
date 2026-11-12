<script setup lang="ts">
import SiteFooter from "@/components/site/SiteFooter.vue";
import SiteNavbar from "@/components/site/SiteNavbar.vue";
</script>

<template>
  <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:p-2">Skip to content</a>
  <SiteNavbar />
  <main id="main" class="flex-1">
    <RouterView />
  </main>
  <SiteFooter />
</template>
