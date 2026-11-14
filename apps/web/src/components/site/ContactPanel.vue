<script setup lang="ts">
// Get in touch (as ClinüxFlow's): who to write to and where we are, beside the form.
import { Building2, Mail, MapPin } from "@lucide/vue";
import ContactForm from "./ContactForm.vue";
import { CONTACT_EMAIL, OPERATOR } from "@/lib/legal";

withDefaults(defineProps<{ heading?: boolean }>(), { heading: true });
</script>

<template>
  <div class="grid gap-10 p-6 md:grid-cols-[1fr_1.2fr] md:p-8">
    <div>
      <template v-if="heading">
        <p class="eyebrow">Get in touch</p>
        <h2 class="mt-2 text-2xl font-semibold tracking-[-0.03em] text-ink md:text-3xl">Let's talk about your kiosk</h2>
      </template>
      <p class="mt-3 text-pretty text-gray-600">Whether you're a family, a shop, a front desk or a partner, tell us what you need. We'll help you set up, answer technical questions, or plan a rollout.</p>
      <dl class="mt-8 space-y-5 text-sm">
        <div class="flex items-start gap-4">
          <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-mist ring-1 ring-gray-200/70"><Mail class="size-4 text-ink" aria-hidden="true" /></span>
          <div><dt class="text-xs text-gray-500">Email</dt><dd class="font-semibold text-ink"><a :href="`mailto:${CONTACT_EMAIL}`" class="hover:underline">{{ CONTACT_EMAIL }}</a></dd></div>
        </div>
        <div class="flex items-start gap-4">
          <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-mist ring-1 ring-gray-200/70"><MapPin class="size-4 text-ink" aria-hidden="true" /></span>
          <div><dt class="text-xs text-gray-500">Headquarters</dt><dd class="font-semibold text-ink">Bengaluru, Karnataka, India</dd><dd class="mt-0.5 text-gray-600">1555, 13th Main Rd, Sunshine Colony, Stage 2, BTM Layout, Bengaluru 560076</dd></div>
        </div>
        <div class="flex items-start gap-4">
          <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-mist ring-1 ring-gray-200/70"><Building2 class="size-4 text-ink" aria-hidden="true" /></span>
          <div><dt class="text-xs text-gray-500">Registered office</dt><dd class="font-semibold text-ink">{{ OPERATOR.name }}</dd><dd class="mt-0.5 text-gray-600">{{ OPERATOR.registered }} · GSTIN {{ OPERATOR.gstin }}</dd></div>
        </div>
      </dl>
    </div>
    <div class="rounded-2xl bg-mist/60 p-5 ring-1 ring-gray-200/70 md:p-6">
      <h3 class="mb-4 text-base font-semibold text-ink">Send us a message</h3>
      <ContactForm />
    </div>
  </div>
</template>
