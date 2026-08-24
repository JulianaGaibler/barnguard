/**
 * Buffer Overflow's UI copy. English only, a plain object the game's components
 * and nodes import directly. Copy that is about the arcade shell rather than
 * this game (How to play, Return to Launcher, Leaderboard, Play again) comes
 * from `displays/arcade/i18n` instead, so every game says it the same way.
 *
 * The pause register is the exception and stays here: a suspended process is
 * continued or killed, which is this game's vocabulary rather than the shell's,
 * and its pause modal is the game's own for the same reason.
 *
 * The vocabulary is the game's own and is used consistently: the playfield is
 * the BUFFER, filling it is an OVERFLOW, a four-row clear is a FLUSH, a spin
 * bonus is a TWIST, and consecutive hard clears are a STREAK. None of the
 * industry's trademarked terms appear anywhere in this game.
 */
export const BUFFER_OVERFLOW_STRINGS = {
  title: 'Buffer Overflow',

  modeUptime: 'Uptime',
  modeCountdown: 'Countdown',
  players1: '1 Player',
  players2: '2 Players',
  chooseSeats: 'Players',

  /**
   * A paused process is suspended, and the two buttons are the signals that
   * send it on or finish it. Readable without knowing that, which is the bar
   * the whole syscall register has to clear.
   */
  paused: 'Suspended',
  resume: 'continue',
  quit: 'kill',

  /**
   * Pane titles and section captions are lowercase, values and keys uppercase.
   * That contrast is most of what makes a screen read as tool output rather
   * than as an interface, and it costs nothing.
   */
  paneState: 'state',
  paneStats: 'stats',
  paneInput: 'input',
  /**
   * The two ambient columns, solo only.
   *
   * Everything they name is this game's own fiction. A column of decoration is
   * exactly the place a real product name would slip in unnoticed, so none do.
   */
  paneSys: 'sys',
  paneBuild: 'build',
  paneLoad: 'load',
  sysHeader: { left: 'core', right: 'load' },
  buildHeader: { left: 'target', right: 'left' },
  sysGauges: ['cpu0', 'cpu1', 'cpu2', 'cpu3', 'mem', 'swap'],
  /** The graph's three readings, left to right. */
  loadColumns: ['cur', 'max', 'avg'] as const,
  hold: 'bank',
  next: 'queue',
  events: 'events',
  score: 'score',
  level: 'level',
  lines: 'lines',
  time: 'clock',
  /** The buffer's own title, solo. A race puts the seat name here instead. */
  bufferPath: '/dev/buffer',
  seat: (who: 1 | 2): string => `player ${who}`,
  headerTitle: 'buffer-overflow 1.0',
  /** The button under the bank pocket. A verb, unlike every other control. */
  bank: 'BANK IT',

  /** Event log rows. Terse, because the column is narrow and the eye is busy. */
  logClear: (rows: number): string => `clear ${rows}`,
  logFlush: 'FLUSH',
  logTwist: (rows: number): string => `twist ${rows}`,
  logChain: (n: number): string => `x${n}`,
  logLevel: (level: number): string => `level ${level}`,
  logTime: (seconds: number): string => `+${Math.round(seconds)}s clock`,
  logOverflow: 'buffer overflow',
  logTimeout: 'out of time',

  /** The four-row clear, the thing the whole scoring table is built around. */
  flush: 'FLUSH',
  twist: 'TWIST',
  streak: 'STREAK',
  levelUp: (level: number): string => `LEVEL ${level}`,
  combo: (n: number): string => `${n}x CHAIN`,

  playerOne: 'Player 1',
  playerTwo: 'Player 2',
  /** Shown on a finished half while the other player is still going. */
  waiting: 'Waiting for the other player',
  opponentScore: (score: number): string => `They are on ${score}`,

  /**
   * Topping out is the fault the game is named after, so it says so. The plain
   * summary sits directly under it, which is what keeps the result legible to a
   * player who does not write software.
   */
  overflowTitle: 'Segmentation fault',
  overflowDetail: 'core dumped',
  timeUpTitle: 'Timeout',
  timeUpDetail: 'killed',
  soloSummary: (lines: number, level: number): string =>
    `${lines} ${lines === 1 ? 'line' : 'lines'} at level ${level}.`,

  versusWin: (who: string): string => `${who} wins`,
  versusTie: 'Dead heat',

  boardUptime: 'Uptime',
  boardCountdown: 'Countdown',

  tutorial: {
    moveTitle: 'Steer it down',
    moveBody:
      'Hold the arrows to slide, tap the turn keys to rotate. Or work straight on the buffer: tap to turn, two fingers to turn back, drag to slide, pull down to hurry it, flick down to drop.',
    flushTitle: 'Fill a row to clear it',
    flushBody:
      'A full row empties and everything above it falls. Four rows at once is a FLUSH, and it scores eight times what four single rows would.',
    overflowTitle: 'Do not let it reach the top',
    overflowBody:
      'A piece with nowhere to enter ends the run. The outline shows where the current piece will land, so you can place it without waiting.',
    modesTitle: 'Two ways to play',
    modesBody:
      'Uptime has no clock: play until the buffer overflows. Countdown gives you 45 seconds and takes them back steadily. Every clear buys time, and a FLUSH buys seven times what one row does.',
  },
} as const
