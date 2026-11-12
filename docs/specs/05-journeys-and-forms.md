# 05 Journeys and forms

Guided services: a sequence of steps that ask the visitor something, run an on-device model, ask the assistant, or save to the notebook.

## Journeys

| ID | Requirement | Status |
|---|---|---|
| JRN-1 | Journeys must be defined in YAML by the organisation, with the same step keys as clinux-core (`ask`/`fields`, `service`/`with`, `decide`, `next`, `final`/`result`), so they can move between the kiosk and Cübo. | Built |
| JRN-2 | A journey with an unknown step, service, condition or template must fail when the content is built, not while a visitor is using it. | Built |
| JRN-3 | Conditions and templates (`{{answers.step.field}}`) must use a small safe language; no code from content is ever evaluated. | Built |
| JRN-4 | The Services screen must list what the visitor can do, grouped by service, and open screens or journeys from it. | Built |
| JRN-5 | A running journey must show its progress, be stoppable, and end with a result the visitor can read aloud, copy, or start again. | Built |
| JRN-6 | Field types: text, textarea, select, boolean, number, date, language and notebook source. A field may have a description, keywords and an entity type (person, location, organisation, email, phone). | Built |

## Filling forms from what the visitor says

| ID | Requirement | Status |
|---|---|---|
| JRN-10 | On a form step, the visitor must be able to say or type their answers in their own words ("I'm Ravi from Chennai, I've had a bad cough for 3 days"), and the kiosk must fill in the fields it can. | Built |
| JRN-11 | Filled values are suggestions: each is marked with how it was found, the visitor checks them before continuing, and a value is never written over something the visitor typed. | Built |
| JRN-12 | A choice field must never take free text as its answer: when the words point at several options, the visitor picks one. | Built |
| JRN-13 | Values must be read, in order: from field labels used as keys ("temperature 38.5"); from patterns (dates, phone numbers, emails, option names); from named entities found by a local model (people, places, organisations); and by meaning, matching what was said against each field's description. | Built |
| JRN-14 | For required fields still empty, the visitor may ask the assistant to fill the rest. The model's answer must be constrained to the fields' types and options (a JSON schema, compiled to a grammar by local models), and checked again before it is shown. | Built |
| JRN-15 | The fields for that request are looked up by the server from the journey content; a client cannot send its own form. | Built |

## Journey summaries

| ID | Requirement | Status |
|---|---|---|
| JRN-20 | For each configured journey, the kiosk must be able to show a summary card: its title, what it does, its steps in order, what it asks for, which on-device models or assistant it uses, and whether anything leaves the device. The summary is generated from the journey definition, so it is always current. | Planned |
| JRN-21 | A summary of all journeys must be available on the Services screen and to the assistant (so "what can you do?" is answered from it, see CMD-2). | Planned |
| JRN-22 | After a journey finishes, the kiosk should be able to show a summary of the run: the steps completed, the answers given (as the visitor saw them) and the result, which the visitor can save to the notebook. | Planned |
| JRN-23 | With a profile open, the activity log records that a journey was completed (never its answers), and the profile page may show a count of journeys used. | Built (log); Planned (count) |
