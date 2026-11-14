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
| LIB-12 | A started journey is handed over to the roles that answer its later screens or finish it, as a case (LIB-33..38). | Built |
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
| LIB-30 | The agent is a Deep Agents agent with the kiosk's protections (no execute or delete, no subagents); models without tool calling get one direct reply, repaired the same way. What people write to it is data, never instructions. | Built |
| LIB-31 | The agent learns from reviews: when a service that started as its draft is accepted after people changed it, or rejected, a lesson records what changed and what the reviewer said. The newest 30 lessons are its memory for every draft. Administrators read, write and delete lessons (Catalogue → AI designer). | Built |
| LIB-32 | Drafting counts as a chat turn for the rate limit, and guests are also held to the form limit. It needs a configured AI model; without one the designer says so and the steps work as before. | Built |
| LIB-33 | A journey screen with questions may name the role that answers it (`role:`; absent: the person who started the journey). The designer offers it as "Who answers it". | Built |
| LIB-34 | When a catalogue journey in the kiosk reaches a screen the person at the kiosk doesn't answer, or ends with roles that finish it, it is handed over as a case: the run so far is stored, the visitor gets a reference (R-XXXXXX, shown and read out), and the case waits in the next role's work queue. Password answers are never stored. | Built |
| LIB-35 | The server decides where a case stands: it replays the stored answers and service results on the journey (kept with the case as it was when it started), so nobody can skip a screen, answer someone else's, or say who acts next. | Built |
| LIB-36 | Members find cases waiting for their roles under Services → Requests when they sign in, carry on from where it stopped, add notes to its thread, and close it (finishers) or decline it with a reason (the role whose turn it is, a finisher or an administrator). A visitor's cases are never listed, since kiosks are shared: they open theirs with the reference, see where it is, add notes, and answer their own later screens. Only its starter, members with a role the journey names, and administrators see a case. | Built |
| LIB-37 | Loading a catalogue service into a kiosk checks that the team has someone for every role it needs (starting, answering screens, finishing): signed in, invited only, or nobody. It warns before loading ("Load anyway") and on the loaded service. The published catalogue says yes, invited or no per role, never who or how many. | Built |
| LIB-38 | The preview has "View as": a visitor or each role. Journeys a role can't start are locked with who starts them; a journey that reaches another role's screen says it is handed over, and "Continue as" carries on as them. | Built |
| LIB-39 | The Service Designer is a conversation kept with the service: the first message of a new service describes it; every later message asks for a change to what is in the editor, and the agent changes it and keeps the rest. The thread is stored with the service (a new service's thread is linked when it is created). | Built |
| LIB-40 | The conversation works at every stage: drafts, services sent back (the reviewer's note goes to the agent), and services in review, where a reviewer gets suggestions that the author can put in the editor. A draft put in the editor can be undone. | Built |
| LIB-41 | A new service that isn't created yet is kept in the browser with its conversation until it is, so a reload loses nothing; "Start over" clears it. | Built |
| LIB-42 | Where requests are kept is a choice, devices first and the cloud last. Without the paid plan, no service data is stored in the cloud: a request lives on the devices that work on it, tied to its thread. Central storage in the cloud is offered only to subscribed deployments (CASES_CENTRAL). | Built |
| LIB-43 | A request is handed on straight to the device of an online member who may take it (the team's peer-to-peer channel), which checks it by replaying its answers and confirms it kept it. | Built |
| LIB-44 | When nobody who may take it is online, the request goes to the organisation's yaxb-box, which keeps it until someone with the role collects it; without a box, to the cloud relay, which is transient: it keeps the request only until it is collected or expires (48 hours by default, at most 7 days), then deletes it, and collecting it deletes it at once. | Built |
| LIB-45 | The sender keeps its copy and sees how far it got (delivered to whom, waiting until when, expired, or not sent). An expired or unsent request can be sent again. | Built |
| LIB-46 | Devices collect requests for their member, their roles and themselves from the box and the relay when Services opens and every minute. A visitor's later screens come back to the kiosk they started on. | Built |
| LIB-47 | Moderators see who holds which request and since when (a reference, titles, the role and the holder; never answers or notes), from the box or the relay, and reassign an idle one to a member with the role: the device with a copy sends it to them, and only they may carry on. A moderator reassigns without reading the request. | Built |
| LIB-48 | Every envelope is checked: the relay takes the sender from the session, never from the envelope, and only moderators may reassign; devices prove themselves to the relay with a secret only they hold. | Built |
| LIB-49 | The services added to the kiosk from the Service Catalogue are in the Notebook (load, remove, the roles they need), not the Services tab. | Built |
| LIB-50 | Journeys run in the conversation. The composer's + attaches files to the notebook and opens the context loader; /journeys slides up the journeys anyone can start, by service, and /staff the requests waiting for a signed-in member's roles and the staff-only journeys. Picking one runs it as a turn of the conversation; every other way to start a journey (Services, the notebook, a kiosk command) does the same. | Built |
| LIB-51 | A journey in the conversation is kept with it, like any turn: reopening the conversation from the Notebook carries on where it stopped, and one that was handed over shows as its request. | Built |
| LIB-52 | A request's reference is kept in the conversation: the hand-over adds it, and a reference typed in (or /request R-…) adds a card. Each shows where the request is now whenever the conversation is open, Opening it unfolds the whole request in the conversation (answers, thread, carrying on, closing): nothing sends anyone to another tab; Quick tools, /staff and links to a request open it here too. | Built |
| LIB-53 | Ask Me has the notebook's conversations as a drawer from the right: switch, start a new one, find one by title. | Built |
| LIB-54 | The kiosk's screens are Ask Me (the conversation), Quick tools (the built-in tools, For staff and requests) and My notebook (sources, memory, the services added from the catalogue, conversations). | Built |
| LIB-55 | The YAXB logo (the A with a person in an orbit, violet to magenta) is a traced SVG with PNGs and favicons from the same shape: the site's header and footer, the kiosk's player, the web app manifest, and the Android and iOS app icons and splash screens. | Built |
| LIB-56 | A form in the conversation has no "in your own words" box of its own: while it waits for answers, the conversation's message box (typed or spoken) fills it, as suggestions to check. "Ask a question instead" sends the next message to the assistant. | Built |
| LIB-57 | The kiosk is named "Anjal - Digital Kiosk (Your Own)". Sign in and Preferences sit beside Conversations in Ask Me. | Built |
| LIB-58 | The kiosk keeps one height whatever screen it shows: Mini from the phone's height, Pod from the tablet's, Full from the window's; screens scroll inside, and drawers open inside it. | Built |
| LIB-59 | The Service Catalogue has the same Ask Me (the conversation, its notebook, journeys and requests), and its Preferences (model, layout, theme, voice) open inside the catalogue, from Ask Me or the catalogue's player. | Built |
| PRF-1 | A device may hold several profiles, as a streaming app does: "Who's using Anjal?" shows each profile, Visitor (no profile) and Add a profile. A profile opens with its passphrase; when it locks (by hand or after 10 quiet minutes) the picker comes back. | Built |
| PRF-2 | Each profile has its own notebooks and conversations; without a profile, the device's. | Built |
| RST-1 | Restricted Mode turns the kiosk into a public front desk for chosen services. Only staff turn it on, with a PIN of 4 to 8 digits (kept as a hash). | Built |
| RST-2 | At the front desk visitors get Ask Me alone: the chosen services as tiles to start from, End session, and no profiles, conversations drawer, preferences, catalogue, Quick tools, notebook or site navigation (every address is the kiosk). The microphone and attaching files are each allowed or not. | Built |
| RST-3 | Each service added to the kiosk has its own notebook of documents and SOPs, which staff manage (My notebook → Services → Documents and SOPs). The front desk answers from the chosen services' documents, which visitors read and never change. | Built |
| RST-4 | A visit keeps nothing on the kiosk: its notebook and conversation live in session memory and nothing is saved on the server; End session, or a quiet spell (1 to 10 minutes), wipes it. What a visitor hands over goes to the service as a request with a reference. | Built |
| RST-5 | Staff leave the front desk with the PIN (a discreet lock button in Ask Me); a wrong PIN is refused. | Built |

