<script setup lang="ts">
// Preferences → Child safety lock (CHL-1, CHL-6): what it does, turning it on with a parent's PIN
// (typed twice), and off with the same PIN. An Under 18 profile is in child mode by itself.
//
// The family spaces a child may use here (SPC-9): a guardian, signed in to their account, chooses
// them while the lock is off; in child mode no other space is offered, and none can be started or
// joined.
import { Baby, House, Lock, ShieldCheck, Unlock } from "@lucide/vue";
import { computed, ref } from "vue";
import { CHILD_PIN, disableChildLock, enableChildLock, setChildSpaces, spaceKey, useChildMode } from "@/composables/child";
import { useIdentity } from "@/composables/identity";
import { settings } from "@/composables/settings";

const child = useChildMode();
const identity = useIdentity();
const familySpaces = computed(() => (identity.me.value.signedIn ? identity.me.value.spaces.filter((s) => s.kind === "family") : []));
const allowed = computed(() => settings.child.spaces);
function allow(key: string, on: boolean) {
  error.value = null;
  try {
    setChildSpaces(on ? [...allowed.value, key] : allowed.value.filter((k) => k !== key));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const pin = ref("");
const again = ref("");
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);
const problem = computed(() => (!CHILD_PIN.test(pin.value) ? "The PIN is 4 to 8 digits." : pin.value !== again.value ? "The two PINs don't match." : null));

async function turnOn() {
  if (problem.value) return void (error.value = problem.value);
  busy.value = true;
  error.value = notice.value = null;
  try {
    await enableChildLock(pin.value);
    pin.value = again.value = "";
    notice.value = "The child safety lock is on.";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function turnOff() {
  busy.value = true;
  error.value = notice.value = null;
  try {
    if (await disableChildLock(pin.value)) {
      pin.value = "";
      notice.value = "The child safety lock is off.";
    } else error.value = "That PIN isn't right.";
  } finally {
    busy.value = false;
  }
}
const DOES = [
  "The assistant answers for a child: short, kind, simple, and nothing for adults. Worrying questions go to a trusted adult and to the moderators.",
  "No web search and no outside tools: answers come from the kiosk's own knowledge and your notebooks.",
  "Websites added to a notebook are checked by a family-safe filter (as always).",
  "Staff sections, the Service Catalogue and the AI designer are hidden.",
  "Preferences keep only language, layout, theme and voice; the model, tools, storage and the rest need the PIN.",
];
</script>

<template>
  <section class="card space-y-4 p-5" aria-labelledby="child-title">
    <div class="flex items-start gap-3">
      <span class="grid size-10 shrink-0 place-items-center rounded-full bg-mist text-brand"><ShieldCheck class="size-5" aria-hidden="true" /></span>
      <div class="min-w-0">
        <h2 id="child-title" class="text-lg font-semibold text-ink">Child safety lock</h2>
        <p class="text-sm text-gray-600">
          {{ child.lock.value ? "On. A parent's PIN turns it off." : child.minor.value ? "On for this profile (Under 18)." : "For when a child uses the kiosk. A parent turns it on with a PIN." }}
        </p>
      </div>
    </div>
    <ul class="list-disc space-y-1 pl-5 text-sm text-body">
      <li v-for="d in DOES" :key="d">{{ d }}</li>
    </ul>
    <p v-if="child.minor.value && !child.lock.value" class="flex items-start gap-2 rounded-xl bg-mist px-3 py-2 text-sm text-body">
      <Baby class="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" /> This profile says its owner is under 18, so child mode is on while it is open. It ends when the profile is closed.
    </p>

    <fieldset v-if="familySpaces.length" class="space-y-2" aria-describedby="child-spaces-help">
      <legend class="flex items-center gap-2 text-sm font-medium text-ink"><House class="size-4 text-brand" aria-hidden="true" /> Family spaces a child may use here</legend>
      <p id="child-spaces-help" class="text-sm text-gray-600">
        In child mode only these are offered. A child never sees a business or community space, and can't start or join one.{{ child.lock.value ? " Turn the lock off to change them." : "" }}
      </p>
      <label v-for="s in familySpaces" :key="spaceKey(s)" class="flex min-h-11 items-center gap-3 rounded-xl px-3 hover:bg-mist">
        <input type="checkbox" class="size-4" :checked="allowed.includes(spaceKey(s))" :disabled="child.lock.value" @change="allow(spaceKey(s), ($event.target as HTMLInputElement).checked)" />
        <span class="text-sm text-ink">{{ s.space_name }}</span>
      </label>
    </fieldset>

    <form v-if="!child.lock.value" class="space-y-3" @submit.prevent="turnOn">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Parent's PIN (4 to 8 digits)</span><input v-model="pin" class="input" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" /></label>
        <label class="block text-sm"><span class="mb-1 block font-medium text-ink">The PIN again</span><input v-model="again" class="input" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" /></label>
      </div>
      <button type="submit" class="btn-primary h-10" :disabled="busy || Boolean(problem)"><Lock class="size-4" aria-hidden="true" /> Turn on the child safety lock</button>
    </form>
    <form v-else class="flex flex-wrap items-end gap-3" @submit.prevent="turnOff">
      <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Parent's PIN</span><input v-model="pin" class="input w-40" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" /></label>
      <button type="submit" class="btn-light h-10" :disabled="busy || !pin"><Unlock class="size-4" aria-hidden="true" /> Turn it off</button>
    </form>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-ink">{{ notice }}</p>
  </section>
</template>
