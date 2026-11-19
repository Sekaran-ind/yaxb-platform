<script setup lang="ts">
// Connect to a yaxb-box: its URL and either the person's account (IDN-42: a box token from the site,
// for a week, renewed by itself; the box checks it offline) or the box's shared token (printed by its
// install). Kept in this browser only.
import { createBoxClient } from "@sekaran-ind/yaxb-core/stores/box";
import { computed, ref } from "vue";
import { settings, updateSettings } from "@/composables/settings";
import { boxTokenFromAccount, useIdentity } from "@/composables/identity";

const identity = useIdentity();

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

async function connectWithAccount() {
  busy.value = true;
  result.value = null;
  try {
    const t = await boxTokenFromAccount();
    await createBoxClient({ url: url.value, token: t.token }).check();
    updateSettings({ box: { url: url.value.replace(/\/+$/, ""), token: t.token, account: true, expires: t.expires_at } });
    token.value = "";
    result.value = { ok: true, text: "Connected with your account. The box checks it even when the internet is down." };
  } catch (e) {
    result.value = { ok: false, text: /401/.test((e as Error).message) ? "The box doesn't know your account yet: sign the box in to this site (yaxb-box login)." : (e as Error).message };
  } finally {
    busy.value = false;
  }
}

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
      yaxb-box keeps everything on a Raspberry Pi on this network (SQLite, backed up continuously by Litestream). Run <code>node yaxb.mjs box-deploy --host &lt;user&gt;@&lt;pi&gt;</code> to install it, then <code>yaxb-box login</code> on the box to sign it in to your account: it keeps working with your account when the internet is down. The install also prints a token, for devices without an account.
    </p>
    <div class="grid gap-3 @lg:grid-cols-2">
      <div>
        <label for="box-url" class="block text-sm font-medium text-ink">Box URL</label>
        <input id="box-url" v-model="url" class="input mt-1" placeholder="https://192.168.1.14:47870" autocomplete="off" />
      </div>
      <div>
        <label for="box-token" class="block text-sm font-medium text-ink">Token</label>
        <input id="box-token" v-model="token" type="password" class="input mt-1" autocomplete="off" />
      </div>
    </div>
    <div v-if="identity.signedIn.value" class="flex flex-wrap items-center gap-3">
      <button type="button" class="btn-primary" :disabled="busy || !url" @click="connectWithAccount">{{ busy ? "Checking…" : "Connect with my account" }}</button>
      <span v-if="settings.box.account" class="text-sm text-gray-600">Connected with your account.</span>
      <span v-else class="text-sm text-gray-600">Or use the box's own token:</span>
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <button type="button" :class="identity.signedIn.value ? 'btn-light' : 'btn-primary'" :disabled="busy || !url || token.length < 32" @click="test">{{ busy ? "Checking…" : "Test and connect" }}</button>
      <a v-if="certPage" :href="certPage" target="_blank" rel="noreferrer" class="text-sm text-brand-dark underline">Trust the box's certificate on this device</a>
    </div>
    <p v-if="result" :role="result.ok ? 'status' : 'alert'" :class="['text-sm', result.ok ? 'text-ink' : 'text-red-800']">{{ result.text }}</p>
    <p class="text-xs text-gray-500">The token stays in this browser and is never sent to the kiosk's server. The kiosk's address must be in the box's YAXB_BOX_ORIGINS.</p>
  </div>
</template>
