<script setup lang="ts">
// The catalogue's side of the kiosk frame, where the kiosk has its player: what the catalogue is,
// how a service gets to a kiosk, the counts, who you are, and the main actions. Dark in every theme,
// like the kiosk's console. Its variants follow the frame's layouts, like the player's:
//   full   a column beside the screens      strip  a bar above them (pod)      mini  a small card
// While a service is open (`working`), it keeps only what helps: the service's name and status,
// the actions, and who you are.
import { Library, LogIn, LogOut, MonitorSmartphone, Plus } from "@lucide/vue";
import { cn } from "@/lib/cn";

const props = withDefaults(
  defineProps<{
    who: { name: string; guest: boolean; roles: string } | null;
    counts: { published: number; mine: number; review: number | null };
    /** The service open on the right, if any. */
    current: { title: string; status: string } | null;
    variant?: "full" | "strip" | "mini";
  }>(),
  { variant: "full" },
);
const emit = defineEmits<{ newService: []; signIn: []; signOut: [] }>();
const STEPS = [
  { n: 1, title: "Design", body: "A service, its journeys, their screens, and the roles that start and finish them." },
  { n: 2, title: "Review", body: "Submit it; a reviewer reads it, tries it, and publishes it." },
  { n: 3, title: "Load", body: "Any kiosk loads published services from here." },
];
const full = () => props.variant === "full";
</script>

<template>
  <aside
    :class="
      cn(
        'console flex text-white',
        variant === 'full' && 'flex-col gap-6 overflow-y-auto p-6 [scrollbar-width:none]',
        variant === 'strip' && 'flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4',
        variant === 'mini' && 'flex-col gap-3 rounded-2xl p-4',
      )
    "
    aria-label="About the Service Catalogue"
  >
    <div class="min-w-0">
      <p class="flex items-center gap-2 text-[10px] font-semibold tracking-[0.22em] text-white/60 uppercase"><Library class="size-3.5" aria-hidden="true" /> YAXB Service Catalogue</p>
      <template v-if="current && !full()">
        <p class="mt-1 truncate font-semibold text-white">{{ current.title }}</p>
        <p class="truncate text-xs text-white/60">{{ current.status }}</p>
      </template>
      <template v-else>
        <h1 :class="cn('font-semibold tracking-tight text-white', full() ? 'mt-3 text-2xl' : 'mt-1 text-lg')">Design once. Run on any kiosk.</h1>
        <p v-if="full() && !current" class="mt-2 text-sm leading-relaxed text-white/70">Guided services for your kiosks, designed by anyone, published by your reviewers.</p>
      </template>
    </div>

    <template v-if="full()">
      <div v-if="current" class="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
        <p class="text-[11px] tracking-wide text-white/60 uppercase">Now open</p>
        <p class="mt-1 font-medium text-white">{{ current.title }}</p>
        <p class="text-xs text-white/60">{{ current.status }}</p>
        <p class="mt-3 text-xs leading-relaxed text-white/60">Go through the four steps with Next. The preview beside them shows what a visitor sees. Save, then submit for review.</p>
      </div>
      <ol v-else class="space-y-3">
        <li v-for="s in STEPS" :key="s.n" class="flex gap-3">
          <span class="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold text-white">{{ s.n }}</span>
          <span>
            <span class="block text-sm font-medium text-white">{{ s.title }}</span>
            <span class="block text-xs leading-relaxed text-white/60">{{ s.body }}</span>
          </span>
        </li>
      </ol>
      <dl v-if="!current" class="grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-center">
        <div><dt class="text-[11px] text-white/60">Published</dt><dd class="text-xl font-semibold text-white">{{ counts.published }}</dd></div>
        <div><dt class="text-[11px] text-white/60">{{ who?.guest ? "Yours" : "All" }}</dt><dd class="text-xl font-semibold text-white">{{ counts.mine }}</dd></div>
        <div><dt class="text-[11px] text-white/60">In review</dt><dd class="text-xl font-semibold text-white">{{ counts.review ?? "—" }}</dd></div>
      </dl>
    </template>

    <div :class="cn(full() ? 'mt-auto space-y-3' : 'flex flex-wrap items-center gap-2')">
      <div class="flex flex-wrap gap-2">
        <button type="button" class="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-console hover:opacity-90" @click="emit('newService')"><Plus class="size-4" aria-hidden="true" /> New service</button>
        <RouterLink to="/kiosk?screen=services" class="inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm text-white/85 ring-1 ring-white/20 hover:bg-white/10"><MonitorSmartphone class="size-4" aria-hidden="true" /> Open the kiosk</RouterLink>
      </div>
      <div v-if="who" :class="cn('flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs', !full() && 'min-w-0 flex-1 sm:flex-none')">
        <span class="min-w-0">
          <span class="block truncate text-white/90">{{ who.guest ? "Designing as a guest" : who.name }}</span>
          <span class="block truncate text-white/60">{{ who.guest ? "Your services stay with this browser" : who.roles }}</span>
        </span>
        <button v-if="who.guest" type="button" class="inline-flex h-8 shrink-0 items-center gap-1 text-white/85 hover:text-white" @click="emit('signIn')"><LogIn class="size-3.5" aria-hidden="true" /> Staff sign in</button>
        <button v-else type="button" class="inline-flex h-8 shrink-0 items-center gap-1 text-white/85 hover:text-white" @click="emit('signOut')"><LogOut class="size-3.5" aria-hidden="true" /> Sign out</button>
      </div>
    </div>
  </aside>
</template>
