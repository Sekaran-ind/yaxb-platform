<script setup lang="ts">
import { Menu, X } from "@lucide/vue";
import { ref } from "vue";
import { useRoute } from "vue-router";
import { cn } from "@/lib/cn";
import BaseModal from "./BaseModal.vue";
import ContactPanel from "./ContactPanel.vue";

const LINKS = [
  { to: "/#about", label: "About" },
  { to: "/kiosk", label: "AI Kiosk" },
  { to: "/settings", label: "Settings" },
];
const route = useRoute();
const menuOpen = ref(false);
const contactOpen = ref(false);
</script>

<template>
  <nav id="top" class="border-b border-gray-100 bg-mist" aria-label="Main">
    <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between px-4 py-3 sm:px-6">
      <RouterLink to="/" class="flex items-center gap-3">
        <img src="/icons8-artificial-64.png" alt="" width="40" height="40" />
        <span class="text-2xl font-semibold text-ink">YAXB.AI</span>
      </RouterLink>
      <button type="button" class="rounded p-2 md:hidden" :aria-expanded="menuOpen" aria-controls="main-menu" aria-label="Toggle menu" @click="menuOpen = !menuOpen">
        <X v-if="menuOpen" class="size-6" />
        <Menu v-else class="size-6" />
      </button>
      <div id="main-menu" :class="cn('w-full md:flex md:w-auto md:items-center md:gap-1', menuOpen ? 'block' : 'hidden')">
        <RouterLink
          v-for="l in LINKS"
          :key="l.to"
          :to="l.to"
          :aria-current="route.path === l.to ? 'page' : undefined"
          :class="cn('block rounded-md px-3 py-2 text-ink hover:bg-white', route.path === l.to && 'font-semibold text-brand-dark')"
          @click="menuOpen = false"
        >
          {{ l.label }}
        </RouterLink>
        <button type="button" class="block w-full rounded-md px-3 py-2 text-left text-ink hover:bg-white md:w-auto" @click="(menuOpen = false), (contactOpen = true)">Contact Us</button>
      </div>
    </div>
    <BaseModal :open="contactOpen" title="Hello" @close="contactOpen = false"><ContactPanel /></BaseModal>
  </nav>
</template>
