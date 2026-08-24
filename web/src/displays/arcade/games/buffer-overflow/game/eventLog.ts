/**
 * The event log's model: what a run has done, newest last, capped.
 *
 * Pure, and separate from the node that draws it, so the wording and the
 * capping are testable without a canvas. The node's only job is to decide how
 * many rows fit and which form they take.
 *
 * Newest last, because that is which way a log scrolls. The node shows the tail
 * and new entries arrive at the bottom.
 */

export type LogTone = 'plain' | 'accent' | 'warn'

export interface LogEntry {
  /** Seconds since the run began. */
  at: number
  label: string
  /** Omitted or zero draws no right-hand column. */
  points: number
  tone: LogTone
}

/** One row, split into the columns the node right-aligns independently. */
export interface LogLine {
  left: string
  right: string
}

/**
 * `mm:ss` since the run began, with the minutes padded.
 *
 * Padded where the clock readout is not, because a log is a column and a stamp
 * that changes width would shuffle every label sideways at the ten minute
 * mark.
 */
export function stamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Append `entry`, keeping only the newest `cap` rows. */
export function pushEntry(
  log: readonly LogEntry[],
  entry: LogEntry,
  cap: number,
): LogEntry[] {
  if (cap <= 0) return []
  return [...log, entry].slice(-cap)
}

/**
 * One row's two columns.
 *
 * The stamp is dropped in a narrow pane rather than truncating the label. Which
 * event fired is the information. When it fired to the second is not, and a
 * clipped word is unreadable in a way a missing timestamp is not.
 */
export function formatEntry(entry: LogEntry, withTime: boolean): LogLine {
  return {
    left: withTime ? `${stamp(entry.at)} ${entry.label}` : entry.label,
    right: entry.points > 0 ? `+${entry.points}` : '',
  }
}
