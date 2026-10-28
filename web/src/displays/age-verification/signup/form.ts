/**
 * The sign-up form shown after every ending, as data. The screen builds itself
 * from this list, and the saved entries and the CSV export key their values by
 * each field's `id`, so a field can be added, dropped or reworded here without
 * touching either.
 *
 * Keep an `id` once entries have been saved under it: the CSV puts a column per
 * id, and a renamed one splits a column in two.
 */

/** What the on-screen keyboard offers and what the value must look like. */
export type TextInput = 'email' | 'name'

export interface TextField {
  kind: 'text'
  /** Stable, since saved entries refer to it. The CSV column's heading. */
  id: string
  label: string
  placeholder?: string
  input: TextInput
  required?: boolean
  /** Characters the value may hold. */
  maxLength: number
}

export interface CheckboxField {
  kind: 'checkbox'
  /** Stable, since saved entries refer to it. The CSV column's heading. */
  id: string
  label: string
  /** The box has to be ticked to submit, as for consent. */
  required?: boolean
}

export type SignupField = TextField | CheckboxField

export interface SignupForm {
  title: string
  body: readonly string[]
  fields: readonly SignupField[]
}

// TODO: The form is not final. The copy and the fields are placeholders until
// the wording and what is collected are settled.
export const signupForm: SignupForm = {
  title: 'Stay in the loop',
  body: [
    'Want to hear more about age verification and what Mozilla is doing about it? Leave your email and we will keep you posted.',
  ],
  fields: [
    {
      kind: 'text',
      id: 'email',
      label: 'Email',
      placeholder: 'you@example.com',
      input: 'email',
      required: true,
      maxLength: 80,
    },
    {
      kind: 'text',
      id: 'name',
      label: 'Name (optional)',
      input: 'name',
      maxLength: 40,
    },
    {
      kind: 'checkbox',
      id: 'consent',
      label: 'I agree to receive emails from Mozilla.',
      required: true,
    },
  ],
}

/** What a visitor has filled in so far, by field id. */
export type SignupValues = Record<string, string | boolean>

/** Every field empty and every box unticked. */
export function emptyValues(fields: readonly SignupField[]): SignupValues {
  return Object.fromEntries(
    fields.map((f) => [f.id, f.kind === 'checkbox' ? false : '']),
  )
}

/**
 * Loose on purpose: something before and after one `@`, and a dot in the part
 * after it. It catches a slip of the finger, not every address a mail server
 * would turn away.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Whether `value` passes the field's own check, ignoring `required`. */
function wellFormed(field: TextField, value: string): boolean {
  return field.input !== 'email' || EMAIL.test(value)
}

/** Whether the field's value is acceptable to submit. */
export function fieldValid(field: SignupField, values: SignupValues): boolean {
  const value = values[field.id]
  if (field.kind === 'checkbox') return !field.required || value === true
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return !field.required
  return wellFormed(field, text)
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
    fields.map((f) => {
      const value = values[f.id]
      if (f.kind === 'checkbox') return [f.id, value === true]
      return [f.id, typeof value === 'string' ? value.trim() : '']
    }),
  )
}
