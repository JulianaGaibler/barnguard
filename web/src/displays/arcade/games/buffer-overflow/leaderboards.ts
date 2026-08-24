/**
 * Buffer Overflow's two ranked boards.
 *
 * One board per mode, because the two are not comparable: an Uptime run ends
 * when the buffer fills and can last as long as the player holds out, while a
 * Countdown run is bounded by a clock that never passes forty-five seconds.
 * Pooling them would rank endurance against pace and measure neither.
 *
 * Both seat counts of a mode DO share a board. In a race the two buffers draw
 * from one seed and never interfere, so each player has played the same game a
 * solo player plays.
 *
 * Uptime is first, which makes it the primary: the launcher's gold badge and
 * its leaderboard filter read that one.
 */
import type { LeaderboardBoard } from '../GameModule'
import { BUFFER_OVERFLOW_STRINGS as t } from './strings'

export const BUFFER_OVERFLOW_LEADERBOARDS: readonly LeaderboardBoard[] = [
  { id: 'buffer-overflow', label: t.boardUptime },
  { id: 'buffer-overflow-countdown', label: t.boardCountdown },
]

/** The `display` key for a mode's scores. */
export function boardIdFor(mode: 'uptime' | 'countdown'): string {
  return mode === 'uptime'
    ? BUFFER_OVERFLOW_LEADERBOARDS[0].id
    : BUFFER_OVERFLOW_LEADERBOARDS[1].id
}
