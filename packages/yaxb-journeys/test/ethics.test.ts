// The Ethics Counsellor's check without a model (ETH-1): protected attributes in questions and
// conditions, in English, Tamil and Hindi, as warnings with their lines in compileBundle.
import { describe, expect, it } from "vitest";
import { compileBundle, ethicsChecks, protectedAttributeIn } from "../src/index.js";

const HOSTEL = `kind: service
id: hostel
title: Hostel admission
journeys:
  - id: apply
    title: Apply for a room
    screens:
      - id: about-you
        title: About you
        questions:
          - { id: name, type: text, label: Your name, required: true }
          - { id: gender, type: select, label: Gender, options: [{ value: f, label: Female }, { value: m, label: Male }, { value: o, label: Other }] }
          - { id: religion, type: text, label: Religion }
          - { id: city, type: text, label: City }
      - id: route
        decide:
          - { if: "answers.about-you.gender == 'f'", to: offered }
          - { to: refused }
      - id: offered
        result: { title: "A room is offered" }
      - id: refused
        result: { title: "No room" }
`;

describe("the ethics check (ETH-1)", () => {
  it("names protected attributes in ids, labels and options, in English, Tamil and Hindi", () => {
    expect(protectedAttributeIn("marital_status")).toBe("marital status");
    expect(protectedAttributeIn("dateOfBirth")).toBe("age");
    expect(protectedAttributeIn("Your caste")).toBe("caste");
    expect(protectedAttributeIn("உங்கள் சாதியை")).toBe("caste");
    expect(protectedAttributeIn("मातृभाषा")).toBe("language");
    expect(protectedAttributeIn("धर्म का नाम")).toBe("religion");
    // Ordinary words are left alone.
    for (const text of ["Page number", "Your image", "Preferred language", "Community hall", "ஆண்டு", "वह जाता है", "Message", "Storage", "Average"]) expect(protectedAttributeIn(text), text).toBeNull();
  });

  it("finds a question that asks (medium) and a decision that reads it (high)", () => {
    const b = compileBundle(HOSTEL);
    const j = b.journeys.find((x) => x.id === "apply")!;
    const findings = ethicsChecks(j);
    expect(findings.map((f) => [f.severity, f.attribute, f.field ?? null])).toEqual([
      ["medium", "gender", "gender"],
      ["medium", "religion", "religion"],
      ["high", "gender", "gender"],
    ]);
  });

  it("shows them as warnings in compileBundle, with their lines, and never as errors", () => {
    const b = compileBundle(HOSTEL);
    const ethics = b.problems.filter((p) => p.ethics);
    expect(ethics.every((p) => p.level === "warning")).toBe(true);
    expect(b.problems.filter((p) => p.level === "error")).toEqual([]);
    const lines = HOSTEL.split("\n");
    const high = ethics.find((p) => p.ethics!.severity === "high")!;
    expect(high.message).toMatch(/^Ethics: screen 'route' treats people differently by gender/);
    expect(lines[high.line - 1]).toContain("id: route");
    const religion = ethics.find((p) => p.ethics!.attribute === "religion")!;
    expect(lines[religion.line - 1]).toContain("id: religion");
  });

  it("finds a field's when that reads a protected answer, and a condition naming one", () => {
    const yaml = HOSTEL.replace("          - { id: city, type: text, label: City }", "          - { id: city, type: text, label: City, when: \"values.religion == 'Hindu'\" }").replace("answers.about-you.gender == 'f'", "context.age >= 60");
    const findings = ethicsChecks(compileBundle(yaml).journeys[0]!).filter((f) => f.severity === "high");
    expect(findings.map((f) => [f.attribute, f.step])).toEqual([
      ["religion", "about-you"],
      ["age", "route"],
    ]);
  });

  it("has nothing to say about a service that asks for none", () => {
    const plain = HOSTEL.replace(/ {10}- \{ id: (gender|religion)[^\n]*\n/g, "").replace("answers.about-you.gender == 'f'", "answers.about-you.city == 'Chennai'");
    expect(ethicsChecks(compileBundle(plain).journeys[0]!)).toEqual([]);
  });
});
