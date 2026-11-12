// Deterministic safety checks that don't depend on the model. The prompts also ask the model to
// escalate; this makes sure a possible emergency reaches the moderators even if a small model
// forgets to call flag_for_moderation.

const EMERGENCY_PATTERNS: RegExp[] = [
  /\bchest (?:pain|tightness|pressure)\b/i,
  /\bheart attack\b/i,
  /\b(?:can(?:'|no)?t|cannot|difficulty|trouble|struggling to) breath(?:e|ing)\b/i,
  /\bshort(?:ness)? of breath\b/i,
  /\bstroke\b/i,
  /\b(?:face|arm|smile) (?:is )?droop/i,
  /\bslurred speech\b/i,
  /\bsuicid/i,
  /\b(?:kill|hurt|harm) (?:my ?self|myself)\b/i,
  /\bself[- ]harm/i,
  /\bend (?:my|it all)\b/i,
  /\boverdos/i,
  /\b(?:severe|heavy|uncontrolled|won'?t stop) bleeding\b/i,
  /\bbleeding (?:heavily|a lot|won'?t stop)\b/i,
  /\b(?:unconscious|passed out|not breathing|unresponsive)\b/i,
  /\bseizure\b/i,
  /\banaphyla/i,
];

/** True when the visitor's message describes a possible emergency. */
export function looksLikeEmergency(message: string): boolean {
  return EMERGENCY_PATTERNS.some((re) => re.test(message));
}

export const AUTO_ESCALATION_REASON = "Possible emergency (detected automatically)";
