/**
 * How-to-play cards for JezzBall, rendered by the shared `HowToPlay` modal.
 * Each card supplies copy plus a scripted demo built on the shared demo stage.
 */
import type { TutorialSpec } from '../../tutorial/types'
import { JEZZBALL_STRINGS as S } from './strings'
import { buildCaptureDemo, buildDestroyDemo, buildWallDemo } from './game/demo'

export const JEZZBALL_TUTORIAL: TutorialSpec = [
  {
    title: S.tutorial.buildTitle,
    body: S.tutorial.buildBody,
    build: buildWallDemo,
  },
  {
    title: S.tutorial.captureTitle,
    body: S.tutorial.captureBody,
    build: buildCaptureDemo,
  },
  {
    title: S.tutorial.destroyTitle,
    body: S.tutorial.destroyBody,
    build: buildDestroyDemo,
  },
]
