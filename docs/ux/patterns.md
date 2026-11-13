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
| Kiosk frame | The rounded frame: a dark side panel and the screens in the adaptive nav | The kiosk (`KioskShell.vue`: the player on the left), and the Service Catalogue (`CataloguePage.vue`: `CatalogueInfo` on the left) |
| Page section | Portal pages: a title, a subtitle and content | `components/site/PageSection.vue` |

- The side panel is always `bg-console` (dark in every theme). It holds orientation (what this is, where you are, who you are) and the main actions, never forms.
- On narrow screens the panel stacks above the screens. While someone is working (for example, designing a service), it shrinks to the essentials.

## Navigation

| Intent | Pattern | Component |
|---|---|---|
| Sibling sections of one place | Adaptive nav: tabs, sidebar or accordion, collapsing to a section menu below 768px | One component everywhere: `yaxb-journeys/vue/AdaptiveNav.vue` (`.yj`). The kiosk's screens, Preferences (sidebar), the catalogue, and the staff sections (tabs, `lockMode`) |
| A sequence to go through in order | Steps: a breadcrumb (where this step sits), "Step n of N" with a picker, a progress bar, and Previous/Next named after the neighbouring steps. The last step offers the real next action in Next's place, never a disabled Next | `ServiceDesigner.vue` (`.yj-wizard`, `.yj-crumbs`, `.yj-progress`; the `finish` slot) |
| Into one item and back | A back link at the top left: "← Catalogue", "← Services", "← Library" | `btn-ghost` with `ArrowLeft` |
| Views of the same item, or of one list | A segmented control (`role="group"`, `aria-pressed`) | `components/site/SegmentedControl.vue` (web), `.yj-segment` (package). ServiceWorkspace (Design, YAML, Preview…), the moderation queue and answer reviews (Open, Handled, All) |
| To another surface | A link with an icon: `ExternalLink` (another page) or a kiosk icon | "Open in a kiosk", "Open the kiosk" |
| A journey's progress (visitor) | Chips for the screens done and the current one | `JourneyPanel.vue`, `JourneyRunner.vue` |

- The address keeps the place: `?screen=`, `?staff=`, `?view=`, `?service=`. Moving within a section keeps the other query keys; moving to a sibling section starts it afresh.
- Sibling sections don't link to each other from inside their panels: the adaptive nav is the way between them. Links inside a panel are for context only ("Review answers" in a sentence, a worst answer, "Share in team chat").
- The adaptive nav takes the host's type and colour, so screens look the same inside it. The icons come from the host through `provideIcons` (the web provides `iconFor` once, in `main.ts`).
- The package's element resets are in the `yj-base` cascade layer, so a host's own classes always win inside its components.

## Information

| Kind | Pattern |
|---|---|
| A collection of things | Cards in a container-sized grid (`@lg:grid-cols-2`, `@4xl:grid-cols-3`). A card shows the title, then one line of facts, then a summary, then its actions. |
| Facts about one thing | A definition list (`dl`): label, then value |
| Records over time | A table, newest first (Audit), or a list of disclosures (History) |
| State | A status chip with one word and one colour per state everywhere: Draft (mist), In review (info), Published (success), Rejected (danger), Archived (mist, muted). Component: `components/catalogue/EntryStatus.vue`. |
| Counts | Badges on nav items and stat tiles on summaries (`ServiceSummary`, `CatalogueInfo`) |
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
| Code (YAML) | `YamlEditor`: line numbers and problem marks. Tab indents; Escape, then Tab, leaves. |
| A matrix | A table of selects with row and column headers (`RolesPanel`) |

- There is at most one primary button (`btn-primary` or `.yj-btn-primary`) per view, in the same place on every screen of a kind. In the designer, the steps' Next is the primary and the action bar's Save is secondary; on the last step the designer offers Save (or Submit for review) itself and the bar drops its copy.
- Secondary buttons go next to it; destructive actions are quiet and come last.
- Touch targets are at least 40px on phone layouts.

## Themes and sizes

- Use theme tokens only (see `CLAUDE.md`), and check every change in Classic, Calm, Warm, Night and High contrast.
- Check every change at 1440×900, 1024×768 and 390×844.
- Inside a frame, size by the container (`@container`), not the window.

## Known inconsistencies (to resolve)

- The notebook's New and Rename use the browser's `prompt()`. They should be inline forms, like the catalogue's New library.
- On a phone, a staff section shows two section headers (the kiosk's "Services" and the staff section's menu) above a back link.

## Decisions

- 2026-11: one adaptive nav (the package's) for the kiosk, Preferences, the catalogue and the staff sections; one segmented control; one confirmation (`ConfirmAction`); the designer's last step offers its real action; icon buttons for ordering; every hidden or disabled action says why.
