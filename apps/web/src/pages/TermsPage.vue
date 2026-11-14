<script setup lang="ts">
import PageSection from "@/components/site/PageSection.vue";
</script>

<template>
  <PageSection size="normal" title-tag="h1" title="Terms of Service & Privacy Policy">
    <div class="mx-auto max-w-3xl space-y-6 leading-relaxed">
      <p class="caution px-4 py-3 text-sm">Placeholder: replace with your reviewed legal text before going live.</p>
      <h2 class="text-xl font-semibold text-ink">Use of the AI Kiosk</h2>
      <p>The kiosk provides general information from curated sources. It is not a substitute for professional medical, legal or financial advice. In an emergency, contact your local emergency services.</p>
      <h2 class="text-xl font-semibold text-ink">What we process</h2>
      <ul class="list-disc space-y-2 pl-6">
        <li>Questions you ask the kiosk, with your notebook's text, are sent to the AI provider selected in Settings to generate an answer.</li>
        <li>Conversations and notebooks are kept where you choose in Settings → Storage: this browser, this session, your local yaxb-box, or the server (keyed to an anonymous cookie).</li>
        <li>Questions the assistant escalates are shown to human moderators.</li>
        <li>Voice input uses your browser's speech service; in-browser translation and on-device models never leave your device.</li>
        <li>Contact form submissions are stored so we can reply to you.</li>
      </ul>
      <p>Please don't enter identifiers such as ID, insurance or account numbers into the kiosk.</p>
    </div>
  </PageSection>
</template>
