/**
 * How-to-play cards, rendered by the shared `HowToPlay` modal. Each supplies
 * copy plus a buffer that plays itself, so the rules are shown rather than
 * described.
 *
 * Four cards, in the order a player meets them: how to steer, what a clear gets
 * you, what ends the run, and which mode to pick. The modes come last because
 * they are a choice between two versions of a game the first three cards have
 * already taught.
 */
import type { TutorialSpec } from '../../tutorial/types'
import { BUFFER_OVERFLOW_STRINGS as S } from './strings'
import {
  buildFlushDemo,
  buildModesDemo,
  buildMoveDemo,
  buildOverflowDemo,
} from './game/demo'

export const BUFFER_OVERFLOW_TUTORIAL: TutorialSpec = [
  {
    title: S.tutorial.moveTitle,
    body: S.tutorial.moveBody,
    build: buildMoveDemo,
  },
  {
    title: S.tutorial.flushTitle,
    body: S.tutorial.flushBody,
    build: buildFlushDemo,
  },
  {
    title: S.tutorial.overflowTitle,
    body: S.tutorial.overflowBody,
    build: buildOverflowDemo,
  },
  {
    title: S.tutorial.modesTitle,
    body: S.tutorial.modesBody,
    build: buildModesDemo,
  },
]
