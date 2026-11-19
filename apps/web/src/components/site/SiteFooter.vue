<script setup lang="ts">
import BrandLogo from "./BrandLogo.vue";
import { ref } from "vue";
import BaseModal from "./BaseModal.vue";
import ContactPanel from "./ContactPanel.vue";
import { SITE_WIDTH } from "@/lib/site-width";
import { cn } from "@/lib/cn";
import { CLINUX_URL, OPERATOR } from "@/lib/legal";
import { SITE_BRAND } from "@/lib/surface";
import BrandText from "./BrandText.vue";

const contactOpen = ref(false);
</script>

<template>
  <footer class="border-t border-gray-200/60">
    <div :class="cn('mx-auto flex flex-col gap-4 py-8 text-sm md:flex-row md:items-center md:justify-between', SITE_WIDTH)">
      <div class="flex items-center gap-2.5">
        <BrandLogo class="size-6" />
        <span class="text-gray-500"><BrandText :text="SITE_BRAND" /> · {{ OPERATOR.name }} · GSTIN {{ OPERATOR.gstin }}</span>
      </div>
      <nav class="flex flex-wrap items-center gap-x-5 gap-y-2 text-gray-500" aria-label="Footer">
        <a href="#top" class="hover:text-ink">Top</a>
        <RouterLink to="/faq" class="hover:text-ink">FAQ</RouterLink>
        <RouterLink to="/terms-conditions" class="hover:text-ink">Terms &amp; Privacy</RouterLink>
        <a :href="CLINUX_URL" target="_blank" rel="noopener" class="hover:text-ink">ClinüxFlow</a>
        <button type="button" class="hover:text-ink" @click="contactOpen = true">Contact</button>
      </nav>
    </div>
    <BaseModal :open="contactOpen" title="Get in touch" @close="contactOpen = false"><ContactPanel :heading="false" /></BaseModal>
  </footer>
</template>
