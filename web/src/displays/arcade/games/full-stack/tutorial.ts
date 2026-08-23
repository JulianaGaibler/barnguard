// The how-to-play cards, in play order.
//
// Copy lives in `strings.ts` and the scenes in `game/demo.ts`. This file only
// pairs them, so a card cannot end up with someone else's demo without the
// pairing being the obvious place to look.

import type { TutorialSpec } from '@src/displays/arcade/tutorial/types'
import { FS_STRINGS as t } from './strings'
import {
  buildAnatomyDemo,
  buildFloorsDemo,
  buildHireDemo,
  buildOnHireDemo,
  buildResourcesDemo,
  buildReviewDemo,
  buildScoreDemo,
} from './game/demo'

export const FULL_STACK_TUTORIAL: TutorialSpec = [
  {
    title: t.tutorial.hireTitle,
    body: t.tutorial.hireBody,
    build: buildHireDemo,
  },
  {
    title: t.tutorial.floorsTitle,
    body: t.tutorial.floorsBody,
    build: buildFloorsDemo,
  },
  {
    title: t.tutorial.anatomyTitle,
    body: t.tutorial.anatomyBody,
    build: buildAnatomyDemo,
  },
  {
    title: t.tutorial.resourcesTitle,
    body: t.tutorial.resourcesBody,
    build: buildResourcesDemo,
  },
  {
    title: t.tutorial.onHireTitle,
    body: t.tutorial.onHireBody,
    build: buildOnHireDemo,
  },
  {
    title: t.tutorial.reviewTitle,
    body: t.tutorial.reviewBody,
    build: buildReviewDemo,
  },
  {
    title: t.tutorial.scoreTitle,
    body: t.tutorial.scoreBody,
    build: buildScoreDemo,
  },
]
