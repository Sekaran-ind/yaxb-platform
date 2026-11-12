<script setup lang="ts">
// "How is YAXB doing this session?" Bad, Fine, Good, then an optional comment (FBK-1). Closing it
// counts as skipped, so it doesn't come back this session.
import { FEEDBACK_COMMENT_CHARS, FEEDBACK_QUESTION, FEEDBACK_RATINGS } from "@sekaran-ind/yaxb-core/feedback";
import { Frown, Meh, Smile, X } from "@lucide/vue";
import { ref } from "vue";
import { useFeedback } from "@/composables/feedback";
import { cn } from "@/lib/cn";

const feedback = useFeedback();
const picked = ref<"bad" | "fine" | "good" | null>(null);
const comment = ref("");
const thanks = ref(false);
const ICONS = { bad: Frown, fine: Meh, good: Smile } as const;

async function send() {
  if (!picked.value) return;
  await feedback.submit(picked.value, comment.value);
  thanks.value = true;
  setTimeout(() => (thanks.value = false), 2500);
  picked.value = null;
  comment.value = "";
}
</script>

<template>
  <p v-if="thanks" role="status" class="rounded-xl bg-success/10 px-4 py-3 text-sm text-ink">Thank you for your feedback.</p>
  <section v-else-if="feedback.open.value" class="rounded-xl bg-white p-4 shadow-sm ring-1 ring-brand/20" aria-labelledby="feedback-q">
    <div class="flex items-start justify-between gap-3">
      <h3 id="feedback-q" class="font-medium text-ink">{{ FEEDBACK_QUESTION }}</h3>
      <button type="button" class="text-gray-400 hover:text-ink" aria-label="Not now" @click="feedback.submit('skipped')"><X class="size-4" aria-hidden="true" /></button>
    </div>
    <div class="mt-3 flex flex-wrap gap-2" role="radiogroup" :aria-labelledby="'feedback-q'">
      <button
        v-for="r in FEEDBACK_RATINGS"
        :key="r.value"
        type="button"
        role="radio"
        :aria-checked="picked === r.value"
        :class="cn('inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm ring-1', picked === r.value ? 'bg-brand text-white ring-brand' : 'bg-white text-ink ring-gray-200 hover:ring-brand')"
        @click="picked = r.value"
      >
        <component :is="ICONS[r.value]" class="size-4" aria-hidden="true" /> {{ r.label }}
      </button>
    </div>
    <form v-if="picked" class="mt-3 space-y-2" @submit.prevent="send">
      <label for="feedback-comment" class="block text-sm text-gray-600">Anything you'd like to add? <span class="text-gray-400">(optional; please don't include personal details)</span></label>
      <textarea id="feedback-comment" v-model="comment" class="input min-h-16" :maxlength="FEEDBACK_COMMENT_CHARS" />
      <button type="submit" class="btn-primary">Send</button>
    </form>
  </section>
</template>
