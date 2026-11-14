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
| JRN-6 | Field types: text, textarea, password (masked; never filled from speech or by the model, and masked in summaries), select, boolean, number, date, language and notebook source. A field may have a description, keywords and an entity type (person, location, organisation, email, phone). | Built |

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
| JRN-33 | The portal must offer a journey studio (now the Service Catalogue, LIB-14): an editor for that YAML, its problems, and a live preview that runs the journeys in the adaptive navigation at the kiosk's sizes (Mini, Pod, Full) and in each navigation mode, plus a tree from service to questionnaire. The draft stays in the browser. Services such as the assistant run as labelled stand-ins. | Built |
| JRN-34 | The journey engine and its components must be a package other projects can install (`@sekaran-ind/yaxb-journeys`): a headless core with no DOM, and Vue components with their own plain CSS that the host themes through variables. The kiosk uses the same engine. | Built |
| JRN-35 | The kiosk's own journey panel should show a questionnaire's sections as pages, as the studio does. It currently lists every question on one page. | Planned |

## The Service Catalogue, the library and roles

| ID | Requirement | Status |
|---|---|---|
| LIB-1 | Staff must be able to keep several libraries, each holding services, journeys and questionnaires (one YAML document per entry). Libraries can be created, renamed, archived and restored; an archived library's content leaves the kiosk. | Built |
| LIB-2 | A service must be editable in a designer, which writes the YAML, or as YAML directly. The questions on a screen are written as YAML. Screens the designer can't represent (one that both asks and runs a service) stay editable as YAML. | Built |
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
| LIB-14 | The Service Catalogue must be its own page of the portal (`/catalogue`), outside the kiosk, linked from the home page and the navigation. | Built |
| LIB-15 | Services are nested: a service holds several journeys, and each journey holds its screens (questions, a service call, a decision, or an end). A service is one entry in the catalogue, standalone. | Built |
| LIB-16 | While designing, roles are added in a side panel and assigned to journeys (who starts, who finishes), as a role × journey matrix. A journey nobody is set to start is open to visitors. | Built |
| LIB-17 | Each service has a summary screen (journeys, screens, questions, who starts and finishes each, services called) and an audit screen (who did what, when, without content). | Built |
| LIB-18 | Anyone can design services without signing in. A guest's services belong to their browser session; only they (or editors) change them, and the number they may keep is capped. Publishing still needs a reviewer. | Built |
| LIB-19 | A kiosk keeps its built-in services and features (chat, notebook, sources, settings, the team), and can load published services from the catalogue. Journeys the viewer can't start show which role starts them; a member with that role who signs in can start them. | Built |
| LIB-20 | The roles a published service defines can be given to team members. | Built |
| LIB-21 | The kiosk's own guided services (such as Visits, with its check-in journey) live in the Service Catalogue, seeded once and published; they are not built-in services. Editing or archiving a seeded service sticks. | Built |
| LIB-22 | Designing a service is four steps (Service, Roles, Journeys, Review) with a numbered step list and Previous / Next. Each object is edited in one place: journeys as a list beside the chosen journey (narrow: the list, then into one and back), its screens and their questions as lists that open in place, with add, reorder and remove. Review compiles the design and offers the real next action. | Built |
| LIB-24 | Questions are edited as a list in plain words (the question, the answer type, needed or not, the choices), with YAML only behind "Edit as YAML". Ids follow names until someone sets them. | Built |
| LIB-25 | A live preview of the design (as a visitor sees it, journeys runnable) sits beside the steps when there is room, or replaces them while shown when there isn't. | Built |
| LIB-26 | The YAML editor highlights YAML, numbers lines, marks problems on their lines with the message, works by touch, and loads only when opened (CodeMirror 6). | Built |
| LIB-23 | The Service Catalogue looks like a kiosk: the kiosk's frame and layouts (Full, Pod, Mini), with its own player where the kiosk has its player (the same component and anatomy: the open service as "now playing", the counts, sign-in, New service and Open the kiosk), and the catalogue's sections as kiosk screens. It stays a separate surface from the kiosk (docs/ux/kiosk-and-catalogue.md). | Built |
| LIB-27 | A new service may start from a description in the designer's own words ("Describe it"): the Service Designer agent drafts the whole service, which opens in the designer to check and change. It is only a draft: the author creates it and a reviewer publishes it as usual. | Built |
| LIB-28 | The agent is shown worked examples (a narrative and the service it became): the closest of the built-in examples (content/designer, several industries) and of the published catalogue, with at least one built-in example. It may ask for more. | Built |
| LIB-29 | Every draft is checked with the catalogue's own compiler, plus checks for mistakes the compiler allows (a question's `when` reading its own screen's answers, template blocks such as {{#if}}). A draft with errors goes back to the agent, a few times at most; one that still has errors opens with them listed. | Built |
| LIB-30 | The agent is a Deep Agents agent with the kiosk's protections (no execute or delete, no subagents); models without tool calling get one direct reply, repaired the same way. The description is data, never instructions, and is not stored; only the draft is. | Built |
| LIB-31 | The agent learns from reviews: when a service that started as its draft is accepted after people changed it, or rejected, a lesson records what changed and what the reviewer said. The newest 30 lessons are its memory for every draft. Administrators read, write and delete lessons (Catalogue → AI designer). | Built |
| LIB-32 | Drafting counts as a chat turn for the rate limit, and guests are also held to the form limit. It needs a configured AI model; without one the designer says so and the steps work as before. | Built |

