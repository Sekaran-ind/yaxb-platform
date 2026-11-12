// Session feedback (FBK-1..5, MOD-40): when to ask, what may be kept, and the moderators' summary.
import { describe, expect, it } from "vitest";
import { createKiosk } from "../src/agent/index.js";
import { DEFAULT_FEEDBACK_RATE, feedbackRate, feedbackSchema, newFeedbackItem, shouldAskFeedback, summarizeFeedback, type AskMoment } from "../src/feedback/index.js";
import { capabilities } from "../src/settings/index.js";
import { createMemoryModerationStore, createMemoryThreadStore } from "../src/stores/index.js";

const moment: AskMoment = { answers: 1, asked: false, draw: 0.1, rate: 1 / 3, busy: false, journeyOpen: false, speaking: false, emergency: false };
const input = { rating: "good" as const, mode: "agent" as const, language: "eng_Latn" as const, profile: false, answers: 2 };

describe("when to ask", () => {
  it("asks once a session, after an answer, for the sessions the draw picks", () => {
    expect(shouldAskFeedback(moment)).toBe(true);
    expect(shouldAskFeedback({ ...moment, draw: 0.5 })).toBe(false); // not this session
    expect(shouldAskFeedback({ ...moment, asked: true })).toBe(false);
    expect(shouldAskFeedback({ ...moment, answers: 0 })).toBe(false);
  });

  it("never interrupts: not while busy, in a journey, speaking, or after an emergency answer", () => {
    for (const k of ["busy", "journeyOpen", "speaking", "emergency"] as const) expect(shouldAskFeedback({ ...moment, [k]: true })).toBe(false);
  });

  it("follows the deployment's rate, including off", () => {
    expect(feedbackRate({})).toBe(DEFAULT_FEEDBACK_RATE);
    expect(feedbackRate({ FEEDBACK_RATE: "0" })).toBe(0);
    expect(feedbackRate({ FEEDBACK_RATE: "1" })).toBe(1);
    expect(feedbackRate({ FEEDBACK_RATE: "7" })).toBe(1);
    expect(feedbackRate({ FEEDBACK_RATE: "often" })).toBe(DEFAULT_FEEDBACK_RATE);
    expect(shouldAskFeedback({ ...moment, rate: 0, draw: 0 })).toBe(false);
    expect(capabilities({ FEEDBACK_RATE: "0.5" }).feedback).toEqual({ rate: 0.5 });
  });
});

describe("what is kept", () => {
  it("only the rating, an optional comment, the mode, language, whether a profile was open and the answer count", () => {
    expect(feedbackSchema.safeParse(input).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...input, message: "I have chest pain" }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...input, rating: "terrible" }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...input, comment: "x".repeat(501) }).success).toBe(false);
    expect(newFeedbackItem({ ...input, comment: "" })).not.toHaveProperty("comment");
  });
});

describe("the moderators' summary", () => {
  it("counts by rating, day and mode, scores good minus bad over rated sessions, and lists comments newest first", () => {
    const at = (iso: string) => new Date(iso);
    const items = [
      newFeedbackItem({ ...input, rating: "good", comment: "Clear answers" }, at("2026-11-12T09:00:00Z")),
      newFeedbackItem({ ...input, rating: "bad", mode: "local", comment: "Didn't know" }, at("2026-11-12T10:00:00Z")),
      newFeedbackItem({ ...input, rating: "fine" }, at("2026-11-11T10:00:00Z")),
      newFeedbackItem({ ...input, rating: "skipped" }, at("2026-11-11T11:00:00Z")),
      newFeedbackItem({ ...input, rating: "good" }, at("2026-11-11T12:00:00Z")),
    ];
    const s = summarizeFeedback(items);
    expect(s.total).toBe(5);
    expect(s.counts).toEqual({ bad: 1, fine: 1, good: 2, skipped: 1 });
    expect(s.score).toBe(0.25); // (2 - 1) / 4 rated
    expect(s.byDay).toEqual([
      { day: "2026-11-12", bad: 1, fine: 0, good: 1, skipped: 0 },
      { day: "2026-11-11", bad: 0, fine: 1, good: 1, skipped: 1 },
    ]);
    expect(s.byMode).toContainEqual({ mode: "local", bad: 1, fine: 0, good: 0, skipped: 0 });
    expect(s.comments.map((c) => c.comment)).toEqual(["Didn't know", "Clear answers"]);
    expect(summarizeFeedback([]).score).toBeNull();
  });

  it("is what the kiosk records and reports", async () => {
    const kiosk = createKiosk({ env: {}, threads: createMemoryThreadStore(), moderation: createMemoryModerationStore(), webSearch: null, embed: null });
    await kiosk.addFeedback({ ...input, rating: "fine" });
    await expect(kiosk.addFeedback({ ...input, rating: "meh" })).rejects.toThrow();
    expect((await kiosk.feedbackSummary()).counts).toEqual({ bad: 0, fine: 1, good: 0, skipped: 0 });
  });
});
