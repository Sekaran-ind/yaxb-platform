<script setup lang="ts">
// Your company's own sign-in (IDN-15), for the space's administrator: the business's OpenID Connect
// provider (Entra ID, Google Workspace, Okta, Keycloak). Staff then sign in with their company
// accounts and join this space with the role chosen here; someone who leaves the company can't sign
// in again, and their sign-in here ends within the space's sign-in length. The client secret is
// sealed on the server and never shown again.
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { Building2, Copy } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { api } from "@/lib/api";
import { roleName } from "@/composables/library";

const props = defineProps<{ roles: string[] }>();
type Oidc = { issuer: string; client_id: string; label: string; default_role: string; updated_at: string } | null;
const available = ref(false);
const saved = ref<Oidc>(null);
const redirect = ref("");
const form = ref({ issuer: "", client_id: "", client_secret: "", label: "", default_role: "moderator" });
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);
const copied = ref(false);

async function load() {
  try {
    const r = await api<{ oidc: Oidc; redirect_uri: string }>("/api/identity/space-oidc");
    saved.value = r.oidc;
    redirect.value = r.redirect_uri;
    if (r.oidc) form.value = { issuer: r.oidc.issuer, client_id: r.oidc.client_id, client_secret: "", label: r.oidc.label, default_role: r.oidc.default_role };
    available.value = true;
  } catch {
    available.value = false; // accounts not set up, or not this space's administrator
  }
}
onMounted(load);
const ready = computed(() => form.value.issuer.trim() && form.value.client_id.trim() && (saved.value || form.value.client_secret.trim()));

async function save() {
  busy.value = true;
  error.value = notice.value = null;
  try {
    const { client_secret, ...rest } = form.value;
    await api("/api/identity/space-oidc", { ...rest, ...(client_secret.trim() ? { client_secret } : {}) }, "PUT");
    await load();
    notice.value = "Saved. Staff can sign in with their company accounts now.";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function remove() {
  busy.value = true;
  try {
    await api("/api/identity/space-oidc", undefined, "DELETE");
    saved.value = null;
    form.value = { issuer: "", client_id: "", client_secret: "", label: "", default_role: "moderator" };
    notice.value = "Removed. Staff sign in with a passkey or Google again.";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function copy() {
  await navigator.clipboard.writeText(redirect.value).catch(() => undefined);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <section v-if="available" class="card space-y-4 p-5" aria-labelledby="company-h">
    <div>
      <h3 id="company-h" class="flex items-center gap-2 font-semibold text-ink"><Building2 class="size-5 text-brand" aria-hidden="true" /> Your company's own sign-in</h3>
      <p class="mt-1 text-sm text-gray-600">
        Staff sign in with their company accounts (Entra ID, Google Workspace, Okta, Keycloak or another OpenID Connect provider). New staff join this space with the role you choose. Someone who leaves the company can't sign in again, and their sign-in here ends within the time set above.
      </p>
    </div>
    <div class="space-y-1 rounded-lg bg-mist px-3 py-2 text-sm">
      <p class="text-ink">In your provider, register a web app with this redirect address:</p>
      <p class="flex flex-wrap items-center gap-2"><code class="break-all">{{ redirect }}</code><button type="button" class="btn-ghost h-8 px-2 text-xs" @click="copy"><Copy class="size-3.5" aria-hidden="true" /> {{ copied ? "Copied" : "Copy" }}</button></p>
    </div>
    <div class="grid gap-3 @lg:grid-cols-2">
      <label class="block text-sm @lg:col-span-2"><span class="mb-1 block font-medium text-ink">Issuer</span><input v-model="form.issuer" class="input" placeholder="https://login.microsoftonline.com/<tenant id>/v2.0" autocomplete="off" /></label>
      <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Client ID</span><input v-model="form.client_id" class="input" autocomplete="off" /></label>
      <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Client secret</span><input v-model="form.client_secret" class="input" type="password" autocomplete="new-password" :placeholder="saved ? 'Kept: type a new one to change it' : ''" /></label>
      <label class="block text-sm"><span class="mb-1 block font-medium text-ink">The button says "Sign in with…"</span><input v-model="form.label" class="input" maxlength="40" placeholder="your company's name" /></label>
      <label class="block text-sm">
        <span class="mb-1 block font-medium text-ink">New staff join as</span>
        <select v-model="form.default_role" class="input">
          <option v-for="r in props.roles.filter((x) => x !== 'administrator')" :key="r" :value="r">{{ roleName(r) }}</option>
        </select>
      </label>
    </div>
    <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-ink">{{ notice }}</p>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn-primary" :disabled="busy || !ready" @click="save">{{ saved ? "Save the changes" : "Turn it on" }}</button>
      <ConfirmAction v-if="saved" label="Remove it" message="Remove your company's sign-in? Staff then sign in with a passkey or Google." trigger-class="btn-ghost" @confirm="remove" />
    </div>
  </section>
</template>
