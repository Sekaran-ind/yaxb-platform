<script setup lang="ts">
// The notebook: what the assistant works from beyond the kiosk's own knowledge. Sources the visitor
// adds, the memory the assistant keeps, and this notebook's conversations, kept in the store the
// Storage setting picks. A turn sends them to the assistant as context.
import { NOTEBOOK_LIMITS } from "@sekaran-ind/yaxb-core/notebook";
import { STORAGE_OPTIONS } from "@sekaran-ind/yaxb-core/settings";
import { Brain, ClipboardPaste, Eye, FileText, Loader2, MessagesSquare, Plus, Trash2, Upload } from "@lucide/vue";
import { computed, ref } from "vue";
import type { NotebookApi } from "@/composables/notebook";
import { ACCEPTED_FILES, readDocument } from "@/lib/browser/documents";
import { cn } from "@/lib/cn";

const props = defineProps<{ nb: NotebookApi; activeThreadId: string }>();
const emit = defineEmits<{ openThread: [id: string]; newThread: [] }>();

const chars = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
const fileInput = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const message = ref<{ tone: "ok" | "error"; text: string } | null>(null);
const paste = ref<{ title: string; text: string } | null>(null);
const preview = ref<string | null>(null);
const memoryDraft = ref<string | null>(null);

const notebook = computed(() => props.nb.notebook.value);
const storage = computed(() => STORAGE_OPTIONS.find((s) => s.id === props.nb.store.value.kind));
const used = computed(() => notebook.value?.sources.reduce((n, s) => n + s.text.length, 0) ?? 0);

async function addFiles(files: FileList | null) {
  if (!files?.length) return;
  busy.value = true;
  message.value = null;
  const added: string[] = [];
  try {
    for (const file of Array.from(files)) {
      const doc = await readDocument(file);
      await props.nb.addSource({ title: doc.title, mime: doc.mime, text: doc.text });
      added.push(doc.truncated ? `${doc.title} (first ${chars(NOTEBOOK_LIMITS.sourceChars)} characters)` : doc.title);
    }
    message.value = { tone: "ok", text: `Added ${added.join(", ")}.` };
  } catch (e) {
    message.value = { tone: "error", text: (e as Error).message };
  } finally {
    busy.value = false;
    if (fileInput.value) fileInput.value.value = "";
  }
}
async function addPaste() {
  if (!paste.value?.text.trim()) return;
  await props.nb.addSource({ title: paste.value.title.trim() || "Pasted text", mime: "text/plain", text: paste.value.text.slice(0, NOTEBOOK_LIMITS.sourceChars) });
  paste.value = null;
}
function newNotebookPrompt() {
  const t = prompt("Name the new notebook");
  if (t !== null) void props.nb.create(t);
}
function renamePrompt() {
  const t = notebook.value && prompt("Rename the notebook", notebook.value.title);
  if (t?.trim() && notebook.value) void props.nb.save({ ...notebook.value, title: t.trim().slice(0, 200) });
}
function removeNotebook() {
  if (notebook.value && confirm(`Delete “${notebook.value.title}”, its sources, memory and conversations?`)) void props.nb.remove(notebook.value.id);
}
async function saveMemory() {
  if (memoryDraft.value === null) return;
  await props.nb.setMemory(memoryDraft.value);
  memoryDraft.value = null;
}
function removeSource(id: string, title: string) {
  if (confirm(`Remove “${title}”?`)) void props.nb.removeSource(id);
}
async function deleteThread(id: string) {
  await props.nb.store.value.deleteThread(id);
  props.nb.refresh();
}
</script>

<template>
  <p v-if="nb.error.value" role="alert" class="rounded-md bg-danger/10 px-3 py-2 text-sm text-red-800">{{ nb.error.value }}</p>
  <p v-else-if="!notebook" class="flex items-center gap-2 text-sm text-gray-500"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Opening the notebook…</p>
  <div v-else class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <label for="nb-pick" class="text-xs font-semibold text-gray-500 uppercase">Notebook</label>
        <div class="mt-1 flex gap-2">
          <select id="nb-pick" class="input max-w-64" :value="notebook.id" @change="nb.select(($event.target as HTMLSelectElement).value)">
            <option v-for="n in nb.notebooks.value" :key="n.id" :value="n.id">{{ n.title }}</option>
          </select>
          <button type="button" class="btn-light" @click="newNotebookPrompt"><Plus class="size-4" aria-hidden="true" /> New</button>
        </div>
      </div>
      <div class="flex gap-2 text-xs">
        <button type="button" class="text-gray-500 hover:text-ink" @click="renamePrompt">Rename</button>
        <button type="button" class="text-red-700 hover:underline" @click="removeNotebook">Delete</button>
      </div>
    </div>
    <p class="-mt-3 text-xs text-gray-500">Stored in: {{ storage?.label }}. {{ storage?.description }}</p>

    <section aria-labelledby="nb-sources">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id="nb-sources" class="flex items-center gap-2 font-semibold text-ink">
          <FileText class="size-4" aria-hidden="true" /> Sources
          <span class="text-xs font-normal text-gray-500">{{ notebook.sources.length }}/{{ NOTEBOOK_LIMITS.sources }} · {{ chars(used) }} of {{ chars(NOTEBOOK_LIMITS.totalChars) }} characters</span>
        </h3>
        <div class="flex gap-2">
          <input id="nb-upload" ref="fileInput" type="file" multiple :accept="ACCEPTED_FILES" class="sr-only" @change="addFiles(($event.target as HTMLInputElement).files)" />
          <label for="nb-upload" :class="cn('btn-primary cursor-pointer', busy && 'pointer-events-none opacity-60')">
            <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /><Upload v-else class="size-4" aria-hidden="true" /> Add files
          </label>
          <button type="button" class="btn-light" @click="paste = { title: '', text: '' }"><ClipboardPaste class="size-4" aria-hidden="true" /> Paste text</button>
        </div>
      </div>
      <p class="mb-2 text-xs text-gray-500">Text, Markdown, CSV, JSON, HTML or PDF. Files are read in this browser; the assistant sees their text when you ask a question.</p>
      <p v-if="message" :role="message.tone === 'error' ? 'alert' : 'status'" :class="cn('mb-2 rounded-md px-3 py-2 text-sm', message.tone === 'error' ? 'bg-danger/10 text-red-800' : 'bg-success/10 text-ink')">{{ message.text }}</p>
      <form v-if="paste" class="card mb-3 space-y-2 p-3" @submit.prevent="addPaste">
        <input v-model="paste.title" class="input" placeholder="Title" maxlength="200" aria-label="Title" />
        <textarea v-model="paste.text" class="input min-h-32" placeholder="Paste the text here" aria-label="Text" />
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-light" @click="paste = null">Cancel</button>
          <button type="submit" class="btn-primary" :disabled="!paste.text.trim()">Add source</button>
        </div>
      </form>
      <p v-if="!notebook.sources.length" class="rounded-lg bg-mist px-3 py-4 text-center text-sm text-gray-500">No sources yet. Add leaflets, reports or notes, then ask about them in the Transcript.</p>
      <ul v-else class="divide-y divide-gray-100 rounded-lg ring-1 ring-gray-100">
        <li v-for="s in notebook.sources" :key="s.id" class="px-3 py-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-ink">{{ s.title }}</p>
              <p class="text-xs text-gray-500">{{ chars(s.text.length) }} characters · {{ new Date(s.addedAt).toLocaleDateString() }} · cited as notebook:{{ s.id }}</p>
            </div>
            <div class="flex shrink-0 gap-1">
              <button type="button" class="rounded p-1.5 text-gray-500 hover:bg-mist" :aria-label="`Preview ${s.title}`" @click="preview = preview === s.id ? null : s.id"><Eye class="size-4" /></button>
              <button type="button" class="rounded p-1.5 text-red-700 hover:bg-danger/10" :aria-label="`Remove ${s.title}`" @click="removeSource(s.id, s.title)"><Trash2 class="size-4" /></button>
            </div>
          </div>
          <pre v-if="preview === s.id" class="mt-2 max-h-48 overflow-y-auto rounded bg-mist p-2 text-xs whitespace-pre-wrap">{{ s.text.slice(0, 4000) }}{{ s.text.length > 4000 ? "…" : "" }}</pre>
        </li>
      </ul>
    </section>

    <section aria-labelledby="nb-memory">
      <h3 id="nb-memory" class="mb-1 flex items-center gap-2 font-semibold text-ink"><Brain class="size-4" aria-hidden="true" /> Memory</h3>
      <p class="mb-2 text-xs text-gray-500">
        What the assistant keeps in mind for this notebook: your preferences and the notebook's purpose. It updates this as you talk (Settings → Memory). Don't put ID numbers or personal medical details here.
        <template v-if="nb.store.value.kind === 'server'"> With Server storage the assistant's copy lives on the server; this shows it after each answer, and your edits are used only until the server has its own.</template>
      </p>
      <textarea
        class="input min-h-28 font-mono text-xs"
        :value="memoryDraft ?? notebook.memory"
        :maxlength="NOTEBOOK_LIMITS.memoryChars"
        placeholder="# Notebook memory"
        aria-label="Notebook memory"
        @input="memoryDraft = ($event.target as HTMLTextAreaElement).value"
      />
      <div v-if="memoryDraft !== null && memoryDraft !== notebook.memory" class="mt-2 flex justify-end gap-2">
        <button type="button" class="btn-light" @click="memoryDraft = null">Discard</button>
        <button type="button" class="btn-primary" @click="saveMemory">Save memory</button>
      </div>
    </section>

    <section aria-labelledby="nb-threads">
      <div class="mb-2 flex items-center justify-between">
        <h3 id="nb-threads" class="flex items-center gap-2 font-semibold text-ink"><MessagesSquare class="size-4" aria-hidden="true" /> Conversations</h3>
        <button type="button" class="btn-light" @click="emit('newThread')"><Plus class="size-4" aria-hidden="true" /> New conversation</button>
      </div>
      <p v-if="!nb.threads.value.length" class="text-sm text-gray-500">No saved conversations in this notebook yet.</p>
      <ul v-else class="space-y-1">
        <li v-for="t in nb.threads.value" :key="t.id" :class="cn('flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm', t.id === activeThreadId ? 'bg-brand/10' : 'hover:bg-mist')">
          <button type="button" class="min-w-0 flex-1 truncate text-left" @click="emit('openThread', t.id)">
            {{ t.title }} <span class="text-xs text-gray-500">· {{ new Date(t.updatedAt).toLocaleString() }}</span>
          </button>
          <button type="button" class="rounded p-1 text-red-700 hover:bg-danger/10" :aria-label="`Delete conversation ${t.title}`" @click="deleteThread(t.id)"><Trash2 class="size-4" /></button>
        </li>
      </ul>
    </section>
  </div>
</template>
