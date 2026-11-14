<script setup lang="ts">
// The player: the dark console in a kiosk frame's panel (KioskFrame), shared by the kiosk
// (PlayerPanel) and the Service Catalogue (CataloguePlayer), so both read the same way
// (docs/ux/patterns.md, Players). Its anatomy, top to bottom in the full variant:
//   controls  the one personal button, top right (profile and preferences / staff sign-in)
//   orb       the surface's mark, glowing; `#orb` is its icon
//   eyebrow   the surface's name ("Anjal - Digital Kiosk (Your Own)", "Anjal - Service Catalogue")
//   status    the "now playing" line, live (role="status"): what is happening now
//   body      full only: what this surface shows while idle (the voice bars; the catalogue's steps)
//   meta      one quiet line that scrolls only when it doesn't fit (the notebook; the counts)
//   actions   the round controls at the foot; the primary is the large brand circle
// Variants follow the frame's layouts: full (a column), strip (pod: a bar), mini (a small card).
import { Loader2 } from "@lucide/vue";
import { cn } from "@/lib/cn";
import MarqueeLine from "@/components/kiosk/MarqueeLine.vue";

withDefaults(defineProps<{ eyebrow: string; status: string; busy?: boolean; variant?: "full" | "strip" | "mini"; label?: string }>(), { variant: "full" });
</script>

<template>
  <section
    :aria-label="label ?? eyebrow"
    :class="
      cn(
        'console',
        variant === 'full' && 'flex h-full min-h-0 flex-col items-center justify-between gap-4 overflow-y-auto px-6 py-8 [scrollbar-width:none]',
        variant === 'strip' && 'flex flex-wrap items-center justify-between gap-4 px-5 py-4',
        variant === 'mini' && 'flex items-center justify-between gap-3 rounded-2xl px-4 py-3',
      )
    "
  >
    <div v-if="variant === 'full'" class="flex w-full justify-end"><slot name="controls" /></div>
    <div :class="variant === 'full' ? 'flex flex-col items-center text-center' : 'flex min-w-0 flex-1 items-center gap-3'">
      <div class="console-orb flex shrink-0 items-center justify-center overflow-hidden rounded-full" :style="{ width: variant === 'full' ? '128px' : variant === 'strip' ? '52px' : '36px', height: variant === 'full' ? '128px' : variant === 'strip' ? '52px' : '36px' }">
        <slot name="orb" :size="variant === 'full' ? 'size-10' : variant === 'strip' ? 'size-6' : 'size-4'" />
      </div>
      <div :class="variant === 'full' ? 'flex flex-col items-center' : 'min-w-0'">
        <p :class="cn('font-semibold tracking-[0.22em] text-white/60 uppercase', variant === 'full' ? 'mt-6 text-xs' : 'truncate text-[10px]')">{{ eyebrow }}</p>
        <p :class="cn('flex items-center gap-2 font-medium tracking-tight text-white', variant === 'full' ? 'mt-2 max-w-xs text-xl' : 'min-w-0 truncate text-sm')" role="status" aria-live="polite">
          <span :class="variant !== 'full' && 'truncate'">{{ status }}</span><Loader2 v-if="busy" class="size-4 shrink-0 animate-spin text-brand" aria-hidden="true" />
        </p>
        <slot name="under-status" />
        <MarqueeLine v-if="$slots.meta && variant !== 'full'" class="max-w-56 text-[11px] text-white/60"><slot name="meta" /></MarqueeLine>
      </div>
    </div>

    <slot v-if="variant === 'full'" name="body" />
    <slot v-else name="strip-body" />

    <MarqueeLine v-if="variant === 'full' && $slots.meta" class="w-full max-w-xs text-center text-xs text-white/60"><slot name="meta" /></MarqueeLine>
    <slot v-if="variant !== 'full'" name="controls" />
    <div :class="cn('flex items-center', variant === 'full' ? 'gap-5' : 'gap-2')"><slot name="actions" /></div>
    <slot v-if="variant === 'full'" name="foot" />
  </section>
</template>
