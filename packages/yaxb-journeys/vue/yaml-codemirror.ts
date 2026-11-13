// The YAML editor proper: CodeMirror 6, loaded on demand by YamlEditor.vue (a separate chunk, so a
// page without an editor never downloads it). Why CodeMirror and not Ace: ES modules that tree-shake,
// no web workers or eval, touch support through the browser's own selection, and styles that read
// the `--yj-*` tokens, so every host theme (dark ones too) applies without an editor theme of its own.
// Problems from the compiler (`problems[].line`) become lint diagnostics: a gutter mark and an
// underline on the line, with the message on hover. Escape, then Tab, leaves the editor (built in).
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export type EditorMark = { line: number; level: "error" | "warning"; message?: string };
export type YamlEditorHandle = {
  setDoc(text: string): void;
  setMarks(marks: EditorMark[]): void;
  setReadonly(readonly: boolean): void;
  goToLine(line: number): void;
  destroy(): void;
};

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--yj-ink)", backgroundColor: "var(--yj-surface)", fontSize: "0.8125rem" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--yj-mono)", lineHeight: "1.6" },
  ".cm-content": { caretColor: "var(--yj-ink)", padding: "0.5rem 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--yj-ink)" },
  ".cm-gutters": { backgroundColor: "var(--yj-mist)", color: "var(--yj-muted)", border: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--yj-mist) 70%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--yj-line) 60%, transparent)", color: "var(--yj-ink)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklab, var(--yj-accent) 30%, transparent) !important",
  },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in oklab, var(--yj-accent) 25%, transparent)", outline: "none" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--yj-danger)", textUnderlineOffset: "3px" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--yj-warning)", textUnderlineOffset: "3px" },
  ".cm-tooltip": { backgroundColor: "var(--yj-surface)", color: "var(--yj-ink)", border: "1px solid var(--yj-line)", borderRadius: "8px" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--yj-danger)" },
  ".cm-diagnostic-warning": { borderLeftColor: "var(--yj-warning)" },
  ".cm-gutter-lint": { width: "1.1em" },
});

// Colours by meaning, from the host's tokens (keys like a heading, values like text).
const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: "var(--yj-info)", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "var(--yj-success)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--yj-warning)" },
  { tag: [t.comment, t.lineComment], color: "var(--yj-muted)", fontStyle: "italic" },
  { tag: [t.punctuation, t.separator, t.squareBracket, t.brace], color: "var(--yj-muted)" },
  { tag: [t.keyword, t.meta, t.labelName, t.typeName], color: "var(--yj-accent)" },
]);

export function createYamlEditor(
  parent: HTMLElement,
  options: { doc: string; label: string; describedby?: string; readonly?: boolean; onChange: (text: string) => void },
): YamlEditorHandle {
  const editable = new Compartment();
  const attrs = { "aria-label": options.label, ...(options.describedby ? { "aria-describedby": options.describedby } : {}), spellcheck: "false", autocapitalize: "off", autocorrect: "off" };
  const readonlyExt = (ro: boolean) => [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)];
  let silent = false;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        indentUnit.of("  "),
        EditorState.tabSize.of(2),
        yaml(),
        syntaxHighlighting(highlight),
        lintGutter(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        theme,
        EditorView.contentAttributes.of(attrs),
        editable.of(readonlyExt(Boolean(options.readonly))),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !silent) options.onChange(u.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    setDoc(text) {
      if (text === view.state.doc.toString()) return;
      silent = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      silent = false;
    },
    setMarks(marks) {
      const doc = view.state.doc;
      const diagnostics: Diagnostic[] = marks
        .filter((m) => m.line >= 1 && m.line <= doc.lines)
        .map((m) => {
          const l = doc.line(m.line);
          return { from: l.from, to: l.to, severity: m.level, message: m.message ?? (m.level === "error" ? "Error" : "Warning") };
        });
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },
    setReadonly(ro) {
      view.dispatch({ effects: editable.reconfigure(readonlyExt(ro)) });
    },
    goToLine(line) {
      const doc = view.state.doc;
      const l = doc.line(Math.max(1, Math.min(doc.lines, line)));
      view.dispatch({ selection: { anchor: l.from, head: l.to }, scrollIntoView: true });
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
