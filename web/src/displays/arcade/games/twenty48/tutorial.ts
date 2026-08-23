/**
 * The How to Play cards, in play order: how to move, what merging does, how a
 * run ends, and what to aim for.
 */
import type { TutorialSpec } from '@src/displays/arcade/tutorial/types'
import {
  buildFullDemo,
  buildGoalDemo,
  buildMergeDemo,
  buildMoveDemo,
} from './game/demo'
import { TWENTY48_STRINGS as S } from './strings'

export const TWENTY48_TUTORIAL: TutorialSpec = [
  {
    title: S.tutorial.moveTitle,
    body: S.tutorial.moveBody,
    build: buildMoveDemo,
  },
  {
    title: S.tutorial.mergeTitle,
    body: S.tutorial.mergeBody,
    build: buildMergeDemo,
  },
  {
    title: S.tutorial.fullTitle,
    body: S.tutorial.fullBody,
    build: buildFullDemo,
  },
  {
    title: S.tutorial.goalTitle,
    body: S.tutorial.goalBody,
    build: buildGoalDemo,
  },
]
