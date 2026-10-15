/**
 * The rows the game over leaderboard card shows: the board with the player's
 * pending entry placed by score, windowed to a fixed number of rows so the
 * pending one is always in view.
 *
 * Equal scores share a place, and the place after them skips ahead, so two
 * players on 12 behind a 14 are both second and the next one is fourth.
 */
import type { LeaderboardEntry } from '@src/core/leaderboard/leaderboardClient'

/** The leaderboard `display` key a map's board is kept under. */
export function boardDisplay(mapId: string): string {
  return `enterprise-${mapId}`
}

/** Rows the card has room for. */
export const VISIBLE_ROWS = 8

/** Mirrors the server's name normalization, so a match here is a match there. */
const NAME_MAX = 12

export interface LeaderboardRow {
  /** One-based place on the board, shared by equal scores. */
  rank: number
  name: string
  region: string
  score: number
  /** The player's own entry, still being named. */
  pending: boolean
  /**
   * The pending row's name already holds a better score on the board, so the
   * row shows that score and the run will not replace it.
   */
  keepsBest: boolean
  /**
   * A best score nobody put a name to: the map's high score, standing above
   * every named entry. Shown so the board never claims a lower top than the one
   * the booth shows elsewhere.
   */
  anonymous: boolean
}

/** The map's best score and where it was set, from the high scores. */
export interface MapBest {
  score: number
  region: string
}

export interface PendingEntry {
  name: string
  score: number
  region: string
}

type UnrankedRow = Omit<LeaderboardRow, 'rank'>

/** The key the server stores a name under. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().slice(0, NAME_MAX)
}

/**
 * The visible rows. With no pending entry it is the top of the board. With one,
 * the entry takes the place its score earns (after any equal score, which was
 * there first), and a name already on the board merges with its row: the better
 * of the two scores stands, at that score's place.
 *
 * A map best above every named score heads the board as an unnamed row, until a
 * named score reaches it. The round on screen is that best when it ties or
 * beats it, so it does not appear twice.
 *
 * The window holds the top rows when the pending entry ranks among them, and
 * otherwise centres on it, clamped at both ends.
 */
export function leaderboardRows(
  entries: readonly LeaderboardEntry[],
  pending: PendingEntry | null,
  best: MapBest | null = null,
  visible: number = VISIBLE_ROWS,
): LeaderboardRow[] {
  const sorted = [...entries].sort(
    (a, b) => b.score - a.score || a.tsMs - b.tsMs,
  )
  const rows: UnrankedRow[] = sorted.map((e) => ({
    name: e.name,
    region: e.region ?? '',
    score: e.score,
    pending: false,
    keepsBest: false,
    anonymous: false,
  }))

  const topNamed = rows.length > 0 ? rows[0].score : 0
  if (
    best &&
    best.score > topNamed &&
    !(pending && pending.score >= best.score)
  ) {
    rows.unshift({
      name: '',
      region: best.region,
      score: best.score,
      pending: false,
      keepsBest: false,
      anonymous: true,
    })
  }

  let at = -1
  if (pending) {
    const key = normalizeName(pending.name)
    const same = key
      ? rows.findIndex((r) => !r.anonymous && r.name === key)
      : -1
    let score = pending.score
    let keepsBest = false
    if (same !== -1) {
      if (rows[same].score >= pending.score) {
        score = rows[same].score
        keepsBest = true
      }
      rows.splice(same, 1)
    }
    at = rows.findIndex((r) => r.score < score)
    if (at === -1) at = rows.length
    rows.splice(at, 0, {
      name: pending.name,
      region: pending.region,
      score,
      pending: true,
      keepsBest,
      anonymous: false,
    })
  }

  // Competition ranking: a row's place is one more than the rows scoring
  // strictly above it, so ties share a place.
  const ranked: LeaderboardRow[] = rows.map((r, i) => {
    let above = 0
    while (above < i && rows[above].score > r.score) above++
    return { ...r, rank: above + 1 }
  })
  if (at < visible) return ranked.slice(0, visible)
  const start = Math.max(
    0,
    Math.min(at - Math.floor(visible / 2), ranked.length - visible),
  )
  return ranked.slice(start, start + visible)
}
