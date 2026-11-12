// The two small languages journeys use, both safe by construction (no eval, no function calls):
//
// Conditions (`decide: [{ if }]`, `next: [{ if, to }]`): data paths, string/number/boolean
// literals, == != < > <= >=, && || !, and parentheses. A bare path is true when it has a value.
//   answers.pick.mode == 'detailed' && !steps.summarise.error
//
// Templates (`with:`, `result:`): {{path}} placeholders inside strings, resolved against the run's
// scope. A value that is exactly one placeholder keeps its type (an object stays an object).
//   "Summarise this for a visitor: {{answers.pick.source.text}}"

export type Scope = Record<string, unknown>;

const PATH = /^[A-Za-z_][\w-]*(?:\.[\w-]+)*$/;

/** Read `a.b.c` from the scope. Never reaches prototypes. */
export function getPath(scope: Scope, path: string): unknown {
  let value: unknown = scope;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

// ---- conditions -----------------------------------------------------------------------------------

type Token =
  | { t: "path"; v: string }
  | { t: "lit"; v: string | number | boolean | null }
  | { t: "op"; v: string }
  | { t: "paren"; v: "(" | ")" };

const TOKEN = /\s*(?:(\(|\))|(==|!=|<=|>=|&&|\|\||<|>|!)|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)|([A-Za-z_][\w.-]*))/y;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`can't read "${src.slice(pos, pos + 12)}"`);
    pos = TOKEN.lastIndex;
    if (m[1]) out.push({ t: "paren", v: m[1] as "(" | ")" });
    else if (m[2]) out.push({ t: "op", v: m[2] });
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ t: "lit", v: (m[3] ?? m[4]!).replace(/\\(.)/g, "$1") });
    else if (m[5]) out.push({ t: "lit", v: Number(m[5]) });
    else if (m[6]) {
      const w = m[6];
      if (w === "true" || w === "false") out.push({ t: "lit", v: w === "true" });
      else if (w === "null") out.push({ t: "lit", v: null });
      else if (PATH.test(w)) out.push({ t: "path", v: w });
      else throw new Error(`"${w}" is not a data path`);
    }
  }
  return out;
}

type Node =
  | { k: "path"; v: string }
  | { k: "lit"; v: unknown }
  | { k: "not"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node };

function parse(tokens: Token[]): Node {
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  function primary(): Node {
    const tok = take();
    if (!tok) throw new Error("the condition ends too early");
    if (tok.t === "paren" && tok.v === "(") {
      const n = or();
      const close = take();
      if (!close || close.t !== "paren" || close.v !== ")") throw new Error("missing )");
      return n;
    }
    if (tok.t === "op" && tok.v === "!") return { k: "not", a: primary() };
    if (tok.t === "path") return { k: "path", v: tok.v };
    if (tok.t === "lit") return { k: "lit", v: tok.v };
    throw new Error(`unexpected "${String(tok.v)}"`);
  }
  function compare(): Node {
    let a = primary();
    const p = peek();
    if (p?.t === "op" && ["==", "!=", "<", ">", "<=", ">="].includes(p.v)) {
      take();
      a = { k: "bin", op: p.v, a, b: primary() };
    }
    return a;
  }
  function and(): Node {
    let a = compare();
    while (peek()?.t === "op" && peek()!.v === "&&") {
      take();
      a = { k: "bin", op: "&&", a, b: compare() };
    }
    return a;
  }
  function or(): Node {
    let a = and();
    while (peek()?.t === "op" && peek()!.v === "||") {
      take();
      a = { k: "bin", op: "||", a, b: and() };
    }
    return a;
  }
  const node = or();
  if (i !== tokens.length) throw new Error(`unexpected "${String(tokens[i]!.v)}"`);
  return node;
}

const present = (v: unknown) => v !== undefined && v !== null && v !== "" && v !== false && !(Array.isArray(v) && v.length === 0);

function run(node: Node, scope: Scope): unknown {
  switch (node.k) {
    case "path":
      return getPath(scope, node.v);
    case "lit":
      return node.v;
    case "not":
      return !present(run(node.a, scope));
    case "bin": {
      if (node.op === "&&") return present(run(node.a, scope)) && present(run(node.b, scope));
      if (node.op === "||") return present(run(node.a, scope)) || present(run(node.b, scope));
      const a = run(node.a, scope);
      const b = run(node.b, scope);
      if (node.op === "==") return a === b || (a == null && b == null);
      if (node.op === "!=") return !(a === b || (a == null && b == null));
      if (typeof a !== "number" || typeof b !== "number") return false;
      return node.op === "<" ? a < b : node.op === ">" ? a > b : node.op === "<=" ? a <= b : a >= b;
    }
  }
}

/** Why a condition can't be used, or null when it's fine. */
export function conditionProblem(src: string): string | null {
  try {
    parse(tokenize(src));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** The data paths a condition reads, such as `values.smoker`. Throws on a malformed condition. */
export function conditionPaths(src: string): string[] {
  return tokenize(src).flatMap((t) => (t.t === "path" ? [t.v] : []));
}

/** Evaluate a condition. Malformed conditions are refused when a journey compiles, so this throws only on misuse. */
export function holds(src: string, scope: Scope): boolean {
  return present(run(parse(tokenize(src)), scope));
}

// ---- templates ------------------------------------------------------------------------------------

const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;
const WHOLE = /^\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}$/;

const asText = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Fill {{path}} placeholders in strings, recursively through arrays and objects. */
export function render(template: unknown, scope: Scope): unknown {
  if (typeof template === "string") {
    const whole = template.match(WHOLE);
    if (whole) return getPath(scope, whole[1]!);
    return template.replace(PLACEHOLDER, (_, p: string) => asText(getPath(scope, p)));
  }
  if (Array.isArray(template)) return template.map((t) => render(t, scope));
  if (template && typeof template === "object") {
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, render(v, scope)]));
  }
  return template;
}

/** Every {{path}} a template refers to. */
export function placeholders(template: unknown): string[] {
  const out = new Set<string>();
  const walk = (t: unknown) => {
    if (typeof t === "string") for (const m of t.matchAll(PLACEHOLDER)) out.add(m[1]!);
    else if (Array.isArray(t)) t.forEach(walk);
    else if (t && typeof t === "object") Object.values(t).forEach(walk);
  };
  walk(template);
  return [...out];
}
