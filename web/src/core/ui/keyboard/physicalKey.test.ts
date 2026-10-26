import { describe, expect, it } from 'vitest'
import { typableChars } from './layout'
import { physicalKeyAction, type PhysicalKeyEvent } from './physicalKey'

const press = (key: string, extra: Partial<PhysicalKeyEvent> = {}) => ({
  key,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
})
const NAME = typableChars('name')
const LETTERS = typableChars('letters')

describe('physicalKeyAction', () => {
  it('types a letter in lowercase', () => {
    expect(physicalKeyAction(press('A'), LETTERS)).toEqual({
      type: 'char',
      char: 'a',
    })
  })

  it('types an accent only where the mode allows it', () => {
    expect(physicalKeyAction(press('ä'), NAME)).toEqual({
      type: 'char',
      char: 'ä',
    })
    expect(physicalKeyAction(press('ä'), LETTERS)).toBeNull()
  })

  it('composes a decomposed accent', () => {
    expect(physicalKeyAction(press('ä'), NAME)).toEqual({
      type: 'char',
      char: 'ä',
    })
  })

  it('maps Enter, Escape and Backspace', () => {
    expect(physicalKeyAction(press('Enter'), NAME)).toEqual({ type: 'submit' })
    expect(physicalKeyAction(press('Escape'), NAME)).toEqual({ type: 'close' })
    expect(physicalKeyAction(press('Backspace'), NAME)).toEqual({
      type: 'backspace',
    })
  })

  it('leaves OS shortcuts alone', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(physicalKeyAction(press('a', { [mod]: true }), NAME)).toBeNull()
      expect(
        physicalKeyAction(press('Backspace', { [mod]: true }), NAME),
      ).toBeNull()
    }
  })

  it('ignores dead keys and keys the mode cannot type', () => {
    expect(physicalKeyAction(press('Dead'), NAME)).toBeNull()
    expect(physicalKeyAction(press('7'), NAME)).toBeNull()
    expect(physicalKeyAction(press('Shift'), NAME)).toBeNull()
  })

  it('repeats Backspace and nothing else', () => {
    expect(
      physicalKeyAction(press('Backspace', { repeat: true }), NAME),
    ).toEqual({ type: 'backspace' })
    for (const key of ['a', 'Enter', 'Escape', ' ']) {
      expect(physicalKeyAction(press(key, { repeat: true }), NAME)).toBeNull()
    }
  })
})
