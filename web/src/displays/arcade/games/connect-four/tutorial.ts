import type { TutorialSpec } from '@src/displays/arcade/tutorial/types'
import { CF_STRINGS as t } from './strings'
import { buildConnectFourStackDemo, buildConnectFourWinDemo } from './game/demo'

/** Connect Four's "How to play" cards: placing/stacking, then connecting four. */
export const CONNECT_FOUR_TUTORIAL: TutorialSpec = [
  {
    title: t.tutorial.placeTitle,
    body: t.tutorial.placeBody,
    build: (stage, host) => buildConnectFourStackDemo(stage, host),
  },
  {
    title: t.tutorial.winTitle,
    body: t.tutorial.winBody,
    build: (stage, host) => buildConnectFourWinDemo(stage, host),
  },
]
