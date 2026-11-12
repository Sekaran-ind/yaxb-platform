<script setup lang="ts">
import AdminPanel from "@/components/moderation/AdminPanel.vue";
import PageSection from "@/components/site/PageSection.vue";
</script>

<template>
  <PageSection size="normal" title-tag="h1" title="Administration" subtitle="Moderators, their keys, and the audit log.">
    <div class="mx-auto max-w-4xl"><AdminPanel /></div>
  </PageSection>
</template>
