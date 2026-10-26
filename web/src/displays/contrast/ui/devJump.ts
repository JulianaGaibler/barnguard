/**
 * Development only: opens the display at a screen without playing up to it.
 * `?screen=` is one of the names below. `?rounds=<n>` first answers `n` rounds
 * right, which sets the score a game over shows. `?seed=<n>` makes the rounds
 * the same on every visit.
 */
import { seededRandom, type Random } from '../game/round'
import type { Session } from '../game/session'

export const DEV_SCREENS = [
  'splash',
  'intro',
  'playing',
  'reveal',
  'gameover',
] as const
export type DevScreen = (typeof DEV_SCREENS)[number]

export interface DevJump {
  screen: DevScreen
  rounds: number
  random: Random | undefined
}

/** The jump a query string asks for, or null when it asks for none. */
export function devJumpFrom(search: string): DevJump | null {
  const params = new URLSearchParams(search)
  const screen = DEV_SCREENS.find((s) => s === params.get('screen'))
  const seed = Number(params.get('seed'))
  const hasSeed = params.has('seed') && Number.isFinite(seed)
  if (!screen && !hasSeed) return null
  const rounds = Math.max(0, Math.floor(Number(params.get('rounds')) || 0))
  return {
    screen: screen ?? 'splash',
    rounds,
    random: hasSeed ? seededRandom(seed) : undefined,
  }
}

/**
 * Plays `session` to the screen of `jump`, answering for the visitor. Returns
 * the way to stop, which the driver also does by itself once it has arrived.
 */
export function driveTo(session: Session, jump: DevJump): () => void {
  if (jump.screen === 'splash') return () => {}
  let answered = 0
  const off = session.subscribe(() => {
    if (session.phase !== 'playing') return
    const right = session.round!.level
    const wrong = right === 1 ? 2 : 1
    if (answered < jump.rounds) {
      answered++
      session.vote(right)
      return
    }
    if (jump.screen === 'reveal') session.vote(right)
    else if (jump.screen === 'gameover') session.vote(wrong)
    off()
  })
  session.start()
  return off
}
