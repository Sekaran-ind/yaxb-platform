// Answer reviews and F1 per notebook (MOD-4, MOD-10..13, MOD-30..34), on the memory store and on
// the real D1 schema (node:sqlite).
import { describe, expect, it } from "vitest";
import { createMemoryModeratorStore, createModeratorService, type ModeratorStore } from "../src/moderators/index.js";
import {
  citedRefs,
  createMemoryReviewStore,
  createReviewService,
  KNOWLEDGE_BASE_ROW,
  missingRefKey,
  newReviewAnswer,
  proposalEntry,
  ReviewError,
  scoreNotebooks,
  scoreOf,
  weekOf,
  type Rating,
  type Review,
  type ReviewAnswer,
  type ReviewedAnswer,
  type ReviewStore,
} from "../src/reviews/index.js";
import { createD1ModerationStore, createD1ModeratorStore, createD1ReviewStore } from "../src/stores/d1.js";
import { createMemoryModerationStore, filterModeration, type ModerationStore } from "../src/stores/index.js";
import { sqliteD1 } from "./sqlite-d1.js";

describe("cited sources", () => {
  it("reads the sources line, with labels, parts of a source once, and nothing outside the line", () => {
    const answer = "Overtime is paid at twice the rate (curated:qa-004 is mentioned here too).\n\n(sources: curated:qa-004 · Overtime pay; notebook:ab12#2; notebook:ab12#3, web:1)\n\n(sources: web:1 · who.int/news; notebook:zz9 · who.int/fact-sheets)";
    expect(citedRefs(answer)).toEqual([
      { id: "curated:qa-004", label: "Overtime pay" },
      { id: "notebook:ab12", label: null },
      { id: "web:1", label: "who.int/news" },
      { id: "notebook:zz9", label: "who.int/fact-sheets" },
    ]);
    expect(citedRefs("No sources here.")).toEqual([]);
  });

  it("accepts missing sources as ids or web addresses only", () => {
    expect(missingRefKey("curated:qa-010")).toBe("curated:qa-010");
    expect(missingRefKey("notebook:ab12#4")).toBe("notebook:ab12");
    expect(missingRefKey("https://www.who.int/news/")).toBe("url:who.int/news");
    expect(missingRefKey("javascript:alert(1)")).toBeNull();
    expect(missingRefKey("the leaflet")).toBeNull();
  });

  it("never takes the cited sources from the client", () => {
    expect(() => newReviewAnswer({ question: "q", answer: "a (sources: curated:qa-1)", mode: "agent", refs: [{ id: "curated:fake" }] }, "visitor")).toThrow();
    expect(newReviewAnswer({ question: "q", answer: "a (sources: curated:qa-1)", mode: "agent" }, "visitor").refs).toEqual([{ id: "curated:qa-1", label: null }]);
  });
});

const submission = (over: Record<string, unknown> = {}) => ({
  question: "How much is holiday pay?",
  answer: "Twice the daily wage.\n\n(sources: curated:qa-004 · Holiday pay; notebook:nb1#1)",
  notebook: { id: "nb1", title: "Labour rights" },
  mode: "agent",
  language: "eng_Latn",
  ...over,
});

const backends: [string, () => { reviews: ReviewStore; moderators: ModeratorStore; moderation: ModerationStore }][] = [
  ["memory", () => ({ reviews: createMemoryReviewStore(), moderators: createMemoryModeratorStore(), moderation: createMemoryModerationStore() })],
  [
    "D1 (SQLite)",
    () => {
      const db = sqliteD1();
      return { reviews: createD1ReviewStore(db), moderators: createD1ModeratorStore(db), moderation: createD1ModerationStore(db) };
    },
  ],
];

describe.each(backends)("reviews: %s", (_name, make) => {
  it("takes an answer for review, with its cited sources read from the answer", async () => {
    const { reviews } = make();
    const svc = createReviewService(reviews);
    const a = await svc.submit(submission(), "visitor");
    expect(a.refs.map((r) => r.id)).toEqual(["curated:qa-004", "notebook:nb1"]);
    expect((await reviews.listAnswers({ state: "open" })).map((x) => x.answer.id)).toEqual([a.id]);
    expect(await reviews.getAnswer(a.id)).toEqual(a);
    await expect(svc.submit({ ...submission(), extra: 1 }, "visitor")).rejects.toThrow();
  });

  it("requires every cited source to be marked, and records who reviewed, with the moderator's count and the audit log", async () => {
    const { reviews, moderators } = make();
    const mods = createModeratorService(moderators);
    const { moderator } = await mods.issue({ name: "Elizabeth" });
    const svc = createReviewService(reviews, moderators);
    const a = await svc.submit(submission(), "visitor");
    const who = { id: moderator.id, name: "Elizabeth", moderator };
    await expect(svc.review(a.id, { rating: "correct", marks: { "curated:qa-004": true } }, who)).rejects.toThrow(ReviewError);
    await expect(svc.review(a.id, { rating: "correct", marks: { "curated:qa-004": true, "notebook:nb1": true }, missing: ["a leaflet"] }, who)).rejects.toThrow(/source id/);

    const r = (await svc.review(a.id, { rating: "partly", marks: { "curated:qa-004": true, "notebook:nb1": false }, missing: ["curated:qa-009", "curated:qa-004", "https://labour.gov.in/holidays"], context: "Also double for national holidays." }, who))!;
    expect(r).toMatchObject({ rating: "partly", marks: { "curated:qa-004": true, "notebook:nb1": false }, missing: ["curated:qa-009", "url:labour.gov.in/holidays"], moderator_name: "Elizabeth", replaces: null });
    expect((await reviews.listAnswers({ state: "reviewed" }))[0]).toMatchObject({ answer: { id: a.id, state: "reviewed" }, review: { id: r.id } });
    expect((await moderators.get(moderator.id))?.reviews).toBe(1);
    const [entry] = await moderators.auditLog({ limit: 1 });
    expect(entry).toMatchObject({ action: "answer.reviewed", target_id: a.id, details: { rating: "partly", relevant: 1, not_relevant: 1, missing: 2 } });
    expect(JSON.stringify(entry)).not.toContain("holiday");
    expect(await svc.review("nope", { rating: "correct" }, who)).toBeNull();
  });

  it("keeps the history when another moderator changes a review, and the latest one counts", async () => {
    const { reviews } = make();
    const svc = createReviewService(reviews);
    const a = await svc.submit(submission(), "visitor");
    const first = (await svc.review(a.id, { rating: "incorrect", marks: { "curated:qa-004": false, "notebook:nb1": false } }, { id: "m1", name: "A", moderator: null }))!;
    const second = (await svc.review(a.id, { rating: "correct", marks: { "curated:qa-004": true, "notebook:nb1": true } }, { id: "m2", name: "B", moderator: null }))!;
    expect(second.replaces).toBe(first.id);
    expect((await svc.detail(a.id))!.history.map((r) => r.moderator_name)).toEqual(["B", "A"]);
    const scored = await reviews.reviewed();
    expect(scored).toHaveLength(1);
    expect(scored[0]!.review.id).toBe(second.id);
    expect((await reviews.listAnswers())[0]!.review?.id).toBe(second.id);
  });

  it("lists proposals for the knowledge base from the latest reviews", async () => {
    const { reviews } = make();
    const svc = createReviewService(reviews);
    const a = await svc.submit(submission(), "visitor");
    const r = (await svc.review(a.id, { rating: "partly", marks: { "curated:qa-004": true, "notebook:nb1": true }, proposal: { question: "Holiday pay?", answer: "Twice the daily wage.", category: "Wages" } }, { id: "m1", name: "A", moderator: null }))!;
    const [p] = await reviews.proposals();
    expect(p!.review.id).toBe(r.id);
    expect(proposalEntry(p!.review, "qa-101")).toEqual({ id: "qa-101", question: "Holiday pay?", answer: "Twice the daily wage.", category: "Wages", red_flag: false, proposed_by: "A", proposed_at: r.at.slice(0, 10) });
  });

  it("marks escalated questions handled with a note, and filters the queue (MOD-4)", async () => {
    const { moderation } = make();
    const a = await moderation.add("Chest pain", "possible emergency");
    await moderation.add("Refund", "not in the knowledge base");
    const handled = await moderation.handle!(a.id, "Called back; referred to A&E.", "Elizabeth");
    expect(handled).toMatchObject({ state: "handled", note: "Called back; referred to A&E.", handled_by: "Elizabeth" });
    const items = await moderation.list();
    expect(filterModeration(items, { state: "open" }).map((i) => i.question)).toEqual(["Refund"]);
    expect(filterModeration(items, { state: "handled" }).map((i) => i.question)).toEqual(["Chest pain"]);
    expect(filterModeration(items, { reason: "not in the knowledge base" })).toHaveLength(1);
    expect(await moderation.handle!("missing", "x", "y")).toBeNull();
  });
});

// ---- scores --------------------------------------------------------------------------------------------

let n = 0;
function reviewed(opts: { notebook?: string | null; refs: string[]; relevant?: string[]; missing?: string[]; rating?: Rating; at?: string }): ReviewedAnswer {
  const id = `a${++n}`;
  const answer: ReviewAnswer = {
    id,
    created_at: opts.at ?? "2026-11-10T10:00:00.000Z",
    origin: "visitor",
    question: `Question ${id}`,
    answer: "…",
    refs: opts.refs.map((r) => ({ id: r, label: null })),
    notebook: opts.notebook === null ? null : { id: opts.notebook ?? "nb1", title: opts.notebook === "nb2" ? "Pharmacy" : "Labour rights" },
    mode: "agent",
    language: null,
    state: "reviewed",
  };
  const review: Review = {
    id: `r${id}`,
    answer_id: id,
    at: answer.created_at,
    moderator_id: "m",
    moderator_name: "M",
    rating: opts.rating ?? "correct",
    marks: Object.fromEntries(opts.refs.map((r) => [r, (opts.relevant ?? opts.refs).includes(r)])),
    missing: opts.missing ?? [],
    context: "",
    proposal: null,
    replaces: null,
  };
  return { answer, review };
}

describe("F1 per notebook", () => {
  it("computes precision, recall and F1 as the spec defines them", () => {
    // TP 6, FP 2, FN 4: precision .75, recall .6, F1 = 2·.75·.6/1.35 = .667.
    expect(scoreOf({ tp: 6, fp: 2, fn: 4, reviews: 5, correct: 4 })).toEqual({ tp: 6, fp: 2, fn: 4, reviews: 5, correct: 4, precision: 0.75, recall: 0.6, f1: 0.667, accuracy: 0.8 });
    expect(scoreOf({ tp: 0, fp: 3, fn: 0, reviews: 5, correct: 0 }).f1).toBe(0);
  });

  it("shows no number below five reviews (MOD-31)", () => {
    expect(scoreOf({ tp: 3, fp: 0, fn: 0, reviews: 4, correct: 4 })).toMatchObject({ precision: null, recall: null, f1: null, accuracy: null, reviews: 4 });
  });

  it("counts a correct 'not covered' towards accuracy but not F1 (MOD-32)", () => {
    const rows = scoreNotebooks(Array.from({ length: 5 }, () => reviewed({ refs: [] })));
    const nb = rows.find((r) => r.id === "notebook:nb1")!;
    expect(nb).toMatchObject({ reviews: 5, accuracy: 1, f1: null, tp: 0, fp: 0, fn: 0 });
  });

  it("gives a row per notebook and a knowledge-base row over curated sources only, with weeks and the worst answers first", () => {
    n = 0;
    const items = [
      reviewed({ refs: ["curated:qa-1", "notebook:x"], relevant: ["curated:qa-1"], rating: "partly", at: "2026-11-03T09:00:00Z" }),
      reviewed({ refs: ["curated:qa-2"], at: "2026-11-04T09:00:00Z" }),
      reviewed({ refs: ["notebook:x"], missing: ["curated:qa-3"], rating: "incorrect", at: "2026-11-10T09:00:00Z" }),
      reviewed({ refs: ["notebook:x"], at: "2026-11-11T09:00:00Z" }),
      reviewed({ refs: ["notebook:x", "web:1"], relevant: ["notebook:x"], at: "2026-11-12T09:00:00Z" }),
      reviewed({ notebook: "nb2", refs: ["notebook:p"], at: "2026-11-12T09:00:00Z" }),
      reviewed({ notebook: null, refs: ["curated:qa-4"], at: "2026-11-12T09:00:00Z" }),
    ];
    const rows = scoreNotebooks(items);
    expect(rows.map((r) => r.id)).toEqual([KNOWLEDGE_BASE_ROW, "notebook:nb1", "notebook:nb2"]);

    const nb1 = rows[1]!;
    // Sources: a1 TP1 FP1; a2 TP1; a3 TP1 FN1; a4 TP1; a5 TP1 FP1 → TP 5, FP 2, FN 1.
    expect(nb1).toMatchObject({ title: "Labour rights", reviews: 5, tp: 5, fp: 2, fn: 1, precision: 0.714, recall: 0.833, accuracy: 0.6 });
    expect(nb1.f1).toBeCloseTo(0.769, 3);
    expect(nb1.weeks.map((w) => [w.week, w.reviews])).toEqual([["2026-11-02", 2], ["2026-11-09", 3]]);
    expect(nb1.worst.map((w) => [w.answer_id, w.rating])).toEqual([["a3", "incorrect"], ["a1", "partly"], ["a5", "correct"]]);

    // Knowledge base: answers touching curated sources (a1, a2, a3) and the one asked without a notebook (a7).
    const kb = rows[0]!;
    expect(kb).toMatchObject({ reviews: 4, tp: 3, fp: 0, fn: 1 });
    expect(rows[2]).toMatchObject({ title: "Pharmacy", reviews: 1, f1: null });
  });

  it("is reproducible: the same reviews in any order give the same numbers (MOD-34)", () => {
    n = 0;
    const items = Array.from({ length: 12 }, (_, i) => reviewed({ refs: ["notebook:x", "curated:qa-1"], relevant: i % 3 ? ["notebook:x"] : [], missing: i % 4 ? [] : ["curated:qa-2"], rating: (["correct", "partly", "incorrect"] as const)[i % 3], at: `2026-11-${String(1 + i).padStart(2, "0")}T08:00:00Z` }));
    const a = scoreNotebooks(items);
    const b = scoreNotebooks([...items].reverse());
    expect(b).toEqual(a);
  });

  it("weeks start on Monday, UTC", () => {
    expect(weekOf("2026-11-12T23:30:00Z")).toBe("2026-11-09");
    expect(weekOf("2026-11-09T00:00:00Z")).toBe("2026-11-09");
    expect(weekOf("2026-11-08T23:59:00Z")).toBe("2026-11-02");
  });
});
