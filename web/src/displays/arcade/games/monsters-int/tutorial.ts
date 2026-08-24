// The how-to-play cards, in the order they are read.
//
// Copy lives in `strings.ts` and the scenes in `game/demo.ts`. This file only
// pairs them, so a card cannot end up with someone else's demo without the
// pairing being the obvious place to look.
//
// What the game IS comes before how it is played: the goal, the deck, the prize
// and the risk, then the two buttons, then what changes the rules.

import type { TutorialSpec } from '@src/displays/arcade/tutorial/types'
import { MONSTERS_INT_STRINGS as t } from './strings'
import {
  buildActionsDemo,
  buildBonusDemo,
  buildBustDemo,
  buildDeckDemo,
  buildGoalDemo,
  buildHitStayDemo,
  buildSevenDemo,
} from './game/demo'

export const MONSTERS_INT_TUTORIAL: TutorialSpec = [
  {
    title: t.tutorial.goalTitle,
    body: t.tutorial.goalBody,
    build: buildGoalDemo,
  },
  {
    title: t.tutorial.deckTitle,
    body: t.tutorial.deckBody,
    build: buildDeckDemo,
  },
  {
    title: t.tutorial.sevenTitle,
    body: t.tutorial.sevenBody,
    build: buildSevenDemo,
  },
  {
    title: t.tutorial.bustTitle,
    body: t.tutorial.bustBody,
    build: buildBustDemo,
  },
  {
    title: t.tutorial.hitStayTitle,
    body: t.tutorial.hitStayBody,
    build: buildHitStayDemo,
  },
  {
    title: t.tutorial.bonusTitle,
    body: t.tutorial.bonusBody,
    build: buildBonusDemo,
  },
  {
    title: t.tutorial.actionsTitle,
    body: t.tutorial.actionsBody,
    build: buildActionsDemo,
  },
]
