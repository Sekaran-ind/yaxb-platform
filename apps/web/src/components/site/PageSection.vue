<script setup lang="ts">
// The portal's Section: background colour, size and an optional image overlay, plus a header.
import { cn } from "@/lib/cn";

const COLORS = { white: "bg-canvas text-body", light: "bg-mist/50 text-body", dark: "bg-console text-white" } as const;
const SIZES = { normal: "py-12", medium: "py-16 md:py-20", large: "py-24 md:py-32" } as const;
const TITLE_SIZES = { sm: "text-xl md:text-2xl", md: "text-2xl md:text-3xl", lg: "text-3xl md:text-5xl" } as const;

withDefaults(
  defineProps<{
    color?: keyof typeof COLORS;
    size?: keyof typeof SIZES;
    backgroundImage?: string;
    backgroundImageOpacity?: number;
    id?: string;
    title?: string;
    subtitle?: string;
    titleTag?: "h1" | "h2" | "h3";
    titleSize?: keyof typeof TITLE_SIZES;
  }>(),
  { color: "white", size: "medium", backgroundImageOpacity: 1, titleTag: "h2", titleSize: "md" },
);
</script>

<template>
  <section :id="id" :class="cn('relative isolate overflow-hidden', COLORS[color], SIZES[size])">
    <div v-if="backgroundImage" aria-hidden="true" class="absolute inset-0 -z-10 bg-cover bg-center" :style="{ backgroundImage: `url(${backgroundImage})`, opacity: backgroundImageOpacity }" />
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <header v-if="title || subtitle" class="mx-auto mb-12 max-w-2xl text-center">
        <component :is="titleTag" v-if="title" :class="cn('font-semibold tracking-[-0.03em] text-balance text-current', TITLE_SIZES[titleSize])">{{ title }}</component>
        <p v-if="subtitle" class="mx-auto mt-4 max-w-3xl text-lg text-pretty opacity-80">{{ subtitle }}</p>
      </header>
      <slot />
    </div>
  </section>
</template>
