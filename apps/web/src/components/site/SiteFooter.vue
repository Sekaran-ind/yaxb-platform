<script setup lang="ts">
import { ref } from "vue";
import BaseModal from "./BaseModal.vue";
import ContactPanel from "./ContactPanel.vue";

const contactOpen = ref(false);
</script>

<template>
  <footer class="border-t border-gray-200/60">
    <div class="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm sm:px-6 md:flex-row md:items-center md:justify-between">
      <div class="flex items-center gap-2.5">
        <span class="grid size-6 place-items-center rounded-md bg-brand-dark text-[10px] font-bold text-on-brand" aria-hidden="true">Y</span>
        <span class="text-gray-500">Yaxb Technology Solutions Private Limited · GSTIN 33AABCY8630L1Z1</span>
      </div>
      <nav class="flex items-center gap-5 text-gray-500" aria-label="Footer">
        <a href="#top" class="hover:text-ink">Top</a>
        <RouterLink to="/faq" class="hover:text-ink">FAQ</RouterLink>
        <RouterLink to="/terms-conditions" class="hover:text-ink">Terms &amp; Privacy</RouterLink>
        <button type="button" class="hover:text-ink" @click="contactOpen = true">Contact</button>
      </nav>
    </div>
    <BaseModal :open="contactOpen" title="Hello" @close="contactOpen = false"><ContactPanel /></BaseModal>
  </footer>
</template>
