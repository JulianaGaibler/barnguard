import { describe, expect, it } from 'vitest'
import {
  cleanValues,
  emptyValues,
  fieldReady,
  fieldValid,
  formValid,
  signupForm,
  type SignupField,
} from './form'

const fields: SignupField[] = [
  {
    id: 'email',
    label: 'Email',
    input: 'email',
    required: true,
    maxLength: 80,
  },
  {
    id: 'name',
    label: 'Name',
    input: 'text',
    maxLength: 40,
    after: 'email',
  },
]

describe('the sign-up form', () => {
  it('starts empty', () => {
    expect(emptyValues(fields)).toEqual({ email: '', name: '' })
  })

  it('needs its required fields', () => {
    const values = emptyValues(fields)
    expect(formValid(fields, values)).toBe(false)
    expect(formValid(fields, { ...values, email: 'a@b.co' })).toBe(true)
  })

  it('lets an optional field stay empty', () => {
    expect(fieldValid(fields[1]!, { name: '  ' })).toBe(true)
  })

  it('turns away an email with no domain', () => {
    for (const email of ['ada', 'ada@', 'ada@mozilla', 'a b@c.de']) {
      expect(fieldValid(fields[0]!, { email })).toBe(false)
    }
    expect(fieldValid(fields[0]!, { email: ' ada@mozilla.org ' })).toBe(true)
  })

  it('keeps only its own fields, trimmed', () => {
    expect(cleanValues(fields, { email: ' a@b.co ', other: 'x' })).toEqual({
      email: 'a@b.co',
      name: '',
    })
  })

  it('shows a field that waits for another once that one is filled in well', () => {
    const name = fields[1]!
    expect(fieldReady(name, fields, { email: '' })).toBe(false)
    expect(fieldReady(name, fields, { email: 'ada@' })).toBe(false)
    expect(fieldReady(name, fields, { email: 'ada@mozilla.org' })).toBe(true)
    expect(fieldReady(fields[0]!, fields, {})).toBe(true)
  })

  it('has unique field ids, and waits only on fields before it', () => {
    signupForm.fields.forEach((field, i) => {
      if (!field.after) return
      const before = signupForm.fields.slice(0, i).map((f) => f.id)
      expect(before).toContain(field.after)
    })
    const ids = signupForm.fields.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
