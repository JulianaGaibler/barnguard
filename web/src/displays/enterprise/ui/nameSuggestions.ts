/**
 * Names the keyboard offers while a player names their score. With nothing
 * typed, the names entered most recently on this board, since a returning
 * player is likely among them. While typing, the names on the board that start
 * with what is typed, best score first.
 *
 * Picking one is how a player claims their own earlier entry, and the row then
 * shows whether this round beats it.
 */
import type { LeaderboardEntry } from '@src/core/leaderboard/leaderboardClient'
import { normalizeName } from './leaderboardRows'

/** Suggestions the keyboard's strip has room for. */
export const SUGGESTION_COUNT = 4

export function nameSuggestions(
  entries: readonly LeaderboardEntry[],
  typed: string,
  count: number = SUGGESTION_COUNT,
): string[] {
  const prefix = normalizeName(typed)
  const named = entries.filter((e) => e.name !== '')
  const ordered = prefix
    ? named
        .filter((e) => e.name.startsWith(prefix) && e.name !== prefix)
        .sort((a, b) => b.score - a.score || a.tsMs - b.tsMs)
    : [...named].sort((a, b) => b.tsMs - a.tsMs)
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of ordered) {
    if (seen.has(e.name)) continue
    seen.add(e.name)
    out.push(e.name)
    if (out.length === count) break
  }
  return out
}
