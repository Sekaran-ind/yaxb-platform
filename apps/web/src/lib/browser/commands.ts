// Recognising the kiosk's own commands (yaxb-core commands, CMD-1..6) on this device: with the
// visitor's sentence-transformer once it has loaded, by words before that. Nothing is sent anywhere.
import { allCommands, COMMAND_THRESHOLDS, matchCommand, type CommandMatch } from "@sekaran-ind/yaxb-core/commands";
import { kioskContent } from "@sekaran-ind/yaxb-core/content";
import type { Embed, EmbeddingModelId } from "@sekaran-ind/yaxb-core/knowledge/semantic";
import type { AgentSettings } from "@sekaran-ind/yaxb-core/settings";
import { embedTexts } from "./offline";
import { modelFor, semanticReady } from "./semantic";

const commands = allCommands(kioskContent.journeys);
// One embed function per model, so the core caches the catalogue's vectors once.
const embeds = new Map<EmbeddingModelId, Embed>();
const embedFor = (model: EmbeddingModelId) => {
  let e = embeds.get(model);
  if (!e) embeds.set(model, (e = (texts) => embedTexts(model, texts)));
  return e;
};

/** The command the visitor's words ask for, or null for an ordinary question. */
export async function recognizeCommand(text: string, settings: Pick<AgentSettings, "knowledge" | "language">): Promise<CommandMatch | null> {
  const model = modelFor(settings, text);
  try {
    if (semanticReady(model)) return await matchCommand(text, { commands, embed: embedFor(model), thresholds: COMMAND_THRESHOLDS[model] });
  } catch {
    /* fall through to words */
  }
  return matchCommand(text, { commands });
}

const YES = /^(yes|yeah|yep|ok(ay)?|sure|please do|do it|confirm|ஆம்|சரி|हाँ|हां|ठीक है|sí|si|oui|ja|sim|نعم|是|はい)[.!]?$/i;
const NO = /^(no|nope|cancel|don'?t|stop|never mind|இல்லை|வேண்டாம்|नहीं|ना|non|nein|não|لا|不|いいえ)[.!]?$/i;

/** "yes" / "no" (in the kiosk's languages) answering a pending confirmation, or null. */
export function yesOrNo(text: string): "yes" | "no" | null {
  const t = text.trim();
  return YES.test(t) ? "yes" : NO.test(t) ? "no" : null;
}
