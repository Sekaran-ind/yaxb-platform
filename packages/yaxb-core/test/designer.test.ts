// The Service Designer agent (LIB-27..32): few-shot examples, the deep agent's tools and repair
// loop, the lean path, and learning from reviews, on the memory store and on D1. No network: the
// model is scripted.
import type { BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { createKiosk } from "../src/agent/index.js";
import { JOURNEY_SERVICES, kioskContent } from "../src/content/index.js";
import {
  createDesignerService,
  createMemoryDesignerStore,
  designChanges,
  draftProblems,
  examplePool,
  lessonFrom,
  lessonsMemory,
  narrativeOf,
  pickExamples,
  REPAIR_ATTEMPTS,
  yamlFromReply,
  type DesignerStore,
  type DesignLesson,
} from "../src/designer/index.js";
import { createLibraryService, createMemoryLibraryStore, type LibraryActor } from "../src/library/index.js";
import { createD1DesignerStore } from "../src/stores/d1.js";
import { createMemoryModerationStore, createMemoryThreadStore } from "../src/stores/index.js";
import { ScriptedModel, type Step } from "./scripted-model.js";
import { sqliteD1 } from "./sqlite-d1.js";

const SELECTION = { provider: "anthropic", model: "claude-sonnet-5-5", temperature: 0.3 };
const LEAN = { provider: "ollama", model: "llama3.1:8b", temperature: 0.3 };

const GOOD = `kind: service
id: gym-membership
title: Gym membership
summary: Join the gym.
journeys:
  - id: join
    title: Join the gym
    roles: { initiate: [visitor] }
    screens:
      - id: about
        title: About you
        questions:
          - { id: name, type: text, label: Your name, required: true }
          - id: plan
            type: select
            label: Plan
            options:
              - { value: monthly, label: Monthly }
              - { value: yearly, label: Yearly }
      - id: done
        title: Welcome
        result: { title: "Welcome {{answers.about.name}}" }
`;
// A question type that doesn't exist.
const BAD = GOOD.replace("type: text", "type: shoe-size");
const NARRATIVE = "Our gym wants people to join at the kiosk: they give their name and pick a monthly or yearly plan.";

function setup(steps: Step[], env: Record<string, string> = { ANTHROPIC_API_KEY: "test-key" }) {
  const model = new ScriptedModel(steps);
  const errors: unknown[] = [];
  const kiosk = createKiosk({ env, threads: createMemoryThreadStore(), moderation: createMemoryModerationStore(), modelFactory: async () => model, onError: (e) => errors.push(e) });
  return { kiosk, model, errors };
}

const systemText = (calls: BaseMessage[][]) =>
  calls
    .flat()
    .filter((m) => m.getType() === "system")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");

describe("few-shot examples", () => {
  it("ships built-in examples that compile, in several industries", () => {
    expect(kioskContent.problems).toEqual([]);
    expect(kioskContent.designer.map((d) => d.id).sort()).toEqual(["bank-complaints", "housing-repairs", "library-renewals"]);
  });

  it("writes a narrative from a published service, and adds it to the pool once", () => {
    const visits = kioskContent.catalogue[0]!.yaml;
    expect(narrativeOf(visits)).toMatch(/Visits.*Front desk.*Check in for your visit.*Your name/s);
    const pool = examplePool(kioskContent.designer, [{ yaml: visits }, { yaml: visits }, { yaml: kioskContent.designer[0]!.yaml }]);
    expect(pool.filter((e) => e.source === "catalogue").map((e) => e.id)).toEqual(["visits"]);
  });

  it("picks the closest examples, always with a built-in one", () => {
    const pool = examplePool(kioskContent.designer, [{ yaml: kioskContent.catalogue[0]!.yaml }]);
    expect(pickExamples("Customers complain about a card or a loan at the bank", pool)[0]!.id).toBe("bank-complaints");
    const picked = pickExamples("A clinic check-in for visitors: name, symptom, front desk", pool);
    expect(picked.map((e) => e.id)).toContain("visits");
    expect(picked.some((e) => e.source === "built-in")).toBe(true);
  });

  it("catches mistakes the compiler allows: a when on its own screen's answers, and template blocks", () => {
    const own = GOOD.replace("label: Your name, required: true }", "label: Your name, required: true, when: \"answers.about.plan == 'yearly'\" }");
    expect(draftProblems(own)).toEqual([expect.objectContaining({ level: "error", message: expect.stringContaining("write values.plan instead of answers.about.plan") })]);
    const block = GOOD.replace('result: { title: "Welcome {{answers.about.name}}" }', 'result: { title: "{{#if answers.about.name}}Welcome{{/if}}" }');
    expect(draftProblems(block)).toEqual([expect.objectContaining({ line: block.split("\n").findIndex((l) => l.includes("{{#if")) + 1 })]);
    expect(draftProblems(GOOD)).toEqual([]);
  });

  it("reads YAML from a reply", () => {
    expect(yamlFromReply("Here it is:\n```yaml\nkind: service\nid: x\n```\nDone")).toBe("kind: service\nid: x\n");
    expect(yamlFromReply("kind: service\nid: y")).toBe("kind: service\nid: y\n");
    expect(yamlFromReply("I can't do that.")).toBeNull();
  });
});

describe("the Service Designer agent", () => {
  it("checks, submits and returns a draft that compiles, with the examples and lessons in its prompt", async () => {
    const { kiosk, model } = setup([
      // Providers without a Deep Agents profile still see `task`; the guard refuses every helper.
      { calls: [{ name: "task", args: { subagent_type: "general-purpose", description: "Design it for me" } }] },
      { calls: [{ name: "check_service", args: { yaml: BAD } }] },
      { calls: [{ name: "submit_design", args: { yaml: GOOD, notes: "Assumed anyone can join." } }] },
      { text: "Submitted." },
    ]);
    const lessons: DesignLesson[] = [{ id: "l1", text: "Always ask for a phone number only when a call back is wanted.", source: "admin", decision: null, entry_id: null, run_id: null, created_at: "2026-11-14T00:00:00Z", created_by_name: "Admin" }];
    const out = await kiosk.design({ narrative: NARRATIVE, selection: SELECTION, lessons });
    expect(out).toMatchObject({ ok: true, title: "Gym membership", notes: "Assumed anyone can join.", yaml: GOOD });
    expect([...new Set(model.boundTools.flat())]).toEqual(expect.arrayContaining(["find_similar_services", "check_service", "submit_design"]));
    expect(model.boundTools.flat()).not.toContain("execute");
    expect(JSON.stringify(model.calls[1])).toContain("No helpers are available");
    const system = systemText(model.calls);
    expect(system).toContain("Worked examples");
    expect(system).toContain("Narrative:");
    expect(system).toContain("phone number only when a call back");
    // The check_service result reached the model.
    expect(JSON.stringify(model.calls[2])).toContain("shoe-size");
    // The narrative is fenced as data.
    expect(JSON.stringify(model.calls[0])).toContain("<service_description>");
  });

  it("sends a draft with errors back, and gives up after a few attempts", async () => {
    const { kiosk, model } = setup([
      ...Array.from({ length: REPAIR_ATTEMPTS }, () => ({ calls: [{ name: "submit_design", args: { yaml: BAD } }] })),
      { text: "I could not fix it." },
    ]);
    const out = await kiosk.design({ narrative: NARRATIVE, selection: SELECTION });
    expect(JSON.stringify(model.calls[1])).toContain("Not yet: fix these");
    expect(out).toMatchObject({ ok: false });
    expect("problems" in out && out.problems.some((p) => p.level === "error")).toBe(true);
  });

  it("falls back to a direct reply when the agent submits nothing, and repairs it", async () => {
    const { kiosk, model } = setup([{ text: "Here you go." }, { text: "```yaml\n" + BAD + "```" }, { text: "```yaml\n" + GOOD + "```" }]);
    const out = await kiosk.design({ narrative: NARRATIVE, selection: SELECTION });
    expect(out).toMatchObject({ ok: true, yaml: GOOD });
    expect(JSON.stringify(model.calls.at(-1))).toContain("has errors");
  });

  it("asks lean models for one reply, without tools", async () => {
    const { kiosk, model } = setup([{ text: "```yaml\n" + GOOD + "```" }], { OLLAMA_BASE_URL: "http://127.0.0.1:11434" });
    const out = await kiosk.design({ narrative: NARRATIVE, selection: LEAN });
    expect(out).toMatchObject({ ok: true });
    expect(model.boundTools).toEqual([]);
  });

  it("refuses short descriptions and unconfigured providers without calling a model", async () => {
    const { kiosk, model } = setup([]);
    expect(await kiosk.design({ narrative: "A gym.", selection: SELECTION })).toEqual({ error: "Describe the service in a few sentences." });
    expect(await kiosk.design({ narrative: NARRATIVE, selection: { provider: "openai", model: "gpt-5.5", temperature: 0 } })).toMatchObject({ error: expect.stringMatching(/not configured|not offered/) });
    expect(model.calls).toEqual([]);
  });
});

describe("learning from reviews", () => {
  const edited = GOOD.replace(
    "          - id: plan",
    "          - { id: phone, type: text, label: Phone number }\n          - id: plan",
  ).replace("type: text, label: Your name, required: true", "type: text, label: Your full name, required: true");

  it("says what people changed in a draft", () => {
    expect(designChanges(GOOD, edited)).toEqual(['added the question "Phone number" (text) on "about"', 'reworded "Your name" as "Your full name"']);
    expect(designChanges(GOOD, GOOD)).toEqual([]);
  });

  it("turns a decision into a lesson, or nothing when it was accepted as drafted", () => {
    expect(lessonFrom(GOOD, GOOD, "accepted", null)).toBeNull();
    expect(lessonFrom(GOOD, edited, "accepted", null)).toMatch(/^"Gym membership" was accepted after people changed the AI draft: added the question "Phone number"/);
    expect(lessonFrom(GOOD, GOOD, "rejected", "Ask for consent before taking a phone number.")).toBe('A reviewer rejected "Gym membership". The reviewer said: Ask for consent before taking a phone number.');
    expect(lessonsMemory([])).toContain("No lessons yet");
  });

  const stores: [string, () => DesignerStore][] = [
    ["memory", createMemoryDesignerStore],
    ["D1 (SQLite)", () => createD1DesignerStore(sqliteD1())],
  ];
  for (const [name, make] of stores) {
    it(`learns from the review of a draft, ${name}`, async () => {
      const designer = createDesignerService(make());
      const author: LibraryActor = { id: "guest:abc", name: "Guest", roles: [], admin: false, guest: true };
      const reviewer: LibraryActor = { id: "r1", name: "Ravi", roles: ["reviewer"], admin: false };
      const library = createLibraryService(createMemoryLibraryStore(), {
        services: JOURNEY_SERVICES,
        onReviewed: (e, decision, note, a) => designer.learn(e, decision, note, a.name),
      });

      const run = await designer.recorded(author.id, { yaml: GOOD, title: "Gym membership", problems: [], ok: true, notes: null, examples: [] });
      const { entry } = await library.createEntry(author, null, { yaml: GOOD });
      expect(await designer.link(run.id, entry.id, "guest:someone-else")).toBe(false);
      expect(await designer.link(run.id, entry.id, author.id)).toBe(true);
      expect(await designer.link(run.id, entry.id, author.id)).toBe(false);

      await library.saveEntry(author, entry.id, { yaml: edited });
      await library.submit(author, entry.id);
      await library.review(reviewer, entry.id, { decision: "accept" });

      const [lesson] = await designer.lessons();
      expect(lesson).toMatchObject({ source: "review", decision: "accepted", entry_id: entry.id, run_id: run.id, created_by_name: "Ravi" });
      expect(lesson!.text).toContain('added the question "Phone number"');

      const added = await designer.addLesson({ text: "Keep result screens to two sentences." }, "Administrator");
      expect((await designer.lessons()).map((l) => l.id)).toContain(added.id);
      await expect(designer.addLesson({ text: "x" }, null)).rejects.toThrow("Write the lesson.");
      expect(await designer.removeLesson(added.id)).toBe(true);
      expect(await designer.removeLesson(added.id)).toBe(false);
      expect(lessonsMemory(await designer.lessons())).toContain("Phone number");
    });
  }

  it("ignores reviews of services that didn't come from a draft", async () => {
    const designer = createDesignerService(createMemoryDesignerStore());
    expect(await designer.learn({ id: "nope", yaml: GOOD }, "rejected", "No.", "Ravi")).toBeNull();
    expect(await designer.lessons()).toEqual([]);
  });
});
