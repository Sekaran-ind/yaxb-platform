<script setup lang="ts">
// An answer, formatted (lib/answer-format.ts: no HTML from the model), with its sources as chips.
import { BookOpen, Globe, NotebookPen } from "@lucide/vue";
import { computed } from "vue";
import { formatAnswer } from "@/lib/answer-format";

const props = defineProps<{ text: string }>();
const f = computed(() => formatAnswer(props.text));
const iconOf = (id: string) => (id.startsWith("web:") ? Globe : id.startsWith("notebook:") ? NotebookPen : BookOpen);
</script>

<template>
  <div class="space-y-2 leading-relaxed text-ink">
    <template v-for="(b, i) in f.blocks" :key="i">
      <p v-if="b.kind === 'p' || b.kind === 'h'" :class="b.kind === 'h' && 'font-semibold'">
        <template v-for="(s, j) in b.inline" :key="j"
          ><strong v-if="s.bold" class="font-semibold">{{ s.text }}</strong><em v-else-if="s.italic">{{ s.text }}</em><code v-else-if="s.code" class="rounded bg-mist px-1 text-[0.9em]">{{ s.text }}</code
          ><template v-else>{{ s.text }}</template></template
        >
      </p>
      <component :is="b.kind" v-else-if="b.kind === 'ul' || b.kind === 'ol'" :class="['space-y-1 pl-5', b.kind === 'ul' ? 'list-disc' : 'list-decimal']">
        <li v-for="(item, k) in b.items" :key="k">
          <template v-for="(s, j) in item" :key="j"
            ><strong v-if="s.bold" class="font-semibold">{{ s.text }}</strong><em v-else-if="s.italic">{{ s.text }}</em><code v-else-if="s.code" class="rounded bg-mist px-1 text-[0.9em]">{{ s.text }}</code
            ><template v-else>{{ s.text }}</template></template
          >
        </li>
      </component>
    </template>
    <ul v-if="f.sources.length" class="flex flex-wrap gap-1.5 pt-1" aria-label="Sources">
      <li v-for="s in f.sources" :key="s.id" class="inline-flex max-w-full items-center gap-1 rounded-full bg-mist px-2.5 py-0.5 text-xs text-gray-600" :title="s.label ?? s.id">
        <component :is="iconOf(s.id)" class="size-3 shrink-0" aria-hidden="true" />
        <span class="truncate">{{ s.label ?? s.id }}</span>
      </li>
    </ul>
  </div>
</template>
