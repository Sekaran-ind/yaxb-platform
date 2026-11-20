// Businesses (tenants) of one edition share a database, so every store that holds a business's data
// must keep to that business. Two checks: (1) every table either has a tenant_id or is on a short list
// of tables that are shared on purpose, each with its reason; so a new table can't be added without
// deciding; (2) two businesses use each store and never see each other's rows.
import { describe, expect, it } from "vitest";
import { createD1DesignerStore, createD1EventStore, createD1FeedbackStore, createD1ModerationStore, createD1ReviewStore } from "../src/stores/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

/** Tables with no tenant_id, and why that is right. Anything not here must have one. */
const SHARED: Record<string, string> = {
  tenants: "the directory of businesses itself",
  business_links: "a link is between two businesses by design: it names both (requester, provider), and each only lists links it is on",
  join_tokens: "has tenant_id under its own name (tenant_id on the token)",
  kv: "the agent's memory, keyed by its caller's secret namespace",
  threads: "conversations, keyed by the visitor's secret session",
  relay_envelopes: "transient, addressed to a device or member secret and deleted on pickup",
  relay_beacons: "transient, addressed like the relay's envelopes",
  moderator_profiles: "one per member; members are scoped, and ids are unguessable",
  library_revisions: "belong to a library entry, which is scoped",
  case_events: "belong to a case, which is scoped",
  reviews: "belong to a review answer, which is scoped",
};
const INTERNAL = /^(sqlite_|_cf_|d1_migrations)/;

describe("tenant isolation", () => {
  it("every table has a tenant_id, or is shared on purpose", async () => {
    const db = sqliteD1();
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>()).results.map((t) => t.name).filter((n) => !INTERNAL.test(n));
    const without: string[] = [];
    for (const name of tables) {
      const cols = (await db.prepare(`PRAGMA table_info(${name})`).all<{ name: string }>()).results.map((c) => c.name);
      if (!cols.includes("tenant_id") && !(name in SHARED)) without.push(name);
    }
    expect(without, `Tables with no tenant_id: add one (and scope the store), or list the table in SHARED with its reason`).toEqual([]);
  });

  it("the moderation queue, answers for review, feedback, designer and events keep to their business", async () => {
    const db = sqliteD1();
    const as = <T>(make: (t: string) => T) => ({ a: make("acme"), b: make("bolt") });

    const mod = as((t) => createD1ModerationStore(db, { tenant: t }));
    const flagged = await mod.a.add("Is this chest pain serious?", "red-flag");
    expect((await mod.b.list()).map((x) => x.id)).toEqual([]);
    expect((await mod.a.list()).map((x) => x.id)).toEqual([flagged.id]);
    // Another business can't mark it handled, or read it back through handling.
    expect(await mod.b.handle!(flagged.id, "x", "bolt-mod")).toBeNull();
    expect((await mod.a.list())[0]!.state).toBe("open");

    const fb = as((t) => createD1FeedbackStore(db, { tenant: t }));
    await fb.a.add({ rating: "good", mode: "agent", language: "eng_Latn", profile: false, answers: 2, comment: "Helpful" });
    expect(await fb.b.list()).toEqual([]);
    expect(await fb.a.list()).toHaveLength(1);

    const rv = as((t) => createD1ReviewStore(db, { tenant: t }));
    const answer = { id: "ans-1", created_at: "2026-11-20T10:00:00.000Z", origin: "kiosk" as const, question: "q", answer: "a", refs: [], notebook: null, mode: "agent" as const, language: "eng_Latn" as const, state: "open" as const };
    await rv.a.addAnswer(answer as never);
    expect(await rv.b.getAnswer("ans-1")).toBeNull();
    expect(await rv.b.listAnswers()).toEqual([]);
    expect(await rv.b.history("ans-1")).toEqual([]);
    await expect(rv.b.addReview({ id: "r1", answer_id: "ans-1", at: "2026-11-20T11:00:00.000Z", moderator_id: "m", moderator_name: "M", rating: "good", marks: [], missing: [], context: "", proposal: null, replaces: null } as never)).rejects.toThrow(/no such answer/);
    expect((await rv.a.listAnswers()).map((x) => x.answer.id)).toEqual(["ans-1"]);

    const ds = as((t) => createD1DesignerStore(db, { tenant: t }));
    await ds.a.putLesson({ id: "l1", text: "Ask for the phone number last", source: "review", decision: "accepted", entry_id: null, run_id: null, created_at: "2026-11-20T10:00:00.000Z", created_by_name: "R" } as never);
    expect(await ds.b.lessons()).toEqual([]);
    expect(await ds.b.removeLesson("l1")).toBe(false);
    expect(await ds.a.lessons()).toHaveLength(1);
    await ds.a.addMessage({ id: "m1", thread_id: "t1", entry_id: null, author_id: "u", author_name: "U", role: "user", text: "A leave service", yaml: null, ok: null, run_id: null, created_at: "2026-11-20T10:00:00.000Z" } as never);
    expect(await ds.b.messages("t1")).toEqual([]);
    expect(await ds.b.threadInfo("t1")).toBeNull();

    const ev = as((t) => createD1EventStore(db, { tenant: t }));
    await ev.a.add([{ id: "e1", service: "svc", journey: "j", kind: "journey.started", step: null, role: null, run: "r", at: "2026-11-20T10:00:00.000Z", ms: null, ok: null, actor: null, outcome: null }]);
    expect(await ev.b.list("svc")).toEqual([]);
    expect(await ev.a.list("svc")).toHaveLength(1);
  });
});
