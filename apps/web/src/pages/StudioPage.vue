<script setup lang="ts">
// The journey studio (JRN-30..36): write services, journeys and questionnaires as YAML and see
// them in the kiosk's adaptive nav. It is @sekaran-ind/yaxb-journeys' FlowStudio, checked against
// this kiosk's handlers and screens. Everything stays in the browser.
import { JOURNEY_SERVICES, kioskContent } from "@sekaran-ind/yaxb-core/content";
import { FlowStudio, provideIcons } from "@sekaran-ind/yaxb-journeys/vue";
import "@sekaran-ind/yaxb-journeys/style.css";
import { iconFor } from "@/lib/icons";
import { LANGUAGES } from "@/lib/languages";

provideIcons(iconFor);
const screens = kioskContent.screens.screens.map((s) => s.id);
const languages = LANGUAGES.map((l) => ({ code: l.code, label: l.label }));
const sources = [
  { id: "sample-leaflet", title: "Sample: clinic leaflet" },
  { id: "sample-policy", title: "Sample: holiday policy" },
];
</script>

<template>
  <section class="bg-canvas py-10 md:py-14">
    <div class="mx-auto max-w-[1600px] px-4 sm:px-6">
      <header class="mb-6 max-w-3xl">
        <h1 class="text-2xl font-semibold tracking-[-0.03em] text-ink md:text-3xl">Journey studio</h1>
        <p class="mt-2 text-pretty">
          Write a <strong class="text-ink">service</strong>, the <strong class="text-ink">journeys</strong> it opens and the <strong class="text-ink">questionnaires</strong> they ask, in one YAML file. The preview runs
          them in the kiosk's navigation at each kiosk size. Your draft stays in this browser. Services such as the assistant or the notebook are shown as stand-ins.
        </p>
      </header>
      <FlowStudio :service-names="JOURNEY_SERVICES" :screens="screens" :languages="languages" :sources="sources" storage-key="yaxb.studio.draft" />
    </div>
  </section>
</template>
