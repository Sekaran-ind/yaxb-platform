<script setup lang="ts">
// In-browser NLLB translation: the text never leaves the device.
import { ArrowRightLeft, Loader2, Volume2 } from "@lucide/vue";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { LANGUAGES } from "@/lib/languages";

const props = defineProps<{ initialText?: string }>();
const emit = defineEmits<{ speak: [text: string, lang: string] }>();

const input = ref(props.initialText ?? "I love walking my dog.");
const src = ref("eng_Latn");
const tgt = ref("hin_Deva");
const output = ref("");
const busy = ref(false);
const progress = ref<{ file: string; progress: number }[]>([]);
const error = ref<string | null>(null);
let worker: Worker | null = null;

onMounted(() => {
  worker = new Worker(new URL("../../workers/translate.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent) => {
    const d = e.data as { status: string; file: string; progress: number; output: string; message: string };
    if (d.status === "initiate") progress.value.push({ file: d.file, progress: 0 });
    else if (d.status === "progress") progress.value = progress.value.map((x) => (x.file === d.file ? { ...x, progress: d.progress } : x));
    else if (d.status === "done") progress.value = progress.value.filter((x) => x.file !== d.file);
    else if (d.status === "update") output.value = d.output;
    else if (d.status === "complete") {
      output.value = d.output;
      busy.value = false;
    } else if (d.status === "error") {
      error.value = d.message;
      busy.value = false;
    }
  };
});
onBeforeUnmount(() => worker?.terminate());

function translate() {
  if (!input.value.trim()) return;
  error.value = null;
  output.value = "";
  busy.value = true;
  worker?.postMessage({ text: input.value, src_lang: src.value, tgt_lang: tgt.value });
}
function swap() {
  [src.value, tgt.value] = [tgt.value, src.value];
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-gray-500">Translation runs on this device; the text is not sent to our servers.</p>
    <div class="flex flex-wrap items-end gap-3">
      <div>
        <label for="src-lang" class="block text-xs font-medium text-gray-500">From</label>
        <select id="src-lang" v-model="src" class="input mt-1"><option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.label }}</option></select>
      </div>
      <button type="button" class="btn-light px-3" aria-label="Swap languages" @click="swap"><ArrowRightLeft class="size-4" /></button>
      <div>
        <label for="tgt-lang" class="block text-xs font-medium text-gray-500">To</label>
        <select id="tgt-lang" v-model="tgt" class="input mt-1"><option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.label }}</option></select>
      </div>
    </div>
    <div class="grid gap-4 md:grid-cols-2">
      <textarea v-model="input" class="input min-h-40" maxlength="2000" aria-label="Text to translate" />
      <textarea :value="output" class="input min-h-40 bg-mist" readonly aria-label="Translation" />
    </div>
    <div class="flex gap-3">
      <button type="button" class="btn-primary" :disabled="busy" @click="translate"><Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /> Translate</button>
      <button type="button" class="btn-light" :disabled="!output || busy" @click="emit('speak', output, LANGUAGES.find((l) => l.code === tgt)?.speech ?? 'en-US')"><Volume2 class="size-4" aria-hidden="true" /> Speak</button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
    <div v-if="progress.length" class="space-y-1">
      <p class="text-xs text-gray-500">Loading model (first time only)…</p>
      <div v-for="p in progress" :key="p.file" class="text-xs">
        <div class="h-2 overflow-hidden rounded bg-mist"><div class="h-full bg-brand transition-all" :style="{ width: `${p.progress ?? 0}%` }" /></div>
        <span class="text-gray-400">{{ p.file }}</span>
      </div>
    </div>
  </div>
</template>
