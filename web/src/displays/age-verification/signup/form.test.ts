import { describe, expect, it } from 'vitest'
import {
  cleanValues,
  emptyValues,
  fieldValid,
  formValid,
  signupForm,
  type SignupField,
} from './form'

const fields: SignupField[] = [
  {
    kind: 'text',
    id: 'email',
    label: 'Email',
    input: 'email',
    required: true,
    maxLength: 80,
  },
  { kind: 'text', id: 'name', label: 'Name', input: 'name', maxLength: 40 },
  { kind: 'checkbox', id: 'consent', label: 'OK', required: true },
]

describe('the sign-up form', () => {
  it('starts empty', () => {
    expect(emptyValues(fields)).toEqual({ email: '', name: '', consent: false })
  })

  it('needs its required fields', () => {
    const values = emptyValues(fields)
    expect(formValid(fields, values)).toBe(false)
    expect(
      formValid(fields, { ...values, email: 'a@b.co', consent: true }),
    ).toBe(true)
  })

  it('lets an optional field stay empty, and a required box be ticked', () => {
    expect(fieldValid(fields[1]!, { name: '  ' })).toBe(true)
    expect(fieldValid(fields[2]!, { consent: false })).toBe(false)
  })

  it('turns away an email with no domain', () => {
    for (const email of ['ada', 'ada@', 'ada@mozilla', 'a b@c.de']) {
      expect(fieldValid(fields[0]!, { email })).toBe(false)
    }
    expect(fieldValid(fields[0]!, { email: ' ada@mozilla.org ' })).toBe(true)
  })

  it('keeps only its own fields, trimmed', () => {
    expect(
      cleanValues(fields, { email: ' a@b.co ', other: 'x', consent: true }),
    ).toEqual({ email: 'a@b.co', name: '', consent: true })
  })

  it('has unique field ids', () => {
    const ids = signupForm.fields.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
