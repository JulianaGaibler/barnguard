import type { Component } from 'svelte'
import type { EngineHost } from '@src/stargazer'
import type { ThemePalette } from '@src/core/theme'
import type { LabelRenderContext, PreviewLabelContext } from '@src/core/display'
import type { GameRecord } from '@src/core/game-log/gameLogClient'
import type { DemoStageController } from '../tutorial/types'

/** Card metadata shown in the launcher. */
export interface GameMeta {
  /** Stable id. */
  id: string
  title: string
  description: string
  /** Player-count blurb, e.g. "2-4" or "1". */
  players: string
  /** Solid thumbnail color, shown behind/instead of `thumbImage`. */
  thumbColor: string
  /** Thumbnail artwork shown on the launcher card, cropped to cover. */
  thumbImage?: string
  /**
   * Optional per-game color overrides. Scoped to the game's container (see
   * `themeScope`), so a game can restyle accents/team colors without changing
   * the arcade display theme.
   */
  themeTokens?: ThemePalette
  /** Whether this game submits to and shows `displays/arcade/leaderboard`,
   * keyed by `id`. */
  supportsLeaderboard?: boolean
}

/** Props the arcade passes to every game component. */
export interface GameProps {
  /** The shared engine host (already started, with the background attached). */
  host: EngineHost
  /**
   * Return to the arcade launcher. Games own their own return affordance (e.g.
   * a "Return to Launcher" button on a home screen) and call this to hand
   * control back; the arcade pans to the launcher and unmounts the game. The
   * arcade-wide swipe-down escape hatch calls the same path.
   *
   * A game pins its overlays to the game region with the `domAnchor` action so
   * they ride the camera on that pan (see the HTML overlays guide); no fade
   * handshake is needed.
   */
  onExit: () => void
  /**
   * Shared, pre-warmed demo stage powering the "How to play" tutorial. `null`
   * if the stage couldn't be created (e.g. no WebGL2); games hide the tutorial
   * affordance in that case.
   */
  demoStage: DemoStageController | null
}

/**
 * A game the arcade can launch. `component` is mounted into the GAME region
 * when the player taps Play; it receives {@link GameProps} and builds its own
 * scene subtree + overlays, tearing them down on unmount.
 */
export interface GameModule {
  meta: GameMeta
  component: Component<GameProps>
  /**
   * Render a finished game's record to a printable JPEG label. Each game owns
   * its own label design (Jezzball's badge won't look like Connect Four's),
   * so this lives per-game rather than once for the whole arcade display.
   * Omit entirely if this game doesn't print — the arcade display's
   * `formatGameRecord` gates the attendant "Games" panel's Print button on
   * whether this is present, and dispatches here by `record.gameId` when it
   * is.
   */
  renderLabelForRecord?(
    record: GameRecord,
    ctx: LabelRenderContext,
  ): Promise<Blob>
  /**
   * Render a representative preview label for the attendant printer panel.
   * Omit alongside `renderLabelForRecord` if this game doesn't print.
   */
  renderPreviewLabel?(ctx: PreviewLabelContext): Promise<Blob>
}
