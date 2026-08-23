/**
 * How-to-play cards for Flood It, rendered by the shared `HowToPlay` modal.
 * Each card supplies copy plus a board that plays itself on the shared demo
 * stage, so the rules are shown rather than described.
 *
 * Three cards, ordered the way a player meets them: the move, then the
 * accessibility affordance, then the constraint. The two-player modes are left
 * out on purpose. They are picked from the menu, so anyone playing one has
 * already read its name, and a fourth card only makes the tutorial longer than
 * the game takes to understand.
 */
import type { TutorialSpec } from '../../tutorial/types'
import { FLOOD_IT_STRINGS as S } from './strings'
import { buildFloodDemo, buildGlyphDemo, buildLimitDemo } from './game/demo'

export const FLOOD_IT_TUTORIAL: TutorialSpec = [
  {
    title: S.tutorial.floodTitle,
    body: S.tutorial.floodBody,
    build: buildFloodDemo,
  },
  {
    title: S.tutorial.glyphTitle,
    body: S.tutorial.glyphBody,
    build: buildGlyphDemo,
  },
  {
    title: S.tutorial.limitTitle,
    body: S.tutorial.limitBody,
    build: buildLimitDemo,
  },
]
