// Session feedback (FBK-1..5): "How is Anjal doing this session?" with Bad, Fine and Good, asked
// at most once per browser session, at random (the deployment's rate), after an answer and never
// mid-task (yaxb-core feedback shouldAskFeedback). Sent without anything identifying the visitor;
// when it can't be sent (offline), it waits in this browser and goes with the next try.
import { shouldAskFeedback, type FeedbackInput, type FeedbackRating } from "@sekaran-ind/yaxb-core/feedback";
import { ref } from "vue";
import { logActivity } from "./account";
import { settings } from "./settings";

const SESSION_KEY = "yaxb.feedback.session";
const QUEUE_KEY = "yaxb.feedback.queue";

type SessionState = { draw: number; asked: boolean };

function session(): SessionState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as SessionState | null;
    if (saved && typeof saved.draw === "number") return saved;
  } catch {
    /* storage unavailable: one draw for this page */
  }
  const fresh = { draw: Math.random(), asked: false };
  save(fresh);
  return fresh;
}
function save(s: SessionState) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function queued(): FeedbackInput[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as FeedbackInput[];
  } catch {
    return [];
  }
}
function setQueue(items: FeedbackInput[]) {
  try {
    if (items.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-20)));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* ignore */
  }
}

/** Send what's waiting; keep what still can't be sent. */
async function flush() {
  const waiting = queued();
  if (!waiting.length) return;
  const left: FeedbackInput[] = [];
  for (const item of waiting) {
    const ok = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) })
      .then((r) => r.ok || r.status === 422) // a refused item won't get better by waiting
      .catch(() => false);
    if (!ok) left.push(item);
  }
  setQueue(left);
}
if (typeof window !== "undefined") window.addEventListener("online", () => void flush());

const open = ref(false);
let context: { answers: number; profile: boolean } = { answers: 0, profile: false };

export function useFeedback() {
  return {
    open,

    /** After an answer: ask now if this is the moment (FBK-2). */
    consider(moment: { answers: number; rate: number; busy: boolean; journeyOpen: boolean; speaking: boolean; emergency: boolean; profile: boolean }) {
      const s = session();
      if (open.value) return;
      if (shouldAskFeedback({ ...moment, asked: s.asked, draw: s.draw })) {
        context = { answers: moment.answers, profile: moment.profile };
        open.value = true;
      }
    },

    /** The visitor's answer, or "skipped" when they close it. Either way it won't ask again this session. */
    async submit(rating: FeedbackRating, comment?: string) {
      open.value = false;
      save({ ...session(), asked: true });
      const item: FeedbackInput = {
        rating,
        ...(comment?.trim() ? { comment: comment.trim().slice(0, 500) } : {}),
        mode: settings.agent.knowledge?.answers ?? "agent",
        language: settings.agent.language,
        profile: context.profile,
        answers: context.answers,
      };
      setQueue([...queued(), item]);
      await flush();
      if (rating !== "skipped") void logActivity("feedback.given", { rating });
    },
  };
}
