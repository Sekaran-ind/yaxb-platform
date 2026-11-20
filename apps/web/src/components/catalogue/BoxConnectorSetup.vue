<script setup lang="ts">
// A box connector (CNX-4) reaches a system on the office network, so only the office box calls it,
// and its secrets live on the box, never on the server. This view gives the JSON to install on the
// box and the commands to run there, by whoever runs the box.
import { boxConnectorJson, type Connector } from "@sekaran-ind/yaxb-core/connectors";
import { Download } from "@lucide/vue";
import { computed } from "vue";

const props = defineProps<{ connector: Connector }>();
const json = computed(() => boxConnectorJson(props.connector));
const file = computed(() => `${props.connector.id}.connector.json`);
const host = computed(() => new URL(props.connector.base).host);
function download() {
  const url = URL.createObjectURL(new Blob([json.value], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.value;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<template>
  <section aria-labelledby="box-setup-h" class="space-y-3">
    <h2 id="box-setup-h" class="font-semibold text-ink">On the office box</h2>
    <p class="text-sm text-gray-600">
      This connector reaches <span class="font-medium text-ink">{{ host }}</span> on the office network, so only the office box calls it; kiosks send its steps to the box. The box calls only connectors installed on it, and keeps their secrets itself: they never reach the server or a browser.
    </p>
    <ol class="list-decimal space-y-2 pl-5 text-sm text-ink">
      <li>
        Download its file and copy it to the box.
        <button type="button" class="btn-light ml-2 h-8 px-3 text-sm" @click="download"><Download class="size-4" aria-hidden="true" /> {{ file }}</button>
      </li>
      <li>On the box, install it: <code class="rounded bg-mist px-1.5 py-0.5 text-xs">yaxb-box connector add {{ file }}</code></li>
      <li v-if="connector.auth.secret">
        Set its secret there (type the value, then Ctrl-D): <code class="rounded bg-mist px-1.5 py-0.5 text-xs">yaxb-box connector secret {{ connector.id }} {{ connector.auth.secret }}</code>
      </li>
      <li>Kiosks that use it need the box connected (Preferences → Storage).</li>
    </ol>
    <p class="text-xs text-gray-500">After a change here is published, install the new file on the box again.</p>
  </section>
</template>
