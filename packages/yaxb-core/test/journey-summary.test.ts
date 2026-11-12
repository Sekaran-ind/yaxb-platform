// Journey summaries (JRN-20..22): built from the definitions, so they never go stale.
import { describe, expect, it } from "vitest";
import { planTurn } from "../src/agent/index.js";
import { JOURNEY_SERVICES, kioskContent } from "../src/content/index.js";
import { createRunner, journeysText, SERVICE_INFO, summarizeJourney, summarizeRun, type Journey } from "../src/journeys/index.js";
import { DEFAULT_AGENT_SETTINGS } from "../src/settings/index.js";

const journey = (id: string) => kioskContent.journeys.find((j) => j.id === id)!;

describe("journey summaries", () => {
  it("describe every service a journey may use", () => {
    for (const s of JOURNEY_SERVICES) expect(SERVICE_INFO[s], s).toBeDefined();
  });

  it("list the steps in the order a run meets them, what they ask for and what they use", () => {
    const s = summarizeJourney(journey("document-briefing"));
    expect(s.steps[0]!.kind).toBe("ask");
    expect(s.steps.at(-1)!.kind).toBe("final");
    expect(s.uses.map((u) => u.name)).toEqual(expect.arrayContaining(["offline.summarize", "agent.ask", "offline.translate"]));
    expect(s.leavesDevice).toBe(true);
    expect(s.privacy).toMatch(/sent to the AI assistant\.$/);
  });

  it("say when nothing leaves the device", () => {
    const s = summarizeJourney(journey("visit-check-in"));
    expect(s.asks[0]).toBe("Main symptom"); // required first
    expect(s.asks).toContain("Your name");
    expect(s.uses).toEqual([]);
    expect(s.leavesDevice).toBe(false);
    expect(s.privacy).toBe("Asks for main symptom, your name, city, how many days, how bad is it, temperature and visit date. Nothing leaves this device.");
  });

  it("are written for every configured journey, and given to the assistant", () => {
    for (const j of kioskContent.journeys) {
      const s = summarizeJourney(j);
      expect(s.steps.length, j.id).toBe(Object.keys(j.steps).length);
      expect(s.privacy.length, j.id).toBeGreaterThan(10);
    }
    expect(journeysText(kioskContent.journeys).split("\n")).toHaveLength(kioskContent.journeys.length);
    const prompt = planTurn({ ...DEFAULT_AGENT_SETTINGS, harness: "deep" }, { hasNotebook: false }).options.promptAddendum;
    expect(prompt).toContain("Guided services, from their definitions:");
    expect(prompt).toContain("Check in for your visit");
  });
});

describe("a finished run", () => {
  it("lists the steps, the answers as the visitor saw them, and the result, as Markdown for the notebook", async () => {
    const j: Journey = journey("visit-check-in");
    const runner = createRunner(j, { services: {} });
    await runner.start();
    await runner.answer({ name: "Ravi", symptom: "Cough", days: "3", severity: "moderate", temperature: "", city: "", visit_date: "" });
    const run = summarizeRun(j, runner.state);
    expect(run.steps).toEqual([{ label: "Your visit", ok: true }]);
    expect(run.answers).toEqual([
      { step: "Your visit", field: "Your name", value: "Ravi" },
      { step: "Your visit", field: "Main symptom", value: "Cough" },
      { step: "Your visit", field: "How many days", value: "3" },
      { step: "Your visit", field: "How bad is it", value: "Moderate" },
    ]);
    expect(run.result?.title).toBe("Check-in: Ravi");
    expect(run.markdown).toContain("## Your answers\n- **Your name**: Ravi");
    expect(run.markdown).toContain("- ✓ Your visit");
  });
});
