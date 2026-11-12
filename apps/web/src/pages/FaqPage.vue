<script setup lang="ts">
import PageSection from "@/components/site/PageSection.vue";

const FAQ = [
  { q: "What is the YAXB AI Kiosk?", a: "A self-service assistant you can talk to by voice or text. It answers from a curated, moderated knowledge base and your own notebook, and escalates sensitive questions to people." },
  { q: "Which AI model does the kiosk use?", a: "Your choice. On the Settings page you can pick any provider and model your administrator has enabled, such as Claude, GPT, Gemini, Cloudflare Workers AI or a local model." },
  { q: "Does the kiosk give medical advice?", a: "No. It provides general information from curated sources and directs you to a clinician for personal medical decisions, or to emergency services when needed." },
  { q: "Where is my conversation stored?", a: "Where you choose in Settings → Storage: this browser, this session only, your own yaxb-box on the local network, or the server. Questions escalated for review are visible to moderators." },
  { q: "Can it translate?", a: "Yes. Translation runs entirely in your browser, so the text you translate is not sent to our servers." },
];
</script>

<template>
  <PageSection title-tag="h1" title="Frequently Asked Questions">
    <div class="mx-auto max-w-3xl divide-y divide-gray-100">
      <details v-for="item in FAQ" :key="item.q" class="group py-5">
        <summary class="flex cursor-pointer list-none items-center gap-3 text-lg font-medium text-ink">
          <span class="text-brand group-open:hidden">+</span>
          <span class="hidden text-brand group-open:inline">−</span>
          {{ item.q }}
        </summary>
        <p class="mt-3 pl-6">{{ item.a }}</p>
      </details>
    </div>
  </PageSection>
</template>
