import { describe, expect, it } from "vitest";
import {
  compileBundle,
  compileJourney,
  compileQuestionnaire,
  createRunner,
  EXAMPLE_BUNDLE,
  fieldVisible,
  MAX_BUNDLE_BYTES,
  previewHandlers,
  serviceNamesOf,
  servicesFor,
  splitDocuments,
  type Questionnaire,
} from "../src/index.js";

const intake = `
kind: questionnaire
id: intake
title: Intake
sections:
  - id: you
    title: About you
    fields:
      - { id: name, type: text, label: Name, required: true }
  - id: health
    title: Health
    fields:
      - { id: fever, type: boolean, label: Fever }
      - { id: temperature, type: number, label: Temperature, required: true, when: "values.fever == true" }
`;

const journey = `
kind: journey
id: check-in
title: Check in
start: form
steps:
  form:
    questionnaire: intake
    next: done
  done:
    final: true
    result: { text: "{{answers.form.name}} {{answers.form.temperature}}" }
`;

const q = (src = intake): Questionnaire => {
  const r = compileQuestionnaire(src);
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.questionnaire;
};

describe("questionnaires", () => {
  it("compiles sections, and a one-page questionnaire from fields", () => {
    expect(q().sections.map((s) => s.id)).toEqual(["you", "health"]);
    const one = q("kind: questionnaire\nid: one\ntitle: One\nfields:\n  - { id: a, type: text, label: A }\n");
    expect(one.sections).toEqual([{ id: "main", title: "One", fields: [{ id: "a", type: "text", label: "A" }] }]);
    expect(one.version).toBe(1);
  });

  it("refuses duplicate field ids across sections and bad conditions", () => {
    const dup = compileQuestionnaire(intake.replace("id: fever,", "id: name,").replace('"values.fever == true"', '"values.name == true"'));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.problems.join("\n")).toMatch(/field 'name' is listed twice/);

    const bad = compileQuestionnaire(intake.replace('"values.fever == true"', '"values.nope && ("'));
    expect(bad.ok).toBe(false);
    const unknown = compileQuestionnaire(intake.replace('"values.fever == true"', '"values.nope == true"'));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.problems.join("\n")).toMatch(/no field 'nope'/);
    const root = compileQuestionnaire(intake.replace('"values.fever == true"', '"window.x"'));
    expect(root.ok).toBe(false);
  });

  it("needs sections or fields, not both", () => {
    expect(compileQuestionnaire("kind: questionnaire\nid: x\ntitle: X\n").ok).toBe(false);
    expect(compileQuestionnaire("kind: questionnaire\nid: x\ntitle: X\nfields: [{ id: a, type: text, label: A }]\nsections: []\n").ok).toBe(false);
  });

  it("shows a field only when its condition holds", () => {
    const temp = q().sections[1]!.fields[1]!;
    expect(fieldVisible(temp, { fever: false })).toBe(false);
    expect(fieldVisible(temp, { fever: true })).toBe(true);
  });
});

describe("journeys with questionnaires", () => {
  it("copies the questions into the step, with sections and an ask line", () => {
    const r = compileJourney(journey, { questionnaires: [q()] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const step = r.journey.steps.form!;
    expect(step.fields!.map((f) => f.id)).toEqual(["name", "fever", "temperature"]);
    expect(step.sections).toEqual([
      { id: "you", title: "About you", fields: ["name"] },
      { id: "health", title: "Health", fields: ["fever", "temperature"] },
    ]);
    expect(step.ask).toBe("Intake");
  });

  it("fails on an unknown questionnaire, or fields and a questionnaire together", () => {
    const missing = compileJourney(journey);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.problems).toContain("step 'form': no questionnaire 'intake'");
    const both = compileJourney(journey.replace("questionnaire: intake", "questionnaire: intake\n    fields: [{ id: a, type: text, label: A }]"), { questionnaires: [q()] });
    expect(both.ok).toBe(false);
  });

  it("skips hidden required fields and keeps them as null", async () => {
    const r = compileJourney(journey, { questionnaires: [q()] });
    if (!r.ok) throw new Error("compile");
    const runner = createRunner(r.journey);
    const s = await runner.start();
    expect(s.prompt?.sections?.length).toBe(2);

    // Fever ticked: the temperature is asked, and required.
    expect(await runner.answer({ name: "Ravi", fever: true })).toEqual({ problems: ["Temperature is required."] });
    // No fever: the temperature is hidden, so not required, and kept as null even if typed earlier.
    const done = await runner.answer({ name: "Ravi", fever: false, temperature: "39" });
    expect("status" in done && done.status).toBe("done");
    expect(runner.state.answers.form).toEqual({ name: "Ravi", fever: false, temperature: null });
    expect(runner.state.result?.text).toBe("Ravi ");
  });
});

describe("bundles", () => {
  it("compiles the example with no errors or warnings", () => {
    const b = compileBundle(EXAMPLE_BUNDLE);
    expect(b.problems).toEqual([]);
    expect(b.ok).toBe(true);
    expect(b.services.map((s) => s.id)).toEqual(["clinic", "help"]);
    expect(b.journeys.map((j) => j.id)).toEqual(["visit-check-in", "quick-feedback"]);
    expect(b.questionnaires.map((x) => x.id)).toEqual(["visit-intake"]);
    expect(servicesFor(b.services, { journeys: b.journeys.map((j) => j.id) })[0]!.items).toHaveLength(2);
  });

  it("splits on --- lines and keeps each document's first line", () => {
    const docs = splitDocuments("# only a comment\n---\na: 1\n---\n\n---\nb: 2\n");
    expect(docs).toEqual([
      { text: "a: 1", line: 3 },
      { text: "b: 2\n", line: 7 },
    ]);
  });

  it("checks references across documents, in any order", () => {
    const service = "kind: service\nid: s\ntitle: S\nitems:\n  - { key: a, label: A, journey: check-in }\n";
    const ok = compileBundle([service, journey, intake]);
    expect(ok.ok).toBe(true);

    const noQuestionnaire = compileBundle([service, journey]);
    expect(noQuestionnaire.ok).toBe(false);
    expect(noQuestionnaire.problems.map((p) => p.message)).toContain("step 'form': no questionnaire 'intake'");
    // The service doesn't also complain: its journey exists, it just failed to compile.
    expect(noQuestionnaire.problems.filter((p) => p.kind === "service")).toEqual([]);

    const noJourney = compileBundle([service]);
    expect(noJourney.problems.map((p) => p.message)).toContain("item 'a': no journey 'check-in'");
  });

  it("points at the line of a problem", () => {
    const b = compileBundle(`kind: service\nid: s\ntitle: S\nitems: [{ key: a, label: A, screen: x }]\n---\nkind: journey\nid: j\n`);
    const p = b.problems.find((x) => x.kind === "journey");
    expect(p?.line).toBe(6);
    expect(p?.id).toBe("j");

    // Inside a document, the line that names the culprit.
    const lines = EXAMPLE_BUNDLE.split("\n");
    const broken = compileBundle(EXAMPLE_BUNDLE.replace("questionnaire: visit-intake", "questionnaire: visit-intak").replace("type: number, label: How many days", "type: numbr, label: How many days"));
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle)) + 1;
    expect(broken.problems.map((x) => x.line)).toEqual([at("questionnaire: visit-intake"), at("id: days")]);

    const yaml = compileBundle("kind: service\nid: s\n---\nkind: journey\n  id: : x\n");
    const y = yaml.problems.find((x) => x.message.startsWith("YAML"));
    expect(y?.line).toBeGreaterThanOrEqual(4);
  });

  it("refuses duplicate ids, unknown kinds, empty and oversized sources", () => {
    const dup = compileBundle([intake, intake]);
    expect(dup.problems.map((p) => p.message)).toContain("another questionnaire already has the id 'intake'");
    expect(compileBundle("kind: screens\nid: x\n").problems[0]!.message).toMatch(/kind must be one of/);
    expect(compileBundle("# nothing\n").ok).toBe(false);
    expect(compileBundle("a".repeat(MAX_BUNDLE_BYTES + 1)).problems[0]!.message).toMatch(/larger than/);
  });

  it("warns about journeys and questionnaires nobody reaches", () => {
    const service = "kind: service\nid: s\ntitle: S\nitems:\n  - { key: a, label: A, screen: transcript }\n";
    const b = compileBundle([service, journey, intake, intake.replace("id: intake", "id: spare")]);
    expect(b.ok).toBe(true);
    expect(b.problems.map((p) => `${p.level} ${p.id}: ${p.message}`)).toEqual([
      "warning check-in: no service item opens this journey",
      "warning spare: no journey step uses this questionnaire",
    ]);
  });

  it("checks handler names and screens when told them", () => {
    const b = compileBundle(EXAMPLE_BUNDLE, { services: ["offline.summarize"], screens: ["notebook"] });
    const messages = b.problems.map((p) => p.message);
    expect(messages).toContain("step 'thank': no service 'agent.ask'");
    expect(messages).toContain("item 'ask': no screen 'transcript'");
  });
});

describe("preview handlers", () => {
  it("stand in for every service a journey calls, and run it to the end", async () => {
    const b = compileBundle(EXAMPLE_BUNDLE);
    expect(serviceNamesOf(b.journeys)).toEqual(["agent.ask"]);
    const feedback = b.journeys.find((j) => j.id === "quick-feedback")!;
    const runner = createRunner(feedback, { services: previewHandlers(b.journeys, {}, { delayMs: 1 }) });
    await runner.start();
    const done = await runner.answer({ rating: "good" });
    expect("status" in done && done.status).toBe("done");
    expect(runner.state.result?.text).toMatch(/^\(Preview\) agent\.ask would run here with .*rated their visit good/);
  });

  it("prefer real handlers when given", async () => {
    const b = compileBundle(EXAMPLE_BUNDLE);
    const h = previewHandlers(b.journeys, { "agent.ask": async () => ({ text: "real" }) });
    expect(await h["agent.ask"]!({}, { journey: b.journeys[0]!, step: b.journeys[0]!.steps.intake!, scope: {} })).toEqual({ text: "real" });
  });
});
