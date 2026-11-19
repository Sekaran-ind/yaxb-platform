// Spell check on this device (yaxb-core spell, SPL-1..7). The dictionary is the kiosk's own words
// plus this tenant's: the notebook in use and the catalogue services loaded on the kiosk (SPL-4). It
// is rebuilt only when those change. Nothing is sent anywhere; spoken words never come here.
import { correctText, extendDictionary, kioskSpellDictionary, ownWords, serviceTexts, type SpellDictionary, type SpellResult } from "@sekaran-ind/yaxb-core/spell";
import type { NotebookRecord } from "./store";

let cached: { key: string; dict: SpellDictionary } | null = null;

/** Drop the dictionary built from a visit's notebook (a front desk session ended, STO-3). */
export function forgetSpelling() {
  cached = null;
}

function dictionaryFor(notebook: NotebookRecord | null | undefined, services: readonly { entry_id: string; yaml: string }[]): SpellDictionary {
  const key = [notebook ? `${notebook.id}@${notebook.updatedAt}` : "", ...services.map((s) => s.entry_id)].join("|");
  if (cached?.key === key) return cached.dict;
  const texts = [...(notebook?.sources ?? []).flatMap((s) => [s.title, s.text]), ...services.flatMap((s) => serviceTexts(s.yaml))];
  const dict = texts.length ? extendDictionary(kioskSpellDictionary(), ownWords(texts)) : kioskSpellDictionary();
  cached = { key, dict };
  return dict;
}

/** The typed text with its likely typing mistakes corrected; `corrected` is null when nothing changed. */
export function checkSpelling(
  text: string,
  { notebook, services = [], protect = [] }: { notebook?: NotebookRecord | null; services?: readonly { entry_id: string; yaml: string }[]; protect?: readonly string[] } = {},
): SpellResult & { changed: string | null } {
  try {
    const r = correctText(text, dictionaryFor(notebook, services), { protect });
    return { ...r, changed: r.changes.length ? r.corrected : null };
  } catch {
    return { original: text, text, corrected: text, changes: [], changed: null };
  }
}
