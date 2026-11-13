# The kiosk and the Service Catalogue: one surface or two?

Decided 2026-11 (UX review 2). Recommendation: **keep two surfaces that look and move alike**, and
don't merge them into one kiosk with a design mode and a run mode.

## Who uses each

| | Kiosk (`/kiosk`) | Service Catalogue (`/catalogue`) |
|---|---|---|
| Who | Visitors, often anxious, at a shared device; staff second | Service designers (any guest or member), reviewers, administrators |
| What for | Ask, run a journey, keep a notebook | Design, review, publish services; manage roles and libraries |
| Where | Web, and the native app (only `/kiosk` and `/settings` exist there) | Web only |
| Identity | Anonymous by default; a local profile; staff sign in with a moderator key inside For staff | A guest by session (their own services only, up to 20), or a member with roles (view, edit, review, manage) |
| Time | Run time | Design time |

## Why not merge

1. **A visitor must never land in design mode.** A kiosk is a public, often unattended device. A
   mode switch inside it is one tap (or one spoken command) away from an editor that guests may use
   to create services. Keeping design on its own address keeps that door shut by construction, not
   by a setting someone has to remember.
2. **The native app is run time only.** It ships `/kiosk` and `/settings`; the catalogue's editor,
   CodeMirror and the review flow would add weight and permissions to an app whose users never design.
3. **Different permissions, different sign-in.** The catalogue's actor (guest by session, or member
   with roles) and the kiosk's (a visitor profile, plus staff sections behind a key) don't map onto
   one another. One surface would have to show two sign-in models at once.
4. **Different layouts of work.** Designing needs room (steps, a list, an editor and a live
   preview); running needs focus (one screen, big targets, voice). Merged, every screen would carry
   both.
5. **The link between them is already one step.** The catalogue's "Open in a kiosk" loads a
   published service into the kiosk (`/kiosk?load=<id>`); the kiosk's "Load a service" lists the
   catalogue and links to it to design one.

## What is shared instead (built)

- **One frame**: `KioskFrame.vue` with the same Full, Pod and Mini layouts, the dark side panel, and
  the same adaptive nav behaviour (tabs, the section menu when narrow, `fill` in Full).
- **The same way across**: "Open the kiosk" in the catalogue's panel, "Open in a kiosk" on each
  published service, and "Design a service in the catalogue →" in the kiosk's Load panel, each a link
  with an icon, the pattern for moving to another surface.
- **The designer previews in the kiosk's own components** (`FlowPreview`, `JourneyRunner`, the
  adaptive nav), so what a designer sees is what a visitor gets.

## If this is revisited

A merge becomes reasonable only if all of these hold: kiosks are always staffed or locked to a
signed-in member while designing; the native app gains a separate build without design; and the
catalogue's guest design is retired. The plan would then be: a `design` mode on `/kiosk` reachable
only from For staff with an editor role; `ServiceWorkspace` as a staff section; the catalogue's
screens (Catalogue, Review, Roles, Libraries) as staff tabs; `/catalogue` redirecting there.

## The YAML editor: CodeMirror 6, not Ace

Both were checked against this app's constraints:

| | CodeMirror 6 | Ace (`ace-builds`) |
|---|---|---|
| CSP (static, `script-src 'self'`, no eval) | ES modules, no workers, no eval | Syntax checking uses web workers (blob or URL); its loader expects script paths at run time (`basePath`) |
| Styles | Injected through constructable stylesheets (`style-src 'unsafe-inline'` is allowed anyway) | Injected `<style>` tags, or `useStrictCSP` plus its CSS file |
| Vite library mode | Plain ESM, externalised, tree-shaken by the host | UMD/CommonJS builds (`src-noconflict`); modes and themes loaded by path |
| Size | 360 kB min, 118 kB gzipped (measured), in its own chunk loaded only when an editor opens | Similar for the core and YAML mode, but not tree-shakable (the package is 58 MB unpacked) |
| Themes | `EditorView.theme` reads the `--yj-*` tokens, so every site theme (dark ones invert the grays) applies with no editor theme | A theme per look, as JS; would need one per site theme or CSS overrides |
| Touch | The browser's own selection and keyboard (contenteditable) | A hidden textarea; weaker on phones |
| YAML | `@codemirror/lang-yaml` (Lezer) | `ace/mode/yaml` |
| Problem marks | `@codemirror/lint` diagnostics from `problems[].line`, gutter mark, underline, message on hover | Annotations (gutter only) |
| Escape, then Tab | Built in with `indentWithTab` | Needs custom key handling |

CodeMirror 6 fits every constraint; Ace needs workarounds for the loader, workers and themes. It is
in `packages/yaxb-journeys/vue/yaml-codemirror.ts`, a separate chunk imported by `YamlEditor.vue`
on mount; the textarea editor stays as the loading state and the fallback.
