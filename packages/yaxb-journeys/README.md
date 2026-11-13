# @sekaran-ind/yaxb-journeys

**Service → Journey → Questionnaire**, written in YAML. This package compiles and checks the
content and runs journeys. Its Vue 3 components render them in the adaptive navigation (tabs,
sidebar, accordion or panes, collapsing to a menu on narrow screens). They include **FlowStudio**,
an editor where you write the YAML and preview it at kiosk sizes.

- `@sekaran-ind/yaxb-journeys` is headless: no DOM, and only `js-yaml` as a dependency. It runs in
  browsers, Node and Workers.
- `@sekaran-ind/yaxb-journeys/vue` holds the components, with `vue` (3.5+) as a peer dependency.
  Their styles, `@sekaran-ind/yaxb-journeys/style.css`, are plain CSS with no Tailwind.

The YAXB kiosk uses this package: yaxb-core re-exports it as `@sekaran-ind/yaxb-core/journeys`,
`/services` and `/screens`. The portal's `/studio` page is `FlowStudio`.

## Install in another project

The package is published to GitHub Packages under the `@sekaran-ind` scope. In the project's
`.npmrc`:

```ini
@sekaran-ind:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then install it:

```bash
npm install @sekaran-ind/yaxb-journeys          # plus vue@^3.5 for the components
```

To publish from this monorepo: `npm run build -w @sekaran-ind/yaxb-journeys`, then
`npm publish -w @sekaran-ind/yaxb-journeys`. `prepublishOnly` builds it too. Publish this package
before yaxb-core, which depends on it.

## The studio

```vue
<script setup lang="ts">
import { FlowStudio, provideIcons } from "@sekaran-ind/yaxb-journeys/vue";
import "@sekaran-ind/yaxb-journeys/style.css";

provideIcons((name) => myIcons[name ?? ""] ?? null); // optional: YAML icon names → your components
</script>

<template>
  <FlowStudio :service-names="['agent.ask', 'notebook.add']" :screens="['transcript']" />
</template>
```

| Prop | What it does |
|---|---|
| `v-model` | The YAML. Without it, the studio keeps its own draft in localStorage (`storageKey`, or `false` to keep nothing). |
| `serviceNames` | The handler names your app registers. A journey that calls any other fails to compile. Without it, any dotted name is accepted. |
| `screens` | The screen ids that service items may open. Not checked when absent. |
| `handlers` | Real service handlers for the preview. Every other service runs a stand-in that echoes its input. |
| `sources`, `languages` | Choices for `source` and `language` fields. |
| `example`, `fileName` | What **Example** loads, and the name **Download** saves under. |

It emits `compiled` with each `Bundle`. Problems point at the line they are about, and clicking one
selects that line. The preview offers sizes **Fit**, **Mini** (390 px), **Pod** (820 px) and
**Full** (1200 px, zoomed to fit), and a navigation mode. **Structure** shows the tree from
service to item, journey, steps, questionnaire and sections.

Other components can be used on their own:

- `FlowPreview`: a bundle in the adaptive nav.
- `JourneyRunner`: one journey.
- `QuestionnaireForm` and `QuestionField`: the questions.
- `ServiceItems`: one service's items.
- `StructureTree`: the tree.
- `AdaptiveNav` and `PopMenu`: the navigation.

## The YAML

One file can hold several documents separated by `---`, in any order:

```yaml
kind: service
id: clinic
title: Clinic visit
items:
  - { key: check-in, label: Check in, journey: visit-check-in }   # or screen: <id>, or staff: <section>
---
kind: journey
id: visit-check-in
title: Check in for your visit
start: intake
steps:
  intake:
    questionnaire: visit-intake        # instead of `fields:`; `ask:` defaults to its summary or title
    next:
      - { if: "answers.intake.severity == 'severe'", to: urgent }
      - { to: done }
  urgent: { final: true, result: { title: Tell staff now } }
  done:   { final: true, result: { title: "Checked in: {{answers.intake.name}}" } }
---
kind: questionnaire
id: visit-intake
title: Visit intake
sections:                              # or `fields:` for one page
  - id: about-you
    title: About you
    fields:
      - { id: name, type: text, label: Your name, required: true }
  - id: symptoms
    title: What brings you in
    fields:
      - { id: fever, type: boolean, label: I have a fever }
      - { id: temperature, type: number, label: Temperature, when: "values.fever == true" }
      - id: severity
        type: select
        label: How bad is it
        options: [{ value: mild, label: Mild }, { value: severe, label: Severe }]
```

- **Steps** are `ask`/`fields` (or `questionnaire`), `service`/`with`, `decide`, `next`, and
  `final`/`result`. The keys are the same as clinux-core's journeys.
- **Field types**: text, textarea, select, boolean, number, date, source, language.
- **Optional field keys**: `required`, `options`, `placeholder`, `default`, `description`,
  `keywords`, `entity`, `when`.
- **Conditions and templates** use a small, safe language that never evaluates code.
  - Conditions: `answers.step.field == 'x' && !steps.s.error`.
  - Templates: `{{answers.step.field}}`.
  - A field's `when` may read `values.<field>` (the same form), `answers.*` and `context.*`. A
    hidden field is never required, and its answer is kept as `null`.
- **Questionnaire answers** are `answers.<step>.<field>`. The questions are copied into the step,
  so the runner treats them as ordinary fields.

## Nested services (the Service Catalogue's format)

A service can hold its journeys, a journey its screens, and the service its own roles:

```yaml
kind: service
id: clinic
title: Clinic visit
roles:
  - { id: nurse, label: Nurse, description: Sees visitors after check-in }
journeys:
  - id: check-in
    title: Check in
    roles: { complete: [nurse] }        # no initiate: anyone may start it
    screens:
      - id: about-you
        title: About you
        questions:
          - { id: name, type: text, label: Your name, required: true }
      - id: done
        result: { title: "Thanks {{answers.about-you.name}}" }
  - id: triage
    title: Triage
    roles: { initiate: [nurse] }
    screens:
      - id: notes
        questions: [{ id: note, type: textarea, label: Notes }]
```

`compileBundle` expands it (`expandService`) into the flat documents the engine runs.

- Screens follow one another unless `next` says otherwise.
- A journey whose last screen doesn't end it gets an ending.
- `bundle.roles` lists the roles the service defines.

For editing, there's a design model with converters both ways: `ServiceDesign`, `designFromDoc` and `designToDoc`.

The Vue components are:

- `ServiceDesigner`: the whole service as steps, with a breadcrumb and Previous/Next. The steps run Service → Roles → Journeys → each journey's details and screens → Review. The `RolesPanel` adds roles and assigns who starts and finishes each journey.
- `JourneyDesigner`: one journey. `part` shows its details, its screens, or both.
- `ServiceSummary`: the service at a glance.

## Roles

```yaml
kind: service
roles: [receptionist, nurse]            # who delivers it
---
kind: journey
roles:
  initiate: [visitor, receptionist]     # who may start it; visitor = anyone at the kiosk
  complete: [nurse]                     # who finishes it
```

- `DEFAULT_ROLES` are Admin (`administrator`), Moderator and Reviewer. Pass your catalogue's ids as `compileBundle(..., { roles })` to check them.
- `canInitiate(journey, userRoles)` says whether someone may start a journey.
- A warning says when a journey's roles don't take part in a service that opens it.

## Forms

Services and journeys can be edited as forms that write YAML:

- `serviceToForm` / `formToService` and `journeyToForm` / `formToJourney`, plus `toYaml`.
- (Flat forms have no Vue component; the nested `ServiceDesigner` replaced them.)
- Journey steps are a list. Fields and service input are YAML text inside the form.
- Steps that combine kinds are listed in `unsupported`, for YAML editing.
- Questionnaires are written as YAML (`questionnaireTemplate`, `YamlEditor`).
- `checkDocument(yaml, others, options)` checks one document against the rest of a library.

## Headless API

```ts
import { compileBundle, createRunner, previewHandlers } from "@sekaran-ind/yaxb-journeys";

const bundle = compileBundle(yamlText, { services: ["agent.ask"], screens: ["transcript"] });
if (!bundle.ok) console.log(bundle.problems); // { level, message, line, kind?, id? }

const journey = bundle.journeys[0];
const runner = createRunner(journey, { services: { "agent.ask": async (input) => ({ text: "…" }) } });
await runner.start();                     // runner.state.prompt: { fields, sections, … }
await runner.answer({ name: "Ravi" });    // { problems } or the new state
```

The package also exports:

- `compileJourney`, `compileService`, `compileQuestionnaire`, `compileScreens`;
- `servicesFor`, `resolveLayout`, `resolveNavMode`;
- `fieldVisible`, `formProblems`;
- `holds`, `render`;
- `EXAMPLE_BUNDLE`.

## Theming

Every component root has the class `yj`. To theme the components, set the tokens on `.yj`:

```css
.yj {
  --yj-ink: #0c0c0e;  --yj-body: #3f3f46;  --yj-muted: #71717a;  --yj-line: #e4e4e7;
  --yj-mist: #f4f4f5; --yj-surface: #fff;  --yj-canvas: #fafaf9;
  --yj-accent: #14b8a6;                      /* focus rings */
  --yj-strong: #111113; --yj-on-strong: #fff; /* filled buttons, selected items */
  --yj-info, --yj-success, --yj-danger, --yj-warning, --yj-font, --yj-mono, --yj-radius, --yj-shadow
}
```

The package's own defaults are wrapped in `:where()`, so your rules win whatever the stylesheet
order. Add `data-yj-theme="dark"` on an ancestor for the built-in dark tokens. Layouts follow the
container, not the window, through `@container`.
