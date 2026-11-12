// Answer reviews and quality scores (docs/specs/07-moderation-and-quality.md MOD-10..13, MOD-30..34).
//
// An answer reaches the moderators when a visitor (or a moderator testing the kiosk) sends it for
// review: the question, the answer, the sources it cited (read from its "(sources: …)" line, never
// trusted from the client) and the notebook it was asked in. A moderator rates it, marks each cited
// source relevant or not, adds the sources that should have been cited, adds context, and may
// propose a curated Q&A entry. Reviews keep their history; the latest one counts.
//
// Scores: per notebook, cited sources marked relevant are true positives, not relevant are false
// positives, and missing ones are false negatives; precision, recall and F1 follow, beside answer
// accuracy (the share rated correct). Pure functions over the reviews: the same reviews always give
// the same numbers.
import { z } from "zod";
import { auditEvent, type Moderator, type ModeratorStore } from "../moderators/index.js";
import { LANGUAGES, type LanguageCode } from "../schemas/index.js";

// ---- references --------------------------------------------------------------------------------------

/** A source id as the kiosk cites it: curated:<id>, notebook:<id>(#part), web:<n>. */
const REF_ID = /\b(curated:[A-Za-z0-9_.-]+|notebook:[A-Za-z0-9_-]+(?:#\d+)?|web:\d+)/;
const REF_IDS = new RegExp(REF_ID.source, "g");

export type CitedRef = { id: string; label: string | null };

/**
 * The sources an answer cites, from its "(sources: …)" lines, in order, without repeats. Labels are
 * what follows "id · " (a title, or a web address). Parts of the same notebook source count once.
 */
export function citedRefs(answer: string): CitedRef[] {
  const out = new Map<string, CitedRef>();
  for (const line of answer.matchAll(/\(sources?:\s*([^)]*)\)/gi)) {
    for (const item of line[1]!.split(/[;,]/)) {
      const m = item.match(REF_ID);
      if (!m) continue;
      const id = refKey(m[1]!);
      const label = item.split("·")[1]?.trim() || null;
      const had = out.get(id);
      if (!had) out.set(id, { id, label: label?.slice(0, 200) ?? null });
      else if (!had.label && label) had.label = label.slice(0, 200);
    }
  }
  return [...out.values()];
}

/** The id that scores compare: a notebook source without its part. */
export const refKey = (id: string) => id.replace(/#\d+$/, "");

/** A missing source a moderator adds: a source id, or a web address. */
export function missingRefKey(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(new RegExp(`^${REF_ID.source}$`));
  if (m) return refKey(m[1]!);
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `url:${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

// ---- answers sent for review -------------------------------------------------------------------------

export const ANSWER_ORIGINS = ["visitor", "moderator"] as const;
export const ANSWER_MODES = ["agent", "local"] as const;
export const QUESTION_MAX = 1000;
export const ANSWER_MAX = 8000;

const LANGUAGE = z.enum(LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]]);

/** What the kiosk sends: the client says what was asked and answered; the cited sources are read from the answer here. */
export const answerSubmissionSchema = z.strictObject({
  question: z.string().trim().min(1).max(QUESTION_MAX),
  answer: z.string().trim().min(1).max(ANSWER_MAX),
  notebook: z.strictObject({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), title: z.string().trim().min(1).max(120) }).nullable().default(null),
  mode: z.enum(ANSWER_MODES),
  language: LANGUAGE.optional(),
});
export type AnswerSubmission = z.input<typeof answerSubmissionSchema>;

export type ReviewAnswer = {
  id: string;
  created_at: string;
  origin: (typeof ANSWER_ORIGINS)[number];
  question: string;
  answer: string;
  refs: CitedRef[];
  notebook: { id: string; title: string } | null;
  mode: (typeof ANSWER_MODES)[number];
  language: LanguageCode | null;
  /** open until reviewed. */
  state: "open" | "reviewed";
};

export function newReviewAnswer(input: unknown, origin: ReviewAnswer["origin"], now = new Date()): ReviewAnswer {
  const a = answerSubmissionSchema.parse(input);
  return {
    id: crypto.randomUUID().replace(/-/g, ""),
    created_at: now.toISOString(),
    origin,
    question: a.question,
    answer: a.answer,
    refs: citedRefs(a.answer).slice(0, 20),
    notebook: a.notebook,
    mode: a.mode,
    language: a.language ?? null,
    state: "open",
  };
}

// ---- reviews -----------------------------------------------------------------------------------------

export const RATINGS = {
  correct: "Correct",
  partly: "Partly correct",
  incorrect: "Incorrect",
  should_decline: "Should have declined",
} as const;
export type Rating = keyof typeof RATINGS;

const proposalSchema = z.strictObject({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(4000),
  category: z.string().trim().min(1).max(80),
  red_flag: z.boolean().default(false),
});
export type Proposal = z.output<typeof proposalSchema>;

/** What a moderator submits (MOD-11, MOD-12). Every cited source must be marked. */
export const reviewInputSchema = z.strictObject({
  rating: z.enum(Object.keys(RATINGS) as [Rating, ...Rating[]]),
  marks: z.record(z.string().max(80), z.boolean()).default({}),
  missing: z.array(z.string().trim().min(1).max(2000)).max(20).default([]),
  context: z.string().trim().max(2000).default(""),
  proposal: proposalSchema.nullable().default(null),
});
export type ReviewInput = z.input<typeof reviewInputSchema>;

export type Review = {
  id: string;
  answer_id: string;
  at: string;
  moderator_id: string;
  moderator_name: string;
  rating: Rating;
  /** Each cited source (by refKey): relevant or not. */
  marks: Record<string, boolean>;
  /** Sources that should have been cited, as keys (curated:…, notebook:…, url:host/path). */
  missing: string[];
  context: string;
  proposal: Proposal | null;
  /** The review this one replaced, if any (MOD-13). */
  replaces: string | null;
};

export class ReviewError extends Error {}

export function newReview(answer: ReviewAnswer, input: unknown, who: { id: string; name: string }, previous: Review | null, now = new Date()): Review {
  const r = reviewInputSchema.parse(input);
  const cited = new Set(answer.refs.map((x) => x.id));
  const unmarked = [...cited].filter((id) => typeof r.marks[id] !== "boolean");
  if (unmarked.length) throw new ReviewError(`Mark every cited source as relevant or not (${unmarked.join(", ")}).`);
  const marks = Object.fromEntries([...cited].map((id) => [id, r.marks[id]!]));
  const missing: string[] = [];
  for (const raw of r.missing) {
    const key = missingRefKey(raw);
    if (!key) throw new ReviewError(`"${raw.slice(0, 60)}" isn't a source id (curated:…, notebook:…) or a web address.`);
    if (!cited.has(key) && !missing.includes(key)) missing.push(key);
  }
  return {
    id: crypto.randomUUID().replace(/-/g, ""),
    answer_id: answer.id,
    // Always after the review it replaces, so history and "latest" never tie.
    at: new Date(Math.max(now.getTime(), previous ? Date.parse(previous.at) + 1 : 0)).toISOString(),
    moderator_id: who.id,
    moderator_name: who.name,
    rating: r.rating,
    marks,
    missing,
    context: r.context,
    proposal: r.proposal,
    replaces: previous?.id ?? null,
  };
}

/** A proposal as an entry for content/curated_qa.json (MOD-12), for a curator to add and approve. */
export function proposalEntry(review: Review, id: string) {
  if (!review.proposal) return null;
  const { question, answer, category, red_flag } = review.proposal;
  return { id, question, answer, category, red_flag, proposed_by: review.moderator_name, proposed_at: review.at.slice(0, 10) };
}

// ---- scores ------------------------------------------------------------------------------------------

export const MIN_REVIEWS = 5;
export const KNOWLEDGE_BASE_ROW = "knowledge-base";

export type Counts = { tp: number; fp: number; fn: number };
export type Score = {
  reviews: number;
  correct: number;
  /** null below MIN_REVIEWS, or with nothing to measure. */
  precision: number | null;
  recall: number | null;
  f1: number | null;
  accuracy: number | null;
} & Counts;

const round = (n: number) => Math.round(n * 1000) / 1000;

export function scoreOf(c: Counts & { reviews: number; correct: number }, min = MIN_REVIEWS): Score {
  const enough = c.reviews >= min;
  const precision = enough && c.tp + c.fp ? c.tp / (c.tp + c.fp) : null;
  const recall = enough && c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
  // No true positives: F1 is 0 when anything was cited or missed, unmeasured when nothing was.
  const f1 = !enough || c.tp + c.fp + c.fn === 0 ? null : c.tp === 0 ? 0 : (2 * precision! * recall!) / (precision! + recall!);
  return {
    ...c,
    precision: precision === null ? null : round(precision),
    recall: recall === null ? null : round(recall),
    f1: f1 === null ? null : round(f1),
    accuracy: enough ? round(c.correct / c.reviews) : null,
  };
}

/** One answer's counts, from its review; `only` limits them to sources with that prefix. */
export function countsOf(answer: ReviewAnswer, review: Review, only?: string): Counts {
  const keep = (id: string) => !only || id.startsWith(only);
  let tp = 0;
  let fp = 0;
  for (const r of answer.refs) if (keep(r.id)) (review.marks[r.id] ? tp++ : fp++);
  return { tp, fp, fn: review.missing.filter(keep).length };
}

export type ReviewedAnswer = { answer: ReviewAnswer; review: Review };

export type ScoreRow = Score & {
  id: string;
  title: string;
  /** By the week the answers were given (Monday, UTC). */
  weeks: (Score & { week: string })[];
  /** Answers to look at first: worst rating, then lowest F1. */
  worst: { answer_id: string; question: string; rating: Rating; f1: number | null }[];
};

const RATING_ORDER: Record<Rating, number> = { incorrect: 0, should_decline: 1, partly: 2, correct: 3 };

export function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

function rowOf(id: string, title: string, items: ReviewedAnswer[], only: string | undefined, min: number): ScoreRow {
  const sum = (list: ReviewedAnswer[]) => {
    const c = { tp: 0, fp: 0, fn: 0, reviews: list.length, correct: 0 };
    for (const { answer, review } of list) {
      const x = countsOf(answer, review, only);
      c.tp += x.tp;
      c.fp += x.fp;
      c.fn += x.fn;
      if (review.rating === "correct") c.correct++;
    }
    return c;
  };
  const byWeek = new Map<string, ReviewedAnswer[]>();
  for (const it of items) {
    const w = weekOf(it.answer.created_at);
    byWeek.set(w, [...(byWeek.get(w) ?? []), it]);
  }
  const answerF1 = (it: ReviewedAnswer) => {
    const c = countsOf(it.answer, it.review, only);
    return c.tp + c.fp + c.fn ? round((2 * c.tp) / (2 * c.tp + c.fp + c.fn)) : null;
  };
  const worst = items
    .map((it) => ({ answer_id: it.answer.id, question: it.answer.question.slice(0, 200), rating: it.review.rating, f1: answerF1(it), at: it.answer.created_at }))
    .filter((w) => w.rating !== "correct" || (w.f1 !== null && w.f1 < 1))
    .sort((a, b) => RATING_ORDER[a.rating] - RATING_ORDER[b.rating] || (a.f1 ?? 1) - (b.f1 ?? 1) || a.at.localeCompare(b.at) || a.answer_id.localeCompare(b.answer_id))
    .slice(0, 5)
    .map(({ at: _, ...w }) => w);
  return {
    id,
    title,
    ...scoreOf(sum(items), min),
    weeks: [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, list]) => ({ week, ...scoreOf(sum(list), min) })),
    worst,
  };
}

/**
 * The F1 dashboard's rows (MOD-30..34): one per notebook, over its answers and all their sources;
 * and the knowledge base, over every answer that cited or should have cited a curated source,
 * counting only curated sources. Rows are sorted by title, the knowledge base first.
 */
export function scoreNotebooks(items: ReviewedAnswer[], { min = MIN_REVIEWS }: { min?: number } = {}): ScoreRow[] {
  const groups = new Map<string, { title: string; items: ReviewedAnswer[] }>();
  for (const it of items) {
    if (!it.answer.notebook) continue;
    const g = groups.get(it.answer.notebook.id) ?? { title: it.answer.notebook.title, items: [] };
    g.items.push(it);
    groups.set(it.answer.notebook.id, g);
  }
  const touchesCurated = (it: ReviewedAnswer) => it.answer.refs.some((r) => r.id.startsWith("curated:")) || it.review.missing.some((m) => m.startsWith("curated:")) || !it.answer.notebook;
  const kb = rowOf(KNOWLEDGE_BASE_ROW, "Knowledge base", items.filter(touchesCurated), "curated:", min);
  const rows = [...groups.entries()].map(([id, g]) => rowOf(`notebook:${id}`, g.title, g.items, undefined, min)).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return [kb, ...rows];
}

// ---- storage -----------------------------------------------------------------------------------------

export interface ReviewStore {
  addAnswer(a: ReviewAnswer): Promise<void>;
  getAnswer(id: string): Promise<ReviewAnswer | null>;
  /** Newest first, with each answer's latest review. */
  listAnswers(opts?: { state?: ReviewAnswer["state"]; notebook?: string; limit?: number }): Promise<{ answer: ReviewAnswer; review: Review | null }[]>;
  /** Saves a review and marks its answer reviewed. */
  addReview(r: Review): Promise<void>;
  /** An answer's reviews, newest first (MOD-13). */
  history(answerId: string): Promise<Review[]>;
  /** Every reviewed answer with its latest review, for scoring. */
  reviewed(opts?: { since?: string }): Promise<ReviewedAnswer[]>;
  /** Reviews that propose a curated entry, newest first. */
  proposals(limit?: number): Promise<{ answer: ReviewAnswer; review: Review }[]>;
}

export function createMemoryReviewStore(maxAnswers = 2000): ReviewStore {
  const answers: ReviewAnswer[] = [];
  const reviews: Review[] = [];
  // The latest review of an answer is the one no other review replaces.
  const latest = (id: string) => reviews.filter((r) => r.answer_id === id && !reviews.some((n) => n.replaces === r.id)).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))[0] ?? null;
  const copy = <T>(x: T): T => structuredClone(x);
  return {
    async addAnswer(a) {
      answers.push(copy(a));
      if (answers.length > maxAnswers) answers.splice(0, answers.length - maxAnswers);
    },
    async getAnswer(id) {
      const a = answers.find((x) => x.id === id);
      return a ? copy(a) : null;
    },
    async listAnswers({ state, notebook, limit = 100 } = {}) {
      return answers
        .filter((a) => (!state || a.state === state) && (!notebook || a.notebook?.id === notebook))
        .slice()
        .reverse()
        .slice(0, limit)
        .map((a) => ({ answer: copy(a), review: copy(latest(a.id)) }));
    },
    async addReview(r) {
      reviews.push(copy(r));
      const a = answers.find((x) => x.id === r.answer_id);
      if (a) a.state = "reviewed";
    },
    async history(id) {
      return reviews.filter((r) => r.answer_id === id).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).map(copy);
    },
    async reviewed({ since } = {}) {
      return answers.filter((a) => a.state === "reviewed" && (!since || a.created_at >= since)).map((a) => ({ answer: copy(a), review: copy(latest(a.id)!) }));
    },
    async proposals(limit = 50) {
      return reviews
        .filter((r) => r.proposal)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit)
        .flatMap((r) => {
          const a = answers.find((x) => x.id === r.answer_id);
          return a && latest(a.id)?.id === r.id ? [{ answer: copy(a), review: copy(r) }] : [];
        });
    },
  };
}

// ---- service -----------------------------------------------------------------------------------------

/** The moderator a review is by: their own record, or the shared token's stand-in (no record). */
export type Reviewer = { id: string; name: string; moderator: Moderator | null };

/**
 * Answers in, reviews out (MOD-10..13), with each review in the audit log (metadata only) and
 * counted on the moderator's record.
 */
export function createReviewService(store: ReviewStore, moderators?: ModeratorStore) {
  return {
    store,
    async submit(input: unknown, origin: ReviewAnswer["origin"]) {
      const a = newReviewAnswer(input, origin);
      await store.addAnswer(a);
      return a;
    },
    async detail(id: string) {
      const answer = await store.getAnswer(id);
      return answer ? { answer, history: await store.history(id) } : null;
    },
    async review(answerId: string, input: unknown, who: Reviewer) {
      const answer = await store.getAnswer(answerId);
      if (!answer) return null;
      const [previous] = await store.history(answerId);
      const r = newReview(answer, input, { id: who.id, name: who.name }, previous ?? null);
      await store.addReview(r);
      if (moderators) {
        const current = who.moderator && (await moderators.get(who.moderator.id));
        if (current) await moderators.update(current.id, { reviews: current.reviews + 1 });
        const c = countsOf(answer, r);
        await moderators.audit(
          auditEvent({ actor_type: "moderator", actor_id: who.moderator?.id ?? null, actor_name: who.name, action: "answer.reviewed", target_id: answer.id, details: { rating: r.rating, relevant: c.tp, not_relevant: c.fp, missing: c.fn, changed: Boolean(previous), proposal: Boolean(r.proposal) } }),
        );
      }
      return r;
    },
    async scores(opts: { since?: string; min?: number } = {}) {
      const items = await store.reviewed({ since: opts.since });
      return { rows: scoreNotebooks(items, { min: opts.min }), reviews: items.length, min: opts.min ?? MIN_REVIEWS };
    },
  };
}
export type ReviewService = ReturnType<typeof createReviewService>;
