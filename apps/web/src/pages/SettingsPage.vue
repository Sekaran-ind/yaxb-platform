<script setup lang="ts">
import SettingsPanel from "@/components/settings/SettingsPanel.vue";
import PageSection from "@/components/site/PageSection.vue";
</script>

<template>
  <PageSection color="light" size="normal" title-tag="h1" title="Settings" subtitle="Set up the kiosk's deep agent: model, tools, MCP servers, memory and skills, storage, layout and voice.">
    <SettingsPanel />
  </PageSection>
</template>
