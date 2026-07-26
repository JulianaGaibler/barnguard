import type { TutorialSpec } from '@src/displays/arcade/tutorial/types'
import { ORBO_STRINGS as t } from './strings'
import {
  buildOrboBumpDemo,
  buildOrboLivesDemo,
  buildOrboOvershootDemo,
  buildOrboScoreDemo,
  buildOrboWinDemo,
} from './game/demo'

/**
 * Orbo's "How to play" cards, in play order: score, bump, overshoot, lives,
 * win.
 */
export const ORBO_TUTORIAL: TutorialSpec = [
  {
    title: t.tutorial.scoreTitle,
    body: t.tutorial.scoreBody,
    build: (stage, host) => buildOrboScoreDemo(stage, host),
  },
  {
    title: t.tutorial.bumpTitle,
    body: t.tutorial.bumpBody,
    build: (stage, host) => buildOrboBumpDemo(stage, host),
  },
  {
    title: t.tutorial.overshootTitle,
    body: t.tutorial.overshootBody,
    build: (stage, host) => buildOrboOvershootDemo(stage, host),
  },
  {
    title: t.tutorial.livesTitle,
    body: t.tutorial.livesBody,
    build: (stage, host) => buildOrboLivesDemo(stage, host),
  },
  {
    title: t.tutorial.winTitle,
    body: t.tutorial.winBody,
    build: (stage, host) => buildOrboWinDemo(stage, host),
  },
]
