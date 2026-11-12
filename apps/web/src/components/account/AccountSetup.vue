<script setup lang="ts">
// Creating (or editing) a kiosk profile, after clinux-diary's first run: the privacy notice, a
// little about the visitor, their interests, a few questions about how they like to be helped,
// and the passphrase that encrypts it all on this device. Editing skips the notice and passphrase.
import { AGE_RANGES, INTEREST_DOMAINS, MIN_PASSPHRASE, NOTICE_POINTS, PERSONALITY_QUESTIONS, profileProblem, type Profile } from "@sekaran-ind/yaxb-core/accounts";
import { Check, Loader2 } from "@lucide/vue";
import { computed, ref } from "vue";
import { useAccount } from "@/composables/account";
import { settings } from "@/composables/settings";
import { cn } from "@/lib/cn";
import { LANGUAGES } from "@/lib/languages";

const props = defineProps<{ initial?: Profile | null }>();
const emit = defineEmits<{ done: []; cancel: [] }>();
const account = useAccount();
const editing = computed(() => Boolean(props.initial));

const STEPS = editing.value ? ["About you", "Interests", "How you like help"] : ["Privacy", "About you", "Interests", "How you like help", "Passphrase"];
const step = ref(0);
const accepted = ref(false);
const form = ref({
  nickname: props.initial?.nickname ?? "",
  ageRange: props.initial?.ageRange ?? "",
  language: props.initial?.language ?? settings.agent.language,
  city: props.initial?.city ?? "",
  interests: [...(props.initial?.interests ?? [])] as string[],
  personality: { ...(props.initial?.personality ?? {}) } as Record<string, string>,
});
const pass = ref({ one: "", two: "" });
const error = ref("");
const busy = ref(false);

const draft = () => ({
  nickname: form.value.nickname,
  ...(form.value.ageRange ? { ageRange: form.value.ageRange } : {}),
  language: form.value.language,
  ...(form.value.city.trim() ? { city: form.value.city } : {}),
  interests: form.value.interests,
  personality: Object.fromEntries(Object.entries(form.value.personality).filter(([, v]) => v)),
});
const name = computed(() => STEPS[step.value]);

function toggleInterest(id: string) {
  const list = form.value.interests;
  form.value.interests = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

async function next() {
  error.value = "";
  if (name.value === "Privacy" && !accepted.value) return (error.value = "Please read and accept the notice to continue.");
  if (name.value === "About you") {
    const p = profileProblem(draft());
    if (p) return (error.value = p);
  }
  if (step.value < STEPS.length - 1) return void step.value++;
  busy.value = true;
  try {
    if (editing.value) await account.update(draft());
    else {
      if (pass.value.one.length < MIN_PASSPHRASE) return (error.value = `Use at least ${MIN_PASSPHRASE} characters.`);
      if (pass.value.one !== pass.value.two) return (error.value = "The two passphrases differ.");
      await account.create(draft(), pass.value.one);
    }
    emit("done");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card space-y-4 p-5" @submit.prevent="next">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold text-ink">{{ editing ? "Edit your profile" : "Create your profile" }}</h2>
      <ol class="flex flex-wrap gap-1 text-xs" aria-label="Steps">
        <li v-for="(s, i) in STEPS" :key="s" :class="cn('rounded-full px-2.5 py-1', i === step ? 'bg-brand-dark text-on-brand' : i < step ? 'bg-success/10 text-ink' : 'bg-mist text-gray-600')" :aria-current="i === step ? 'step' : undefined">{{ s }}</li>
      </ol>
    </div>

    <template v-if="name === 'Privacy'">
      <ul class="list-disc space-y-1.5 pl-5 text-sm text-gray-700">
        <li v-for="p in NOTICE_POINTS" :key="p">{{ p }}</li>
      </ul>
      <label class="flex items-center gap-2 text-sm text-ink"><input v-model="accepted" type="checkbox" class="size-4 accent-brand" /> I have read this and want a profile on this device.</label>
    </template>

    <div v-else-if="name === 'About you'" class="grid gap-3 @lg:grid-cols-2">
      <div class="@lg:col-span-2">
        <label for="a-nick" class="mb-1 block text-sm font-medium text-ink">Nickname <span class="text-red-700">*</span></label>
        <input id="a-nick" v-model="form.nickname" class="input" maxlength="40" autocomplete="nickname" required />
        <p class="mt-1 text-xs text-gray-500">Shown on this kiosk to pick your profile. A first name or nickname, not your full name.</p>
      </div>
      <div>
        <label for="a-age" class="mb-1 block text-sm font-medium text-ink">Age range</label>
        <select id="a-age" v-model="form.ageRange" class="input">
          <option value="">Prefer not to say</option>
          <option v-for="a in AGE_RANGES" :key="a.value" :value="a.value">{{ a.label }}</option>
        </select>
      </div>
      <div>
        <label for="a-lang" class="mb-1 block text-sm font-medium text-ink">Language</label>
        <select id="a-lang" v-model="form.language" class="input">
          <option v-for="l in LANGUAGES" :key="l.code" :value="l.code" :lang="l.speech">{{ l.native === l.label ? l.label : `${l.native} · ${l.label}` }}</option>
        </select>
      </div>
      <div class="@lg:col-span-2">
        <label for="a-city" class="mb-1 block text-sm font-medium text-ink">City or town <span class="font-normal text-gray-500">(optional)</span></label>
        <input id="a-city" v-model="form.city" class="input" maxlength="60" autocomplete="address-level2" />
      </div>
    </div>

    <fieldset v-else-if="name === 'Interests'">
      <legend class="mb-2 text-sm text-gray-600">What would you like help with? Choose any.</legend>
      <div class="grid gap-2 @lg:grid-cols-2">
        <button
          v-for="d in INTEREST_DOMAINS"
          :key="d.id"
          type="button"
          role="checkbox"
          :aria-checked="form.interests.includes(d.id)"
          :class="cn('flex items-start gap-2 rounded-lg border-2 p-3 text-left', form.interests.includes(d.id) ? 'border-brand bg-brand/5' : 'border-gray-200 hover:border-gray-300')"
          @click="toggleInterest(d.id)"
        >
          <Check :class="cn('mt-0.5 size-4 shrink-0', form.interests.includes(d.id) ? 'text-brand' : 'text-transparent')" aria-hidden="true" />
          <span><span class="block text-sm font-medium text-ink">{{ d.label }}</span><span class="block text-xs text-gray-500">{{ d.description }}</span></span>
        </button>
      </div>
    </fieldset>

    <div v-else-if="name === 'How you like help'" class="space-y-4">
      <p class="text-sm text-gray-600">These shape how the kiosk works for you. Answer any you like; you'll see what they change before anything is applied.</p>
      <fieldset v-for="q in PERSONALITY_QUESTIONS" :key="q.id">
        <legend class="mb-1.5 text-sm font-medium text-ink">{{ q.question }}</legend>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="o in q.options"
            :key="o.value"
            :class="cn('cursor-pointer rounded-full px-3 py-1.5 text-sm ring-1', form.personality[q.id] === o.value ? 'bg-brand-dark text-on-brand ring-brand' : 'bg-surface text-ink ring-gray-200 hover:ring-brand')"
          >
            <input v-model="form.personality[q.id]" type="radio" class="sr-only" :name="`q-${q.id}`" :value="o.value" />{{ o.label }}
          </label>
        </div>
      </fieldset>
    </div>

    <div v-else-if="name === 'Passphrase'" class="grid gap-3 @lg:grid-cols-2">
      <p class="text-sm text-gray-600 @lg:col-span-2">Your profile is encrypted with this passphrase. There is no way to recover it: if you forget it, the profile can only be erased.</p>
      <div>
        <label for="a-p1" class="mb-1 block text-sm font-medium text-ink">Passphrase</label>
        <input id="a-p1" v-model="pass.one" type="password" class="input" autocomplete="new-password" :minlength="MIN_PASSPHRASE" required />
      </div>
      <div>
        <label for="a-p2" class="mb-1 block text-sm font-medium text-ink">Again</label>
        <input id="a-p2" v-model="pass.two" type="password" class="input" autocomplete="new-password" required />
      </div>
    </div>

    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
    <div class="flex flex-wrap justify-between gap-2">
      <button type="button" class="btn-light" @click="step > 0 ? step-- : emit('cancel')">{{ step > 0 ? "Back" : "Cancel" }}</button>
      <button type="submit" class="btn-primary" :disabled="busy">
        <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" />
        {{ step < STEPS.length - 1 ? "Continue" : editing ? "Save" : "Create my profile" }}
      </button>
    </div>
  </form>
</template>
