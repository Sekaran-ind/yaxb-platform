// A small, safe reading of the Markdown that models write in answers: paragraphs, bullet and
// numbered lists, headings, **bold**, *italic* and `code`, plus the closing "(sources: …)" line
// as separate items. It returns data for a Vue template (no v-html), so model text can never
// inject markup.

export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean };
export type Block = { kind: "p" | "h"; inline: Inline[] } | { kind: "ul" | "ol"; items: Inline[][] };
export type FormattedAnswer = { blocks: Block[]; sources: { id: string; label: string | null }[] };

export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    if (m[2] ?? m[3]) out.push({ text: (m[2] ?? m[3])!, bold: true });
    else if (m[4]) out.push({ text: m[4], code: true });
    else out.push({ text: (m[5] ?? m[6])!, italic: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const SOURCES = /\((?:sources?):\s*([^)]*)\)/gi;

export function formatAnswer(text: string): FormattedAnswer {
  const sources: FormattedAnswer["sources"] = [];
  for (const m of text.matchAll(SOURCES)) {
    for (const part of m[1]!.split(/;\s*/)) {
      const [id, ...rest] = part.split("·");
      const key = id!.trim();
      if (key && !sources.some((s) => s.id === key)) sources.push({ id: key, label: rest.join("·").trim() || null });
    }
  }
  const body = text.replace(SOURCES, "").replace(/[ \t]+$/gm, "");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", inline: inline(para.join(" ")) });
    para = [];
  };
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (!line) flush();
    else if (bullet || numbered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const prev = blocks[blocks.length - 1];
      const item = inline((bullet ?? numbered)![1]!);
      if (prev && prev.kind === kind) prev.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (heading) {
      flush();
      blocks.push({ kind: "h", inline: inline(heading[1]!) });
    } else para.push(line);
  }
  flush();
  return { blocks, sources };
}
