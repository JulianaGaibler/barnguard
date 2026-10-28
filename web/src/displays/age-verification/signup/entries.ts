/**
 * The sign-ups collected on this device. The venue's internet can't be relied
 * on, so nothing is sent anywhere: every entry stays in the browser's storage
 * until the attendant exports the list as CSV and clears it.
 */
import { writable, type Readable } from 'svelte/store'
import type { SignupField, SignupValues } from './form'

/** Namespaced as the other displays are: `bg.<display>.<what>`. */
export const SIGNUPS_KEY = 'bg.age-verification.signups'

export interface SignupEntry {
  /** When it was sent, as an ISO 8601 timestamp. */
  at: string
  values: SignupValues
}

/** The part of the browser's storage this file uses, for a test to stand in. */
export interface SignupStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): SignupStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isEntry(value: unknown): value is SignupEntry {
  if (typeof value !== 'object' || value === null) return false
  const { at, values } = value as Partial<SignupEntry>
  return typeof at === 'string' && typeof values === 'object' && values !== null
}

/** Every entry kept, oldest first. Anything unreadable is left out. */
export function readSignups(
  storage: SignupStorage | null = browserStorage(),
): SignupEntry[] {
  try {
    const raw = storage?.getItem(SIGNUPS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch {
    return []
  }
}

/**
 * Adds `entry` to the list. Returns false when the storage refused it, as when
 * it is full or blocked, so the entry was not kept.
 */
export function appendSignup(
  entry: SignupEntry,
  storage: SignupStorage | null = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    const next = [...readSignups(storage), entry]
    storage.setItem(SIGNUPS_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

/** Forgets every entry. */
export function removeSignups(
  storage: SignupStorage | null = browserStorage(),
): void {
  try {
    storage?.removeItem(SIGNUPS_KEY)
  } catch {
    // Nothing to forget.
  }
}

const list = writable<SignupEntry[]>(readSignups())

/** The kept entries, for the attendant's panel to follow. */
export const signups: Readable<SignupEntry[]> = { subscribe: list.subscribe }

/** Keeps a visitor's sign-up. Returns false when it could not be kept. */
export function saveSignup(values: SignupValues, now = new Date()): boolean {
  const kept = appendSignup({ at: now.toISOString(), values })
  if (!kept) {
    console.error('[age-verification] could not keep a sign-up')
  }
  list.set(readSignups())
  return kept
}

/** Forgets every sign-up, once the attendant has exported them. */
export function clearSignups(): void {
  removeSignups()
  list.set(readSignups())
}

/**
 * A cell as CSV wants it: quoted when it holds a comma, a quote or a line
 * break. A leading `=`, `+`, `-`, `@`, tab or carriage return would make a
 * spreadsheet read the cell as a formula, so it gets a `'` in front.
 */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

function text(value: string | boolean | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return value
}

/**
 * The entries as CSV, one row each under a heading row. The columns are the
 * time it was sent, then the form's fields in order, then any field an older
 * form had that this one no longer does, so nothing collected is dropped.
 */
export function toCsv(
  entries: readonly SignupEntry[],
  fields: readonly SignupField[],
): string {
  const columns = fields.map((f) => f.id)
  for (const entry of entries) {
    for (const id of Object.keys(entry.values)) {
      if (!columns.includes(id)) columns.push(id)
    }
  }
  const rows = [
    ['submitted_at', ...columns],
    ...entries.map((e) => [e.at, ...columns.map((id) => text(e.values[id]))]),
  ]
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
