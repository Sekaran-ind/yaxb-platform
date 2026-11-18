// A journey as an XState state machine (JRN-40..44): every step a state, every way out of a step a
// transition, so XState's graph tools can walk it. It is the model behind the design checks (what
// nobody reaches, what never ends, an approval nobody is asked for), the ways through a journey
// (one path to each ending), and the flow diagram. The runner (journeys.ts) still runs journeys;
// this is how they are understood before anyone runs them.
//
// Each way out is its own event, so walking the graph follows every branch whatever the answers:
//   ask        SUBMIT (or SUBMIT.<n> per branch of `next:`), from the person or the role answering
//   service    DONE (or DONE.<n>), and ERROR: to the next step with onError: continue, else "failed"
//   decide     DECIDE.<n>, one per branch, labelled with its condition
//   final      a final state (a result)
import { createMachine, type AnyStateMachine } from "xstate";
import { toDirectedGraph } from "@xstate/graph";
import type { Branch, Journey, Step } from "./journeys.js";
import { VISITOR_ROLE } from "./roles.js";
import { afterTasks, journeyTasks } from "./run.js";

export const FAILED_STATE = "(failed)";

export type FlowStepKind = "ask" | "service" | "decide" | "final";
export type FlowNode = { id: string; label: string; kind: FlowStepKind | "failed"; role: string | null; depth: number; reachable: boolean };
export type FlowEdge = { from: string; to: string; event: string; label: string | null };
export type FlowGraph = { journey: string; start: string; nodes: FlowNode[]; edges: FlowEdge[] };

const kindOf = (s: Step): FlowStepKind => (s.final ? "final" : s.decide ? "decide" : s.service ? "service" : "ask");
const branchesOf = (next: Step["next"]): Branch[] => (next === undefined ? [] : typeof next === "string" ? [{ to: next }] : next);
const labelOf = (b: Branch) => (b.if ? `if ${b.if}` : null);

/** The ways out of a step, as events. */
function exits(s: Step): { event: string; to: string; label: string | null }[] {
  const kind = kindOf(s);
  if (kind === "final") return [];
  if (kind === "decide") return (s.decide ?? []).map((b, i) => ({ event: `DECIDE.${i + 1}`, to: b.to, label: labelOf(b) ?? "otherwise" }));
  const base = kind === "service" ? "DONE" : "SUBMIT";
  const nexts = branchesOf(s.next);
  const out: { event: string; to: string; label: string | null }[] = nexts.length === 1 && !nexts[0]!.if ? [{ event: base, to: nexts[0]!.to, label: null }] : nexts.map((b, i) => ({ event: `${base}.${i + 1}`, to: b.to, label: labelOf(b) ?? "otherwise" }));
  if (kind === "service") out.push(s.onError === "continue" && nexts[0] ? { event: "ERROR", to: nexts.at(-1)!.to, label: "if it fails" } : { event: "ERROR", to: FAILED_STATE, label: "if it fails" });
  return out;
}

/** The journey as an XState machine (structure only: no actions, no guards; every branch is an event). */
export function journeyMachine(j: Journey): AnyStateMachine {
  const states: Record<string, unknown> = {};
  if (j.flow === "parallel") {
    // The tasks are regions of one parallel state; when all are done, the ending part.
    const tasks = journeyTasks(j);
    const end = afterTasks(j);
    states.tasks = {
      type: "parallel",
      states: Object.fromEntries(
        tasks.map((id) => [id, { initial: "pending", description: j.steps[id]!.label ?? id, states: { pending: { on: { READY: "ready" } }, ready: { on: { DONE: "done" } }, done: { type: "final" } } }]),
      ),
      ...(end ? { onDone: { target: end } } : {}),
    };
    for (const [id, st] of Object.entries(j.steps)) {
      if (tasks.includes(id)) continue;
      const out = exits(st).filter((e) => j.steps[e.to]);
      states[id] = kindOf(st) === "final" ? { type: "final", description: st.label ?? id } : { description: st.label ?? id, on: Object.fromEntries(out.map((e) => [e.event, { target: e.to }])) };
    }
    return createMachine({ id: j.id, initial: "tasks", states } as never);
  }
  let failed = false;
  for (const [id, s] of Object.entries(j.steps)) {
    const out = exits(s).filter((e) => e.to === FAILED_STATE || j.steps[e.to]);
    if (out.some((e) => e.to === FAILED_STATE)) failed = true;
    states[id] = kindOf(s) === "final" ? { type: "final", description: s.label ?? id } : { description: s.label ?? id, on: Object.fromEntries(out.map((e) => [e.event, { target: e.to, description: e.label ?? undefined }])) };
  }
  if (failed) states[FAILED_STATE] = { type: "final", description: "Failed" };
  return createMachine({ id: j.id, initial: j.steps[j.start] ? j.start : Object.keys(j.steps)[0], states } as never);
}

/** A parallel journey's graph: tasks by how deep their `after` goes, then the ending part below. */
function parallelGraph(j: Journey): FlowGraph {
  const tasks = journeyTasks(j);
  const end = afterTasks(j);
  const edges: FlowEdge[] = [];
  const dependents = new Set(tasks.flatMap((t) => j.steps[t]!.after ?? []));
  for (const t of tasks) for (const d of j.steps[t]!.after ?? []) if (tasks.includes(d)) edges.push({ from: d, to: t, event: "AFTER", label: null });
  for (const t of tasks) {
    const st = j.steps[t]!;
    if (end && !dependents.has(t)) edges.push({ from: t, to: end, event: "ALL_DONE", label: "when every task is done" });
    if (st.service && st.onError !== "continue") edges.push({ from: t, to: FAILED_STATE, event: "ERROR", label: "if it fails" });
  }
  for (const [id, st] of Object.entries(j.steps)) if (!tasks.includes(id)) for (const e of exits(st)) if (e.to === FAILED_STATE || j.steps[e.to]) edges.push({ from: id, ...e });
  // Depth: a task one row below what it waits for; the ending part below the deepest task.
  const taskDepth = new Map<string, number>();
  const depthOf = (t: string, seen = new Set<string>()): number => {
    if (taskDepth.has(t)) return taskDepth.get(t)!;
    if (seen.has(t)) return 0;
    seen.add(t);
    const deps = (j.steps[t]!.after ?? []).filter((d) => tasks.includes(d));
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depthOf(x, seen))) : 0;
    taskDepth.set(t, d);
    return d;
  };
  tasks.forEach((t) => depthOf(t));
  const depth = new Map<string, number>(taskDepth);
  const first = Math.max(-1, ...taskDepth.values()) + 1;
  if (end) {
    depth.set(end, first);
    const queue = [end];
    while (queue.length) {
      const at = queue.shift()!;
      for (const e of edges.filter((x) => x.from === at && !tasks.includes(x.to))) {
        if (!depth.has(e.to)) {
          depth.set(e.to, depth.get(at)! + 1);
          queue.push(e.to);
        }
      }
    }
  }
  const failing = edges.some((e) => e.to === FAILED_STATE);
  if (failing && !depth.has(FAILED_STATE)) depth.set(FAILED_STATE, first);
  const base = Math.max(0, ...depth.values()) + 1;
  const ids = [...Object.keys(j.steps), ...(failing ? [FAILED_STATE] : [])];
  const nodes: FlowNode[] = ids.map((id) => {
    const st = j.steps[id];
    return { id, label: st ? (st.label ?? id) : "Failed", kind: st ? kindOf(st) : "failed", role: st?.role ?? null, depth: depth.get(id) ?? base, reachable: depth.has(id) };
  });
  return { journey: j.id, start: tasks[0] ?? end ?? j.start, nodes, edges };
}

/** The machine's graph, with each step's kind, role and depth (its distance from the start). */
export function journeyGraph(j: Journey): FlowGraph {
  if (j.flow === "parallel") return parallelGraph(j);
  const directed = toDirectedGraph(journeyMachine(j));
  const edges: FlowEdge[] = [];
  const ids: string[] = [];
  const walk = (n: typeof directed) => {
    for (const child of n.children) {
      const id = child.stateNode.key;
      ids.push(id);
      for (const e of child.edges) {
        const to = e.target.key;
        const event = e.transition.eventType;
        const step = j.steps[id];
        const label = step ? (exits(step).find((x) => x.event === event)?.label ?? null) : null;
        edges.push({ from: id, to, event, label });
      }
      walk(child);
    }
  };
  walk(directed);
  // Breadth-first from the start: depth, and what is reachable at all.
  const depth = new Map<string, number>([[j.start, 0]]);
  const queue = [j.start];
  while (queue.length) {
    const at = queue.shift()!;
    for (const e of edges.filter((x) => x.from === at)) {
      if (!depth.has(e.to)) {
        depth.set(e.to, depth.get(at)! + 1);
        queue.push(e.to);
      }
    }
  }
  // What nothing reaches goes below, in its own rows: from each screen nothing (unreached) leads to.
  const reached = new Set(depth.keys());
  const base = Math.max(0, ...depth.values()) + 1;
  const roots = ids.filter((id) => !reached.has(id) && !edges.some((e) => e.to === id && e.from !== id && !reached.has(e.from)));
  const lost = new Map<string, number>(roots.map((id) => [id, base]));
  const lostQueue = [...roots];
  while (lostQueue.length) {
    const at = lostQueue.shift()!;
    for (const e of edges.filter((x) => x.from === at && !reached.has(x.to))) {
      if (!lost.has(e.to)) {
        lost.set(e.to, lost.get(at)! + 1);
        lostQueue.push(e.to);
      }
    }
  }
  const nodes: FlowNode[] = ids.map((id) => {
    const s = j.steps[id];
    return {
      id,
      label: s ? (s.label ?? id) : "Failed",
      kind: s ? kindOf(s) : "failed",
      role: s?.role ?? null,
      depth: depth.get(id) ?? lost.get(id) ?? base,
      reachable: depth.has(id),
    };
  });
  return { journey: j.id, start: j.start, nodes, edges };
}

/** One way through to each ending: the shortest path from the start to every final step. */
export function waysThrough(j: Journey): { end: string; steps: string[]; via: (string | null)[] }[] {
  const g = journeyGraph(j);
  const prev = new Map<string, FlowEdge>();
  // A parallel journey: every task (in the order of what they wait for), then from the ending part.
  const depthOf = (id: string) => g.nodes.find((n) => n.id === id)?.depth ?? 0;
  const tasks = j.flow === "parallel" ? journeyTasks(j).sort((a, b) => depthOf(a) - depthOf(b)) : [];
  const from = j.flow === "parallel" ? afterTasks(j) : g.start;
  if (!from) return [];
  const seen = new Set([from, ...tasks]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift()!;
    for (const e of g.edges.filter((x) => x.from === at)) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      prev.set(e.to, e);
      queue.push(e.to);
    }
  }
  return g.nodes
    .filter((n) => (n.kind === "final" || n.kind === "failed") && seen.has(n.id))
    .map((n) => {
      const steps = [n.id];
      const via: (string | null)[] = [];
      for (let e = prev.get(n.id); e && !tasks.includes(e.from); e = prev.get(e.from)) {
        steps.unshift(e.from);
        via.unshift(e.label);
      }
      if (tasks.length) return { end: n.id, steps: [...tasks, ...steps], via: [...tasks.slice(1).map(() => null), "when every task is done", ...via] };
      return { end: n.id, steps, via };
    });
}

export type DesignCheck = { level: "error" | "warning"; step: string | null; message: string };
const APPROVAL = /\b(approv|review|accept|verif|check|confirm|screen|vet)\w*/i;

/**
 * Design checks for one journey, from its graph: what nobody reaches (and why, when a result ends
 * the journey before it), what can never end, an approval that is a decision nobody is asked for, and roles named one letter away from a known role.
 */
export function designChecks(j: Journey, { roles = [] as readonly string[], order = [] as readonly string[] } = {}): DesignCheck[] {
  const g = journeyGraph(j);
  const out: DesignCheck[] = [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const list = order.length ? order.filter((id) => j.steps[id]) : Object.keys(j.steps);

  // Nothing leads there.
  for (const id of list) {
    const n = byId.get(id);
    if (!n || n.reachable) continue;
    const before = list[list.indexOf(id) - 1];
    const ended = before && j.steps[before]?.final && byId.get(before)?.reachable;
    const from = [...new Set(g.edges.filter((e) => e.to === id).map((e) => e.from))];
    out.push({
      level: "warning",
      step: id,
      message: ended
        ? `screen '${id}' is never reached: '${before}' before it is a result, which ends the journey. To show something and carry on, make '${before}' a question screen.`
        : from.length
          ? `screen '${id}' is never reached: only ${from.map((f) => `'${f}'`).join(" or ")} lead${from.length === 1 ? "s" : ""} to it, and ${from.length === 1 ? "that is" : "those are"} never reached.`
          : `screen '${id}' is never reached: no screen leads to it.`,
    });
  }

  // Reachable, but no way to an ending (a loop with no way out).
  const canEnd = new Set(g.nodes.filter((n) => n.kind === "final" || n.kind === "failed").map((n) => n.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of g.edges) {
      if (canEnd.has(e.to) && !canEnd.has(e.from)) {
        canEnd.add(e.from);
        grew = true;
      }
    }
  }
  for (const n of g.nodes) if (n.reachable && !canEnd.has(n.id)) out.push({ level: "warning", step: n.id, message: `from screen '${n.id}' the journey can never end: it loops with no way out.` });

  for (const [id, s] of Object.entries(j.steps)) {
    // "Approve" as a decision: it runs by itself, nobody is asked.
    if (s.decide && APPROVAL.test(`${s.label ?? ""} ${id}`)) {
      const asked = g.edges.some((e) => e.to === id && j.steps[e.from]?.role);
      if (!asked)
        out.push({
          level: "warning",
          step: id,
          message: `'${s.label ?? id}' is a decision, which runs by itself: nobody is asked to approve. For a person to decide, put a question screen with 'role:' (say, Approved: yes or no) before it, and decide on that answer.`,
        });
    }
  }

  // A role one letter away from a known one ("curators" for "curator").
  const used = new Set([...(j.roles?.initiate ?? []), ...(j.roles?.complete ?? []), ...Object.values(j.steps).flatMap((s) => (s.role ? [s.role] : []))]);
  for (const r of used) {
    if (r === VISITOR_ROLE || roles.includes(r)) continue;
    const near = roles.find((k) => k !== r && (k === `${r}s` || `${k}s` === r || k === r.replace(/es$/, "") || oneEdit(k, r)));
    if (near) out.push({ level: "warning", step: null, message: `role '${r}' looks like '${near}': members with '${near}' won't get these requests. Use '${near}', or give people '${r}'.` });
  }
  return out;
}

/** Whether two ids differ by one letter (added, dropped or changed). */
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || a === b || Math.min(a.length, b.length) < 4) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(i + (a.length >= b.length ? 1 : 0)) === b.slice(i + (b.length >= a.length ? 1 : 0)) || a.slice(i + 1) === b.slice(i + 1);
}
