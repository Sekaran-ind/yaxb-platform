<script setup lang="ts">
// Turning on Restricted Mode (RST-1..2): staff choose the services the front desk offers (from those
// added to this kiosk), how soon an idle session is wiped, whether visitors may speak and attach
// files, and a PIN that only staff know. Then the kiosk becomes a public front desk.
import { Lock, MonitorSmartphone } from "@lucide/vue";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { kioskViewer, loadedServices } from "@/composables/library";
import { enableRestricted, PIN } from "@/composables/restricted";
import { settings } from "@/composables/settings";
import ToggleRow from "./ToggleRow.vue";

const router = useRouter();
const staff = computed(() => kioskViewer.value.member || kioskViewer.value.admin);
const chosen = ref<string[]>([...settings.restricted.services].filter((id) => loadedServices.value.some((s) => s.meta.entry_id === id)));
const idle = ref(settings.restricted.idleMinutes);
const mic = ref(settings.restricted.mic);
const attach = ref(settings.restricted.attach);
const pin = ref("");
const again = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

const toggle = (id: string) => (chosen.value = chosen.value.includes(id) ? chosen.value.filter((x) => x !== id) : [...chosen.value, id]);
const problem = computed(() => {
  if (!chosen.value.length) return "Choose at least one service.";
  if (!PIN.test(pin.value)) return "The PIN is 4 to 8 digits.";
  if (pin.value !== again.value) return "The two PINs don't match.";
  return null;
});
async function turnOn() {
  if (problem.value) return void (error.value = problem.value);
  busy.value = true;
  error.value = null;
  try {
    await enableRestricted({ services: chosen.value, idleMinutes: idle.value, mic: mic.value, attach: attach.value }, pin.value);
    pin.value = again.value = "";
    void router.push({ path: "/kiosk" });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card space-y-4 p-5" aria-labelledby="fd-title">
    <div>
      <h2 id="fd-title" class="flex items-center gap-2 text-lg font-semibold text-ink"><MonitorSmartphone class="size-5 text-brand" aria-hidden="true" /> Front desk (Restricted Mode)</h2>
      <p class="mt-1 text-sm text-gray-600">
        A public kiosk for one or a few services. Visitors get Ask Me alone, answered from the services' documents and SOPs; each visit is wiped when it ends or goes quiet, and nothing about a visitor stays on the kiosk. Profiles, the catalogue, preferences and staff pages are hidden. Staff leave it with the PIN.
      </p>
    </div>

    <p v-if="!staff" class="caution rounded-lg px-3 py-2 text-sm">Only staff can turn this on. Sign in with your key under Quick tools → For staff first.</p>
    <template v-else>
      <fieldset class="space-y-2">
        <legend class="text-sm font-medium text-ink">Services at the front desk</legend>
        <p v-if="!loadedServices.length" class="text-sm text-gray-600">No services are added to this kiosk yet. Add them in My notebook → Services, with their documents and SOPs.</p>
        <label v-for="s in loadedServices" :key="s.meta.entry_id" class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-mist">
          <input type="checkbox" class="size-4" :checked="chosen.includes(s.meta.entry_id)" @change="toggle(s.meta.entry_id)" />
          <span class="min-w-0 flex-1">
            <span class="block text-sm text-ink">{{ s.meta.title }}</span>
            <span class="block text-xs text-gray-500">{{ s.journeys.length }} journey{{ s.journeys.length === 1 ? "" : "s" }}</span>
          </span>
        </label>
      </fieldset>

      <div class="grid gap-3 @lg:grid-cols-2">
        <label class="block text-sm">
          <span class="mb-1 block font-medium text-ink">Wipe a quiet session after</span>
          <select v-model.number="idle" class="input">
            <option v-for="m in [1, 2, 3, 5, 10]" :key="m" :value="m">{{ m }} minute{{ m === 1 ? "" : "s" }}</option>
          </select>
        </label>
      </div>
      <div class="space-y-2">
        <ToggleRow label="Visitors may speak" description="The microphone, for questions and for filling forms." :checked="mic" @change="(v) => (mic = v)" />
        <ToggleRow label="Visitors may attach files" description="Only for their own session; wiped with it." :checked="attach" @change="(v) => (attach = v)" />
      </div>

      <div class="grid gap-3 @lg:grid-cols-2">
        <label class="block text-sm">
          <span class="mb-1 block font-medium text-ink">Staff PIN</span>
          <input v-model="pin" class="input tracking-widest" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" placeholder="4 to 8 digits" />
        </label>
        <label class="block text-sm">
          <span class="mb-1 block font-medium text-ink">The PIN again</span>
          <input v-model="again" class="input tracking-widest" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" />
        </label>
      </div>
      <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
      <button type="button" class="btn-primary" :disabled="busy" @click="turnOn"><Lock class="size-4" aria-hidden="true" /> Turn on the front desk</button>
    </template>
  </section>
</template>
