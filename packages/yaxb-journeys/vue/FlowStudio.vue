<script setup lang="ts">
// The studio: write services, journeys and questionnaires as YAML on the left; see them compiled,
// checked and running on the right, in the adaptive nav at the kiosk's sizes (Mini, Pod, Full).
// Nothing leaves the browser: the draft is kept in localStorage, and services that journeys call
// are stand-ins unless the host passes real handlers.
import { compileBundle, EXAMPLE_BUNDLE, MAX_BUNDLE_BYTES, type Bundle, type BundleProblem } from "@sekaran-ind/yaxb-journeys/bundle";
import type { ServiceHandler } from "@sekaran-ind/yaxb-journeys/journeys";
import { NAV_MODES, resolveLayout, type Layout, type NavMode } from "@sekaran-ind/yaxb-journeys/screens";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import ConfirmAction from "./ConfirmAction.vue";
import FlowPreview from "./FlowPreview.vue";
import type { LanguageOption, SourceOption } from "./QuestionField.vue";
import StructureTree from "./StructureTree.vue";
import YamlEditor from "./YamlEditor.vue";

const props = withDefaults(
  defineProps<{
    /** The YAML (v-model). When absent, the studio keeps its own draft. */
    modelValue?: string;
    /** localStorage key for the draft; false keeps nothing. */
    storageKey?: string | false;
    /** Handler names journeys may call (the host's); any dotted name when absent. */
    serviceNames?: readonly string[];
    /** Screen ids service items may open; not checked when absent. */
    screens?: readonly string[];
    handlers?: Record<string, ServiceHandler>;
    sources?: SourceOption[];
    languages?: LanguageOption[];
    /** What "Example" loads, and the first draft. */
    example?: string;
    fileName?: string;
  }>(),
  { storageKey: "yaxb-journeys.studio", fileName: "journeys.yaml" },
);
const emit = defineEmits<{ "update:modelValue": [source: string]; compiled: [bundle: Bundle] }>();

const example = computed(() => props.example ?? EXAMPLE_BUNDLE);

// ---- the draft ------------------------------------------------------------------------------
function readDraft(): string | null {
  if (!props.storageKey) return null;
  try {
    return localStorage.getItem(props.storageKey);
  } catch {
    return null;
  }
}
function saveDraft(text: string) {
  if (!props.storageKey) return;
  try {
    localStorage.setItem(props.storageKey, text);
  } catch {
    /* private mode or full: the draft just isn't kept */
  }
}

const source = ref(props.modelValue ?? readDraft() ?? example.value);
watch(
  () => props.modelValue,
  (v) => {
    if (v !== undefined && v !== source.value) source.value = v;
  },
);

// ---- compiling ------------------------------------------------------------------------------
const options = computed(() => ({ services: props.serviceNames, screens: props.screens }));
const bundle = shallowRef<Bundle>(compileBundle(source.value, options.value));
/** What the preview shows: the latest bundle that compiled anything, so a half-typed line doesn't blank it. */
const shown = shallowRef<Bundle>(bundle.value);
let timer: ReturnType<typeof setTimeout> | undefined;
function recompile() {
  const b = compileBundle(source.value, options.value);
  bundle.value = b;
  if (b.services.length || b.journeys.length || b.questionnaires.length || !source.value.trim()) shown.value = b;
  emit("compiled", b);
}
watch(source, (text) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    recompile();
    saveDraft(text);
  }, 250);
});
watch(options, recompile);
onMounted(() => emit("compiled", bundle.value));
onBeforeUnmount(() => clearTimeout(timer));

const errors = computed(() => bundle.value.problems.filter((p) => p.level === "error").length);
const warnings = computed(() => bundle.value.problems.length - errors.value);
const counts = computed(() => {
  const b = bundle.value;
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  return [n(b.services.length, "service"), n(b.journeys.length, "journey"), n(b.questionnaires.length, "questionnaire")].join(" · ");
});

// ---- the editor -----------------------------------------------------------------------------
const editor = ref<InstanceType<typeof YamlEditor> | null>(null);
const marks = computed(() => {
  const m = new Map<number, BundleProblem["level"]>();
  for (const p of bundle.value.problems) if (m.get(p.line) !== "error") m.set(p.line, p.level);
  return m;
});
function setSource(text: string) {
  source.value = text;
  emit("update:modelValue", text);
}
const goToLine = (line: number) => editor.value?.goToLine(line);

// ---- files ----------------------------------------------------------------------------------
const fileInput = ref<HTMLInputElement | null>(null);
const fileNote = ref<string | null>(null);
async function openFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = "";
  if (!file) return;
  if (file.size > MAX_BUNDLE_BYTES) {
    fileNote.value = `${file.name} is larger than ${MAX_BUNDLE_BYTES / 1024} KB.`;
    return;
  }
  setSource(await file.text());
  fileNote.value = `Opened ${file.name}.`;
}
function download() {
  const url = URL.createObjectURL(new Blob([source.value], { type: "application/yaml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = props.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const copied = ref(false);
async function copy() {
  await navigator.clipboard?.writeText(source.value).catch(() => undefined);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
const keepsWork = computed(() => source.value !== example.value && Boolean(source.value.trim()));
function loadExample() {
  setSource(example.value);
  fileNote.value = null;
}

// ---- the preview ----------------------------------------------------------------------------
type Size = "fit" | Layout;
const SIZES: { id: Size; label: string; width?: number }[] = [
  { id: "fit", label: "Fit" },
  { id: "mini", label: "Mini", width: 390 },
  { id: "pod", label: "Pod", width: 820 },
  { id: "full", label: "Full", width: 1200 },
];
const view = ref<"preview" | "structure">("preview");
const size = ref<Size>("fit");
const nav = ref<"remembered" | NavMode>("remembered");
const wrap = ref<HTMLElement | null>(null);
const available = ref(800);
let observer: ResizeObserver | undefined;
let frame = 0;
onMounted(() => {
  if (!wrap.value || typeof ResizeObserver === "undefined") return;
  // Applied on the next frame: changing the preview inside the observer's callback would loop.
  observer = new ResizeObserver(([entry]) => {
    cancelAnimationFrame(frame);
    const width = Math.max(240, Math.floor(entry!.contentRect.width));
    frame = requestAnimationFrame(() => (available.value = width));
  });
  observer.observe(wrap.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  cancelAnimationFrame(frame);
});

// The frame has 1rem padding and a 1px border on each side.
const FRAME_CHROME = 34;
const preset = computed(() => SIZES.find((s) => s.id === size.value)!);
const frameWidth = computed(() => preset.value.width ?? available.value);
const zoom = computed(() => (preset.value.width ? Math.min(1, available.value / preset.value.width) : 1));
const innerWidth = computed(() => frameWidth.value - FRAME_CHROME);
const layout = computed<Layout>(() => (size.value === "fit" ? resolveLayout(innerWidth.value) : size.value));
const caption = computed(() => `${layout.value[0]!.toUpperCase()}${layout.value.slice(1)} layout · ${frameWidth.value}px${zoom.value < 1 ? ` · shown at ${Math.round(zoom.value * 100)}%` : ""}`);
</script>

<template>
  <div class="yj yj-studio yj-cq">
    <div class="yj-studio-grid">
      <!-- Editor -->
      <section class="yj-panel yj-studio-editor" aria-label="YAML editor">
        <div class="yj-panel-head">
          <div>
            <h2 class="yj-title yj-small">YAML</h2>
            <p class="yj-small yj-muted">{{ counts }}</p>
          </div>
          <div class="yj-row">
            <ConfirmAction label="Example" confirm-label="Replace with the example" message="Replace your YAML with the example? Your changes are lost." trigger-class="yj-btn" :skip="!keepsWork" @confirm="loadExample" />
            <button type="button" class="yj-btn" @click="fileInput?.click()">Open…</button>
            <button type="button" class="yj-btn" @click="download">Download</button>
            <button type="button" class="yj-btn" @click="copy">{{ copied ? "Copied" : "Copy" }}</button>
            <input ref="fileInput" type="file" accept=".yaml,.yml,.txt,text/yaml,application/yaml" class="yj-sr-only" tabindex="-1" aria-hidden="true" @change="openFile" />
          </div>
        </div>
        <div class="yj-panel-body">
          <YamlEditor ref="editor" :model-value="source" :marks="marks" label="YAML: services, journeys and questionnaires, separated by --- lines" describedby="yj-studio-status" @update:model-value="setSource" />
          <p v-if="fileNote" class="yj-help" role="status">{{ fileNote }}</p>
          <p id="yj-studio-status" class="yj-small yj-mt" :class="errors ? 'yj-status-bad' : 'yj-status-ok'" role="status">
            {{ errors ? `${errors} error${errors === 1 ? "" : "s"}` : "Compiles" }}{{ warnings ? ` · ${warnings} warning${warnings === 1 ? "" : "s"}` : "" }}
          </p>
          <div v-if="bundle.problems.length" class="yj-problems">
            <button v-for="(p, i) in bundle.problems" :key="i" type="button" class="yj-problem" :class="`yj-problem-${p.level}`" @click="goToLine(p.line)">
              <span class="yj-problem-level">{{ p.level === "error" ? "Error" : "Warning" }}</span>
              <span class="yj-code">L{{ p.line }}</span>
              <span>{{ p.kind && p.id ? `${p.kind} '${p.id}': ` : "" }}{{ p.message }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- Preview -->
      <section class="yj-panel" aria-label="Preview">
        <div class="yj-panel-head">
          <div class="yj-segment" role="group" aria-label="View">
            <button type="button" :aria-pressed="view === 'preview'" @click="view = 'preview'">Preview</button>
            <button type="button" :aria-pressed="view === 'structure'" @click="view = 'structure'">Structure</button>
          </div>
          <div v-if="view === 'preview'" class="yj-row">
            <div class="yj-segment" role="group" aria-label="Kiosk size">
              <button v-for="s in SIZES" :key="s.id" type="button" :aria-pressed="size === s.id" @click="size = s.id">{{ s.label }}</button>
            </div>
            <label class="yj-label yj-small">
              <span class="yj-muted">Navigation</span>
              <select v-model="nav" class="yj-input yj-select-sm">
                <option value="remembered">As remembered</option>
                <option v-for="m in NAV_MODES" :key="m" :value="m">{{ m[0]!.toUpperCase() + m.slice(1) }}</option>
              </select>
            </label>
          </div>
        </div>
        <div class="yj-panel-body">
          <p v-if="errors && view === 'preview'" class="yj-note yj-small" role="status">Showing what compiled. Fix the errors to see the rest.</p>
          <div v-show="view === 'preview'" ref="wrap" class="yj-frame-wrap" :class="errors ? 'yj-mt' : undefined">
            <p class="yj-frame-caption">{{ caption }}</p>
            <div class="yj-frame" :style="{ width: `${frameWidth}px`, zoom }">
              <FlowPreview
                :bundle="shown"
                :layout="layout"
                :width="innerWidth"
                :mode="nav === 'remembered' ? undefined : nav"
                :switchable="nav === 'remembered'"
                :handlers="handlers"
                :sources="sources"
                :languages="languages"
                storage-key="journeys.studio.preview"
              />
            </div>
          </div>
          <StructureTree v-if="view === 'structure'" :bundle="bundle" @reveal="goToLine" />
        </div>
      </section>
    </div>
  </div>
</template>
