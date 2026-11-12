<script setup lang="ts">
import ContactForm from "./ContactForm.vue";
</script>

<template>
  <div class="p-6 md:p-8">
    <div class="mb-8 grid items-center gap-6 md:grid-cols-2">
      <img src="/icons8-artificial-64.png" alt="YAXB" width="64" height="64" />
      <h2 class="text-center text-2xl font-semibold text-ink md:text-3xl">eMail : support@yaxb.ai</h2>
    </div>
    <div class="grid gap-8 md:grid-cols-2">
      <div class="space-y-3">
        <h3 class="text-lg font-bold text-ink">Yaxb Technology Solutions Private Limited,</h3>
        <h3 class="text-lg font-bold text-ink">GSTIN : 33AABCY8630L1Z1</h3>
        <p class="text-ink">Branch Office : 1555, 13th Main Rd, Sunshine Colony, Stage 2, BTM Layout, Bengaluru, Karnataka 560076.</p>
        <p class="text-ink">Registered Office : 1st Floor, 6/4, Subramaniyapuram, Mohanur, Namakkal, Tamil Nadu, 637015.</p>
      </div>
      <ContactForm />
    </div>
  </div>
</template>
