<script setup lang="ts">
// Turning on Restricted Mode (RST-1..2): staff choose the services the front desk offers (from those
// added to this kiosk), how soon an idle session is wiped, whether visitors may speak and attach
// files, and a PIN that only staff know. Then the kiosk becomes a public front desk.
//
// Keeping the device for this space (SPC-5): the space's administrator ties the device to the space
// it is in now, so it never opens another one, whoever uses it; only an administrator of that space
// releases it, here or from another device's list.
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { Lock, MonitorSmartphone, Pin } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useIdentity, type KeptDevice } from "@/composables/identity";
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

const identity = useIdentity();
const deviceLabel = ref("Front desk");
const kept = ref<KeptDevice[]>([]);
const here = ref<string | null>(null);
const keepError = ref<string | null>(null);
const keeping = ref(false);
async function listKept() {
  if (!identity.config.value?.enabled) return;
  try {
    const r = await identity.keptDevices();
    kept.value = r.devices;
    here.value = r.here;
  } catch {
    kept.value = []; // not this space's administrator: the list is theirs only
  }
}
// Once the account settings have loaded (they may arrive after this screen opens).
watch(() => identity.config.value?.enabled, (on) => on && void listKept(), { immediate: true });
async function keep(fn: () => Promise<unknown>) {
  keeping.value = true;
  keepError.value = null;
  try {
    await fn();
    await listKept();
  } catch (e) {
    keepError.value = (e as Error).message;
  } finally {
    keeping.value = false;
  }
}

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

    <!-- Keep this device for this space (SPC-5). -->
    <section v-if="identity.config.value?.enabled" class="space-y-2 border-t border-gray-100 pt-4" aria-labelledby="fd-keep">
      <h3 id="fd-keep" class="flex items-center gap-2 text-base font-semibold text-ink"><Pin class="size-4 text-brand" aria-hidden="true" /> Keep this device for this space</h3>
      <template v-if="identity.locked.value">
        <p class="text-sm text-gray-700">
          This device is kept for <strong class="text-ink">{{ identity.locked.value.space_name }}</strong> ({{ identity.locked.value.label }}). No other space opens here, and visitors stay anonymous.
        </p>
        <ConfirmAction label="Release this device" :message="`Release this device from ${identity.locked.value.space_name}? Any space can be opened here again.`" trigger-class="btn-light h-10 px-3 text-sm" @confirm="keep(identity.releaseDevice)" />
      </template>
      <template v-else>
        <p class="text-sm text-gray-600">For a shop's counter or a lobby kiosk: the device stays in this space, whoever uses it, and no other space opens here. Only this space's administrator can release it.</p>
        <div class="flex flex-wrap items-end gap-2">
          <label class="block text-sm">
            <span class="mb-1 block font-medium text-ink">Name this device</span>
            <input v-model="deviceLabel" class="input" maxlength="60" />
          </label>
          <button type="button" class="btn-light h-10 px-3 text-sm" :disabled="keeping" @click="keep(() => identity.lockDevice(deviceLabel))"><Pin class="size-4" aria-hidden="true" /> Keep it for this space</button>
        </div>
      </template>
      <div v-if="kept.length" class="space-y-1">
        <h4 class="text-sm font-medium text-ink">Devices kept for this space</h4>
        <ul class="divide-y divide-gray-100 rounded-xl bg-surface ring-1 ring-gray-100">
          <li v-for="d in kept" :key="d.id" class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span class="min-w-0 flex-1 text-ink">{{ d.label }}<span v-if="d.id === here" class="chip ml-2">This device</span><span class="block text-xs text-gray-500">Since {{ new Date(d.created_at).toLocaleDateString() }}</span></span>
            <ConfirmAction label="Release" :message="`Release “${d.label}” from this space?`" trigger-class="btn-ghost h-9 px-2 text-sm" @confirm="keep(() => (d.id === here ? identity.releaseDevice() : identity.releaseKept(d.id)))" />
          </li>
        </ul>
      </div>
      <p v-if="keepError" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ keepError }}</p>
    </section>
  </section>
</template>
