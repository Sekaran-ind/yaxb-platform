// The conversation's message box fills the form that is open in it (LIB-56): while a journey in the
// conversation waits for answers, what the visitor types or says goes into that form (slot filling:
// suggestions to check, never answers given for them), instead of a separate "in your own words" box
// inside the form. "Ask a question instead" sends the next message to the assistant as usual.
import { computed, ref, shallowRef } from "vue";

type FormInput = { id: string; label: string; fill: (text: string) => Promise<void> };

const current = shallowRef<FormInput | null>(null);
/** The visitor chose to ask a question while a form is open. */
export const askInstead = ref(false);

/** A form in the conversation is waiting for answers: the message box fills it. */
export function offerFormInput(input: FormInput) {
  current.value = input;
  askInstead.value = false;
}
/** That form is answered, closed or gone. */
export function withdrawFormInput(id: string) {
  if (current.value?.id === id) current.value = null;
}

/** The form the message box fills now, unless the visitor chose to ask instead. */
export const formInput = computed(() => (askInstead.value ? null : current.value));
/** The open form, even while asking instead (to offer going back to it). */
export const openForm = computed(() => current.value);
