/**
 * How-to-play cards for Data Control, rendered by the shared `HowToPlay` modal.
 * Each card supplies copy plus a scripted demo built on the shared demo stage.
 */
import type { TutorialSpec } from '../../tutorial/types'
import { DATA_CONTROL_STRINGS as S } from './strings'
import { buildRouteDemo, buildAvoidDemo } from './game/demo'

export const DATA_CONTROL_TUTORIAL: TutorialSpec = [
  {
    title: S.tutorial.routeTitle,
    body: S.tutorial.routeBody,
    build: buildRouteDemo,
  },
  {
    title: S.tutorial.avoidTitle,
    body: S.tutorial.avoidBody,
    build: buildAvoidDemo,
  },
]
