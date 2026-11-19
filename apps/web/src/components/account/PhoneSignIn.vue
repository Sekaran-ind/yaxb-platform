<script setup lang="ts">
// Sign in here by scanning with your phone (IDN-19): a public screen never asks for a password or a
// passkey. The kiosk shows a QR code (and its code); the person's phone, already signed in, opens it
// and approves; the kiosk is signed in for 30 minutes at the phone's level, and the front desk signs
// it out when the visit ends.
import { Loader2, Smartphone, X } from "@lucide/vue";
import { onBeforeUnmount, ref } from "vue";
import { renderSVG } from "uqr";
import { api } from "@/lib/api";
import { useIdentity } from "@/composables/identity";

const props = defineProps<{ label?: string }>();
const emit = defineEmits<{ signedIn: [] }>();
const identity = useIdentity();
const shown = ref<{ svg: string; code: string; url: string } | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let until = 0;

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
  shown.value = null;
}
onBeforeUnmount(stop);

async function poll(deviceCode: string, interval: number) {
  if (Date.now() > until) {
    stop();
    error.value = "The code ran out. Show a new one.";
    return;
  }
  try {
    const r = await api<{ status: string }>("/api/identity/handoff/token", { device_code: deviceCode });
    if (r.status === "approved") {
      stop();
      await identity.reload();
      emit("signedIn");
      return;
    }
    if (r.status === "denied" || r.status === "expired") {
      stop();
      error.value = r.status === "denied" ? "It was turned down on the phone." : "The code ran out. Show a new one.";
      return;
    }
  } catch {
    // A dropped connection: keep waiting until the code runs out.
  }
  timer = setTimeout(() => void poll(deviceCode, interval), interval * 1000);
}

async function start() {
  busy.value = true;
  error.value = null;
  try {
    const s = await api<{ device_code: string; user_code: string; verification_uri_complete: string; expires_in: number; interval: number }>("/api/identity/handoff/start", {});
    // An image from the link alone (data: URL, allowed by the CSP's img-src), never inserted markup.
    shown.value = { svg: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(s.verification_uri_complete, { border: 2 }))}`, code: s.user_code, url: s.verification_uri_complete };
    until = Date.now() + s.expires_in * 1000;
    timer = setTimeout(() => void poll(s.device_code, s.interval), s.interval * 1000);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-3">
    <button v-if="!shown" type="button" class="btn-light" :disabled="busy" @click="start">
      <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /><Smartphone v-else class="size-4" aria-hidden="true" /> {{ props.label ?? "Sign in with my phone" }}
    </button>
    <div v-else class="flex flex-wrap items-center gap-4 rounded-xl bg-mist p-3" role="group" aria-label="Sign in with your phone">
      <img class="size-40 shrink-0 rounded-lg bg-white p-1" :src="shown.svg" :alt="`QR code for ${shown.url}`" />
      <div class="min-w-0 flex-1 space-y-1 text-sm">
        <p class="font-medium text-ink">Scan this with your phone's camera</p>
        <p class="text-body">Your phone must be signed in to Anjalai. Check it shows <span class="font-mono font-semibold tracking-widest text-ink">{{ shown.code }}</span>, then approve. Nothing is typed here.</p>
        <p class="flex items-center gap-2 text-gray-600"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Waiting for your phone… You're signed in here for 30 minutes.</p>
        <button type="button" class="btn-ghost h-8 px-2 text-sm" @click="stop"><X class="size-4" aria-hidden="true" /> Cancel</button>
      </div>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
  </div>
</template>
