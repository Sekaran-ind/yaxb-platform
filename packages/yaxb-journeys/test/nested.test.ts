import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  checkDocument,
  compileBundle,
  createRunner,
  designFromDoc,
  designToDoc,
  expandService,
  idFromName,
  newServiceDesign,
  serviceTemplate,
  servicesFor,
  toYaml,
} from "../src/index.js";

const CLINIC = `kind: service
id: clinic
title: Clinic visit
roles:
  - { id: receptionist, label: Receptionist }
  - { id: nurse, label: Nurse, description: Ward nurse }
journeys:
  - id: check-in
    title: Check in
    roles: { initiate: [visitor, receptionist], complete: [nurse] }
    screens:
      - id: about-you
        title: About you
        questions:
          - { id: name, type: text, label: Your name, required: true }
          - { id: fever, type: boolean, label: I have a fever }
      - id: route
        decide:
          - { if: "answers.about-you.fever == true", to: urgent }
          - { to: done }
      - id: urgent
        result: { title: "Please see the nurse now" }
      - id: done
        result: { title: "Thanks {{answers.about-you.name}}" }
  - id: triage
    title: Triage
    roles: { initiate: [nurse] }
    screens:
      - id: notes
        title: Notes
        questions: [{ id: note, type: textarea, label: Notes }]
`;

describe("nested services", () => {
  it("compile into a service whose items are its journeys, and journeys whose steps are screens", () => {
    const b = compileBundle(CLINIC);
    expect(b.problems).toEqual([]);
    expect(b.roles.map((r) => r.id)).toEqual(["receptionist", "nurse"]);
    expect(b.services[0]).toMatchObject({ id: "clinic", roles: ["receptionist", "nurse"], items: [{ key: "check-in", journey: "check-in" }, { key: "triage", journey: "triage" }] });
    const triage = b.journeys.find((j) => j.id === "triage")!;
    // The last screen didn't end the journey: an ending is added.
    expect(Object.keys(triage.steps)).toEqual(["notes", "end"]);
    expect(triage.steps.notes).toMatchObject({ label: "Notes", ask: "Notes", next: "end" });
    expect(servicesFor(b.services, { journeys: ["check-in"] })[0]!.items).toHaveLength(1);
  });

  it("run screen to screen, with decisions", async () => {
    const j = compileBundle(CLINIC).journeys[0]!;
    const runner = createRunner(j);
    expect((await runner.start()).prompt?.step).toBe("about-you");
    await runner.answer({ name: "Ravi", fever: false });
    expect(runner.state.result?.title).toBe("Thanks Ravi");
  });

  it("say what's wrong with the nesting, on the right line, in screen words", () => {
    const b = compileBundle(CLINIC.replace("complete: [nurse]", "complete: [doctor]").replace("to: urgent", "to: urgnt"));
    const messages = b.problems.map((p) => `${p.line} ${p.message}`);
    expect(messages).toContain(`10 journey 'check-in': role 'doctor' isn't one of this service's roles: add it to the roles`);
    expect(messages.some((m) => m.endsWith("screen 'route' decide[0]: no screen 'urgnt'"))).toBe(true);
    expect(compileBundle(CLINIC.replace("        questions: [{ id: note, type: textarea, label: Notes }]\n", "")).problems.map((p) => p.message)).toContain(
      "journey 'triage' screen 'notes': give it questions, a service, a decision or a result",
    );
    const x = expandService(load("kind: service\nid: s\ntitle: S\nroles: [visitor]\nitems: []\njourneys: []\n") as Record<string, unknown>);
    expect(x.problems).toEqual(["a service with journeys lists no items: each journey is one", "role 'visitor' is built in (anyone at the kiosk): don't define it", "add at least one journey"]);
  });

  it("check alone as one catalogue entry", () => {
    expect(checkDocument(CLINIC, []).problems).toEqual([]);
    expect(checkDocument(serviceTemplate("hello"), []).problems).toEqual([]);
  });
});

describe("service designs", () => {
  it("round-trip the nested YAML", () => {
    const doc = load(CLINIC) as Record<string, unknown>;
    const { design, unsupported } = designFromDoc(doc);
    expect(unsupported).toEqual([]);
    const back = designToDoc(design);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const a = compileBundle(CLINIC);
    const b = compileBundle(toYaml(back.doc));
    expect(b.problems).toEqual([]);
    expect(b.journeys).toEqual(a.journeys);
    expect(b.services).toEqual(a.services);
    expect(b.roles).toEqual(a.roles);
  });

  it("start from a template, add a role and assign it", () => {
    const d = newServiceDesign("front-desk");
    d.roles.push({ id: idFromName("Front desk"), label: "Front desk" });
    d.journeys[0]!.complete = ["front-desk"];
    const r = designToDoc(d);
    expect(r.ok && compileBundle(toYaml(r.doc)).ok).toBe(true);
    expect(idFromName("  Ward Nurse (night) ")).toBe("ward-nurse-night");
    d.journeys[0]!.screens[0]!.fieldsYaml = "id: [";
    expect(designToDoc(d).ok).toBe(false);
  });
});
