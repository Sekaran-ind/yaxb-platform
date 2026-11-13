<script setup lang="ts">
// The kiosk frame (SET-14, LAY-1): one rounded frame holding a dark side panel and the screens. The
// kiosk (its player) and the Service Catalogue (CatalogueInfo) both use it, so both have the same
// three layouts (docs/ux/patterns.md, Frames):
//   full  a wide screen: the panel is a column beside the screens, and the frame fills the window,
//         wide and tall; the screens scroll inside it and the panel stays put
//   pod   a tablet: the panel is a strip above the screens, and the page scrolls
//   mini  a phone: a phone-sized card; with `miniHeight` (the kiosk, SET-18) its screens area has one
//         fixed height and scrolls inside
// The host picks the layout (resolveLayout from the width it measures around the frame). The
// screens' own width is measured here and passed to the default slot, for the adaptive nav.
// `narrowPanel`: while someone is working (designing a service), the full layout's panel is narrower.
import type { Layout } from "@sekaran-ind/yaxb-core/screens";
import { useWidth } from "@/composables/width";
import { cn } from "@/lib/cn";
import { NATIVE } from "@/lib/platform";

const props = defineProps<{ layout: Layout; miniHeight?: string; narrowPanel?: boolean }>();
const { el: screens, width } = useWidth(900);
// The full frame's height: the window less the site's navbar and the page padding (no navbar in the app).
const FULL_HEIGHT = NATIVE ? "h-[calc(100dvh-2.5rem)]" : "h-[calc(100dvh-6.5rem)]";
const outer = () => cn("mx-auto px-3 py-5 sm:px-5", props.layout === "mini" ? "max-w-md" : props.layout === "pod" ? "max-w-5xl" : "max-w-[110rem]");
</script>

<template>
  <div :class="outer()">
    <slot name="before" />
    <div
      :class="
        cn(
          'rounded-[2rem] border border-gray-200/70 bg-surface p-2 shadow-[var(--shadow-lift)]',
          layout === 'full' ? cn('grid min-h-[38rem] gap-2', FULL_HEIGHT, narrowPanel ? 'grid-cols-[18rem_minmax(0,1fr)]' : 'grid-cols-[22rem_minmax(0,1fr)] 2xl:grid-cols-[25rem_minmax(0,1fr)]') : 'space-y-2',
        )
      "
    >
      <div :class="layout === 'full' ? 'min-h-0 [&>*]:h-full' : ''"><slot name="panel" /></div>
      <div
        ref="screens"
        :class="
          cn(
            'min-w-0',
            layout === 'full' && 'min-h-0 overflow-y-auto px-3 pt-3 pb-3 [scrollbar-width:thin]',
            layout === 'pod' && 'px-3 pt-2 pb-3',
            layout === 'mini' && cn('px-1.5 pt-1 pb-2', miniHeight),
          )
        "
      >
        <slot :width="width" />
      </div>
    </div>
  </div>
</template>
