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
];
const route = useRoute();
const menuOpen = ref(false);
const contactOpen = ref(false);
</script>

<template>
  <nav id="top" class="sticky top-0 z-30 border-b border-gray-200/60 bg-canvas/80 backdrop-blur-xl" aria-label="Main">
    <div class="mx-auto flex h-14 max-w-6xl flex-wrap items-center justify-between px-4 sm:px-6">
      <RouterLink to="/" class="flex items-center gap-2.5">
        <span class="grid size-7 place-items-center rounded-lg bg-brand-dark text-[11px] font-bold tracking-tight text-on-brand" aria-hidden="true">Y</span>
        <span class="text-[15px] font-semibold tracking-tight text-ink">YAXB<span class="text-gray-400">.ai</span></span>
      </RouterLink>
      <button type="button" class="rounded-full p-2 md:hidden" :aria-expanded="menuOpen" aria-controls="main-menu" aria-label="Toggle menu" @click="menuOpen = !menuOpen">
        <X v-if="menuOpen" class="size-5" />
        <Menu v-else class="size-5" />
      </button>
      <div id="main-menu" :class="cn('w-full pb-3 md:flex md:w-auto md:items-center md:gap-1 md:pb-0', menuOpen ? 'block' : 'hidden')">
        <RouterLink
          v-for="l in LINKS"
          :key="l.to"
          :to="l.to"
          :aria-current="route.path === l.to ? 'page' : undefined"
          :class="cn('block rounded-full px-3 py-1.5 text-sm text-gray-600 transition hover:text-ink', route.path === l.to && 'bg-mist font-medium text-ink')"
          @click="menuOpen = false"
        >
          {{ l.label }}
        </RouterLink>
        <button type="button" class="btn-primary mt-2 h-8 w-full px-3.5 text-[13px] md:mt-0 md:ml-2 md:w-auto" @click="(menuOpen = false), (contactOpen = true)">Contact us</button>
      </div>
    </div>
    <BaseModal :open="contactOpen" title="Hello" @close="contactOpen = false"><ContactPanel /></BaseModal>
  </nav>
</template>
