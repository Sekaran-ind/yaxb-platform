// Running a journey on its XState machine (JRN-45..49). Every journey runs on an XState actor:
//
//   sequence (the default)  a state per step. Each has `enter` (an answered step goes on, a step
//                           someone else answers waits, else it asks), `run` (a service is invoked;
//                           a plain step just passes), and `route` (the step's branches, in order).
//                           A result step is a final state; "failed" is another.
//   parallel (flow: parallel, after Cübo's plan machine)
//                           the tasks (steps that ask or run a service) are regions of one parallel
//                           state, available together unless they wait for others (`after:`):
//                           pending → ready → active (asking, waiting for a role, or the service
//                           running) → done. A person works on one task at a time (`focus`); a
//                           service task runs as soon as it is ready. When every task is done the
//                           run carries on from the first step that isn't a task (a decision or a
//                           result), in sequence.
//   guards (RTN-9, 11)      an ask step with `guard` checks its answers before taking them: a
//                           condition, or a service's yes or no within its time limit. A no (or
//                           no answer in time) puts the step back to asking with the reason; a
//                           call's answer is kept in steps["guard:<id>"], which replay reads back.
//
// The API is the one the surfaces always had (createRunner: start, answer, snapshot, resume,
// continueAs, stop, plus focus), so the kiosk, the preview, hand-overs and the server's replay all
// run on the machine. Each method resolves when the run settles: asking, waiting, done or failed.
import { assign, createActor, createMachine, fromPromise, type AnyActorRef, type AnyMachineSnapshot } from "xstate";
import { holds, render, type Scope } from "./expressions.js";
import { formProblems, keptAnswers } from "./fields.js";
import { GUARD_DEFAULT_MS, guardKey, levelNeeded, mayAnswer, type Journey, type RunActor, type RunSnapshot, type RunState, type ServiceHandler, type Step, type TaskState } from "./journeys.js";

/** XState's assign, for this file's events (SUBMIT's answers, a service's output or error). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const set = (fn: (args: { context: Ctx; event: any }) => Partial<Ctx>) => assign(fn as never);

/** Transitions without anyone answering before a run counts as going round in circles. */
const MAX_HOPS = 200;

type Ctx = {
  answers: RunState["answers"];
  steps: RunState["steps"];
  trail: RunState["trail"];
  result: RunState["result"];
  error: string | null;
  failedAt: string | null;
  /** Parallel: the tasks done so far. */
  done: string[];
  hops: number;
  /** The last answers a guard stopped, and why (RTN-9). */
  refused: { step: string; reason: string } | null;
};

/** A guard's answer read as yes or no: `{ allow }` (or a connector's `{ ok, data: { allow, reason } }`). */
export function guardVerdict(out: unknown): { allow: boolean; reason: string | null } {
  let o = (out && typeof out === "object" ? out : {}) as Record<string, unknown>;
  if (o.untrusted === true) {
    if (o.ok !== true) return { allow: false, reason: null };
    o = (o.data && typeof o.data === "object" ? o.data : {}) as Record<string, unknown>;
  }
  const v = typeof out === "boolean" ? out : o.allow;
  return { allow: v === true, reason: typeof o.reason === "string" && o.reason.trim() ? o.reason.trim().slice(0, 300) : null };
}

const isTask = (s: Step) => !s.final && !s.decide && (s.ask !== undefined || Boolean(s.service));
const isParallel = (j: Journey) => j.flow === "parallel";
/** The tasks of a parallel journey, in their order. */
export const journeyTasks = (j: Journey): string[] => (isParallel(j) ? Object.keys(j.steps).filter((id) => isTask(j.steps[id]!)) : []);
/** Where a parallel journey goes once every task is done: its first step that isn't a task. */
export const afterTasks = (j: Journey): string | null => Object.keys(j.steps).find((id) => !isTask(j.steps[id]!)) ?? null;

const key = (id: string) => `s_${id}`;
const target = (id: string) => `#${key(id)}`;

export function createRunner(
  journey: Journey,
  {
    services = {},
    context = {},
    onChange,
    actor: firstActor,
  }: { services?: Record<string, ServiceHandler>; context?: Scope; onChange?: (s: RunState) => void; actor?: RunActor } = {},
) {
  let who = firstActor;
  const tasks = journeyTasks(journey);
  const parallel = isParallel(journey);
  const scope = (c: Pick<Ctx, "answers" | "steps">): Scope => ({ answers: c.answers, steps: c.steps, context });
  const trailOf = (c: Ctx, step: Step, ok: boolean) => [...c.trail, { step: step.id, label: step.label ?? step.id, stage: step.stage, ok }];
  const notMine = (step: Step) => Boolean(who) && !mayAnswer(step, who!);
  // IDN-32: a step this person may answer, but not yet signed in strongly enough for. Only with an
  // actor (a plain preview asks every step).
  const tooLow = (step: Step) => Boolean(who) && (who!.level ?? 0) < levelNeeded(journey, step);

  // ---- the machine ----------------------------------------------------------------------------

  const fail = (message: string | ((c: Ctx) => string), at?: (c: Ctx) => string | null) => ({
    target: "#failed",
    actions: set(({ context: c }: { context: Ctx }) => ({ error: typeof message === "string" ? message : message(c), failedAt: at ? at(c) : c.failedAt })),
  });

  /** A step's ways out, in order: the first that holds. */
  function routeOf(step: Step) {
    const hop = set(({ context: c }: { context: Ctx }) => ({ hops: c.hops + 1 }));
    const circles = { guard: ({ context: c }: { context: Ctx }) => c.hops >= MAX_HOPS, ...fail("The journey went round in circles.", () => step.id) };
    const go = (to: string) => (journey.steps[to] ? { target: target(to), actions: hop } : fail(`The journey has no step "${to}".`, () => to));
    const n = step.decide ?? step.next;
    if (n === undefined) return [circles, fail("The journey stopped without an ending.", () => step.id)];
    if (typeof n === "string") return [circles, go(n)];
    return [
      circles,
      ...n.map((b) => (b.if === undefined ? go(b.to) : { guard: ({ context: c }: { context: Ctx }) => holds(b.if!, scope(c)), ...go(b.to) })),
      fail("The journey stopped without an ending.", () => step.id),
    ];
  }

  /** The service a step invokes, with its rendered input. */
  function invokeOf(step: Step, onDone: object, onFailContinue: object) {
    const handler = Object.hasOwn(services, step.service!) ? services[step.service!] : undefined;
    const keep = (out: unknown) => (typeof out === "string" ? { text: out } : (out ?? {}));
    const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
    return {
      src: fromPromise(async ({ input, signal }: { input: { value: unknown; scope: Scope }; signal: AbortSignal }) => {
        if (!handler) throw new Error(`"${step.service}" isn't available here.`);
        return handler(input.value, { journey, step, scope: input.scope, signal });
      }),
      input: ({ context: c }: { context: Ctx }) => ({ value: render(step.with ?? {}, scope(c)), scope: scope(c) }),
      onDone: { ...onDone, actions: set(({ context: c, event }: { context: Ctx; event: { output: unknown } }) => ({ steps: { ...c.steps, [step.id]: keep(event.output) }, trail: trailOf(c, step, true), done: [...c.done, step.id] })) },
      onError: [
        {
          guard: () => step.onError === "continue",
          ...onFailContinue,
          actions: set(({ context: c, event }: { context: Ctx; event: { error: unknown } }) => ({ steps: { ...c.steps, [step.id]: { error: message(event.error) } }, trail: trailOf(c, step, false), done: [...c.done, step.id] })),
        },
        {
          target: "#failed",
          actions: set(({ context: c, event }: { context: Ctx; event: { error: unknown } }) => ({
            steps: { ...c.steps, [step.id]: { error: message(event.error) } },
            trail: trailOf(c, step, false),
            error: message(event.error),
            failedAt: step.id,
          })),
        },
      ],
    };
  }

  /** An ask step's guard (RTN-9): a state between its answers and its run. */
  function guardState(step: Step) {
    const g = step.guard!;
    const pass = (extra: (c: Ctx, output?: unknown) => Partial<Ctx> = () => ({})) =>
      set(({ context: c, event }: { context: Ctx; event: { output?: unknown } }) => ({
        ...extra(c, event.output),
        refused: null,
        trail: step.service ? c.trail : trailOf(c, step, true),
        done: step.service ? c.done : [...c.done, step.id],
      }));
    const refuse = (why: (c: Ctx, output?: unknown) => string) =>
      set(({ context: c, event }: { context: Ctx; event: { output?: unknown } }) => {
        const answers = { ...c.answers };
        delete answers[step.id];
        const steps = { ...c.steps };
        delete steps[guardKey(step.id)];
        return { answers, steps, refused: { step: step.id, reason: why(c, event.output) } };
      });
    if (g.allow !== undefined)
      return { always: [{ guard: ({ context: c }: { context: Ctx }) => holds(g.allow!, scope(c)), target: "run", actions: pass() }, { target: "asking", actions: refuse(() => g.reason) }] };
    const handler = g.call && Object.hasOwn(services, g.call) ? services[g.call] : undefined;
    const within = g.within ?? GUARD_DEFAULT_MS;
    return {
      invoke: {
        src: fromPromise(async ({ input, signal }: { input: { value: unknown; scope: Scope }; signal: AbortSignal }) => {
          if (!handler) throw new Error(`"${g.call}" isn't available here.`);
          let timer: ReturnType<typeof setTimeout> | undefined;
          const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("late")), within)));
          try {
            return await Promise.race([handler(input.value, { journey, step, scope: input.scope, signal, guard: true }), late]);
          } finally {
            clearTimeout(timer);
          }
        }),
        input: ({ context: c }: { context: Ctx }) => ({ value: render(g.with ?? {}, scope(c)), scope: scope(c) }),
        onDone: [
          { guard: ({ event }: { event: { output: unknown } }) => guardVerdict(event.output).allow, target: "run", actions: pass((c, out) => ({ steps: { ...c.steps, [guardKey(step.id)]: { allow: true, reason: guardVerdict(out).reason } } })) },
          { target: "asking", actions: refuse((_c, out) => guardVerdict(out).reason ?? g.reason) },
        ],
        // No answer in time, or the check failed: the step stays, so nothing goes on unchecked.
        onError: { target: "asking", actions: refuse(() => g.reason) },
      },
    };
  }

  const answered = (id: string) => ({ context: c }: { context: Ctx }) => Object.hasOwn(c.answers, id);
  const submit = (step: Step) =>
    set(({ context: c, event }: { context: Ctx; event: { answers?: Record<string, unknown> } }) => ({
      answers: { ...c.answers, [step.id]: event.answers ?? {} },
      // A service on the same step records the step when it has run; a guarded step when its guard passes.
      trail: step.service || step.guard ? c.trail : trailOf(c, step, true),
      done: step.service || step.guard ? c.done : [...c.done, step.id],
      hops: 0,
      refused: step.guard ? c.refused : null,
    }));
  const forThis = (id: string) => ({ event }: { event: { step?: string } }) => event.step === id;

  /** A step of the sequential part. */
  function sequentialState(id: string, step: Step) {
    if (step.final)
      return {
        id: key(id),
        type: "final",
        entry: set(({ context: c }: { context: Ctx }) => {
          const r = (render(step.result ?? {}, scope(c)) ?? {}) as { title?: unknown; text?: unknown; ok?: unknown };
          const ok = r.ok === undefined ? true : r.ok === true || r.ok === "true";
          const outcome = typeof step.result?.outcome === "string" ? step.result.outcome : null;
          return { trail: trailOf(c, step, true), result: { title: String(r.title ?? journey.title), text: String(r.text ?? ""), ok, outcome } };
        }),
      };
    const asks = step.ask !== undefined;
    return {
      id: key(id),
      initial: "enter",
      states: {
        enter: {
          always: asks
            ? [{ guard: answered(id), target: "run" }, { guard: () => notMine(step), target: "waiting" }, { guard: () => tooLow(step), target: "stepup" }, { target: "asking" }]
            : [{ target: "run" }],
        },
        asking: { on: { SUBMIT: { guard: forThis(id), target: step.guard ? "guard" : "run", actions: submit(step) } } },
        ...(step.guard ? { guard: guardState(step) } : {}),
        waiting: { on: { RECHECK: { target: "enter" } } },
        stepup: { on: { RECHECK: { target: "enter" } } },
        run: step.service
          ? { invoke: invokeOf(step, { target: "route" }, { target: "route" }) }
          : {
              always: {
                target: "route",
                // An answered ask step was recorded on SUBMIT; a resumed one already is in the trail.
                actions: asks ? [] : set(({ context: c }: { context: Ctx }) => ({ trail: trailOf(c, step, true) })),
              },
            },
        route: { always: routeOf(step) },
      },
    };
  }

  /** A task of a parallel journey: a region of the `tasks` state. */
  function taskRegion(id: string, step: Step) {
    const deps = (step.after ?? []).filter((d) => d !== id);
    const doneId = `${key(id)}-done`;
    const readyId = `${key(id)}-ready`;
    const markDone = set(({ context: c }: { context: Ctx }) => ({ done: c.done.includes(id) ? c.done : [...c.done, id] }));
    const ran = ({ context: c }: { context: Ctx }) => Object.hasOwn(c.steps, id);
    const otherFocus = { FOCUS: { guard: ({ event }: { event: { step?: string } }) => event.step !== id, target: `#${readyId}` } };
    const pending = { always: deps.length ? { guard: ({ context: c }: { context: Ctx }) => deps.every((d) => c.done.includes(d)), target: "ready" } : { target: "ready" } };
    const done = { id: doneId, type: "final", entry: markDone };
    const run = { invoke: invokeOf(step, { target: `#${doneId}` }, { target: `#${doneId}` }) };

    // A service alone: it runs as soon as it is ready (resumed: done when it has run).
    if (step.ask === undefined)
      return { initial: "pending", states: { pending, ready: { always: [{ guard: ran, target: "done" }, { target: "active" }] }, active: run, done } };

    // Questions (then, maybe, a service): focused by a person, asked, or waiting for its role.
    const after = step.service ? "running" : `#${doneId}`;
    return {
      initial: "pending",
      states: {
        pending,
        ready: {
          id: readyId,
          always: [{ guard: step.service ? ran : answered(id), target: "done" }],
          on: { FOCUS: { guard: forThis(id), target: "active" } },
        },
        active: {
          initial: "check",
          states: {
            check: { always: [{ guard: answered(id), target: after }, { guard: () => notMine(step), target: "waiting" }, { guard: () => tooLow(step), target: "stepup" }, { target: "asking" }] },
            asking: { on: { SUBMIT: { guard: forThis(id), target: after, actions: submit(step) }, ...otherFocus } },
            waiting: { on: { RECHECK: { target: "check" }, ...otherFocus } },
            stepup: { on: { RECHECK: { target: "check" }, ...otherFocus } },
            ...(step.service ? { running: run } : {}),
          },
        },
        done,
      },
    };
  }

  function machineFor(initial: string | null, restored: Partial<Ctx> = {}) {
    const states: Record<string, unknown> = { failed: { id: "failed", type: "final" } };
    for (const [id, step] of Object.entries(journey.steps)) if (!(parallel && tasks.includes(id))) states[key(id)] = sequentialState(id, step);
    if (parallel) {
      const next = afterTasks(journey);
      states.tasks = {
        type: "parallel",
        states: Object.fromEntries(tasks.map((id) => [key(id), taskRegion(id, journey.steps[id]!)])),
        onDone: next ? { target: target(next) } : fail("The journey stopped without an ending."),
      };
    }
    const first = parallel ? (initial && !tasks.includes(initial) && journey.steps[initial] ? key(initial) : "tasks") : key(initial && journey.steps[initial] ? initial : journey.start);
    const ctx: Ctx = { answers: {}, steps: {}, trail: [], result: null, error: null, failedAt: null, done: [], hops: 0, refused: null, ...restored };
    return createMachine({ id: `run-${journey.id}`, initial: first, context: ctx, states } as never);
  }

  // ---- reading the machine's state -------------------------------------------------------------

  const blank = (): RunState => ({ status: "idle", current: null, waiting: null, stepUp: null, prompt: null, answers: {}, steps: {}, trail: [], result: null, error: null });
  let state: RunState = blank();
  let actor: AnyActorRef | null = null;
  let stopped = false;

  const promptOf = (id: string): RunState["prompt"] => {
    const s = journey.steps[id]!;
    return { step: id, text: s.ask ?? "", fields: s.fields ?? [], sections: s.sections, submitLabel: s.submitLabel };
  };

  function view(snap: AnyMachineSnapshot): RunState {
    const c = snap.context as Ctx;
    const base = { answers: c.answers, steps: c.steps, trail: c.trail, result: null, error: null, prompt: null, waiting: null, stepUp: null };
    if (stopped) return { ...base, status: "failed", current: state.current, error: "Stopped." };
    if (snap.status === "error") return { ...base, status: "failed", current: state.current, error: snap.error instanceof Error ? snap.error.message : String(snap.error) };
    const value = snap.value as string | Record<string, unknown>;
    if (snap.status === "done") {
      if (value === "failed") return { ...base, status: "failed", current: c.failedAt, error: c.error };
      return { ...base, status: "done", current: String(value).replace(/^s_/, ""), result: c.result };
    }
    const [top, sub] = typeof value === "string" ? [value, null] : (Object.entries(value)[0] as [string, unknown]);
    if (top === "tasks") return taskView(c, sub as Record<string, unknown>, base);
    const id = top.replace(/^s_/, "");
    if (sub === "asking") return { ...base, status: "asking", current: id, prompt: promptOf(id), refused: c.refused?.step === id ? c.refused : null };
    if (sub === "waiting") return { ...base, status: "waiting", current: id, waiting: { step: id, role: journey.steps[id]?.role ?? null } };
    if (sub === "stepup") return { ...base, status: "step_up", current: id, stepUp: { step: id, level: levelNeeded(journey, journey.steps[id]!) } };
    return { ...base, status: "running", current: id };
  }

  function taskView(c: Ctx, regions: Record<string, unknown>, base: Omit<RunState, "status" | "current">): RunState {
    const list: TaskState[] = tasks.map((id) => {
      const step = journey.steps[id]!;
      const r = regions[key(id)];
      const at = typeof r === "string" ? r : r && typeof r === "object" ? (Object.entries(r)[0] as [string, unknown]) : null;
      const status: TaskState["status"] =
        r === "pending" ? "pending"
        : r === "ready" ? (step.ask !== undefined && notMine(step) ? "waiting" : "ready")
        : r === "done" ? "done"
        : r === "active" ? "running"
        : Array.isArray(at) && at[0] === "active" ? (at[1] === "asking" ? "asking" : at[1] === "waiting" ? "waiting" : at[1] === "stepup" ? "step_up" : "running") : "pending";
      return { step: id, label: step.label ?? id, role: step.role ?? null, status, after: step.after ?? [] };
    });
    const asking = list.find((t) => t.status === "asking");
    if (asking) return { ...base, status: "asking", current: asking.step, prompt: promptOf(asking.step), tasks: list };
    if (list.some((t) => t.status === "running")) return { ...base, status: "running", current: list.find((t) => t.status === "running")!.step, tasks: list };
    // A task of this person's is ready: not settled yet (settle() focuses it).
    if (list.some((t) => t.status === "ready")) return { ...base, status: "running", current: null, tasks: list };
    const up = list.find((t) => t.status === "step_up");
    if (up) return { ...base, status: "step_up", current: up.step, stepUp: { step: up.step, level: levelNeeded(journey, journey.steps[up.step]!) }, tasks: list };
    const waiting = list.find((t) => t.status === "waiting");
    if (waiting) return { ...base, status: "waiting", current: waiting.step, waiting: { step: waiting.step, role: waiting.role }, tasks: list };
    return { ...base, status: "running", current: null, tasks: list };
  }

  // ---- driving it ------------------------------------------------------------------------------

  function launch(initial: string | null, restored: Partial<Ctx> = {}) {
    actor?.stop();
    stopped = false;
    actor = createActor(machineFor(initial, restored));
    actor.subscribe({
      next: (snap) => {
        state = view(snap);
        onChange?.(state);
      },
      error: () => {
        // The snapshot carries the error (status "error"); view() reports it.
      },
    });
    actor.start();
  }

  /** Resolves when the run rests: asking, waiting, done or failed. A ready task of this person's is focused. */
  function settle(): Promise<RunState> {
    return new Promise((resolve) => {
      const check = () => {
        if (!actor) return resolve(state);
        state = view(actor.getSnapshot());
        if (state.tasks) {
          // Services finish first, as in a sequence (answer() resolves after them).
          if (state.tasks.some((t) => t.status === "running")) return;
          // Nothing focused: the first ready task this person may answer.
          if (state.status !== "asking") {
            const next = state.tasks.find((t) => t.status === "ready");
            if (next) return void actor.send({ type: "FOCUS", step: next.step });
          }
        }
        if (state.status !== "running" || state.tasks) {
          sub.unsubscribe();
          resolve(state);
        }
      };
      const sub = actor!.subscribe({ next: check, error: check });
      check();
    });
  }

  const resting = (s: RunState) => s;

  return {
    get state() {
      return state;
    },
    start: () => {
      launch(null);
      return settle().then(resting);
    },
    /** What to store when the run is handed over (or to keep it). */
    snapshot: (): RunSnapshot => ({ current: state.current, answers: state.answers, steps: state.steps, trail: state.trail }),
    /** Carry on from a stored run, as someone else (the journey's next role) or the same person. */
    resume: (snap: RunSnapshot, as?: RunActor) => {
      if (as) who = as;
      const done = parallel ? tasks.filter((id) => Object.hasOwn(snap.answers, id) || Object.hasOwn(snap.steps, id)) : [];
      launch(snap.current, { answers: snap.answers, steps: snap.steps, trail: snap.trail, done });
      return settle();
    },
    /** Hand a waiting run to another actor in place (the designer's preview: "continue as"), or carry on after a stronger sign-in (IDN-32). */
    continueAs: (as: RunActor) => {
      who = as;
      actor?.send({ type: "RECHECK" });
      return settle();
    },
    /** Parallel journeys: work on another ready task. */
    focus: (step: string) => {
      actor?.send({ type: "FOCUS", step });
      return settle();
    },
    /** Answer the current ask step. Returns problems instead of advancing when an answer is missing. */
    async answer(values: Record<string, unknown>): Promise<RunState | { problems: string[] }> {
      if (state.status !== "asking" || !state.prompt || !actor) return { problems: ["Nothing is waiting for an answer."] };
      const step = journey.steps[state.prompt.step]!;
      const sc = { answers: state.answers, steps: state.steps, context };
      const problems = formProblems(step.fields ?? [], values, sc);
      if (problems.length) return { problems };
      actor.send({ type: "SUBMIT", step: step.id, answers: keptAnswers(step.fields ?? [], values, sc) });
      return settle();
    },
    stop() {
      stopped = true;
      actor?.stop();
      state = { ...state, status: "failed", error: "Stopped.", prompt: null };
      onChange?.(state);
      return state;
    },
  };
}

export type Runner = ReturnType<typeof createRunner>;

/**
 * Runs a journey again from its stored answers and service results, without asking anyone or
 * calling any service, to see where it stands. The server uses it to check a handed-over run (every
 * answer valid for its step, in the order the journey reaches them) and to find who answers next,
 * which the client never says. The result waits at the first step without an answer, or has ended.
 * A parallel journey's tasks are answered in any order the stored answers allow.
 */
export async function replay(
  journey: Journey,
  run: Pick<RunSnapshot, "answers" | "steps">,
  context: Scope = {},
): Promise<{ ok: true; state: RunState; answered: string[] } | { ok: false; problems: string[] }> {
  // A guard's call is read back from the run too (RTN-11): replaying never calls the hook again.
  const recorded: ServiceHandler = async (_input, { step, guard }) => {
    const id = guard ? guardKey(step.id) : step.id;
    const out = Object.hasOwn(run.steps, id) ? run.steps[id] : undefined;
    if (out === undefined) throw new Error(guard ? `The check on "${step.label ?? step.id}" has no answer kept.` : `The step "${step.label ?? step.id}" hasn't run.`);
    if (out && typeof out === "object" && typeof (out as { error?: unknown }).error === "string") throw new Error((out as { error: string }).error);
    return out;
  };
  const names = [...new Set(Object.values(journey.steps).flatMap((s) => [...(s.service ? [s.service] : []), ...(s.guard?.call ? [s.guard.call] : [])]))];
  const runner = createRunner(journey, { services: Object.fromEntries(names.map((n) => [n, recorded])), context });
  let state = await runner.start();
  const answered: string[] = [];
  for (let i = 0; i < MAX_HOPS && state.status === "asking" && state.prompt; i++) {
    let at = state.prompt.step;
    if (!Object.hasOwn(run.answers, at)) {
      // A parallel journey: another ready task may have its answers.
      const other = state.tasks?.find((t) => t.status === "ready" && Object.hasOwn(run.answers, t.step) && !answered.includes(t.step));
      if (!other) break;
      state = await runner.focus(other.step);
      if (state.status !== "asking" || !state.prompt) break;
      at = state.prompt.step;
    }
    answered.push(at);
    const r = await runner.answer(run.answers[at]!);
    if ("problems" in r) return { ok: false, problems: r.problems.map((p) => `${journey.steps[at]?.label ?? at}: ${p}`) };
    // A guard that stops stored answers (RTN-9): the run isn't valid as sent.
    if (r.refused) return { ok: false, problems: [`${journey.steps[at]?.label ?? at}: ${r.refused.reason}`] };
    state = r;
  }
  const extra = Object.keys(run.answers).filter((k) => !answered.includes(k));
  if (extra.length) return { ok: false, problems: [`Answers for steps the journey didn't reach: ${extra.join(", ")}.`] };
  if (state.status === "failed") return { ok: false, problems: [state.error ?? "The journey failed."] };
  return { ok: true, state, answered };
}
