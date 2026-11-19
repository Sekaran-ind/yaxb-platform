// Reading the text in a photo on the device (MED-5): Tesseract.js (Apache-2.0), in English and the
// kiosk's language, so Tamil, Hindi, Telugu, Kannada, Malayalam and Bengali are read too (Florence-2
// reads Latin script only, and stays for describing a photo). The language data is fetched once from
// jsDelivr and kept by the browser; the photo never leaves the device.
import type { Worker as TesseractWorker } from "tesseract.js";

/** The kiosk's languages (NLLB codes) as Tesseract's. */
const TESSERACT: Record<string, string> = {
  eng_Latn: "eng",
  hin_Deva: "hin",
  tam_Taml: "tam",
  kan_Knda: "kan",
  tel_Telu: "tel",
  mal_Mlym: "mal",
  ben_Beng: "ben",
  fra_Latn: "fra",
  spa_Latn: "spa",
  deu_Latn: "deu",
  por_Latn: "por",
  arb_Arab: "ara",
  zho_Hans: "chi_sim",
  jpn_Jpan: "jpn",
};
/** The languages to read a photo in: English, and the kiosk's own when it is another. */
export const ocrLanguages = (kioskLanguage: string) => [...new Set(["eng", TESSERACT[kioskLanguage] ?? "eng"])];

const workers = new Map<string, Promise<TesseractWorker>>();
function workerFor(langs: string[]) {
  const key = langs.join("+");
  let w = workers.get(key);
  if (!w) {
    w = import("tesseract.js").then(({ createWorker }) => createWorker(langs));
    w.catch(() => workers.delete(key));
    workers.set(key, w);
  }
  return w;
}

/** The text in a photo, read on this device. */
export async function ocrImage(blob: Blob, kioskLanguage: string): Promise<string> {
  const worker = await workerFor(ocrLanguages(kioskLanguage));
  const { data } = await worker.recognize(blob);
  // Tesseract marks some Indic conjuncts with zero-width non-joiners: not part of what is written.
  return data.text.replace(/\u200c/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
