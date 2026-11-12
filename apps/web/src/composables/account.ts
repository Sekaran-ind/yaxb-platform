// The visitor's kiosk profile (yaxb-core accounts): created with a few questions, kept on this
// device encrypted with their passphrase (IndexedDB, like clinux-diary), opened with it, and
// locked again on request or after a quiet spell, which suits a shared kiosk.
//
// While a profile is open it keeps an activity log (metadata only) and can apply the settings its
// answers suggest, remembering the previous settings so they can be undone.
import {
  activityEvent,
  appendActivity,
  applyPreferences,
  preferencesFrom,
  profileSchema,
  type ActivityAction,
  type ActivityEvent,
  type KioskPreferences,
  type Profile,
} from "@sekaran-ind/yaxb-core/accounts";
import { createVault, openVault, rekeyVault, sealVault, type Key, type VaultRecord } from "@sekaran-ind/yaxb-core/accounts/crypto";
import type { AgentSettings } from "@sekaran-ind/yaxb-core/settings";
import { computed, ref, shallowRef } from "vue";
import { settings, updateSettings } from "./settings";

/** What the vault holds. */
type AccountData = {
  profile: Profile;
  activity: ActivityEvent[];
  /** Settings from before "apply suggestions", for undo. */
  previous: { agent: AgentSettings; kiosk: KioskPreferences } | null;
  appliedAt: string | null;
};

export const AUTO_LOCK_MS = 10 * 60_000;

// ---- storage: IndexedDB, or memory when it isn't available ----------------------------------------
const DB = "yaxb-accounts";
let dbPromise: Promise<IDBDatabase> | null = null;
const memory = new Map<string, VaultRecord>();
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("profiles", { keyPath: "id" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => {
      dbPromise = null;
      reject(open.error);
    };
  });
  return dbPromise;
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = run(d.transaction("profiles", mode).objectStore("profiles"));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const vaults = {
  async list(): Promise<VaultRecord[]> {
    try {
      return await tx("readonly", (s) => s.getAll() as IDBRequest<VaultRecord[]>);
    } catch {
      return [...memory.values()];
    }
  },
  async get(id: string) {
    try {
      return (await tx("readonly", (s) => s.get(id) as IDBRequest<VaultRecord | undefined>)) ?? null;
    } catch {
      return memory.get(id) ?? null;
    }
  },
  async put(r: VaultRecord) {
    try {
      await tx("readwrite", (s) => s.put(r));
    } catch {
      memory.set(r.id, r);
    }
  },
  async remove(id: string) {
    try {
      await tx("readwrite", (s) => s.delete(id));
    } catch {
      memory.delete(id);
    }
  },
};

// ---- the open profile ------------------------------------------------------------------------------
const list = ref<{ id: string; nickname: string; createdAt: string }[]>([]);
const current = shallowRef<{ record: VaultRecord; data: AccountData } | null>(null);
let key: Key | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function refreshList() {
  list.value = (await vaults.list()).map(({ id, nickname, createdAt }) => ({ id, nickname, createdAt })).sort((a, b) => a.nickname.localeCompare(b.nickname));
}

async function save(data: AccountData) {
  if (!current.value || !key) return;
  const record = await sealVault(current.value.record, key, data, data.profile.nickname);
  await vaults.put(record);
  current.value = { record, data };
}

/** Record something that happened on the open profile. Never what was said: see activityEvent. */
export async function logActivity(action: ActivityAction, details: Record<string, unknown> = {}) {
  if (!current.value) return;
  try {
    await save({ ...current.value.data, activity: appendActivity(current.value.data.activity, activityEvent(action, details)) });
  } catch {
    /* the log never gets in the way of the kiosk */
  }
}

function armAutoLock() {
  if (timer) clearTimeout(timer);
  if (current.value) timer = setTimeout(() => void lock("account.auto_locked"), AUTO_LOCK_MS);
}
if (typeof window !== "undefined") for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, armAutoLock, { passive: true });

const snapshot = () => ({
  agent: structuredClone({ ...settings.agent }),
  kiosk: { speakResponses: settings.speakResponses, layout: settings.layout, speechRate: settings.speechRate } as KioskPreferences,
});

/** A shared kiosk: the next visitor gets the kiosk's own settings back, not this profile's. */
async function lock(action: "account.locked" | "account.auto_locked" = "account.locked") {
  if (!current.value) return;
  await logActivity(action);
  const prev = current.value.data.previous;
  if (prev) updateSettings({ agent: prev.agent, ...prev.kiosk });
  current.value = null;
  key = null;
  if (timer) clearTimeout(timer);
}

export function useAccount() {
  void refreshList();
  const profile = computed(() => current.value?.data.profile ?? null);
  const preferences = computed(() => (profile.value ? preferencesFrom(profile.value) : null));
  return {
    list,
    profile,
    preferences,
    activity: computed(() => current.value?.data.activity ?? []),
    applied: computed(() => Boolean(current.value?.data.previous)),
    appliedAt: computed(() => current.value?.data.appliedAt ?? null),
    refreshList,

    /** A new profile, opened straight away. */
    async create(input: unknown, passphrase: string) {
      const p = profileSchema.parse(input);
      const data: AccountData = { profile: p, activity: [activityEvent("account.created", { language: p.language, count: p.interests.length })], previous: null, appliedAt: null };
      const created = await createVault(crypto.randomUUID(), p.nickname, passphrase, data);
      await vaults.put(created.record);
      key = created.key;
      current.value = { record: created.record, data };
      armAutoLock();
      await refreshList();
    },

    /** Open a profile; false when the passphrase isn't right. */
    async unlock(id: string, passphrase: string) {
      const record = await vaults.get(id);
      if (!record) return false;
      const opened = await openVault<AccountData>(record, passphrase);
      if (!opened) return false;
      key = opened.key;
      current.value = { record, data: opened.data };
      armAutoLock();
      // Settings this profile applied before come back, over the kiosk's current ones (kept for sign-out).
      if (opened.data.appliedAt) {
        const prefs = preferencesFrom(opened.data.profile);
        const previous = snapshot();
        updateSettings({ agent: applyPreferences(settings.agent, prefs), ...prefs.kiosk });
        await save({ ...current.value.data, previous });
      }
      await logActivity("account.unlocked");
      return true;
    },
    lock: () => lock("account.locked"),

    async update(input: unknown) {
      if (!current.value) return;
      const p = profileSchema.parse(input);
      await save({ ...current.value.data, profile: p, activity: appendActivity(current.value.data.activity, activityEvent("account.updated", { language: p.language, count: p.interests.length })) });
      await refreshList();
    },

    /** Apply the suggested settings, remembering the current ones for undo. */
    async applySuggestions() {
      if (!current.value || !preferences.value) return;
      const prefs = preferences.value;
      const previous = current.value.data.previous ?? snapshot();
      updateSettings({ agent: applyPreferences(settings.agent, prefs), ...prefs.kiosk });
      await save({ ...current.value.data, previous, appliedAt: new Date().toISOString(), activity: appendActivity(current.value.data.activity, activityEvent("preferences.applied", { count: prefs.suggestions.length })) });
    },

    async undoSuggestions() {
      const prev = current.value?.data.previous;
      if (!current.value || !prev) return;
      updateSettings({ agent: prev.agent, ...prev.kiosk });
      await save({ ...current.value.data, previous: null, appliedAt: null, activity: appendActivity(current.value.data.activity, activityEvent("preferences.undone")) });
    },

    /** false when the current passphrase isn't right. */
    async changePassphrase(currentPass: string, next: string) {
      if (!current.value) return false;
      if (!(await openVault(current.value.record, currentPass))) return false;
      const data = { ...current.value.data, activity: appendActivity(current.value.data.activity, activityEvent("account.passphrase_changed")) };
      const rekeyed = await rekeyVault(current.value.record, next, data);
      await vaults.put(rekeyed.record);
      key = rekeyed.key;
      current.value = { record: rekeyed.record, data };
      return true;
    },

    /** The profile and its activity log as a JSON file the visitor keeps (not encrypted: it's theirs). */
    async exportJson() {
      if (!current.value) return null;
      await logActivity("account.exported");
      const { profile: p, activity } = current.value.data;
      return new Blob([JSON.stringify({ kind: "yaxb-kiosk-profile", version: 1, exportedAt: new Date().toISOString(), profile: p, activity }, null, 2)], { type: "application/json" });
    },

    /** Erase the open profile from this device. */
    async erase() {
      if (!current.value) return;
      const id = current.value.record.id;
      current.value = null;
      key = null;
      await vaults.remove(id);
      await refreshList();
    },
  };
}

export type AccountApi = ReturnType<typeof useAccount>;
