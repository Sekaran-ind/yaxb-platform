// The journey library (docs/specs/05-journeys-and-forms.md LIB-1..12): libraries that hold
// services, journeys and questionnaires (one YAML document per entry), with revisions, a review,
// archiving, and the organisation's roles.
//
//   draft ──submit──▶ in_review ──accept──▶ accepted   (published: the kiosk serves it)
//     ▲                    │
//     └──── save ◀─────────┴──reject──▶ rejected (with a note)
//   archived: out of the library's working set and off the kiosk; restore brings it back as a draft.
//
// Saving a new revision of an accepted entry doesn't take it off the kiosk: `published_yaml` keeps
// the accepted version until a reviewer accepts the next one.
//
// Who may do what (members' roles; the ADMIN_TOKEN holder may do everything):
//   view      any signed-in member
//   edit      administrator, moderator, curator: create, save, submit, archive, restore
//   review    reviewer, administrator: accept or reject what is in review, never their own submission
//   manage    administrator: roles, archiving and restoring whole libraries
import {
  canInitiate,
  checkDocument,
  compileBundle,
  DEFAULT_ROLES,
  parseDocument,
  ROLE_ID,
  VISITOR_ROLE,
  type BundleProblem,
  type Role,
} from "@sekaran-ind/yaxb-journeys";
import { z } from "zod";
import { auditEvent, type AuditAction, type AuditEvent } from "../moderators/index.js";

export const ENTRY_KINDS = ["service", "journey", "questionnaire"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ENTRY_STATUSES = ["draft", "in_review", "accepted", "rejected", "archived"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const EDITOR_ROLES = ["administrator", "moderator", "curator"] as const;
export const REVIEWER_ROLES = ["reviewer", "administrator"] as const;
/** The id the ADMIN_TOKEN holder acts as. */
export const ADMIN_ACTOR_ID = "admin";

/** Larger documents are refused. */
export const MAX_ENTRY_BYTES = 64 * 1024;

export type CustomRole = Role & { created_at: string };

export type Library = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LibraryEntry = {
  id: string;
  library_id: string;
  kind: EntryKind;
  /** The document's own `id`. */
  doc_id: string;
  title: string;
  yaml: string;
  status: EntryStatus;
  revision: number;
  published_yaml: string | null;
  published_revision: number | null;
  submitted_by: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  updated_by_name: string | null;
};

export type EntryRevision = { entry_id: string; revision: number; yaml: string; at: string; by_id: string | null; by_name: string | null; note: string | null };

export interface LibraryStore {
  roles(): Promise<CustomRole[]>;
  putRole(r: CustomRole): Promise<void>;
  removeRole(id: string): Promise<boolean>;
  libraries(): Promise<Library[]>;
  library(id: string): Promise<Library | null>;
  putLibrary(l: Library): Promise<void>;
  /** Every entry, or one library's. */
  entries(libraryId?: string): Promise<LibraryEntry[]>;
  entry(id: string): Promise<LibraryEntry | null>;
  putEntry(e: LibraryEntry): Promise<void>;
  revisions(entryId: string): Promise<EntryRevision[]>;
  addRevision(r: EntryRevision): Promise<void>;
}

/** Who is acting: a member (their id, name and roles) or the ADMIN_TOKEN holder (`admin`). */
export type LibraryActor = { id: string; name: string; roles: readonly string[]; admin: boolean };

/** A refused library action, with the HTTP status that fits. */
export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

const has = (a: LibraryActor, roles: readonly string[]) => a.admin || a.roles.some((r) => roles.includes(r));
export const permissionsOf = (a: LibraryActor) => ({
  view: a.admin || a.roles.length > 0,
  edit: has(a, EDITOR_ROLES),
  review: has(a, REVIEWER_ROLES),
  manage: has(a, ["administrator"]),
});
export type LibraryPermissions = ReturnType<typeof permissionsOf>;

// ---- input --------------------------------------------------------------------------------------

export const roleInputSchema = z.strictObject({
  id: z.string().trim().regex(ROLE_ID, "A role id is lower-case words joined by '-', such as front-desk."),
  label: z.string().trim().min(1, "Give the role a name.").max(40),
  description: z.string().trim().max(200).optional(),
});
export const roleUpdateSchema = roleInputSchema.omit({ id: true }).partial();
export const libraryInputSchema = z.strictObject({
  name: z.string().trim().min(1, "Give the library a name.").max(80),
  description: z.string().trim().max(400).optional(),
});
export const entryInputSchema = z.strictObject({
  kind: z.enum(ENTRY_KINDS),
  yaml: z.string().max(MAX_ENTRY_BYTES, "That document is too large."),
});
export const entrySaveSchema = z.strictObject({
  yaml: z.string().max(MAX_ENTRY_BYTES, "That document is too large."),
  note: z.string().trim().max(200).optional(),
});
export const reviewInputSchema = z
  .strictObject({ decision: z.enum(["accept", "reject"]), note: z.string().trim().max(1000).optional() })
  .refine((r) => r.decision === "accept" || Boolean(r.note), { message: "Say why it is rejected.", path: ["note"] });

/** Parse input, refusing with the first problem as a LibraryError. */
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new LibraryError(r.error.issues[0]?.message ?? "Check the details.");
  return r.data;
}

// ---- the service ----------------------------------------------------------------------------------

export type LibraryOptions = {
  /** Handler names journeys may call (the kiosk's JOURNEY_SERVICES). */
  services?: readonly string[];
  /** Screen ids service items may open. */
  screens?: readonly string[];
  /** Where audit events go (the moderators' audit log). */
  audit?: (e: AuditEvent) => Promise<void>;
  now?: () => Date;
};

/** The document's kind, id and title from its YAML, or the problem. */
function readDocument(yaml: string): { kind: string; id: string; title: string } | { error: string } {
  const p = parseDocument(yaml);
  if (!p.ok) return { error: p.error };
  const { kind, id, title } = p.doc;
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) return { error: "The document needs an id: lower-case words joined by '-'." };
  return { kind: String(kind ?? ""), id, title: typeof title === "string" && title.trim() ? title.trim() : id };
}

/** Role ids a document names (a service's roles, a journey's initiate and complete). */
function rolesNamed(yaml: string): string[] {
  const p = parseDocument(yaml);
  if (!p.ok) return [];
  const r = p.doc.roles as unknown;
  if (Array.isArray(r)) return r.filter((x): x is string => typeof x === "string");
  if (r && typeof r === "object") return Object.values(r as Record<string, unknown>).flatMap((v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []));
  return [];
}

export function createLibraryService(store: LibraryStore, options: LibraryOptions = {}) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const audit = async (a: LibraryActor, action: AuditAction, target: string | null, details?: Record<string, unknown>) =>
    options.audit?.(auditEvent({ actor_type: a.id === ADMIN_ACTOR_ID ? "admin" : "moderator", actor_id: a.id === ADMIN_ACTOR_ID ? null : a.id, actor_name: a.name, action, target_id: target, details }));

  const need = (a: LibraryActor, what: keyof LibraryPermissions) => {
    if (!permissionsOf(a)[what]) {
      const say = { view: "Sign in as a team member to see the library.", edit: "Your roles can't change the library.", review: "Only reviewers can accept or reject.", manage: "Only an administrator can do that." };
      throw new LibraryError(say[what], 403);
    }
  };

  async function catalogue(): Promise<Role[]> {
    const custom = await store.roles();
    return [...DEFAULT_ROLES, ...custom.map(({ created_at: _, ...r }) => ({ ...r, builtin: false }))];
  }
  const compileOptions = async () => ({ services: options.services, screens: options.screens, roles: (await catalogue()).map((r) => r.id) });

  async function getLibrary(id: string) {
    const l = await store.library(id);
    if (!l) throw new LibraryError("No such library.", 404);
    return l;
  }
  async function getEntry(id: string) {
    const e = await store.entry(id);
    if (!e) throw new LibraryError("No such entry.", 404);
    return e;
  }

  /** The other working entries of a library (not archived), as YAML. */
  const othersOf = async (e: Pick<LibraryEntry, "id" | "library_id">) => (await store.entries(e.library_id)).filter((x) => x.id !== e.id && x.status !== "archived").map((x) => x.yaml);
  /** Published entries of a library (what the kiosk serves), as YAML. */
  const publishedOf = async (libraryId: string, except?: string) =>
    (await store.entries(libraryId)).filter((x) => x.id !== except && x.status !== "archived" && x.published_yaml).map((x) => x.published_yaml!);

  async function problemsOf(e: Pick<LibraryEntry, "id" | "library_id" | "yaml">): Promise<BundleProblem[]> {
    return checkDocument(e.yaml, await othersOf(e), await compileOptions()).problems;
  }

  /** A document for a new or saved entry: one mapping with the expected kind and an id unique in the library. */
  async function validDocument(libraryId: string, kind: EntryKind, yaml: string, self?: string) {
    if (!yaml.trim()) throw new LibraryError("The document is empty.");
    const d = readDocument(yaml);
    if ("error" in d) throw new LibraryError(d.error);
    if (d.kind !== kind) throw new LibraryError(`This entry is a ${kind}: the document needs kind: ${kind}.`);
    const clash = (await store.entries(libraryId)).find((x) => x.id !== self && x.kind === kind && x.doc_id === d.id && x.status !== "archived");
    if (clash) throw new LibraryError(`This library already has a ${kind} with the id '${d.id}'.`, 409);
    return d;
  }

  return {
    store,
    permissionsOf,
    catalogue,

    // ---- roles -----------------------------------------------------------------------------------
    async addRole(a: LibraryActor, input: unknown): Promise<Role> {
      need(a, "manage");
      const r = parse(roleInputSchema, input);
      if (r.id === VISITOR_ROLE || (await catalogue()).some((x) => x.id === r.id)) throw new LibraryError(`There is already a role '${r.id}'.`, 409);
      await store.putRole({ id: r.id, label: r.label, ...(r.description ? { description: r.description } : {}), created_at: now() });
      await audit(a, "library.role_added", r.id, { label: r.label });
      return { id: r.id, label: r.label, description: r.description, builtin: false };
    },

    async updateRole(a: LibraryActor, id: string, input: unknown): Promise<Role> {
      need(a, "manage");
      const custom = (await store.roles()).find((r) => r.id === id);
      if (!custom) throw new LibraryError(DEFAULT_ROLES.some((r) => r.id === id) ? "Built-in roles can't be changed." : "No such role.", DEFAULT_ROLES.some((r) => r.id === id) ? 409 : 404);
      const p = parse(roleUpdateSchema, input);
      const next = { ...custom, ...(p.label ? { label: p.label } : {}), ...(p.description !== undefined ? { description: p.description || undefined } : {}) };
      await store.putRole(next);
      await audit(a, "library.role_changed", id, { label: next.label });
      const { created_at: _, ...role } = next;
      return { ...role, builtin: false };
    },

    /** Remove a custom role, unless a working entry still names it. */
    async removeRole(a: LibraryActor, id: string, memberRoles: readonly string[][] = []) {
      need(a, "manage");
      if (DEFAULT_ROLES.some((r) => r.id === id)) throw new LibraryError("Built-in roles can't be removed.", 409);
      const users = (await store.entries()).filter((e) => e.status !== "archived" && [e.yaml, e.published_yaml ?? ""].some((y) => rolesNamed(y).includes(id)));
      if (users.length) throw new LibraryError(`'${id}' is used by ${users.map((e) => `${e.kind} '${e.doc_id}'`).join(", ")}. Take it out of those first.`, 409);
      if (memberRoles.some((roles) => roles.includes(id))) throw new LibraryError(`A team member still has the role '${id}'. Change their roles in Administration first.`, 409);
      if (!(await store.removeRole(id))) throw new LibraryError("No such role.", 404);
      await audit(a, "library.role_removed", id);
    },

    // ---- libraries -------------------------------------------------------------------------------
    async libraries(a: LibraryActor) {
      need(a, "view");
      const [libs, entries] = await Promise.all([store.libraries(), store.entries()]);
      return libs.map((l) => {
        const mine = entries.filter((e) => e.library_id === l.id);
        const count = (s: EntryStatus) => mine.filter((e) => e.status === s).length;
        return { ...l, counts: { total: mine.length, draft: count("draft"), in_review: count("in_review"), accepted: count("accepted"), rejected: count("rejected"), archived: count("archived") } };
      });
    },

    async createLibrary(a: LibraryActor, input: unknown): Promise<Library> {
      need(a, "edit");
      const p = parse(libraryInputSchema, input);
      if ((await store.libraries()).some((l) => l.name.toLowerCase() === p.name.toLowerCase())) throw new LibraryError(`There is already a library called "${p.name}".`, 409);
      const at = now();
      const l: Library = { id: crypto.randomUUID(), name: p.name, description: p.description || null, status: "active", created_by: a.name, created_at: at, updated_at: at };
      await store.putLibrary(l);
      await audit(a, "library.created", l.id, { name: l.name });
      return l;
    },

    async updateLibrary(a: LibraryActor, id: string, input: unknown): Promise<Library> {
      need(a, "edit");
      const l = await getLibrary(id);
      const p = parse(libraryInputSchema.partial(), input);
      const next = { ...l, ...(p.name ? { name: p.name } : {}), ...(p.description !== undefined ? { description: p.description || null } : {}), updated_at: now() };
      await store.putLibrary(next);
      await audit(a, "library.changed", id, { name: next.name });
      return next;
    },

    /** Archive or restore a whole library: an archived library's entries leave the kiosk. */
    async setLibraryStatus(a: LibraryActor, id: string, status: Library["status"]): Promise<Library> {
      need(a, "manage");
      const l = await getLibrary(id);
      const next = { ...l, status, updated_at: now() };
      await store.putLibrary(next);
      await audit(a, status === "archived" ? "library.archived" : "library.restored", id, { name: l.name });
      return next;
    },

    // ---- entries ---------------------------------------------------------------------------------
    async entries(a: LibraryActor, libraryId: string) {
      need(a, "view");
      await getLibrary(libraryId);
      return store.entries(libraryId);
    },

    async entry(a: LibraryActor, id: string) {
      need(a, "view");
      const e = await getEntry(id);
      return { entry: e, revisions: await store.revisions(id), problems: await problemsOf(e) };
    },

    async createEntry(a: LibraryActor, libraryId: string, input: unknown) {
      need(a, "edit");
      const l = await getLibrary(libraryId);
      if (l.status === "archived") throw new LibraryError("This library is archived. Restore it first.", 409);
      const p = parse(entryInputSchema, input);
      const d = await validDocument(libraryId, p.kind, p.yaml);
      const at = now();
      const e: LibraryEntry = {
        id: crypto.randomUUID(),
        library_id: libraryId,
        kind: p.kind,
        doc_id: d.id,
        title: d.title,
        yaml: p.yaml,
        status: "draft",
        revision: 1,
        published_yaml: null,
        published_revision: null,
        submitted_by: null,
        submitted_by_name: null,
        submitted_at: null,
        reviewed_by: null,
        reviewed_by_name: null,
        reviewed_at: null,
        review_note: null,
        created_at: at,
        updated_at: at,
        updated_by_name: a.name,
      };
      await store.putEntry(e);
      await store.addRevision({ entry_id: e.id, revision: 1, yaml: p.yaml, at, by_id: a.id, by_name: a.name, note: "Created" });
      await audit(a, "library.entry_saved", e.id, { kind: e.kind, id: e.doc_id, revision: 1 });
      return { entry: e, problems: await problemsOf(e) };
    },

    /** Save a new revision. An entry in review goes back to draft (it must be submitted again). */
    async saveEntry(a: LibraryActor, id: string, input: unknown) {
      need(a, "edit");
      const e = await getEntry(id);
      if (e.status === "archived") throw new LibraryError("This entry is archived. Restore it first.", 409);
      const p = parse(entrySaveSchema, input);
      if (p.yaml === e.yaml) return { entry: e, problems: await problemsOf(e) };
      const d = await validDocument(e.library_id, e.kind, p.yaml, e.id);
      const at = now();
      const next: LibraryEntry = { ...e, yaml: p.yaml, doc_id: d.id, title: d.title, status: "draft", revision: e.revision + 1, updated_at: at, updated_by_name: a.name };
      await store.putEntry(next);
      await store.addRevision({ entry_id: id, revision: next.revision, yaml: p.yaml, at, by_id: a.id, by_name: a.name, note: p.note || null });
      await audit(a, "library.entry_saved", id, { kind: e.kind, id: d.id, revision: next.revision });
      return { entry: next, problems: await problemsOf(next) };
    },

    /** Send the latest revision for review: it must compile with the rest of its library. */
    async submit(a: LibraryActor, id: string) {
      need(a, "edit");
      const e = await getEntry(id);
      if (e.status !== "draft" && e.status !== "rejected") throw new LibraryError(e.status === "in_review" ? "It is already in review." : `A ${e.status} entry can't be submitted: save a change first.`, 409);
      const errors = (await problemsOf(e)).filter((p) => p.level === "error");
      if (errors.length) throw new LibraryError(`Fix ${errors.length === 1 ? "this problem" : `these ${errors.length} problems`} first: ${errors.map((p) => p.message).join("; ")}`);
      const next: LibraryEntry = { ...e, status: "in_review", submitted_by: a.id, submitted_by_name: a.name, submitted_at: now(), reviewed_by: null, reviewed_by_name: null, reviewed_at: null, review_note: null };
      await store.putEntry(next);
      await audit(a, "library.entry_submitted", id, { kind: e.kind, id: e.doc_id, revision: e.revision });
      return next;
    },

    /** Accept (publish) or reject what is in review. A reviewer never reviews their own submission. */
    async review(a: LibraryActor, id: string, input: unknown) {
      need(a, "review");
      const e = await getEntry(id);
      if (e.status !== "in_review") throw new LibraryError("Only entries in review can be accepted or rejected.", 409);
      if (e.submitted_by === a.id && a.id !== ADMIN_ACTOR_ID) throw new LibraryError("You submitted this one: another reviewer has to review it.", 403);
      const r = parse(reviewInputSchema, input);
      if (r.decision === "accept") {
        // It must work with what the kiosk already serves from this library.
        const { problems } = checkDocument(e.yaml, await publishedOf(e.library_id, e.id), await compileOptions());
        const errors = problems.filter((p) => p.level === "error");
        if (errors.length) throw new LibraryError(`It doesn't work with what is published yet: ${errors.map((p) => p.message).join("; ")}. Accept what it refers to first.`);
      }
      const accepted = r.decision === "accept";
      const next: LibraryEntry = {
        ...e,
        status: accepted ? "accepted" : "rejected",
        ...(accepted ? { published_yaml: e.yaml, published_revision: e.revision } : {}),
        reviewed_by: a.id,
        reviewed_by_name: a.name,
        reviewed_at: now(),
        review_note: r.note || null,
      };
      await store.putEntry(next);
      await audit(a, accepted ? "library.entry_accepted" : "library.entry_rejected", id, { kind: e.kind, id: e.doc_id, revision: e.revision });
      return next;
    },

    /** Archive: off the kiosk and out of the working set. Restore brings it back as a draft, to be reviewed again. */
    async setEntryArchived(a: LibraryActor, id: string, archived: boolean) {
      need(a, "edit");
      const e = await getEntry(id);
      if (archived === (e.status === "archived")) return e;
      if (!archived) await validDocument(e.library_id, e.kind, e.yaml, e.id);
      const next: LibraryEntry = archived ? { ...e, status: "archived", published_yaml: null, published_revision: null, updated_at: now() } : { ...e, status: "draft", updated_at: now() };
      await store.putEntry(next);
      await audit(a, archived ? "library.entry_archived" : "library.entry_restored", id, { kind: e.kind, id: e.doc_id });
      return next;
    },

    /** Everything waiting for a review, across active libraries. */
    async reviewQueue(a: LibraryActor) {
      need(a, "view");
      const active = new Set((await store.libraries()).filter((l) => l.status === "active").map((l) => l.id));
      return (await store.entries()).filter((e) => e.status === "in_review" && active.has(e.library_id));
    },

    /**
     * What the kiosk loads: each active library's published documents, and the ids of the journeys
     * this viewer may start (their initiate roles). The kiosk compiles every document, so services
     * still compile, and offers only the allowed journeys (their items are dropped).
     */
    async published(viewerRoles: readonly string[] = [], { all = false } = {}) {
      const [libs, entries, roles] = await Promise.all([store.libraries(), store.entries(), catalogue()]);
      const opts = await compileOptions();
      const libraries = libs
        .filter((l) => l.status === "active")
        .map((l) => {
          const docs = entries.filter((e) => e.library_id === l.id && e.status !== "archived" && e.published_yaml);
          const bundle = compileBundle(
            docs.map((e) => e.published_yaml!),
            opts,
          );
          const allowed = bundle.journeys.filter((j) => all || canInitiate(j, viewerRoles)).map((j) => j.id);
          return { id: l.id, name: l.name, sources: docs.map((e) => e.published_yaml!), allowed };
        })
        .filter((l) => l.sources.length);
      return { roles, libraries };
    },
  };
}
export type LibraryService = ReturnType<typeof createLibraryService>;

/** In memory (tests). */
export function createMemoryLibraryStore(): LibraryStore {
  const roles = new Map<string, CustomRole>();
  const libs = new Map<string, Library>();
  const entries = new Map<string, LibraryEntry>();
  const revs: EntryRevision[] = [];
  const copy = <T>(x: T): T => structuredClone(x);
  return {
    async roles() {
      return [...roles.values()].map(copy).sort((a, b) => a.label.localeCompare(b.label));
    },
    async putRole(r) {
      roles.set(r.id, copy(r));
    },
    async removeRole(id) {
      return roles.delete(id);
    },
    async libraries() {
      return [...libs.values()].map(copy).sort((a, b) => a.name.localeCompare(b.name));
    },
    async library(id) {
      const l = libs.get(id);
      return l ? copy(l) : null;
    },
    async putLibrary(l) {
      libs.set(l.id, copy(l));
    },
    async entries(libraryId) {
      return [...entries.values()]
        .filter((e) => !libraryId || e.library_id === libraryId)
        .map(copy)
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
    },
    async entry(id) {
      const e = entries.get(id);
      return e ? copy(e) : null;
    },
    async putEntry(e) {
      entries.set(e.id, copy(e));
    },
    async revisions(entryId) {
      return revs.filter((r) => r.entry_id === entryId).sort((a, b) => b.revision - a.revision).map(copy);
    },
    async addRevision(r) {
      revs.push(copy(r));
    },
  };
}
