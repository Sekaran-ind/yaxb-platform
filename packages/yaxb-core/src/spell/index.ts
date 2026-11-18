// Spell check for typed words (docs/specs/13-foundations.md, SPL-1..7 and SPL-10).
//
// Kiosk visitors type quickly, on touch screens, in several scripts. Before typed text is matched
// (commands, the on-device knowledge search, slot filling) it is normalised (SPL-1) and a corrected
// copy is made by SymSpell-style lookup over grapheme clusters (SPL-2), against a dictionary of the
// kiosk's own words with a general word list weighted lower (SPL-4). The caller matches both the
// original and the corrected text and keeps the better (SPL-3); `chooseSpelling` says whether to
// act on the correction, offer it, or ignore it (SPL-6). The original is never overwritten.
//
// What is never corrected (SPL-5): numbers, money, phone numbers, email and web addresses, ids,
// names (capitalised mid-sentence, or passed in from the NER model), and anything the caller
// protects. Password fields and spoken input never reach this module.
import { KIOSK_COMMANDS, type KioskCommand } from "../commands/index.js";
import { kioskContent } from "../content/index.js";
import curatedJson from "../data/curated_qa.json" with { type: "json" };
import { GENERAL_WORDS } from "./general.js";

// ---- SPL-1: normalising ---------------------------------------------------------------------------------

/** The first code point of each block's digits 0..9: Arabic-Indic, Extended Arabic-Indic and the Indian scripts. */
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66];

function asciiDigit(ch: string): string {
  const cp = ch.codePointAt(0)!;
  for (const zero of DIGIT_ZEROS) if (cp >= zero && cp <= zero + 9) return String(cp - zero);
  return ch;
}

/**
 * NFC, one space between words (zero-width spaces and the BOM dropped; the joiners ZWJ and ZWNJ
 * kept, since Indian scripts need them), and Indian-script digits as ASCII digits.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[​﻿⁠]/g, "")
    .replace(/[٠-٩۰-۹०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯]/g, asciiDigit)
    .replace(/\s+/g, " ")
    .trim();
}

// ---- SPL-2: graphemes and edit distance -------------------------------------------------------------------

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/** A word's letters as a person sees them: a Tamil or Hindi consonant with its vowel sign is one. */
export function graphemes(word: string): string[] {
  return [...graphemeSegmenter.segment(word)].map((s) => s.segment);
}

/** Edit distance with adjacent swaps (optimal string alignment), over graphemes. */
export function editDistance(a: readonly string[], b: readonly string[]): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++)
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  return d[a.length]![b.length]!;
}

/** The writing system of a word, so a word is only ever corrected to one in the same script. */
export function scriptOf(word: string): string {
  for (const [name, re] of SCRIPTS) if (re.test(word)) return name;
  return "other";
}
const SCRIPTS: [string, RegExp][] = [
  ["latin", /\p{Script=Latin}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
  ["tamil", /\p{Script=Tamil}/u],
  ["telugu", /\p{Script=Telugu}/u],
  ["kannada", /\p{Script=Kannada}/u],
  ["malayalam", /\p{Script=Malayalam}/u],
  ["bengali", /\p{Script=Bengali}/u],
  ["arabic", /\p{Script=Arabic}/u],
];

/**
 * How far a word may be from its correction. Short words are left alone (too many near
 * neighbours); Indian-script words count fewer graphemes for the same length, so their steps are lower.
 */
export function maxDistanceFor(word: string): number {
  const n = graphemes(word).length;
  if (scriptOf(word) === "latin") return n < 4 ? 0 : n < 8 ? 1 : 2;
  return n < 2 ? 0 : n < 5 ? 1 : 2;
}

// ---- SPL-4: the dictionary -------------------------------------------------------------------------------

/** The kiosk's (or a tenant's) own words with how often they appear, and the word pairs its texts use. */
export type OwnWords = { counts: ReadonlyMap<string, number>; pairs: ReadonlySet<string> };

/**
 * Corrections only land on the kiosk's own words: those are what commands, search and forms match
 * against. The general word list only says which words are real, so they are left alone.
 */
export type SpellDictionary = {
  readonly own: OwnWords;
  readonly general: ReadonlySet<string>;
  /** Grapheme deletions (up to 2) of the own words → those words: SymSpell's index. */
  readonly index: ReadonlyMap<string, readonly string[]>;
};

const SEP = "\u0001";

function deletes(g: readonly string[], depth: number, out: Set<string>) {
  if (depth === 0 || g.length <= 1) return;
  for (let i = 0; i < g.length; i++) {
    const shorter = [...g.slice(0, i), ...g.slice(i + 1)];
    const key = shorter.join(SEP);
    if (out.has(key)) continue;
    out.add(key);
    deletes(shorter, depth - 1, out);
  }
}

/** The lower-case word tokens of a text, in order (letters only: no numbers or punctuation). */
export function wordsOf(text: string): string[] {
  const out: string[] = [];
  for (const s of wordSegmenter.segment(normalizeText(text).toLowerCase())) if (s.isWordLike && !/\d/.test(s.segment)) out.push(s.segment);
  return out;
}

/** The words of some texts, counted, and the pairs of neighbouring words ("check in"). */
export function ownWords(texts: Iterable<string>): OwnWords {
  const counts = new Map<string, number>();
  const pairs = new Set<string>();
  for (const t of texts) {
    const w = wordsOf(t);
    w.forEach((x, i) => {
      counts.set(x, (counts.get(x) ?? 0) + 1);
      if (i) pairs.add(`${w[i - 1]} ${x}`);
    });
  }
  return { counts, pairs };
}

/** A dictionary from own words (one-letter words left out: they only add wrong corrections) and the general list. */
export function buildDictionary(own: OwnWords, { general = GENERAL_WORDS }: { general?: Iterable<string> } = {}): SpellDictionary {
  const index = new Map<string, string[]>();
  const add = (key: string, w: string) => {
    const list = index.get(key);
    if (list) list.push(w);
    else index.set(key, [w]);
  };
  for (const w of own.counts.keys()) {
    const g = graphemes(w);
    if (g.length < 2) continue;
    add(g.join(SEP), w);
    const keys = new Set<string>();
    deletes(g, maxDistanceFor(w), keys);
    for (const k of keys) add(k, w);
  }
  return { own, general: general instanceof Set ? general : new Set(general), index };
}

/** Adds a tenant's words (its notebooks, its services) to the kiosk's: a new dictionary, the old one untouched. */
export function extendDictionary(base: SpellDictionary, more: OwnWords): SpellDictionary {
  if (!more.counts.size) return base;
  const counts = new Map(base.own.counts);
  for (const [w, n] of more.counts) counts.set(w, (counts.get(w) ?? 0) + n);
  return buildDictionary({ counts, pairs: new Set([...base.own.pairs, ...more.pairs]) }, { general: base.general });
}

/** The forms an English word may come from: "moved" → move, "skipping" → skip, "cities" → city. */
function stems(w: string): string[] {
  const out: string[] = [];
  const strip = (suffix: string, ...ends: string[]) => {
    if (w.length <= suffix.length + 2 || !w.endsWith(suffix)) return;
    const base = w.slice(0, -suffix.length);
    out.push(base, ...ends.map((e) => base + e));
    if (/([b-df-hj-np-tv-z])\1$/.test(base)) out.push(base.slice(0, -1)); // stopped, skipping
  };
  for (const [suffix, ...ends] of STEM_RULES) strip(suffix!, ...ends);
  return out;
}
const STEM_RULES: string[][] = [["'s"], ["’s"], ["s"], ["es"], ["ies", "y"], ["ed", "e"], ["ied", "y"], ["ing", "e"], ["er", "e"], ["ers", "e"], ["est", "e"], ["ly"], ["ily", "y"], ["ness"], ["ment"], ["ments"]];

/** True when the word is known: an own or general word, an English form of one, or (Indian scripts) one with a short suffix. */
export function isKnown(word: string, dict: SpellDictionary): boolean {
  const w = word.toLowerCase();
  const has = (x: string) => dict.own.counts.has(x) || dict.general.has(x);
  if (has(w)) return true;
  if (scriptOf(w) === "latin") return stems(w).some(has);
  // Tamil and the other Indian languages join suffixes to words (மூடு → மூடும்): a known word of
  // two or more letters followed by up to two more.
  const g = graphemes(w);
  for (let i = g.length - 1; i >= Math.max(2, g.length - 2); i--) if (has(g.slice(0, i).join(""))) return true;
  return false;
}

// The texts of the kiosk's own content (SPL-4): every string in its services, journeys, screens,
// fields and options, apart from ids, handler names, templates and conditions.
const SKIP_KEYS = new Set(["id", "icon", "component", "service", "when", "next", "with", "pattern", "entity", "yaml", "type", "kind", "role", "roles", "screen", "staff", "after", "flow", "outcome", "date", "time", "version", "_comment", "body"]);

function stringsOf(value: unknown, out: string[], key = ""): void {
  if (SKIP_KEYS.has(key)) return;
  if (typeof value === "string") {
    if (!value.includes("{{")) out.push(value);
  } else if (Array.isArray(value)) for (const v of value) stringsOf(v, out, key === "options" || key === "keywords" || key === "examples" ? "" : key);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) stringsOf(v, out, k);
}

/** The kiosk's own texts: content, curated Q&A and command examples (the core's part of SPL-4). */
export function kioskTexts(commands: readonly KioskCommand[] = KIOSK_COMMANDS): string[] {
  const out: string[] = [];
  stringsOf({ services: kioskContent.services, journeys: kioskContent.journeys, questionnaires: kioskContent.questionnaires, screens: kioskContent.screens, catalogue: kioskContent.catalogue }, out);
  for (const q of curatedJson as { question: string; answer: string }[]) out.push(q.question, q.answer);
  for (const c of commands) out.push(c.label, ...c.examples);
  return out;
}

let kioskDictionary: SpellDictionary | null = null;

/** The kiosk's own dictionary, built once on first use. */
export function kioskSpellDictionary(): SpellDictionary {
  return (kioskDictionary ??= buildDictionary(ownWords(kioskTexts())));
}

/** The words a tenant's catalogue service carries, from its YAML text: titles, questions, options, roles. */
export function serviceTexts(yaml: string): string[] {
  const out: string[] = [];
  for (const m of yaml.matchAll(/^\s*-?\s*(?:title|label|description|name|question|summary|text|options|keywords|agree|points)\s*:\s*(.+)$/gm)) {
    const v = m[1]!.trim();
    if (!v.includes("{{")) out.push(v.replace(/^["'[]|["'\]]$/g, ""));
  }
  return out;
}

// ---- correcting -------------------------------------------------------------------------------------------

export type SpellChange = { from: string; to: string; distance: number; kind: "edit" | "split" | "join" };

export type SpellResult = {
  /** What the person typed, untouched. */
  original: string;
  /** The same text normalised (SPL-1): this is what matching uses when nothing is corrected. */
  text: string;
  /** The corrected text; the same as `text` when there were no changes. */
  corrected: string;
  changes: SpellChange[];
};

const PROTECTED_SPANS = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/g, // email addresses
  /\b(?:https?:\/\/|www\.)\S+/gi, // web addresses
  /\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|in|io|ai|cc|gov|edu|co|uk|info)(?:\/\S*)?/gi, // bare domains
  /(?:[₹$€£]|\brs\.?|\binr\b|\busd\b)\s?\d[\d,.]*/gi, // money
  /\+?\d[\d\s().-]{6,}\d/g, // phone numbers
];

function protectedRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const re of PROTECTED_SPANS) for (const m of text.matchAll(re)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

/** The kiosk's own word closest to `word`, or null when there is none, or no clear one. */
export function suggestWord(word: string, dict: SpellDictionary): { word: string; distance: number } | null {
  const lower = word.toLowerCase();
  if (isKnown(lower, dict)) return null;
  const max = maxDistanceFor(lower);
  if (!max) return null;
  const g = graphemes(lower);
  const script = scriptOf(lower);
  const keys = new Set<string>([g.join(SEP)]);
  deletes(g, max, keys);
  const found: { word: string; distance: number; weight: number }[] = [];
  const seen = new Set<string>();
  for (const k of keys)
    for (const w of dict.index.get(k) ?? []) {
      if (seen.has(w)) continue;
      seen.add(w);
      if (scriptOf(w) !== script) continue;
      const distance = editDistance(g, graphemes(w));
      if (distance <= max) found.push({ word: w, distance, weight: dict.own.counts.get(w)! });
    }
  found.sort((a, b) => a.distance - b.distance || b.weight - a.weight);
  const [best, second] = found;
  if (!best) return null;
  // Two about equally likely corrections: guessing would often be wrong, so make none.
  if (second && second.distance === best.distance && second.weight * 2 > best.weight) return null;
  return { word: best.word, distance: best.distance };
}

/** An unknown word that is two of the kiosk's words run together, as its texts use them ("checkin" → "check in"). */
function splitWord(word: string, dict: SpellDictionary): [string, string] | null {
  const g = graphemes(word.toLowerCase());
  for (let i = 2; i <= g.length - 2; i++) {
    const a = g.slice(0, i).join("");
    const b = g.slice(i).join("");
    if (dict.own.pairs.has(`${a} ${b}`)) return [a, b];
  }
  return null;
}

/** The case of the word typed, carried over to its correction. */
function withCase(typed: string, word: string): string {
  if (typed === typed.toUpperCase() && typed !== typed.toLowerCase()) return word.toUpperCase();
  if (typed[0] && typed[0] !== typed[0].toLowerCase()) return word[0]!.toUpperCase() + word.slice(1);
  return word;
}

type Token = { text: string; start: number; end: number; word: boolean };

/**
 * The text with its likely typing mistakes corrected (SPL-2), and what changed. `protect` holds
 * words never to touch, such as the names the NER model found (SPL-5).
 */
export function correctText(original: string, dict: SpellDictionary, { protect = [] }: { protect?: readonly string[] } = {}): SpellResult {
  const text = normalizeText(original);
  const ranges = protectedRanges(text);
  const kept = new Set(protect.map((p) => p.toLowerCase()));
  const tokens: Token[] = [...wordSegmenter.segment(text)].map((s) => ({ text: s.segment, start: s.index, end: s.index + s.segment.length, word: Boolean(s.isWordLike) }));
  let sentenceStart = true;
  const fixed = (t: Token, i: number): boolean => {
    const w = t.text;
    if (/\d/.test(w) || /_/.test(w)) return true; // numbers, ids
    if (ranges.some(([a, b]) => t.start < b && t.end > a)) return true;
    if (kept.has(w.toLowerCase())) return true;
    if (scriptOf(w) === "latin") {
      if (w.length > 1 && w === w.toUpperCase()) return true; // acronyms and codes
      if (!sentenceStart && /^\p{Lu}/u.test(w)) return true; // a name, mid-sentence
    }
    // A word joined to its neighbours by a dot, @, slash or hyphen is part of something bigger.
    const before = tokens[i - 1]?.text ?? "";
    const after = tokens[i + 1]?.text ?? "";
    return /^[./@:\\-]$/.test(before) || /^[./@:\\-]$/.test(after) || /^['’]$/.test(after);
  };

  const out: string[] = [];
  const changes: SpellChange[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t.word) {
      out.push(t.text);
      if (/[.!?।]/.test(t.text)) sentenceStart = true;
      continue;
    }
    const lower = t.text.toLowerCase();
    if (fixed(t, i)) {
      out.push(t.text);
      sentenceStart = false;
      continue;
    }
    // Joined: two typed words that are one known word, when one of them alone is unknown.
    const next = tokens[i + 2];
    if (tokens[i + 1]?.text === " " && next?.word && !fixed(next, i + 2)) {
      const joined = lower + next.text.toLowerCase();
      if (dict.own.counts.has(joined) && (!isKnown(lower, dict) || !isKnown(next.text, dict))) {
        const to = withCase(t.text, joined);
        changes.push({ from: `${t.text} ${next.text}`, to, distance: 1, kind: "join" });
        out.push(to);
        i += 2;
        sentenceStart = false;
        continue;
      }
    }
    if (!isKnown(lower, dict)) {
      const split = splitWord(lower, dict);
      if (split) {
        const to = `${withCase(t.text, split[0])} ${split[1]}`;
        changes.push({ from: t.text, to, distance: 1, kind: "split" });
        out.push(to);
        sentenceStart = false;
        continue;
      }
      const s = suggestWord(lower, dict);
      if (s) {
        const to = withCase(t.text, s.word);
        changes.push({ from: t.text, to, distance: s.distance, kind: "edit" });
        out.push(to);
        sentenceStart = false;
        continue;
      }
    }
    out.push(t.text);
    sentenceStart = false;
  }
  return { original, text, corrected: changes.length ? out.join("") : text, changes };
}

// ---- SPL-3 and SPL-6: which text to act on ----------------------------------------------------------------

export type SpellChoice = {
  /** The text whose match is used. */
  use: "original" | "corrected";
  /**
   * acted: the correction found a strong match the original didn't, so it is used and the person
   * is told ("Showing results for …"). suggest: neither is strong; offer "Did you mean …" and do nothing.
   */
  notice: "acted" | "suggest" | null;
};

/**
 * Picks between the original's and the correction's best match scores (null: no match). The
 * original wins ties, and a correction is only acted on when it turns a weak match into a strong one.
 */
export function chooseSpelling(original: number | null, corrected: number | null, { strong }: { strong: number }): SpellChoice {
  const o = original ?? -Infinity;
  const c = corrected ?? -Infinity;
  if (c >= strong && c > o) return { use: "corrected", notice: "acted" };
  if (o >= strong) return { use: "original", notice: null };
  return { use: "original", notice: corrected !== null && c > o ? "suggest" : null };
}

/** The hint the AI agent gets with the original words (SPL-7). Empty when nothing was corrected. */
export function spellingHint(corrected: string | undefined | null, message: string): string {
  if (!corrected || normalizeText(corrected) === normalizeText(message)) return "";
  return `\n\n[The kiosk's spell check suggests the visitor may have meant: "${corrected.replace(/"/g, "'")}". The words above are what they typed; use this only to understand them.]`;
}
