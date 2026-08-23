/**
 * Formatting and matching for a game's supported player counts.
 *
 * The counts are a set, not a range. Orbo runs at 2 or 4 and never at 3, so
 * rendering it as "2-4" would promise a game that does not exist.
 */

/** Ascending runs of consecutive numbers, e.g. `[1,2,4]` to `[[1,2],[4]]`. */
function consecutiveRuns(counts: readonly number[]): number[][] {
  const sorted = [...new Set(counts)].sort((a, b) => a - b)
  const runs: number[][] = []
  for (const n of sorted) {
    const last = runs[runs.length - 1]
    if (last && n === last[last.length - 1] + 1) last.push(n)
    else runs.push([n])
  }
  return runs
}

/**
 * Render supported counts for a card. Consecutive runs collapse to a range and
 * gaps stay apart, so `[1,2]` reads "1-2" while `[2,4]` reads "2 or 4".
 *
 * `or` is the localised conjunction.
 */
export function formatPlayerCounts(
  counts: readonly number[],
  or: string,
): string {
  return consecutiveRuns(counts)
    .map((run) =>
      run.length > 1 ? `${run[0]}-${run[run.length - 1]}` : `${run[0]}`,
    )
    .join(` ${or} `)
}

/** Every count any game offers, ascending. Drives the filter chips. */
export function playerCountsAcross(
  games: readonly { meta: { playerCounts: readonly number[] } }[],
): number[] {
  return [...new Set(games.flatMap((g) => g.meta.playerCounts))].sort(
    (a, b) => a - b,
  )
}
