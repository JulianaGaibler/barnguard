/**
 * What a physical keydown means for the on-screen keyboard. Shortcuts held with
 * Ctrl, Meta or Alt belong to the OS and are left alone. Backspace may repeat,
 * every other key acts once per press.
 */

export type PhysicalKeyAction =
  | { type: 'char'; char: string }
  | { type: 'backspace' }
  | { type: 'submit' }
  | { type: 'close' }

export interface PhysicalKeyEvent {
  key: string
  repeat: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

export function physicalKeyAction(
  e: PhysicalKeyEvent,
  typable: ReadonlySet<string>,
): PhysicalKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Dead') return null
  if (e.key === 'Backspace') return { type: 'backspace' }
  if (e.repeat) return null
  if (e.key === 'Enter') return { type: 'submit' }
  if (e.key === 'Escape') return { type: 'close' }
  const char = e.key.normalize('NFC').toLowerCase()
  return typable.has(char) ? { type: 'char', char } : null
}
