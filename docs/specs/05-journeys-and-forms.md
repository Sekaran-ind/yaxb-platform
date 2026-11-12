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
| JRN-20 | For each configured journey, the kiosk must be able to show a summary card: its title, what it does, its steps in order, what it asks for, which on-device models or assistant it uses, and whether anything leaves the device. The summary is generated from the journey definition, so it is always current. | Built |
| JRN-21 | A summary of all journeys must be available on the Services screen and to the assistant (so "what can you do?" is answered from it, see CMD-2). | Built |
| JRN-22 | After a journey finishes, the kiosk should be able to show a summary of the run: the steps completed, the answers given (as the visitor saw them) and the result, which the visitor can save to the notebook. | Built |
| JRN-23 | With a profile open, the activity log records that a journey was completed (never its answers), and the profile page may show a count of journeys used. | Built |

## Questionnaires and the journey studio

| ID | Requirement | Status |
|---|---|---|
| JRN-30 | Content has three levels: a service lists items, an item opens a journey, and a journey's question step may use a questionnaire (`questionnaire: <id>`) instead of listing its own fields. A questionnaire is its own YAML document with sections of fields, so several journeys can share one. | Built |
| JRN-31 | A question may be asked only when a condition holds (`when`), in the same safe language as journeys. It can read the same form's answers, earlier steps' answers and the context. A hidden question is never required, and its answer is kept empty. | Built |
| JRN-32 | Services, journeys and questionnaires must compile together from one YAML file of several documents, with references checked across them (an unknown journey, questionnaire, handler or screen is an error), and each problem pointing at the line it is about. Content nobody reaches is a warning. | Built |
| JRN-33 | The portal must offer a journey studio (`/studio`): an editor for that YAML, its problems, and a live preview that runs the journeys in the adaptive navigation at the kiosk's sizes (Mini, Pod, Full) and in each navigation mode, plus a tree from service to questionnaire. The draft stays in the browser. Services such as the assistant run as labelled stand-ins. | Built |
| JRN-34 | The journey engine and its components must be a package other projects can install (`@sekaran-ind/yaxb-journeys`): a headless core with no DOM, and Vue components with their own plain CSS that the host themes through variables. The kiosk uses the same engine. | Built |
| JRN-35 | The kiosk's own journey panel should show a questionnaire's sections as pages, as the studio does. It currently lists every question on one page. | Planned |

## The journey library and roles

| ID | Requirement | Status |
|---|---|---|
| LIB-1 | Staff must be able to keep several libraries, each holding services, journeys and questionnaires (one YAML document per entry). Libraries can be created, renamed, archived and restored; an archived library's content leaves the kiosk. | Built |
| LIB-2 | A service and a journey must be editable as a form, which writes the YAML, or as YAML directly; a questionnaire is written as YAML. Steps the form can't represent (one step that both asks and runs a service) stay editable as YAML. | Built |
| LIB-3 | Every save keeps a revision (who, when, an optional note); an earlier revision can be loaded and saved again. | Built |
| LIB-4 | An entry is checked against the rest of its library as it is edited (unknown questionnaires, journeys, roles, handlers or screens), and can't be submitted for review with errors. | Built |
| LIB-5 | An entry goes draft → in review → accepted or rejected (rejecting needs a note for the author). Saving takes it back to draft. | Built |
| LIB-6 | A reviewer can read the entry (form, YAML, a live preview, its history) and accept or reject it. Nobody reviews their own submission (the ADMIN_TOKEN holder excepted). Accepting is refused while it refers to something not yet published. | Built |
| LIB-7 | Archiving an entry takes it off the kiosk; restoring it brings it back as a draft, to be reviewed again. | Built |
| LIB-8 | The kiosk's Services screen must load what reviewers accepted, from active libraries, next to its built-in content. A new revision being edited doesn't change what the kiosk serves until it is accepted. | Built |
| LIB-9 | A service lists the roles that deliver it; a journey says which roles may start it (`visitor`: anyone at the kiosk) and which finish it. A journey's roles should take part in the services that open it (a warning otherwise). | Built |
| LIB-10 | Admin, Moderator and Reviewer are built-in roles; an administrator adds the organisation's own (id, name, description) and gives members several roles. A role in use by an entry or a member can't be removed. | Built |
| LIB-11 | The kiosk offers a journey only to those who may start it: visitors see journeys open to anyone; a signed-in member also sees journeys their roles may start. When a journey has roles that finish it, the result tells the visitor who takes it from there. | Built |
| LIB-12 | Handing a started journey over to the role that finishes it (a queue of runs for that role to complete, with what the visitor gave) is not built yet: it would send the visitor's answers to the server, which needs its own consent and privacy design. | Planned |
| LIB-13 | Every library change (libraries, entries, reviews, roles) goes into the audit log: who, what, when, never the content. | Built |

