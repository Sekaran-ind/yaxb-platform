// Spell check (SPL-1..7, SPL-10): normalising, correcting over graphemes, what is never touched,
// choosing between the original and the correction, and the test set of mistyped questions.
import { describe, expect, it } from "vitest";
import { matchCommand, KIOSK_COMMANDS } from "../src/commands/index.js";
import {
  buildDictionary,
  chooseSpelling,
  correctText,
  ownWords,
  editDistance,
  extendDictionary,
  graphemes,
  kioskSpellDictionary,
  normalizeText,
  serviceTexts,
  spellingHint,
  suggestWord,
} from "../src/spell/index.js";
import set from "./fixtures/spell-typos.json" with { type: "json" };

const dict = kioskSpellDictionary();
const same = (a: string, b: string) => normalizeText(a).toLowerCase() === normalizeText(b).toLowerCase();

describe("normalising (SPL-1)", () => {
  it("composes, tidies spaces and turns Indian-script digits into ASCII", () => {
    expect(normalizeText("  café ​  menu\n\tplease ")).toBe("café menu please");
    expect(normalizeText("அறை ௧௨௩")).toBe("அறை 123");
    expect(normalizeText("कमरा १०५")).toBe("कमरा 105");
    expect(normalizeText("ক্লাস ৪")).toBe("ক্লাস 4");
  });
});

describe("graphemes and distance (SPL-2)", () => {
  it("counts a consonant with its vowel sign as one letter", () => {
    expect(graphemes("காட்டு")).toHaveLength(3);
    expect(graphemes("दिखाओ")).toHaveLength(3);
    expect(editDistance(graphemes("காட்ட"), graphemes("காட்டு"))).toBe(1);
  });

  it("counts a swap of two neighbouring letters as one edit", () => {
    expect(editDistance(graphemes("opne"), graphemes("open"))).toBe(1);
    expect(editDistance(graphemes("kitten"), graphemes("sitting"))).toBe(3);
  });

  it("corrects to the kiosk's own words, and splits and joins words", () => {
    expect(correctText("open my notbook", dict).corrected).toBe("open my notebook");
    expect(correctText("a visitor wants to checkin", dict).changes).toEqual([{ from: "checkin", to: "check in", distance: 1, kind: "split" }]);
    const own = buildDictionary(ownWords(["Sign the notebook", "notebook sources"]), { general: ["note"] });
    expect(correctText("note book", own).corrected).toBe("notebook");
  });

  it("leaves short words alone, and makes no correction when two are equally likely", () => {
    expect(correctText("go to teh bus", dict).changes).toEqual([]);
    const tie = buildDictionary(ownWords(["bake", "bike"]), { general: [] });
    expect(suggestWord("boke", tie)).toBeNull();
  });

  it("keeps the case the person typed", () => {
    expect(correctText("Opne settings", dict).corrected).toBe("Open settings");
  });
});

describe("never corrected (SPL-5)", () => {
  it("numbers, money, phone numbers, email and web addresses, ids and names", () => {
    for (const text of ["call 98400 12345", "pay ₹1,250 today", "mail priya.r@exampel.com", "see www.exmaple.org now", "my id is EMP2045X", "ask Meenaksi about it", "the UPI is ramesh@okaxsi"]) {
      expect(correctText(text, dict).changes, text).toEqual([]);
    }
  });

  it("names the caller protects (from the NER model)", () => {
    expect(correctText("meenaksi wants help", dict, { protect: ["Meenaksi"] }).changes).toEqual([]);
  });
});

describe("the tenant's own words (SPL-4)", () => {
  it("adds a service's words without losing the kiosk's", () => {
    const yaml = "kind: service\ntitle: Ration card renewal\njourneys:\n  - title: Renew a ration card\n    screens:\n      - questions: []\n";
    expect(serviceTexts(yaml)).toEqual(["Ration card renewal", "Renew a ration card"]);
    const tenant = extendDictionary(dict, ownWords(serviceTexts(yaml)));
    expect(correctText("renew my rasion card", tenant).corrected).toBe("renew my ration card");
    expect(correctText("open my notbook", tenant).corrected).toBe("open my notebook");
    expect(correctText("renew my rasion card", dict).corrected).not.toBe("renew my ration card");
  });
});

describe("choosing (SPL-3, SPL-6) and the agent's hint (SPL-7)", () => {
  it("acts on a correction only when it turns a weak match into a strong one", () => {
    expect(chooseSpelling(null, 0.9, { strong: 0.7 })).toEqual({ use: "corrected", notice: "acted" });
    expect(chooseSpelling(0.8, 0.9, { strong: 0.7 })).toEqual({ use: "corrected", notice: "acted" });
    expect(chooseSpelling(0.8, 0.75, { strong: 0.7 })).toEqual({ use: "original", notice: null });
    expect(chooseSpelling(0.4, 0.6, { strong: 0.7 })).toEqual({ use: "original", notice: "suggest" });
    expect(chooseSpelling(0.6, 0.4, { strong: 0.7 })).toEqual({ use: "original", notice: null });
    expect(chooseSpelling(null, null, { strong: 0.7 })).toEqual({ use: "original", notice: null });
  });

  it("gives the agent the correction as a hint, only when there is one", () => {
    expect(spellingHint("open my notebook", "opne my notbook")).toContain('"open my notebook"');
    expect(spellingHint("open my notebook", "open my  notebook")).toBe("");
    expect(spellingHint(undefined, "x")).toBe("");
  });
});

describe("the test set (SPL-10)", () => {
  const typos = set.typos as { lang: string; typed: string; meant: string }[];

  it("recovers most mistyped questions in English, Tamil and Hindi", () => {
    for (const lang of ["en", "ta", "hi"]) {
      const items = typos.filter((t) => t.lang === lang);
      const fixed = items.filter((t) => same(correctText(t.typed, dict).corrected, t.meant));
      const missed = items.filter((t) => !fixed.includes(t)).map((t) => `${t.typed} → ${correctText(t.typed, dict).corrected}`);
      expect(fixed.length / items.length, `${lang} missed: ${missed.join(" | ")}`).toBeGreaterThanOrEqual(0.75);
    }
  });

  it("makes more commands match by words", async () => {
    const by = (text: string) => matchCommand(text, { commands: KIOSK_COMMANDS });
    // Of the typos whose intended words are a command: how many are recognised before and after.
    let commands = 0;
    let before = 0;
    let after = 0;
    for (const t of typos) {
      if (!(await by(t.meant))) continue;
      commands++;
      if (await by(t.typed)) before++;
      if (await by(correctText(t.typed, dict).corrected)) after++;
    }
    expect(commands).toBeGreaterThanOrEqual(8);
    expect(after / commands, `${before} → ${after} of ${commands}`).toBeGreaterThanOrEqual(0.75);
    expect(after).toBeGreaterThan(before);
  });

  it("corrects wrongly under 2% of words", () => {
    let words = 0;
    let wrong = 0;
    const wrongs: string[] = [];
    // Correct text must come back unchanged.
    for (const text of set.clean) {
      const r = correctText(text, dict);
      words += text.split(/\s+/).length;
      wrong += r.changes.length;
      wrongs.push(...r.changes.map((c) => `${c.from} → ${c.to}`));
    }
    // In mistyped text, a word typed right must stay right.
    for (const t of typos) {
      const typed = normalizeText(t.typed).split(" ");
      const meant = normalizeText(t.meant).split(" ");
      const got = normalizeText(correctText(t.typed, dict).corrected).split(" ");
      words += typed.length;
      if (typed.length !== meant.length || got.length !== meant.length) continue;
      typed.forEach((w, i) => {
        if (w === meant[i] && got[i] !== w) {
          wrong++;
          wrongs.push(`${w} → ${got[i]}`);
        }
      });
    }
    expect(wrong / words, wrongs.join(" | ")).toBeLessThan(0.02);
  });
});
