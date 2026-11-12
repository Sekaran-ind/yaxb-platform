# 02 Conversation and answers

How a visitor asks, and what an answer must be.

## Asking

| ID | Requirement | Status |
|---|---|---|
| ANS-1 | A visitor must be able to ask by typing or by speaking, and must see the conversation as it happens: the question, the assistant's activity ("Searching the knowledge base", "Searching the web") and the answer. | Built |
| ANS-2 | Answers must stream as they are written, and must be read aloud when the visitor has voice output on (04). | Built |
| ANS-3 | A visitor must be able to stop an answer, start a new conversation, and reopen an earlier one from the notebook. | Built |
| ANS-4 | A conversation must continue: a follow-up question is answered in the light of what came before. | Built |

## Answer modes

Chosen in Settings → Knowledge, or suggested by the visitor's profile (06).

| ID | Requirement | Status |
|---|---|---|
| ANS-10 | **On this device only.** The kiosk must answer without any AI model: the closest curated answer, word for word, or the most relevant sentences quoted from a notebook source, with its reference; otherwise "not covered". Nothing about the question leaves the device, except an escalation (ANS-30). | Built |
| ANS-11 | **AI agent, grounded.** The AI model must answer only from passages it retrieved (knowledge base, notebook and, when allowed, the web), cite every source, and say when they don't cover the question. | Built |
| ANS-12 | **Automatic.** The kiosk must give the on-device curated answer when it matches confidently, and the grounded agent's answer otherwise. Without an AI provider it must behave as ANS-10. | Built |
| ANS-13 | The visitor must be able to see which mode answered: on-device answers are marked as such. | Built |

## What an answer must be

| ID | Requirement | Status |
|---|---|---|
| ANS-20 | An answer must state only what its sources say and attribute it ("The Code of Conduct Q&A says…"). | Built |
| ANS-21 | An answer must end with its sources, in the form `(sources: curated:qa-020; notebook:abc; web:1)`. A web source must also show its site and address, added by the kiosk itself, not left to the model. | Built |
| ANS-22 | An answer must not contain opinions, recommendations, value judgements or remarks of the kiosk's own. When a source says what to do, the answer reports it as what the source says. | Built |
| ANS-23 | When nothing covers the question, the answer must say so plainly and must not fill the gap from the model's general knowledge. | Built |
| ANS-24 | Answers must be in short, plain sentences suitable for reading aloud, without tables or heavy formatting. | Built |
| ANS-25 | Read-aloud must leave out the sources line. | Built |

Check: automated tests on prompts and citations; manual review of sample answers by a moderator, scored as in 07.

## Safety and escalation

| ID | Requirement | Status |
|---|---|---|
| ANS-30 | A message that may describe an emergency (chest pain, difficulty breathing, stroke signs, thoughts of self-harm, severe bleeding, unconsciousness, seizure, anaphylaxis) must get the emergency line first ("call your local emergency number or tell the nearest staff member") and must be escalated, in every answer mode, even if the model fails. | Built |
| ANS-31 | A curated answer marked *red flag* must be escalated when it is given, and the visitor told that a person will follow up. | Built |
| ANS-32 | A question the knowledge base simply doesn't cover must **not** be escalated: the visitor is told it isn't covered and that a staff member can help. | Built |
| ANS-33 | The assistant may escalate a request it declines or where sources conflict. | Built |
| ANS-34 | The kiosk must never ask for, or repeat, identifiers such as ID numbers, insurance numbers or full dates of birth, and must never state a phone number, address or opening time that no source gives. | Built |
| ANS-35 | A possible emergency must never be sent to a web search service. | Built |

Check: `looksLikeEmergency` and escalation tests; a demonstration of each mode with "I have chest pain".

## The AI agent

| ID | Requirement | Status |
|---|---|---|
| ANS-40 | The organisation chooses which AI providers and models may be used (an allowlist); only those with a configured key can be selected, and keys never reach the browser. | Built |
| ANS-41 | Two harnesses: a *deep agent* (planning, files, helpers, memory, skills) for capable models and a *lean agent* (kiosk tools only) for small local models; *Automatic* picks by model. | Built |
| ANS-42 | Helpers (subagents): a knowledge researcher and a safety reviewer, each switchable. The agent must not be able to start any helper that isn't declared. | Built |
| ANS-43 | The agent must never have a shell, file deletion or arbitrary web access; its file tools work only on the turn's virtual files. | Built |
| ANS-44 | A turn must have time and step limits, and must report a clear message when it times out or a provider fails, without losing the conversation so far. | Built |
