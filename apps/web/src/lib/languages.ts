// Languages a visitor can choose (yaxb-core's list: NLLB-200 codes, speech locales, names).
import { LANGUAGES } from "@sekaran-ind/yaxb-core/settings";

export { LANGUAGES };
export const speechLangFor = (code: string) => LANGUAGES.find((l) => l.code === code)?.speech ?? "en-US";
export const languageLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;
