import type { Component } from 'svelte'
import type { EngineHost } from '@src/stargazer'
import type { ThemePalette } from '@src/core/theme'

/** Card metadata shown in the launcher. */
export interface GameMeta {
  /** Stable id. */
  id: string
  title: string
  description: string
  /** Player-count blurb, e.g. "2-4" or "1". */
  players: string
  /** Solid thumbnail color (placeholder until real art). */
  thumbColor: string
  /**
   * Optional per-game color overrides. Scoped to the game's container (see
   * `themeScope`), so a game can restyle accents/team colors without changing
   * the arcade display theme.
   */
  themeTokens?: ThemePalette
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
}

/**
 * A game the arcade can launch. `component` is mounted into the GAME region
 * when the player taps Play; it receives {@link GameProps} and builds its own
 * scene subtree + overlays, tearing them down on unmount.
 */
export interface GameModule {
  meta: GameMeta
  component: Component<GameProps>
}
