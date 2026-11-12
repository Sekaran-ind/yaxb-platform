<script setup lang="ts">
import { ref } from "vue";
import BaseModal from "./BaseModal.vue";
import ContactPanel from "./ContactPanel.vue";

const contactOpen = ref(false);
</script>

<template>
  <footer class="border-t border-gray-100 bg-mist">
    <div class="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:px-6 md:grid-cols-2">
      <RouterLink to="/" class="flex items-center gap-3">
        <img src="/icons8-artificial-64.png" alt="" width="36" height="36" />
        <span class="text-xl font-semibold text-ink">YAXB.AI</span>
      </RouterLink>
      <div class="flex items-center gap-6 md:justify-end">
        <a href="#top" class="hover:text-brand-dark">Top</a>
        <RouterLink to="/faq" class="hover:text-brand-dark">FAQ</RouterLink>
        <RouterLink to="/terms-conditions" class="hover:text-brand-dark">Terms &amp; Privacy</RouterLink>
        <button type="button" class="hover:text-brand-dark" @click="contactOpen = true">Contact</button>
      </div>
      <p class="text-sm text-gray-500 md:col-span-2">Yaxb Technology Solutions Private Limited - GSTIN : 33AABCY8630L1Z1</p>
    </div>
    <BaseModal :open="contactOpen" title="Hello" @close="contactOpen = false"><ContactPanel /></BaseModal>
  </footer>
</template>
