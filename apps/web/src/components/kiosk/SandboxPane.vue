<script setup lang="ts">
// Try small open models directly in the browser (the original Sandbox / ModelPane).
import { Loader2, Play } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { SANDBOX_MODELS } from "@/lib/sandbox-models";

type LabelScore = { label?: string; token_str?: string; score: number };
type Entity = { entity: string; word: string; score: number };

const modelId = ref(SANDBOX_MODELS[0]!.id);
const spec = computed(() => SANDBOX_MODELS.find((m) => m.id === modelId.value)!);
const text = ref(spec.value.sample.text);
const question = ref(spec.value.sample.question ?? "");
const labels = ref(spec.value.sample.labels ?? "");
const result = ref<unknown>(null);
const busy = ref(false);
const loading = ref<string | null>(null);
const error = ref<string | null>(null);
let worker: Worker | null = null;

onMounted(() => {
  worker = new Worker(new URL("../../workers/sandbox.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent) => {
    const { type, data, message } = e.data as { type: string; data: { status?: string; file?: string; progress?: number }; message: string };
    if (type === "progress") loading.value = data.status === "progress" ? `${data.file} ${Math.round(data.progress ?? 0)}%` : null;
    else if (type === "result") {
      result.value = data;
      busy.value = false;
      loading.value = null;
    } else if (type === "error") {
      error.value = message;
      busy.value = false;
      loading.value = null;
    }
  };
});
onBeforeUnmount(() => worker?.terminate());

function choose(id: string) {
  modelId.value = id;
  text.value = spec.value.sample.text;
  question.value = spec.value.sample.question ?? "";
  labels.value = spec.value.sample.labels ?? "";
  result.value = null;
  error.value = null;
}
function run() {
  busy.value = true;
  error.value = null;
  result.value = null;
  worker?.postMessage({ id: modelId.value, text: text.value.slice(0, 4000), question: question.value, labels: labels.value });
}

const resultText = computed(() => {
  const first = (Array.isArray(result.value) ? result.value[0] : result.value) as Record<string, string> | null;
  return first?.generated_text ?? first?.translation_text ?? first?.summary_text ?? JSON.stringify(first);
});
</script>

<template>
  <div class="space-y-4">
    <div>
      <label for="sandbox-model" class="block text-sm font-medium text-ink">Model</label>
      <select id="sandbox-model" class="input mt-1" :value="modelId" @change="choose(($event.target as HTMLSelectElement).value)">
        <option v-for="m in SANDBOX_MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
      </select>
      <p class="mt-1 text-xs text-gray-500">Runs entirely in your browser. The model downloads once, then is cached.</p>
    </div>
    <input v-if="spec.input === 'qa'" v-model="question" class="input" placeholder="Question" aria-label="Question" />
    <textarea v-model="text" class="input min-h-32" aria-label="Input text" />
    <input v-if="spec.input === 'zero-shot'" v-model="labels" class="input" placeholder="Comma-separated labels" aria-label="Labels" />
    <button type="button" class="btn-primary" :disabled="busy" @click="run">
      <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /><Play v-else class="size-4" aria-hidden="true" /> Generate
    </button>
    <p v-if="loading" class="text-xs text-gray-500">Loading {{ loading }}</p>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
    <template v-if="result != null">
      <p v-if="spec.output === 'text'" class="rounded-md bg-mist p-4 whitespace-pre-wrap text-ink">{{ resultText }}</p>
      <ul v-else-if="spec.output === 'labels' && Array.isArray(result)" class="space-y-2">
        <li v-for="(r, i) in result as LabelScore[]" :key="i" class="text-sm">
          <div class="flex justify-between"><span class="text-ink">{{ r.token_str ?? r.label }}</span><span class="text-gray-500">{{ (r.score * 100).toFixed(1) }}%</span></div>
          <div class="mt-1 h-2 overflow-hidden rounded bg-mist"><div class="h-full bg-brand" :style="{ width: `${r.score * 100}%` }" /></div>
        </li>
      </ul>
      <div v-else-if="spec.output === 'tokens' && Array.isArray(result)" class="flex flex-wrap gap-2">
        <span v-for="(e, i) in result as Entity[]" :key="i" class="rounded bg-info/10 px-2 py-1 text-sm text-ink">{{ e.word }} <span class="text-xs font-semibold text-info">{{ e.entity }}</span></span>
      </div>
      <pre v-else class="overflow-x-auto rounded-md bg-mist p-4 text-xs">{{ JSON.stringify(result, null, 2) }}</pre>
    </template>
  </div>
</template>
