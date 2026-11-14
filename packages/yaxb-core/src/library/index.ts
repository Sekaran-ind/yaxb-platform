// The Service Catalogue (docs/specs/05-journeys-and-forms.md LIB-1..20): libraries of services.
// Each entry is one service with its journeys and their screens inside (yaxb-journeys nested.ts),
// with its own roles, revisions, a review, archiving and an audit trail.
//
//   draft ──submit──▶ in_review ──accept──▶ accepted   (published: kiosks may load it)
//     ▲                    │
//     └──── save ◀─────────┴──reject──▶ rejected (with a note)
//   archived: out of the catalogue and off kiosks; restore brings it back as a draft.
//
// Saving a new revision of an accepted service doesn't take it off kiosks: `published_yaml` keeps
// the accepted version until a reviewer accepts the next one.
//
// Who may do what:
//   anyone     design services: a guest (no sign-in) owns what they create, through their session,
//              and may save, submit and archive their own services
//   view       any signed-in member sees every service
//   edit       administrator, moderator, curator: any service; create and rename libraries
//   review     reviewer, administrator: accept or reject what is in review, never their own submission
//   manage     administrator: the organisation's roles, archiving and restoring whole libraries
// The ADMIN_TOKEN holder may do everything.
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

/** Entries are services (with their journeys and screens inside). */
export const ENTRY_KINDS = ["service"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ENTRY_STATUSES = ["draft", "in_review", "accepted", "rejected", "archived"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const EDITOR_ROLES = ["administrator", "moderator", "curator"] as const;
export const REVIEWER_ROLES = ["reviewer", "administrator"] as const;
/** The id the ADMIN_TOKEN holder acts as. */
export const ADMIN_ACTOR_ID = "admin";
/** Who seeds the catalogue with the kiosk's own services. */
export const SYSTEM_ACTOR_ID = "system";
/** The library a service goes to when its author doesn't choose one. */
export const DEFAULT_LIBRARY_NAME = "Service catalogue";
/** A guest's services that aren't archived, at most. */
export const MAX_GUEST_SERVICES = 20;

/** Larger documents are refused. */
export const MAX_ENTRY_BYTES = 128 * 1024;

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
  /** The service's own `id`. */
  doc_id: string;
  title: string;
  yaml: string;
  status: EntryStatus;
  revision: number;
  published_yaml: string | null;
  published_revision: number | null;
  /** Who created it: a member's id, `admin`, or `guest:<session>`. */
  owner_id: string | null;
  owner_name: string | null;
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

/**
 * Who is acting: a member (their id, name and roles), the ADMIN_TOKEN holder (`admin`), or a guest
 * (`guest:<session>`, no roles) who may only work on their own services.
 */
export type LibraryActor = { id: string; name: string; roles: readonly string[]; admin: boolean; guest?: boolean };

/** A refused action, with the HTTP status that fits. */
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
  /** Create services (everyone). */
  design: true,
  /** See every service (members). */
  view: !a.guest && (a.admin || a.roles.length > 0),
  edit: has(a, EDITOR_ROLES),
  review: has(a, REVIEWER_ROLES),
  manage: has(a, ["administrator"]),
});
export type LibraryPermissions = ReturnType<typeof permissionsOf>;
const owns = (a: LibraryActor, e: Pick<LibraryEntry, "owner_id">) => Boolean(e.owner_id && e.owner_id === a.id);
export const canSee = (a: LibraryActor, e: LibraryEntry) => permissionsOf(a).view || owns(a, e);
export const canChange = (a: LibraryActor, e: LibraryEntry) => permissionsOf(a).edit || owns(a, e);

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
  kind: z.enum(ENTRY_KINDS).default("service"),
  yaml: z.string().max(MAX_ENTRY_BYTES, "That service is too large."),
});
export const entrySaveSchema = z.strictObject({
  yaml: z.string().max(MAX_ENTRY_BYTES, "That service is too large."),
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
  /** Where audit events go (the moderators' audit log). */
  audit?: (e: AuditEvent) => Promise<void>;
  /** Read an entry's audit trail. */
  auditTrail?: (targetId: string) => Promise<AuditEvent[]>;
  /** Told about every review (the Service Designer learns from drafts). Its failures don't fail the review. */
  onReviewed?: (entry: LibraryEntry, decision: "accepted" | "rejected", note: string | null, reviewer: LibraryActor) => Promise<unknown>;
  now?: () => Date;
};

/** The document's id and title from its YAML, or the problem. */
function readDocument(yaml: string): { kind: string; id: string; title: string } | { error: string } {
  const p = parseDocument(yaml);
  if (!p.ok) return { error: p.error };
  const { kind, id, title } = p.doc;
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) return { error: "The service needs an id: lower-case words joined by '-'." };
  return { kind: String(kind ?? ""), id, title: typeof title === "string" && title.trim() ? title.trim() : id };
}

/** Role ids a service names: its own roles and its journeys' initiate and complete. */
export function rolesNamed(yaml: string | null): string[] {
  if (!yaml) return [];
  const p = parseDocument(yaml);
  if (!p.ok) return [];
  const ids = (v: unknown) => (Array.isArray(v) ? v.flatMap((x) => (typeof x === "string" ? [x] : x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string" ? [(x as { id: string }).id] : [])) : []);
  const journeys = Array.isArray(p.doc.journeys) ? (p.doc.journeys as Record<string, unknown>[]) : [];
  const fromJourneys = journeys.flatMap((j) => {
    const r = (j?.roles ?? {}) as Record<string, unknown>;
    return [...ids(r.initiate), ...ids(r.complete)];
  });
  return [...new Set([...ids(p.doc.roles), ...fromJourneys])];
}

export function createLibraryService(store: LibraryStore, options: LibraryOptions = {}) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const audit = async (a: LibraryActor, action: AuditAction, target: string | null, details?: Record<string, unknown>) =>
    options.audit?.(
      auditEvent({
        actor_type: a.id === ADMIN_ACTOR_ID ? "admin" : a.guest ? "guest" : "moderator",
        actor_id: a.id === ADMIN_ACTOR_ID ? null : a.id,
        actor_name: a.name,
        action,
        target_id: target,
        details,
      }),
    );

  const need = (a: LibraryActor, what: keyof LibraryPermissions) => {
    if (!permissionsOf(a)[what]) {
      const say: Record<keyof LibraryPermissions, string> = {
        design: "",
        view: "Sign in as a team member to see every service.",
        edit: "Your roles can't change that.",
        review: "Only reviewers can accept or reject.",
        manage: "Only an administrator can do that.",
      };
      throw new LibraryError(say[what], 403);
    }
  };

  async function catalogue(): Promise<Role[]> {
    const custom = await store.roles();
    return [...DEFAULT_ROLES, ...custom.map(({ created_at: _, ...r }) => ({ ...r, builtin: false }))];
  }
  const compileOptions = async () => ({ services: options.services, roles: (await catalogue()).map((r) => r.id) });

  async function getLibrary(id: string) {
    const l = await store.library(id);
    if (!l) throw new LibraryError("No such library.", 404);
    return l;
  }
  async function getEntry(a: LibraryActor, id: string) {
    const e = await store.entry(id);
    if (!e || !canSee(a, e)) throw new LibraryError("No such service.", 404);
    return e;
  }
  const mustChange = (a: LibraryActor, e: LibraryEntry) => {
    if (!canChange(a, e)) throw new LibraryError("Only its author or an editor can change this service.", 403);
  };

  /** The default library, created the first time someone needs it. */
  async function defaultLibrary(a: LibraryActor): Promise<Library> {
    const libs = await store.libraries();
    const found = libs.find((l) => l.status === "active" && l.name === DEFAULT_LIBRARY_NAME);
    if (found) return found;
    const at = now();
    const l: Library = { id: crypto.randomUUID(), name: DEFAULT_LIBRARY_NAME, description: "Services anyone has designed.", status: "active", created_by: a.name, created_at: at, updated_at: at };
    await store.putLibrary(l);
    await audit(a, "library.created", l.id, { name: l.name });
    return l;
  }

  async function problemsOf(yaml: string): Promise<BundleProblem[]> {
    return checkDocument(yaml, [], await compileOptions()).problems;
  }

  /** A service document: one mapping with kind service, journeys inside, and an id unique in the catalogue. */
  async function validDocument(yaml: string, self?: string) {
    if (!yaml.trim()) throw new LibraryError("The service is empty.");
    const d = readDocument(yaml);
    if ("error" in d) throw new LibraryError(d.error);
    if (d.kind !== "service") throw new LibraryError("The document needs kind: service.");
    const clash = (await store.entries()).find((x) => x.id !== self && x.doc_id === d.id && x.status !== "archived");
    if (clash) throw new LibraryError(`The catalogue already has a service with the id '${d.id}' ("${clash.title}"). Choose another id.`, 409);
    return d;
  }

  return {
    store,
    permissionsOf,
    catalogue,

    // ---- the organisation's roles ------------------------------------------------------------------
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
      const builtin = DEFAULT_ROLES.some((r) => r.id === id);
      if (!custom) throw new LibraryError(builtin ? "Built-in roles can't be changed." : "No such role.", builtin ? 409 : 404);
      const p = parse(roleUpdateSchema, input);
      const next = { ...custom, ...(p.label ? { label: p.label } : {}), ...(p.description !== undefined ? { description: p.description || undefined } : {}) };
      await store.putRole(next);
      await audit(a, "library.role_changed", id, { label: next.label });
      const { created_at: _, ...role } = next;
      return { ...role, builtin: false };
    },

    /** Remove an organisation role, unless a service or a member still has it. */
    async removeRole(a: LibraryActor, id: string, memberRoles: readonly string[][] = []) {
      need(a, "manage");
      if (DEFAULT_ROLES.some((r) => r.id === id)) throw new LibraryError("Built-in roles can't be removed.", 409);
      const users = (await store.entries()).filter((e) => e.status !== "archived" && (rolesNamed(e.yaml).includes(id) || rolesNamed(e.published_yaml).includes(id)));
      if (users.length) throw new LibraryError(`'${id}' is used by ${users.map((e) => `"${e.title}"`).join(", ")}. Take it out of those first.`, 409);
      if (memberRoles.some((roles) => roles.includes(id))) throw new LibraryError(`A team member still has the role '${id}'. Change their roles in Administration first.`, 409);
      if (!(await store.removeRole(id))) throw new LibraryError("No such role.", 404);
      await audit(a, "library.role_removed", id);
    },

    // ---- libraries -------------------------------------------------------------------------------
    /** Libraries, with counts. Guests see active ones (to pick where a service goes), counting only theirs. */
    async libraries(a: LibraryActor) {
      const [libs, entries] = await Promise.all([store.libraries(), store.entries()]);
      return libs
        .filter((l) => permissionsOf(a).view || l.status === "active")
        .map((l) => {
          const mine = entries.filter((e) => e.library_id === l.id && canSee(a, e));
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

    /** Archive or restore a whole library: an archived library's services leave the catalogue. */
    async setLibraryStatus(a: LibraryActor, id: string, status: Library["status"]): Promise<Library> {
      need(a, "manage");
      const l = await getLibrary(id);
      const next = { ...l, status, updated_at: now() };
      await store.putLibrary(next);
      await audit(a, status === "archived" ? "library.archived" : "library.restored", id, { name: l.name });
      return next;
    },

    // ---- services --------------------------------------------------------------------------------
    /** The services this actor may see: every one for members, their own for guests. One library, or all. */
    async entries(a: LibraryActor, libraryId?: string) {
      if (libraryId) await getLibrary(libraryId);
      return (await store.entries(libraryId)).filter((e) => canSee(a, e));
    },

    async entry(a: LibraryActor, id: string) {
      const e = await getEntry(a, id);
      return { entry: e, revisions: await store.revisions(id), problems: await problemsOf(e.yaml), canChange: canChange(a, e) };
    },

    /** What happened to a service: created, saved, submitted, reviewed, archived (never its content). */
    async auditTrail(a: LibraryActor, id: string) {
      await getEntry(a, id);
      return options.auditTrail ? options.auditTrail(id) : [];
    },

    /** A new service, as a draft owned by its author. `libraryId` "default" (or none): the catalogue's default library. */
    async createEntry(a: LibraryActor, libraryId: string | null, input: unknown) {
      const l = !libraryId || libraryId === "default" ? await defaultLibrary(a) : await getLibrary(libraryId);
      if (l.status === "archived") throw new LibraryError("This library is archived. Restore it first.", 409);
      const p = parse(entryInputSchema, input);
      if (a.guest && (await store.entries()).filter((e) => e.owner_id === a.id && e.status !== "archived").length >= MAX_GUEST_SERVICES)
        throw new LibraryError(`You have ${MAX_GUEST_SERVICES} services already. Archive one, or sign in as a team member.`, 429);
      const d = await validDocument(p.yaml);
      const at = now();
      const e: LibraryEntry = {
        id: crypto.randomUUID(),
        library_id: l.id,
        kind: p.kind,
        doc_id: d.id,
        title: d.title,
        yaml: p.yaml,
        status: "draft",
        revision: 1,
        published_yaml: null,
        published_revision: null,
        owner_id: a.id,
        owner_name: a.name,
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
      await audit(a, "library.entry_created", e.id, { id: e.doc_id, library: l.name });
      return { entry: e, problems: await problemsOf(e.yaml) };
    },

    /** Save a new revision. A service in review goes back to draft (it must be submitted again). */
    async saveEntry(a: LibraryActor, id: string, input: unknown) {
      const e = await getEntry(a, id);
      mustChange(a, e);
      if (e.status === "archived") throw new LibraryError("This service is archived. Restore it first.", 409);
      const p = parse(entrySaveSchema, input);
      if (p.yaml === e.yaml) return { entry: e, problems: await problemsOf(e.yaml) };
      const d = await validDocument(p.yaml, e.id);
      const at = now();
      const next: LibraryEntry = { ...e, yaml: p.yaml, doc_id: d.id, title: d.title, status: "draft", revision: e.revision + 1, updated_at: at, updated_by_name: a.name };
      await store.putEntry(next);
      await store.addRevision({ entry_id: id, revision: next.revision, yaml: p.yaml, at, by_id: a.id, by_name: a.name, note: p.note || null });
      await audit(a, "library.entry_saved", id, { id: d.id, revision: next.revision });
      return { entry: next, problems: await problemsOf(next.yaml) };
    },

    /** Send the latest revision for review: it must compile without errors. */
    async submit(a: LibraryActor, id: string) {
      const e = await getEntry(a, id);
      mustChange(a, e);
      if (e.status !== "draft" && e.status !== "rejected") throw new LibraryError(e.status === "in_review" ? "It is already in review." : `A ${e.status} service can't be submitted: save a change first.`, 409);
      const errors = (await problemsOf(e.yaml)).filter((p) => p.level === "error");
      if (errors.length) throw new LibraryError(`Fix ${errors.length === 1 ? "this problem" : `these ${errors.length} problems`} first: ${errors.map((p) => p.message).join("; ")}`);
      const next: LibraryEntry = { ...e, status: "in_review", submitted_by: a.id, submitted_by_name: a.name, submitted_at: now(), reviewed_by: null, reviewed_by_name: null, reviewed_at: null, review_note: null };
      await store.putEntry(next);
      await audit(a, "library.entry_submitted", id, { id: e.doc_id, revision: e.revision });
      return next;
    },

    /** Accept (publish) or reject what is in review. A reviewer never reviews their own submission. */
    async review(a: LibraryActor, id: string, input: unknown) {
      need(a, "review");
      const e = await getEntry(a, id);
      if (e.status !== "in_review") throw new LibraryError("Only services in review can be accepted or rejected.", 409);
      if ((e.submitted_by === a.id || e.owner_id === a.id) && a.id !== ADMIN_ACTOR_ID) throw new LibraryError("This is your own service: another reviewer has to review it.", 403);
      const r = parse(reviewInputSchema, input);
      const accepted = r.decision === "accept";
      if (accepted) {
        const errors = (await problemsOf(e.yaml)).filter((p) => p.level === "error");
        if (errors.length) throw new LibraryError(`It doesn't compile: ${errors.map((p) => p.message).join("; ")}`);
      }
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
      await audit(a, accepted ? "library.entry_accepted" : "library.entry_rejected", id, { id: e.doc_id, revision: e.revision });
      await options.onReviewed?.(next, accepted ? "accepted" : "rejected", next.review_note, a).catch(() => undefined);
      return next;
    },

    /** Archive: out of the catalogue and off kiosks. Restore brings it back as a draft, to be reviewed again. */
    async setEntryArchived(a: LibraryActor, id: string, archived: boolean) {
      const e = await getEntry(a, id);
      mustChange(a, e);
      if (archived === (e.status === "archived")) return e;
      if (!archived) await validDocument(e.yaml, e.id);
      const next: LibraryEntry = archived ? { ...e, status: "archived", published_yaml: null, published_revision: null, updated_at: now() } : { ...e, status: "draft", updated_at: now() };
      await store.putEntry(next);
      await audit(a, archived ? "library.entry_archived" : "library.entry_restored", id, { id: e.doc_id });
      return next;
    },

    /**
     * Put the kiosk's own services (content/catalogue) into the catalogue, published, the first time:
     * a seed whose service id the catalogue already has (in any state, archived too) is left alone,
     * so editing or archiving a seeded service sticks. Returns the ids added.
     */
    async seed(yamls: readonly string[]): Promise<string[]> {
      const added: string[] = [];
      const system: LibraryActor = { id: SYSTEM_ACTOR_ID, name: "YAXB", roles: ["administrator"], admin: true };
      for (const yaml of yamls) {
        const d = readDocument(yaml);
        if ("error" in d || (await store.entries()).some((e) => e.doc_id === d.id)) continue;
        const l = await defaultLibrary(system);
        const at = now();
        const e: LibraryEntry = {
          id: crypto.randomUUID(),
          library_id: l.id,
          kind: "service",
          doc_id: d.id,
          title: d.title,
          yaml,
          status: "accepted",
          revision: 1,
          published_yaml: yaml,
          published_revision: 1,
          owner_id: SYSTEM_ACTOR_ID,
          owner_name: "YAXB",
          submitted_by: SYSTEM_ACTOR_ID,
          submitted_by_name: "YAXB",
          submitted_at: at,
          reviewed_by: SYSTEM_ACTOR_ID,
          reviewed_by_name: "YAXB",
          reviewed_at: at,
          review_note: "Comes with the kiosk.",
          created_at: at,
          updated_at: at,
          updated_by_name: "YAXB",
        };
        await store.putEntry(e);
        await store.addRevision({ entry_id: e.id, revision: 1, yaml, at, by_id: SYSTEM_ACTOR_ID, by_name: "YAXB", note: "Comes with the kiosk" });
        await options.audit?.(auditEvent({ actor_type: "system", actor_id: null, actor_name: "YAXB", action: "library.entry_created", target_id: e.id, details: { id: d.id, seeded: true } }));
        added.push(d.id);
      }
      return added;
    },

    /** Everything waiting for a review, across active libraries. */
    async reviewQueue(a: LibraryActor) {
      if (!permissionsOf(a).view) return [];
      const active = new Set((await store.libraries()).filter((l) => l.status === "active").map((l) => l.id));
      return (await store.entries()).filter((e) => e.status === "in_review" && active.has(e.library_id));
    },

    /**
     * The catalogue kiosks load from: each published service of an active library, with its roles,
     * its journeys (who starts and finishes them, and whether this viewer may start them), and its
     * published YAML. `roles` is every role there is: built in, the organisation's, and services'.
     */
    async published(viewerRoles: readonly string[] = [], { all = false } = {}) {
      const [libs, entries, org] = await Promise.all([store.libraries(), store.entries(), catalogue()]);
      const active = new Map(libs.filter((l) => l.status === "active").map((l) => [l.id, l]));
      const opts = await compileOptions();
      const roles: Role[] = [...org];
      const services = entries
        .filter((e) => active.has(e.library_id) && e.status !== "archived" && e.published_yaml)
        .flatMap((e) => {
          const b = compileBundle(e.published_yaml!, opts);
          const s = b.services[0];
          if (!s) return [];
          for (const r of b.roles) if (!roles.some((x) => x.id === r.id)) roles.push(r);
          return [
            {
              entry_id: e.id,
              library: active.get(e.library_id)!.name,
              id: s.id,
              title: s.title,
              summary: s.summary ?? null,
              icon: s.icon ?? null,
              revision: e.published_revision,
              published_at: e.reviewed_at,
              roles: b.roles,
              journeys: b.journeys.map((j) => ({
                id: j.id,
                title: j.title,
                summary: j.summary ?? null,
                initiate: j.roles?.initiate ?? [],
                complete: j.roles?.complete ?? [],
                allowed: all || canInitiate(j, viewerRoles),
              })),
              yaml: e.published_yaml!,
            },
          ];
        });
      return { roles, services };
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
        .sort((a, b) => a.title.localeCompare(b.title));
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
