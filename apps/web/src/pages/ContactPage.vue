<script setup lang="ts">
import ContactPanel from "@/components/site/ContactPanel.vue";
import PageSection from "@/components/site/PageSection.vue";
</script>

<template>
  <PageSection background-image="/kiosk-bg.jpeg" :background-image-opacity="0.15">
    <div class="card"><ContactPanel /></div>
  </PageSection>
</template>
