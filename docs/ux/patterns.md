# YAXB UX patterns

One way to do each thing. This is the source of truth for how information is presented, how people
move around, and which control fits which decision, across the portal, the kiosk, the Service
Catalogue and the yaxb-journeys components. The `ux-designer` agent keeps it current: every new or
changed pattern is recorded here in the same change.

People come first in this order: a **novice visitor** at a kiosk, a **first-time service designer**,
then **staff**.

## Words

| Thing | Say | Not |
|---|---|---|
| What a kiosk offers | service | entry, document, bundle |
| A guided flow in a service | journey | workflow, process |
| One page of a journey | screen | step (except in the designer's own steps), page |
| A field on a screen | question | field, slot |
| Who does what | role | permission, group |
| Where services are designed and published | Service catalogue | library (a library is a folder inside it) |
| The device people use | kiosk | app, terminal |

- Buttons are verbs that say what happens: "Submit for review", "Accept and publish", "Load", "Open in a kiosk".
- Use sentence case. Use no YAML or ids in a visitor's path.

## Frames

| Frame | Use | Where |
|---|---|---|
| Kiosk frame | The rounded frame: a dark side panel and the screens | One component, `components/site/KioskFrame.vue`, for the kiosk (`KioskShell.vue`: the player) and the Service Catalogue (`CataloguePage.vue`: `CataloguePlayer`) |
| Page section | Portal pages: a title, a subtitle and content | `components/site/PageSection.vue` |

The kiosk frame has three layouts, picked by `resolveLayout` from the width around the frame (the kiosk also lets the visitor choose one in Preferences; the catalogue always picks by width):

| Layout | Width | Panel | Screens | Height |
|---|---|---|---|---|
| Full | 1100px and up | A column beside the screens (22rem, 25rem from 1536px; 18rem while working) | All the rest of the window's width, up to 110rem | Fills the window under the navbar; the screens scroll inside, the panel and the screens' navigation stay put |
| Pod | 640 to 1100px | A strip above the screens | Up to 64rem | The page scrolls |
| Mini | under 640px | A small card above the screens | A phone's width (28rem) | The kiosk: one fixed height, scrolling inside (SET-18). The catalogue: the page scrolls |

- The side panel is always a player (below), `bg-console`, dark in every theme. It holds orientation (what this is, what is happening, who you are) and the main actions, never forms.

## Players

The panel of every kiosk frame is a player: one component, `components/site/ConsolePlayer.vue`, with one anatomy. The kiosk (`PlayerPanel`) and the catalogue (`CataloguePlayer`) fill its slots; a new surface in the frame does the same, never a card of its own.

| Part | What it is | Kiosk | Service Catalogue |
|---|---|---|---|
| `controls` | The one personal button, top right (in a strip or card: before the actions) | Profile and preferences (`ProfileButton`) | Staff sign in (a guest), or your initials to sign out (a member) |
| `orb` | The surface's mark, glowing | Sparkles (pulses while thinking) | Library while browsing; a pencil and ruler while designing |
| eyebrow | The surface's name | Yaxb AI Kiosk | YAXB Service Catalogue |
| status | "Now playing", live (`role="status"`), with a spinner while busy; short, so it fits the strip and the card | Ready when you are, Listening, Thinking… | Ready to design; the open service's name while designing; "Loading the catalogue" |
| `under-status` | Full only: a detail of the status | What the visitor is saying | The service's state and the designer's step ("Step 3 of 4: Journeys") |
| `body` | Full only: what fills the column | The voice bars | "Design once. Run on any kiosk." and how a service gets there (Design, Review, Load), or a hint while designing |
| `meta` | One quiet line that scrolls sideways only when it doesn't fit | The notebook and its sources | The counts ("2 published · 0 yours · 1 in review"); while designing, the state and step |
| `actions` | Round controls at the foot; the primary is the large brand circle, at most one | Pause, Ask by voice (primary), Stop | Open the kiosk, New service (primary) |
| `foot` | Full only: a note in words | Voice needs Chrome or Edge | Who you are (guest, or name and roles) |

- Variants follow the frame's layouts: `full` (a column), `strip` (Pod: a bar), `mini` (a small card). The strip and the card keep the orb, eyebrow, status, meta, controls and actions; the body and foot are full only.
- Round actions are icon buttons with an `aria-label` and `title`. A symbol everyone knows (microphone, pause, stop) needs no caption; any other gets a visible caption under it in the full player ("New service", "Open the kiosk").
- Counts are the player's meta line, not stat tiles.
- While someone is working (designing a service), the panel keeps only the essentials: the open item, the actions, who you are.
- Inside the frame, everything sizes by its container (`@container`, `@lg:`/`@2xl:`), never the window. Long reading (the conversation) keeps a reading width (`max-w-4xl`, centred) however wide the frame is.

## Navigation

### Which control for which purpose

| Intent | Pattern | Component |
|---|---|---|
| Sibling sections of one place | The adaptive nav. It only ever navigates; it never changes how anything is displayed | `yaxb-journeys/vue/AdaptiveNav.vue`, one component everywhere |
| A sequence to go through in order | Steps: a numbered step list that is also the progress and the way to jump, "Step n of N: name", and Previous/Next named after the neighbouring steps. The last step offers the real next action in Next's place, never a disabled Next | `ServiceDesigner.vue` (`.yj-steps`, `.yj-wizard-foot`, the `finish` slot) |
| A collection edited in place (journeys, screens, questions) | Master/detail: the list (add, reorder, remove) beside the chosen item's editor when there is room; narrow, the list, then into the item and back ("← Journeys"). Small items (a screen, a question) open in place in the list, one at a time | `ServiceDesigner` (journeys), `JourneyDesigner` (screens), `QuestionsEditor` (questions) |
| Into one item and back | A back link at the top left, named after where it goes: "← Catalogue", "← Services", "← Kiosk", "← Journeys" | Web: `btn-ghost` with `ArrowLeft`. Package: `.yj-back` with `Glyph name="back"` |
| Views of the same item, or of one list | A segmented control (`role="group"`, `aria-pressed`) | `components/site/SegmentedControl.vue` (web), `.yj-segment` (package). ServiceWorkspace (Design, YAML, Preview…), the moderation queue and answer reviews |
| Something shown beside the work, on or off | A toggle button with `aria-pressed` ("Show preview" / "Hide preview") | The designer's live preview |
| To another surface | A link with an icon: `ExternalLink` (another page) or a kiosk icon | "Open in a kiosk", "Open the kiosk", "Design a service in the catalogue →" |
| A journey's progress (visitor) | Chips for the screens done and the current one | `JourneyPanel.vue`, `JourneyRunner.vue` |

### The adaptive nav's modes

The mode is the host's choice, by purpose and by the nav's own width. The visitor never switches it: there is no "Display" menu in YAXB (`switchable` exists in the package for other hosts and the studio, and is off by default; `lockMode` is its old, now default, opposite).

| Purpose | Mode when wide (768px of nav and up) | Narrow (under 768px) | Where |
|---|---|---|---|
| A surface's screens | Tabs | Up to 4 screens: tabs that share the width. More: the section menu | The kiosk (Transcript, Services, Notebook, Sources), the catalogue (Catalogue, My services, Review, Roles, Libraries) |
| Many sections of settings (7 or more) | Sidebar | Section menu | Preferences |
| A few sub-sections inside one screen | Tabs, with the back link before them on the same row (`lead` slot) | Back link and the section menu on one row | Staff sections inside Services |
| The pages of one form | Tabs (with "Next: <page>" at the foot of each) | As above | `QuestionnaireForm` |
| Accordion, panes | Not used for navigation in YAXB. For optional detail inside a screen, use a disclosure (`details`, `.yj-details`) | | |

What each kiosk layout means for its screens: Full and Mini give the nav a fixed height (`fill`): the tabs stay put and only the screen scrolls. Pod lets the page scroll. Mini is always narrow, so its three screens are tabs sharing the width.

- The section menu is a button that names the current section with a chevron ("Answer quality ▾"), at least 40px tall. The three-dot icon (⋮) never navigates; it is kept for "more actions" only.
- Tabs follow the tablist pattern: one tab in the Tab order, arrow keys, Home and End move between them.
- The address keeps the place: `?screen=`, `?staff=`, `?view=`, `?service=`, `?prefs=`. Moving within a section keeps the other query keys; moving to a sibling section starts it afresh.
- Sibling sections don't link to each other from inside their panels: the adaptive nav is the way between them. Links inside a panel are for context only ("Review answers" in a sentence, a worst answer, "Share in team chat").
- A nav inside another nav's screen (staff inside Services) puts its way back on its own row (`lead`), so there is one header, not two.
- The adaptive nav takes the host's type and colour, so screens look the same inside it. The icons come from the host through `provideIcons` (the web provides `iconFor` once, in `main.ts`).
- The package's element resets are in the `yj-base` cascade layer, so a host's own classes always win inside its components.

### Exits: back and Done

- **Back** leaves a place you went into. Every such place has exactly one, a back link at the top left named after where it goes. Preferences, a journey, a staff section, a service in the catalogue, a journey in the designer (narrow) and an answer under review all use it.
- **Done** is not a way out; it is the last action of a flow that has an end: a journey's result ("Done" returns to Services). It sits in the action row, at the end, as the primary button. It never appears beside a back link in a header, and never where changes apply at once (Preferences has no Done).
- **Close** (an ✕) is only for something layered over the page: a dialog (`BaseModal`) or a call.

## Information

| Kind | Pattern |
|---|---|
| A collection of things | Cards in a container-sized grid (`@lg:grid-cols-2`, `@4xl:grid-cols-3`). A card shows the title, then one line of facts, then a summary, then its actions. |
| Facts about one thing | A definition list (`dl`): label, then value |
| Records over time | A table, newest first (Audit), or a list of disclosures (History) |
| State | A status chip with one word and one colour per state everywhere: Draft (mist), In review (info), Published (success), Rejected (danger), Archived (mist, muted). Component: `components/catalogue/EntryStatus.vue`. |
| Counts | Badges on nav items, stat tiles on summaries (`ServiceSummary`), and the player's meta line |
| Who does what | Role chips. For assignments, a role × journey table (`RolesPanel`). |
| Nothing yet | An empty state in `bg-mist` that says what to do next ("Nothing is published yet. Design a service and send it for review.") |

## Feedback

| Severity | Pattern |
|---|---|
| Guidance | Help text under the field (`.yj-help`, `text-xs text-gray-500`) |
| An action's result | A note with `role="status"` ("Saved as a new revision.", "Sent for review.") |
| An error | An alert box with `role="alert"` (`bg-danger/10 text-red-800`) that says what happened and how to fix it |
| A problem in content | A list of problems with the level, the line and the message. Clicking one goes to it. |
| A destructive action | An inline confirmation that names the thing ("Archive “Clinic visit”? It leaves the catalogue and every kiosk."): `ConfirmAction` from yaxb-journeys, everywhere (web and package). The button opens a panel in its place with the action (danger) and Cancel; focus moves to Cancel, Escape cancels and returns focus. `typeToConfirm` for what can't be undone and matters most (erasing a profile); `skip` when nothing would be lost. Never `window.confirm`. |
| Unavailable | Say why (sign in, the role needed, "Save first") instead of hiding the control. A disabled button gets a visible reason next to it (`aria-describedby`), not a tooltip. A hidden action gets a note: "Waiting for a reviewer. Your roles (Moderator, Curator) can't publish; ask an administrator for the Reviewer role.", "This is your own service: another reviewer publishes it.", "Only an administrator adds or removes organisation roles." |

## Controls

| Decision | Control |
|---|---|
| One of 2–5 visible options | Segmented control or radio group |
| One of about 6–15 options | Select |
| One of many or searchable options | Combobox with type-ahead (not built yet: use a select until it exists) |
| Several of a few | Checkbox chips (`RolePicker`) |
| On or off, applied at once | Switch. Inside a submitted form: checkbox. |
| A number | Number input with `inputmode="decimal"` and bounds |
| A date | Native date input |
| A secret (password, PIN) | `type: password`. Never prefilled, read aloud or shown in summaries. |
| Short or long text | Text input, or textarea for long answers |
| Ordering | Icon buttons (arrow up, arrow down; `.yj-btn-icon` with `Glyph`) labelled with `aria-label` and `title` ("Move Check in up"). Focus follows the moved item. Never text arrows. |
| Removing an item from a list | "Remove" through `ConfirmAction`, quiet and last in the row |
| Code (YAML) | `YamlEditor`: CodeMirror 6, loaded on demand (a textarea with a line gutter until then, or if it fails), YAML highlighting from the `--yj-*` tokens, line numbers, and the compiler's problems as lint marks on their lines with the message on hover (`problems` prop). Tab indents; Escape, then Tab, leaves. Never in a novice's main path: behind "Edit as YAML" or the YAML view. |
| The questions on a screen | `QuestionsEditor`: a list (add, open one to edit, reorder, remove) with the question, the answer type in plain words, "An answer is needed", choices one per line; the answer's name and "Ask only when" in a "More" disclosure. "Edit as YAML" for the rest. |
| Ids (service, journey, screen, answer) | Made from the name while nobody has set them, and kept under a "More" disclosure. Lists that refer to screens show their names, with the id in brackets. |
| A matrix | A table of selects with row and column headers (`RolesPanel`) |

- There is at most one primary button (`btn-primary` or `.yj-btn-primary`) per view, in the same place on every screen of a kind. In the designer, the steps' Next is the primary and the action bar's Save is secondary; on the last step the designer offers Save (or Submit for review) itself and the bar drops its copy.
- The designer's live preview (`FlowPreview` of the compiled design) sits beside the steps when the designer is at least 62rem wide, and is on there by default; narrower, "Show preview" puts it in the steps' place until "Hide preview" or a step is chosen.
- Secondary buttons go next to it; destructive actions are quiet and come last.
- Touch targets are at least 40px on phone layouts.

## Themes and sizes

- Use theme tokens only (see `CLAUDE.md`), and check every change in Classic, Calm, Warm, Night and High contrast.
- Check every change at 1440×900, 1024×768 and 390×844.
- Inside a frame, size by the container (`@container`), not the window.

## Known inconsistencies (to resolve)

- The notebook's New and Rename use the browser's `prompt()`. They should be inline forms, like the catalogue's New library.
- Settings that apply at once use a checkbox row (`ToggleRow`, "Read answers aloud") where the guide says switch.

## Decisions

- 2026-11: one adaptive nav (the package's) for the kiosk, Preferences, the catalogue and the staff sections; one segmented control; one confirmation (`ConfirmAction`); the designer's last step offers its real action; icon buttons for ordering; every hidden or disabled action says why.
- 2026-11 (review 2):
  - One frame (`KioskFrame`) and one layout model for the kiosk and the catalogue; Full fills a wide window, wide and tall.
  - The adaptive nav only navigates. No visitor-facing "Display" switch; the mode follows purpose and width (the table above). The section menu names the current section; ⋮ never navigates. Up to four screens stay visible as tabs when narrow.
  - Exits: one back link per place, Done only at the end of a flow. Preferences lost its Done; journeys lost Close (back link, and Done at the result).
  - The designer has four fixed steps; journeys, screens and questions are each edited in one place (master/detail, open-in-place lists); the preview is a pane beside the steps, not a step.
  - The YAML editor is CodeMirror 6, lazy-loaded (not Ace: see `docs/ux/kiosk-and-catalogue.md`).
  - The kiosk and the catalogue stay two surfaces (see `docs/ux/kiosk-and-catalogue.md`).
  - Both frame panels are players (`ConsolePlayer`): the catalogue's information card became `CataloguePlayer`, with the open service as "now playing", the counts as meta, and New service / Open the kiosk as the player's controls.
