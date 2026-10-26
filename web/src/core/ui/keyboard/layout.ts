/**
 * What the keyboard shows, as data. A mode and a page give rows of keys, and
 * every row spans exactly `COLUMNS` grid columns. A letter is 2 columns wide,
 * so a column is half a key. The keys that are not letters take the columns a
 * row has left over, which is how close sits in the bottom-left corner and
 * enter in the bottom-right whatever the mode.
 *
 * `letters` is a to z. `name` adds accents on hold, space and `- ' .`. `full`
 * adds a page of digits and symbols behind a `?123` key.
 */
import { ALL_VARIANT_CHARS } from './variants'

export type KeyboardMode = 'letters' | 'name' | 'full'
export type KeyboardPage = 'letters' | 'symbols'

export const COLUMNS = 20

export type KeyAction =
  | { type: 'char'; char: string }
  | { type: 'space' }
  | { type: 'backspace' }
  | { type: 'enter' }
  | { type: 'close' }
  | { type: 'page'; page: KeyboardPage }

export type KeyVariant = 'char' | 'fn' | 'enter'

export interface KeySpec {
  kind: 'key'
  id: string
  action: KeyAction
  span: number
}

/** Empty columns, for the stagger of a row. */
export interface GapSpec {
  kind: 'gap'
  span: number
}

export type RowItem = KeySpec | GapSpec

export interface LayoutOptions {
  /** Whether the close key is shown. */
  hasClose: boolean
  /** Whether the enter key is shown. */
  hasEnter: boolean
}

const LETTER_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const SYMBOL_ROWS = ['1234567890', '-/:;()&@"', ".,?!'_+"]
const NAME_PUNCTUATION = " -'."

const LETTER_SPAN = 2
const CLOSE_SPAN = 3
const PAGE_SPAN = 3
const ENTER_SPAN = 4

export function keyVariant(action: KeyAction): KeyVariant {
  if (action.type === 'enter') return 'enter'
  if (action.type === 'char') return 'char'
  return 'fn'
}

/** The rows for `page`. A mode without a symbols page always gets letters. */
export function layoutFor(
  mode: KeyboardMode,
  page: KeyboardPage,
  { hasClose, hasEnter }: LayoutOptions,
): RowItem[][] {
  const symbols = mode === 'full' && page === 'symbols'
  const rows = symbols ? SYMBOL_ROWS : LETTER_ROWS
  const top = rowOfChars(rows[0])
  const middle = [gap(1), ...rowOfChars(rows[1]), gap(1)]
  const closeKey = (span: number) =>
    hasClose ? [fn('close', { type: 'close' }, span)] : []
  const enterKey = (span: number) =>
    hasEnter ? [fn('enter', { type: 'enter' }, span)] : []

  if (mode === 'letters') {
    // Close, backspace and enter share the six columns beside the last row.
    const backspaceSpan =
      6 - (hasClose ? LETTER_SPAN : 0) - (hasEnter ? LETTER_SPAN : 0)
    return [
      top,
      middle,
      [
        ...closeKey(LETTER_SPAN),
        ...rowOfChars(rows[2]),
        fn('backspace', { type: 'backspace' }, backspaceSpan),
        ...enterKey(LETTER_SPAN),
      ],
    ]
  }

  const third = [
    gap(3),
    ...rowOfChars(rows[2]),
    fn('backspace', { type: 'backspace' }, 3),
  ]
  const toggle =
    mode === 'full'
      ? [
          fn(
            symbols ? 'page:letters' : 'page:symbols',
            { type: 'page', page: symbols ? 'letters' : 'symbols' },
            PAGE_SPAN,
          ),
        ]
      : []
  const [dash, apostrophe, period] = Array.from(NAME_PUNCTUATION.slice(1))
  const before = symbols ? [] : [charKey(dash)]
  const after = symbols ? [] : [charKey(apostrophe), charKey(period)]
  const close = closeKey(CLOSE_SPAN)
  const enter = enterKey(ENTER_SPAN)
  const fixed = [...close, ...toggle, ...before, ...after, ...enter]
  const used = fixed.reduce((sum, item) => sum + item.span, 0)
  const space = fn('space', { type: 'space' }, COLUMNS - used)
  const bottom = [...close, ...toggle, ...before, space, ...after, ...enter]
  return [top, middle, third, bottom]
}

/** Every character the mode can type, for accepting a physical keyboard. */
export function typableChars(mode: KeyboardMode): ReadonlySet<string> {
  const chars = new Set(Array.from(LETTER_ROWS.join('')))
  if (mode === 'letters') return chars
  for (const ch of ALL_VARIANT_CHARS) chars.add(ch)
  for (const ch of NAME_PUNCTUATION) chars.add(ch)
  if (mode === 'full') {
    for (const ch of SYMBOL_ROWS.join('')) chars.add(ch)
  }
  return chars
}

function gap(span: number): GapSpec {
  return { kind: 'gap', span }
}

function charKey(char: string): KeySpec {
  return {
    kind: 'key',
    id: `char:${char}`,
    action: { type: 'char', char },
    span: LETTER_SPAN,
  }
}

function rowOfChars(chars: string): KeySpec[] {
  return Array.from(chars).map(charKey)
}

function fn(id: string, action: KeyAction, span: number): KeySpec {
  return { kind: 'key', id, action, span }
}
