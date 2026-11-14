<script setup lang="ts">
// The contact form (as ClinüxFlow's): name, organisation (optional), email, message. The Worker
// forwards it to the helpdesk (`/api/contact`); a hidden honeypot drops bots.
import { Send } from "@lucide/vue";
import { reactive, ref } from "vue";
import { z } from "zod";
import { cn } from "@/lib/cn";

withDefaults(defineProps<{ buttonText?: string }>(), { buttonText: "Send message" });

const contactSchema = z.strictObject({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  organisation: z.string().trim().max(160),
  email: z.email("Please enter a valid email").max(254),
  message: z.string().trim().min(1, "Please enter a message").max(5000),
  company: z.string().max(0).optional().default(""),
});

const empty = () => ({ name: "", organisation: "", email: "", message: "", company: "" });
const form = reactive(empty());
const errors = ref<Record<string, string>>({});
const pending = ref(false);
const alert = ref<{ type: "success" | "error"; message: string } | null>(null);

async function submit() {
  const parsed = contactSchema.safeParse(form);
  if (!parsed.success) {
    errors.value = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    return;
  }
  errors.value = {};
  alert.value = null;
  pending.value = true;
  try {
    const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? "That didn't send. Please write to helpdesk@yaxb.ai.");
    Object.assign(form, empty());
    alert.value = { type: "success", message: "Message sent! Our team will reply within 24 hours." };
  } catch (e) {
    alert.value = { type: "error", message: (e as Error).message };
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <form novalidate class="space-y-4" @submit.prevent="submit">
    <div v-if="alert" :role="alert.type === 'error' ? 'alert' : 'status'" :class="cn('rounded-md px-4 py-3 text-sm', alert.type === 'success' ? 'bg-success/15 text-green-800' : 'bg-danger/10 text-red-800')">
      {{ alert.message }}
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="mb-1.5 block text-sm font-medium text-ink" for="contact-name">Your name</label>
        <input id="contact-name" v-model="form.name" class="input" placeholder="Your name" autocomplete="name" :aria-invalid="!!errors.name" />
        <p v-if="errors.name" class="mt-1 text-sm text-danger">{{ errors.name }}</p>
      </div>
      <div>
        <label class="mb-1.5 block text-sm font-medium text-ink" for="contact-org">Organisation <span class="font-normal text-gray-500">(optional)</span></label>
        <input id="contact-org" v-model="form.organisation" class="input" placeholder="Your family, shop or business" autocomplete="organization" maxlength="160" />
      </div>
    </div>
    <div>
      <label class="mb-1.5 block text-sm font-medium text-ink" for="contact-email">Email</label>
      <input id="contact-email" v-model="form.email" type="email" class="input" placeholder="you@example.com" autocomplete="email" :aria-invalid="!!errors.email" />
      <p v-if="errors.email" class="mt-1 text-sm text-danger">{{ errors.email }}</p>
    </div>
    <div>
      <label class="mb-1.5 block text-sm font-medium text-ink" for="contact-message">Message</label>
      <textarea id="contact-message" v-model="form.message" rows="4" placeholder="Tell us who you are and what you'd like Anjal to do for you…" class="input" maxlength="5000" :aria-invalid="!!errors.message" />
      <p v-if="errors.message" class="mt-1 text-sm text-danger">{{ errors.message }}</p>
    </div>
    <!-- Honeypot for bots; hidden from people and assistive tech. -->
    <input v-model="form.company" type="text" tabindex="-1" autocomplete="off" class="hidden" aria-hidden="true" />
    <button type="submit" class="btn-primary h-11 w-full gap-2" :disabled="pending"><Send class="size-4" aria-hidden="true" /> {{ pending ? "Sending…" : buttonText }}</button>
  </form>
</template>
