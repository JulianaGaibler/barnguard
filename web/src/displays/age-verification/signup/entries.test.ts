import { describe, expect, it } from 'vitest'
import {
  SIGNUPS_KEY,
  appendSignup,
  readSignups,
  removeSignups,
  toCsv,
  type SignupEntry,
} from './entries'
import type { SignupField } from './form'

function memory() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

const fields: SignupField[] = [
  { id: 'email', label: 'Email', input: 'email', maxLength: 80 },
  { id: 'name', label: 'Name', input: 'text', maxLength: 40 },
  { id: 'region', label: 'Region', input: 'text', maxLength: 40 },
]

const entry = (at: string, values: SignupEntry['values']): SignupEntry => ({
  at,
  values,
})

describe('kept sign-ups', () => {
  it('add up in the order they were sent', () => {
    const storage = memory()
    appendSignup(entry('a', { email: 'a@b.co' }), storage)
    appendSignup(entry('b', { email: 'c@d.co' }), storage)
    expect(readSignups(storage).map((e) => e.at)).toEqual(['a', 'b'])
  })

  it('are gone once removed', () => {
    const storage = memory()
    appendSignup(entry('a', { email: 'a@b.co' }), storage)
    removeSignups(storage)
    expect(readSignups(storage)).toEqual([])
  })

  it('read as none when the storage holds something else', () => {
    const storage = memory()
    storage.setItem(SIGNUPS_KEY, '{not json')
    expect(readSignups(storage)).toEqual([])
    storage.setItem(SIGNUPS_KEY, JSON.stringify([{ at: 1 }, entry('a', {})]))
    expect(readSignups(storage)).toEqual([entry('a', {})])
  })

  it('report a storage that refuses to keep them', () => {
    const full = {
      ...memory(),
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(appendSignup(entry('a', {}), full)).toBe(false)
    expect(appendSignup(entry('a', {}), null)).toBe(false)
  })
})

describe('the CSV export', () => {
  it('has a heading row and a row per entry, in the form’s order', () => {
    const csv = toCsv(
      [entry('t1', { region: 'Berlin', name: 'Ada', email: 'ada@x.org' })],
      fields,
    )
    expect(csv).toBe(
      'submitted_at,email,name,region\r\nt1,ada@x.org,Ada,Berlin\r\n',
    )
  })

  it('keeps a column for a field the form no longer has', () => {
    const csv = toCsv(
      [entry('t1', { email: 'a@b.co', company: 'Acme' })],
      fields,
    )
    expect(csv.split('\r\n')[0]).toBe('submitted_at,email,name,region,company')
    expect(csv.split('\r\n')[1]).toBe('t1,a@b.co,,,Acme')
  })

  it('quotes commas, quotes and line breaks', () => {
    const csv = toCsv([entry('t1', { name: 'Doe, "J"\nr' })], fields)
    expect(csv.split('\r\n')[1]).toBe('t1,,"Doe, ""J""\nr",')
  })

  it('stops a spreadsheet reading a cell as a formula', () => {
    const csv = toCsv([entry('t1', { name: '=SUM(A1)' })], fields)
    expect(csv.split('\r\n')[1]).toBe("t1,,'=SUM(A1),")
  })
})
