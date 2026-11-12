// Kiosk profiles: the encrypted vault, what a profile may hold, the settings it suggests, and the
// activity log's refusal to record content.
import { describe, expect, it } from "vitest";
import { activityEvent, appendActivity, applyPreferences, INTEREST_DOMAINS, PERSONALITY_QUESTIONS, preferencesFrom, profileProblem, profileSchema } from "../src/accounts/index.js";
import { createVault, openVault, rekeyVault, sealVault } from "../src/accounts/crypto.js";
import { kioskContent } from "../src/content/index.js";
import { DEFAULT_AGENT_SETTINGS, SUBAGENT_OPTIONS, TOOL_OPTIONS } from "../src/settings/index.js";

const FAST = { iterations: 1000 }; // the real count (600,000) is slow in tests

describe("the profile vault", () => {
  it("opens with the passphrase, not without; the nickname alone is in the clear", async () => {
    const { record } = await createVault("p1", "Ravi", "correct horse", { secret: "interests" }, FAST);
    expect(JSON.stringify(record)).not.toContain("interests");
    expect(record.nickname).toBe("Ravi");
    expect(await openVault(record, "wrong horse")).toBeNull();
    expect((await openVault(record, "correct horse"))!.data).toEqual({ secret: "interests" });
  });

  it("re-seals with the same key, and re-keys for a new passphrase", async () => {
    const { record, key } = await createVault("p1", "Ravi", "first pass", { n: 1 }, FAST);
    const updated = await sealVault(record, key, { n: 2 }, "Ravi K");
    expect(updated.nickname).toBe("Ravi K");
    expect((await openVault(updated, "first pass"))!.data).toEqual({ n: 2 });
    const { record: rekeyed } = await rekeyVault(updated, "second pass", { n: 2 }, FAST);
    expect(await openVault(rekeyed, "first pass")).toBeNull();
    expect((await openVault(rekeyed, "second pass"))!.data).toEqual({ n: 2 });
  });

  it("refuses a record that was altered", async () => {
    const { record } = await createVault("p1", "Ravi", "a passphrase", { n: 1 }, FAST);
    const tampered = { ...record, box: { ...record.box, ct: record.box.ct.slice(0, -4) + "AAAA" } };
    expect(await openVault(tampered, "a passphrase")).toBeNull();
  });
});

describe("a profile", () => {
  it("holds a little: a nickname, an age range, language, interests and answers; nothing else", () => {
    const p = profileSchema.parse({ nickname: " Ravi ", ageRange: "45-59", language: "tam_Taml", interests: ["documents"], personality: { depth: "brief" } });
    expect(p).toEqual({ nickname: "Ravi", ageRange: "45-59", language: "tam_Taml", interests: ["documents"], personality: { depth: "brief" } });
    expect(profileProblem({ nickname: "" })).toBe("Enter a nickname.");
    expect(profileProblem({ nickname: "Ravi", abhaNumber: "91-1234-5678-9012" })).not.toBeNull(); // no identifiers
    expect(profileProblem({ nickname: "Ravi", personality: { depth: "rambling" } })).not.toBeNull();
  });
});

describe("suggested settings", () => {
  it("keep answers on the device for a privacy-first visitor", () => {
    const prefs = preferencesFrom(profileSchema.parse({ nickname: "A", personality: { privacy: "device" } }));
    expect(prefs.agent.knowledge).toEqual({ answers: "local", web: "off" });
    expect(prefs.suggestions[0]!.because).toContain("Only this device");
  });

  it("follow how the visitor likes to be helped", () => {
    const prefs = preferencesFrom(
      profileSchema.parse({
        nickname: "A",
        ageRange: "75-plus",
        language: "tam_Taml",
        interests: ["documents", "visits"],
        personality: { depth: "detailed", channel: "voice", privacy: "web", comfort: "new", checking: "yes" },
      }),
    );
    expect(prefs.agent).toMatchObject({
      language: "tam_Taml",
      knowledge: { answers: "agent", web: "fallback" },
      subagents: { "knowledge-researcher": true, "safety-reviewer": true },
      tools: { planning: true, files: true },
      skills: { "notebook-research": true, "summarise-document": true },
    });
    expect(prefs.kiosk).toEqual({ speakResponses: true, layout: "mini", speechRate: 0.9 });
    expect(prefs.highlight).toEqual(["open", "summarise", "briefing", "find", "check-in"]);
    expect(prefs.suggestions.every((s) => s.label && s.because)).toBe(true);
  });

  it("only name tools, helpers, skills and services the kiosk has", () => {
    const all = profileSchema.parse({
      nickname: "A",
      interests: INTEREST_DOMAINS.map((d) => d.id),
      personality: Object.fromEntries(PERSONALITY_QUESTIONS.map((q) => [q.id, q.options[0]!.value])),
    });
    const variants = [all, ...PERSONALITY_QUESTIONS.flatMap((q) => q.options.map((o) => ({ ...all, personality: { [q.id]: o.value } })))];
    const items = new Set(kioskContent.services.flatMap((s) => s.items.map((i) => i.key)));
    for (const v of variants) {
      const p = preferencesFrom(v);
      for (const t of Object.keys(p.agent.tools ?? {})) expect(TOOL_OPTIONS.map((o) => o.id as string)).toContain(t);
      for (const s of Object.keys(p.agent.subagents ?? {})) expect(SUBAGENT_OPTIONS.map((o) => o.id as string)).toContain(s);
      for (const s of Object.keys(p.agent.skills ?? {})) expect(kioskContent.skills.map((k) => k.name)).toContain(s);
      for (const h of p.highlight) expect(items).toContain(h);
    }
  });

  it("are merged into the current settings, not replacing them", () => {
    const settings = { ...DEFAULT_AGENT_SETTINGS, tools: { files: false, planning: false }, mcp: ["docs"] };
    const next = applyPreferences(settings, { agent: { tools: { files: true }, knowledge: { web: "off" } }, kiosk: {}, highlight: [], suggestions: [] });
    expect(next.tools).toEqual({ files: true, planning: false });
    expect(next.knowledge).toEqual({ ...DEFAULT_AGENT_SETTINGS.knowledge, web: "off" });
    expect(next.mcp).toEqual(["docs"]);
  });
});

describe("the activity log", () => {
  it("keeps the action and a few short facts, never content", () => {
    const e = activityEvent("question.asked", { mode: "local", language: "tam_Taml", message: "I have chest pain", text: "x", count: 2 });
    expect(e.action).toBe("question.asked");
    expect(e.details).toEqual({ mode: "local", language: "tam_Taml", count: 2 });
    expect(JSON.stringify(e)).not.toContain("chest");
    expect(() => activityEvent("nonsense" as never)).toThrow();
  });

  it("is newest first and bounded", () => {
    let log = [activityEvent("account.created")];
    for (let i = 0; i < 5; i++) log = appendActivity(log, activityEvent("question.asked"), 3);
    expect(log).toHaveLength(3);
    expect(log[0]!.action).toBe("question.asked");
  });
});
