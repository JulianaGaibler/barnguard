import type { EngineHost, Stage } from '@src/stargazer'

/**
 * A live demo running on the shared demo stage. `destroy` tears the built
 * subtree down: destroying nodes cascades AbortErrors through in-flight `loop`
 * / `tween` / `wait` calls and unregisters any physics world the demo
 * attached.
 */
export interface DemoHandle {
  destroy(): void
}

/**
 * Builds one card's in-engine scene into the shared demo `stage`, laid out to
 * the stage's fixed viewport (`stage.camera.viewport`, never the primary
 * `host.engine.renderer.pixelSize`). Animated cards drive motion via
 * `node.loop` / `engine.wait` / tweens; a "still" card just builds a static
 * scene. Only the centered card's demo exists at a time, so it always plays —
 * there is no separate play flag.
 */
export type DemoBuilder = (stage: Stage, host: EngineHost) => DemoHandle

/** One tutorial card: copy plus the scene it renders. */
export interface TutorialCard {
  title: string
  body: string
  build: DemoBuilder
}

/** An ordered set of cards for one game's tutorial. */
export type TutorialSpec = TutorialCard[]

/**
 * The arcade-owned, pre-warmed demo stage, handed to games via `GameProps`. A
 * single persistent GPU stage renders whichever card is centered; its scene
 * swaps as the selection changes.
 */
export interface DemoStageController {
  /** Move the fixed demo canvas into `slot` and start ticking the stage. */
  reveal(slot: HTMLElement): void
  /** Swap the scene: destroy the previous demo, build the new one (or clear). */
  setDemo(build: DemoBuilder | null): void
  /** Clear the scene, park the stage idle, and detach the canvas from its slot. */
  hide(): void
}
