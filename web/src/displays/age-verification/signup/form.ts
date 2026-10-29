/**
 * The sign-up form shown after every ending, as data. The screen builds itself
 * from this list, and the saved entries and the CSV export key their values by
 * each field's `id`, so a field can be added, dropped or reworded here without
 * touching either.
 *
 * Keep an `id` once entries have been saved under it: the CSV puts a column per
 * id, and a renamed one splits a column in two.
 */

import { QR_MOZILLA_BLOG, QR_PROJECT_SYNDICATE } from '../assets'

/**
 * What the device's keyboard offers and what the value must look like. Plain
 * text starts each word with a capital, as names and places do.
 */
export type TextInput = 'email' | 'text'

/** One text field. Every field is text, so a value is always a string. */
export interface SignupField {
  /** Stable, since saved entries refer to it. The CSV column's heading. */
  id: string
  label: string
  placeholder?: string
  input: TextInput
  required?: boolean
  /** Characters the value may hold. */
  maxLength: number
  /**
   * The id of a field that has to be filled in well before this one shows, so
   * the form starts short and grows only for a visitor who is signing up.
   */
  after?: string
}

/** A link to read on, offered as a QR code to scan with a phone. */
export interface ReadingLink {
  /** The QR code, an imported asset URL. */
  qr: string
  /** Where the code leads, for anyone who can't scan it. */
  url: string
  /** Who published it. */
  source: string
  title: string
}

export interface SignupForm {
  title: string
  body: readonly string[]
  fields: readonly SignupField[]
  /** The heading over the links. */
  readingTitle: string
  /** Shown beside the form one at a time, so a visitor can take one away. */
  reading: readonly ReadingLink[]
}

export const signupForm: SignupForm = {
  title: 'Configuring age assurance – let’s stay in touch!',
  body: [
    'The global proliferation of age assurance mandates is an urgent policy priority that is rapidly unfolding. Stay in touch with us to find out what you can do to shape age assurance policies in your region.',
  ],
  fields: [
    {
      id: 'email',
      label: 'E-Mail',
      placeholder: 'you@example.com',
      input: 'email',
      required: true,
      maxLength: 80,
    },
    {
      id: 'name',
      label: 'Name (optional)',
      input: 'text',
      maxLength: 60,
      after: 'email',
    },
    {
      id: 'region',
      label: 'Region (optional)',
      input: 'text',
      maxLength: 60,
      after: 'email',
    },
  ],
  readingTitle: 'Learn more about age assurance',
  reading: [
    {
      qr: QR_MOZILLA_BLOG,
      url: 'https://blog.mozilla.org/netpolicy/2026/07/17/beyond-technical-fixes-protecting-kids-online-without-breaking-the-internet/',
      source: 'Mozilla',
      title:
        'Beyond technical fixes: Protecting kids online without breaking the internet',
    },
    {
      qr: QR_PROJECT_SYNDICATE,
      url: 'https://www.project-syndicate.org/magazine/online-age-gating-ineffective-and-introduces-new-hazards-by-julia-powles-and-kate-sim-2026-03',
      source: 'Project Syndicate',
      title: 'Online age-gating is ineffective and introduces new hazards',
    },
  ],
}

/** What a visitor has filled in so far, by field id. */
export type SignupValues = Record<string, string>

/** Every field empty. */
export function emptyValues(fields: readonly SignupField[]): SignupValues {
  return Object.fromEntries(fields.map((f) => [f.id, '']))
}

/**
 * Loose on purpose: something before and after one `@`, and a dot in the part
 * after it. It catches a slip of the finger, not every address a mail server
 * would turn away.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Whether `value` passes the field's own check, ignoring `required`. */
function wellFormed(field: SignupField, value: string): boolean {
  return field.input !== 'email' || EMAIL.test(value)
}

/** Whether the field's value is acceptable to submit. */
export function fieldValid(field: SignupField, values: SignupValues): boolean {
  const text = (values[field.id] ?? '').trim()
  if (!text) return !field.required
  return wellFormed(field, text)
}

/**
 * Whether the field shows yet: it has no `after`, or the field it waits for
 * holds an acceptable value.
 */
export function fieldReady(
  field: SignupField,
  fields: readonly SignupField[],
  values: SignupValues,
): boolean {
  if (!field.after) return true
  const before = fields.find((f) => f.id === field.after)
  const filled = !!(values[field.after] ?? '').trim()
  return !!before && filled && fieldValid(before, values)
}

/** Whether every field is acceptable, so the form can be sent. */
export function formValid(
  fields: readonly SignupField[],
  values: SignupValues,
): boolean {
  return fields.every((f) => fieldValid(f, values))
}

/** The values as they are kept: text trimmed, and only the form's fields. */
export function cleanValues(
  fields: readonly SignupField[],
  values: SignupValues,
): SignupValues {
  return Object.fromEntries(
    fields.map((f) => [f.id, (values[f.id] ?? '').trim()]),
  )
}
