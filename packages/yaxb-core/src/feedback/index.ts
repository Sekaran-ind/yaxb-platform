// Session feedback (docs/specs/06-profiles-activity-feedback.md, FBK-1..5; MOD-40): once in a
// while the kiosk asks "How is YAXB doing this session?" with Bad, Fine and Good. The answer is
// kept without identifying the visitor: the rating, an optional comment, the time, how questions
// were answered, the language and whether a profile was open. Never the conversation.
import { z } from "zod";
import { LANGUAGES, type LanguageCode } from "../schemas/index.js";

export const FEEDBACK_QUESTION = "How is YAXB doing this session?";
export const FEEDBACK_RATINGS = [
  { value: "bad", label: "Bad" },
  { value: "fine", label: "Fine" },
  { value: "good", label: "Good" },
] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number]["value"] | "skipped";

/** About one session in three is asked, unless the deployment says otherwise (FEEDBACK_RATE). */
export const DEFAULT_FEEDBACK_RATE = 1 / 3;
export const FEEDBACK_COMMENT_CHARS = 500;

export const feedbackSchema = z.strictObject({
  rating: z.enum(["bad", "fine", "good", "skipped"]),
  comment: z.string().trim().max(FEEDBACK_COMMENT_CHARS).optional(),
  mode: z.enum(["agent", "local", "auto"]),
  language: z.enum(LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]]),
  profile: z.boolean(),
  /** Answers given in the session before it asked. */
  answers: z.number().int().min(0).max(1000),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;
export type FeedbackItem = FeedbackInput & { id: string; created_at: string };

export function newFeedbackItem(input: FeedbackInput, now = new Date()): FeedbackItem {
  const { comment, ...rest } = input;
  return { id: crypto.randomUUID(), created_at: now.toISOString(), ...rest, ...(comment ? { comment } : {}) };
}

/** The deployment's rate: FEEDBACK_RATE as a number from 0 (never) to 1 (every session). */
export function feedbackRate(env: Readonly<Record<string, unknown>>): number {
  const raw = typeof env.FEEDBACK_RATE === "string" ? env.FEEDBACK_RATE.trim() : "";
  if (!raw) return DEFAULT_FEEDBACK_RATE;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_FEEDBACK_RATE;
}

export type AskMoment = {
  /** Answers the visitor has had this session. */
  answers: number;
  /** Already asked (or answered, or dismissed) this session. */
  asked: boolean;
  /** The session's draw, made once: a number in [0, 1). */
  draw: number;
  rate: number;
  /** Something is happening that a question would interrupt. */
  busy: boolean;
  journeyOpen: boolean;
  speaking: boolean;
  /** The last answer was for a possible emergency. */
  emergency: boolean;
};

/** Ask now? At most once per session, after an answer, never mid-task or after an emergency (FBK-2). */
export function shouldAskFeedback(m: AskMoment): boolean {
  if (m.asked || m.rate <= 0 || m.answers < 1) return false;
  if (m.busy || m.journeyOpen || m.speaking || m.emergency) return false;
  return m.draw < m.rate;
}

export type FeedbackSummary = {
  total: number;
  counts: Record<FeedbackRating, number>;
  /** Good minus Bad, as a share of rated (not skipped) sessions: -1..1, null with none rated. */
  score: number | null;
  byDay: { day: string; bad: number; fine: number; good: number; skipped: number }[];
  byMode: { mode: FeedbackInput["mode"]; bad: number; fine: number; good: number; skipped: number }[];
  comments: { id: string; created_at: string; rating: FeedbackRating; comment: string; language: string }[];
};

/** Totals for moderators (MOD-40): by rating, by day (newest first) and by answer mode, and the comments. */
export function summarizeFeedback(items: readonly FeedbackItem[], { days = 30, comments = 50 } = {}): FeedbackSummary {
  const zero = () => ({ bad: 0, fine: 0, good: 0, skipped: 0 });
  const counts = zero();
  const byDay = new Map<string, ReturnType<typeof zero>>();
  const byMode = new Map<FeedbackInput["mode"], ReturnType<typeof zero>>();
  for (const f of items) {
    counts[f.rating]++;
    const day = f.created_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, zero());
    byDay.get(day)![f.rating]++;
    if (!byMode.has(f.mode)) byMode.set(f.mode, zero());
    byMode.get(f.mode)![f.rating]++;
  }
  const rated = counts.bad + counts.fine + counts.good;
  return {
    total: items.length,
    counts,
    score: rated ? Math.round(((counts.good - counts.bad) / rated) * 100) / 100 : null,
    byDay: [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, days)
      .map(([day, c]) => ({ day, ...c })),
    byMode: [...byMode.entries()].map(([mode, c]) => ({ mode, ...c })),
    comments: items
      .filter((f) => f.comment)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, comments)
      .map((f) => ({ id: f.id, created_at: f.created_at, rating: f.rating, comment: f.comment!, language: f.language })),
  };
}

export interface FeedbackStore {
  add(input: FeedbackInput): Promise<FeedbackItem>;
  /** Newest first. */
  list(limit?: number): Promise<FeedbackItem[]>;
}

export function createMemoryFeedbackStore(maxItems = 2000): FeedbackStore {
  const items: FeedbackItem[] = [];
  return {
    async add(input) {
      const item = newFeedbackItem(feedbackSchema.parse(input));
      items.unshift(item);
      items.length = Math.min(items.length, maxItems);
      return item;
    },
    async list(limit = 500) {
      return items.slice(0, Math.min(Math.max(limit, 1), 2000));
    },
  };
}
