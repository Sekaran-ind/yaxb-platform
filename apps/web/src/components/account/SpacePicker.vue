<script setup lang="ts">
// "Where are you today?" (SPC-2, SPC-4): after the person (their profile), the space, when their
// account belongs to more than one here. It looks like "Who's using Anjal?" and takes its place in
// the kiosk. Picking one opens it (the app starts again in it); "Start or join another" runs the
// your-account journey; "Not now" keeps the kiosk as it is for this visit.
import type { Membership } from "@sekaran-ind/yaxb-core/identity";
import { Building2, Check, House, Loader2, Plus, Users } from "@lucide/vue";
import { computed, ref } from "vue";
import { useIdentity } from "@/composables/identity";
import { cn } from "@/lib/cn";

/** `defer`: the picker was asked for by a journey step, which opens the space itself (emits `pick`). */
const props = defineProps<{ defer?: boolean }>();
const emit = defineEmits<{ later: []; more: []; pick: [space: Membership] }>();
const id = useIdentity();
const me = computed(() => (id.me.value.signedIn ? id.me.value : null));
const busy = ref<string | null>(null);
const error = ref<string | null>(null);
const ICON = { family: House, business: Building2, community: Users } as const;
const KIND = { family: "Family", business: "Business", community: "Community" } as const;
const key = (s: Membership) => `${s.edition}:${s.tenant_id}`;
const isOpen = (s: Membership) => me.value?.space?.tenant_id === s.tenant_id && me.value.space.edition === s.edition;

async function pick(s: Membership) {
  if (props.defer) return emit("pick", s);
  if (isOpen(s)) return emit("later");
  busy.value = key(s);
  error.value = null;
  try {
    await id.openSpace(s.tenant_id, s.edition);
  } catch (e) {
    error.value = (e as Error).message;
    busy.value = null;
  }
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col items-center justify-center gap-8 overflow-y-auto px-4 py-8 text-center" aria-labelledby="space-title">
    <div>
      <h2 id="space-title" class="text-2xl font-semibold tracking-tight text-ink">Where are you today?</h2>
      <p class="mt-1 text-sm text-gray-600">{{ me?.account.display_name ? `${me.account.display_name}, choose` : "Choose" }} {{ id.childMode.value ? "where you are." : "your family, business or community." }} You can switch any time.</p>
    </div>
    <ul class="grid w-full max-w-2xl gap-3 @lg:grid-cols-2">
      <li v-for="s in id.spacesHere.value" :key="key(s)">
        <button
          type="button"
          :class="cn('card flex w-full items-center gap-3 p-4 text-left transition hover:border-gray-300', isOpen(s) && 'ring-2 ring-brand')"
          :aria-current="isOpen(s) ? 'true' : undefined"
          :disabled="busy !== null"
          @click="pick(s)"
        >
          <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-mist text-ink"><component :is="ICON[s.kind]" class="size-5" aria-hidden="true" /></span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold text-ink">{{ s.space_name }}</span>
            <span class="block text-xs text-gray-500">{{ KIND[s.kind] }}<template v-if="s.roles.length"> · {{ s.roles.join(", ") }}</template></span>
          </span>
          <Loader2 v-if="busy === key(s)" class="size-4 animate-spin text-gray-500" aria-hidden="true" />
          <Check v-else-if="isOpen(s)" class="size-4 text-success" aria-label="Open now" />
        </button>
      </li>
    </ul>
    <div class="flex flex-wrap justify-center gap-2">
      <button v-if="!id.childMode.value" type="button" class="btn-light" @click="emit('more')"><Plus class="size-4" aria-hidden="true" /> Start or join another</button>
      <button type="button" class="btn-ghost" @click="emit('later')">Not now</button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
    <p v-else-if="me?.refused" role="alert" class="caution rounded-lg px-3 py-2 text-sm">{{ me.refused.space_name }} didn't open: {{ me.refused.message }}</p>
  </section>
</template>
