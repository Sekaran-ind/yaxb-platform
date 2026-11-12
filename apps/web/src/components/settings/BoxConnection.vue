<script setup lang="ts">
// Connect to a yaxb-box: its URL and token (printed by the box's install). Kept in this browser only.
import { createBoxClient } from "@sekaran-ind/yaxb-core/stores/box";
import { computed, ref } from "vue";
import { settings, updateSettings } from "@/composables/settings";

const url = ref(settings.box.url || "https://192.168.1.14:47870");
const token = ref(settings.box.token);
const busy = ref(false);
const result = ref<{ ok: boolean; text: string } | null>(null);
const certPage = computed(() => {
  try {
    const u = new URL(url.value);
    return u.protocol === "https:" ? `http://${u.hostname}:${Number(u.port || 47870) + 1}/` : null;
  } catch {
    return null;
  }
});

async function test() {
  busy.value = true;
  result.value = null;
  try {
    await createBoxClient({ url: url.value, token: token.value }).check();
    updateSettings({ box: { url: url.value.replace(/\/+$/, ""), token: token.value } });
    result.value = { ok: true, text: "Connected. Notebooks and conversations now live on the box." };
  } catch (e) {
    result.value = { ok: false, text: (e as Error).message };
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mt-4 space-y-3 rounded-lg bg-mist p-4">
    <p class="text-sm text-gray-600">
      yaxb-box keeps everything on a Raspberry Pi on this network (SQLite, backed up continuously by Litestream). Run <code>node yaxb.mjs box-deploy --host &lt;user&gt;@&lt;pi&gt;</code> to install it; it prints the URL and token.
    </p>
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label for="box-url" class="block text-sm font-medium text-ink">Box URL</label>
        <input id="box-url" v-model="url" class="input mt-1" placeholder="https://192.168.1.14:47870" autocomplete="off" />
      </div>
      <div>
        <label for="box-token" class="block text-sm font-medium text-ink">Token</label>
        <input id="box-token" v-model="token" type="password" class="input mt-1" autocomplete="off" />
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <button type="button" class="btn-primary" :disabled="busy || !url || token.length < 32" @click="test">{{ busy ? "Checking…" : "Test and connect" }}</button>
      <a v-if="certPage" :href="certPage" target="_blank" rel="noreferrer" class="text-sm text-brand-dark underline">Trust the box's certificate on this device</a>
    </div>
    <p v-if="result" :role="result.ok ? 'status' : 'alert'" :class="['text-sm', result.ok ? 'text-ink' : 'text-red-800']">{{ result.text }}</p>
    <p class="text-xs text-gray-500">The token stays in this browser and is never sent to the kiosk's server. The kiosk's address must be in the box's YAXB_BOX_ORIGINS.</p>
  </div>
</template>
