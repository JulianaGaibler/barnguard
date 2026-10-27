/**
 * Stressed text. A paragraph marks a word or phrase with `**double stars**`,
 * and the screen sets it heavier. The marks are read here so every screen
 * agrees on them, and the plain text, which has no marks, is what is measured
 * and read out.
 */

/** A run of text, stressed or not. */
export interface Segment {
  text: string
  strong: boolean
}

/**
 * Splits `text` at its `**` marks. A mark with no partner is plain text, so an
 * unfinished one never hides anything.
 */
export function segments(text: string): Segment[] {
  const parts = text.split('**')
  // An odd count of marks leaves the last one unmatched: it stays as text.
  const matched = parts.length % 2 === 1 ? parts.length : parts.length - 1
  const result: Segment[] = []
  const push = (part: string, strong: boolean): void => {
    if (part === '') return
    const last = result[result.length - 1]
    if (last && last.strong === strong) last.text += part
    else result.push({ text: part, strong })
  }
  parts.forEach((part, i) => {
    if (i >= matched) push(`**${part}`, false)
    else push(part, i % 2 === 1)
  })
  return result
}

/** `text` with its marks taken out. */
export function plain(text: string): string {
  return segments(text)
    .map((s) => s.text)
    .join('')
}

/** A paragraph, or a run of list items, as a screen sets them. */
export type Block =
  { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] }

/** Marks a paragraph as a list item. */
const ITEM = /^- /

/**
 * Groups `paragraphs` into blocks. A paragraph starting with `- ` is a list
 * item, and the items that follow one another make one list.
 */
export function blocks(paragraphs: readonly string[]): Block[] {
  const result: Block[] = []
  for (const paragraph of paragraphs) {
    if (!ITEM.test(paragraph)) {
      result.push({ kind: 'paragraph', text: paragraph })
      continue
    }
    const item = paragraph.replace(ITEM, '')
    const last = result[result.length - 1]
    if (last?.kind === 'list') last.items.push(item)
    else result.push({ kind: 'list', items: [item] })
  }
  return result
}
