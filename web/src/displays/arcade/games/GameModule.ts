import type { Component } from 'svelte'
import type { EngineHost } from '@src/stargazer'
import type { ThemeFonts, ThemePalette } from '@src/core/theme'
import type { LabelRenderContext, PreviewLabelContext } from '@src/core/display'
import type { GameRecord } from '@src/core/game-log/gameLogClient'
import type { DemoStageController } from '../tutorial/types'
import type { ArcadeCamera } from './arcadeCamera'
import type { ArcadeBackdrop } from './arcadeBackdrop'
import type { GameRegion } from './gameRegion.svelte'

/** One ranked board. */
export interface LeaderboardBoard {
  /** The `display` key sent to the leaderboard API. Kebab-case, permanent. */
  id: string
  /** Segment label in the leaderboard modal, e.g. `'Marathon'`. */
  label: string
}

/** Card metadata shown in the launcher. */
export interface GameMeta {
  /** Stable id. */
  id: string
  title: string
  description: string
  /**
   * Every player count the game actually runs at, ascending. A set rather than
   * a range, because Orbo plays at 2 or 4 and never at 3.
   */
  playerCounts: readonly number[]
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
  /**
   * Optional per-game font-role overrides, the `--font-*` counterpart to
   * `themeTokens`. Scoped to the game's container (see `fontScope`), which
   * covers its DOM overlays.
   *
   * The game's canvas nodes must resolve their fonts from the SAME constant
   * this points at, via `resolveFonts`/`fontFor`. The engine canvas sits
   * outside the scoped container and cannot read the custom properties back.
   * One constant, both surfaces, no drift.
   */
  fontTokens?: ThemeFonts
  /**
   * Ranked boards this game keeps, best-known first. Omit for a game that keeps
   * no scores.
   *
   * One entry is the common case, and its `id` is conventionally the game's own
   * `id`. A game whose modes are not comparable declares one board per mode
   * instead: a two-minute sprint and a forty-minute marathon on the same ladder
   * would rank patience, not skill. The first entry is the PRIMARY board, which
   * is what the launcher's gold badge and its leaderboard filter read.
   *
   * `label` names the segment in the leaderboard modal's switcher, which only
   * appears past one board.
   */
  leaderboards?: readonly LeaderboardBoard[]
  /** Whether a human can play this against the machine. */
  supportsAi?: boolean
}

/**
 * The board the launcher reads for a game: its badge, and whether the
 * leaderboard filter keeps it. `undefined` for a game that keeps no scores,
 * which is also the test for "does this game rank at all".
 */
export function primaryBoard(meta: GameMeta): LeaderboardBoard | undefined {
  return meta.leaderboards?.[0]
}

/** Props the arcade passes to every game component. */
export interface GameProps {
  /** The shared engine host (already started, with the background attached). */
  host: EngineHost
  /**
   * Return to the arcade launcher. Games own their own return affordance (e.g.
   * a "Return to Launcher" button on a home screen) and call this to hand
   * control back. The arcade pans to the launcher and unmounts the game. The
   * arcade-wide swipe-down escape hatch and the idle reset call the same path.
   *
   * A game pins its overlays to the game region with the `domAnchor` action so
   * they ride the camera on that pan (see the HTML overlays guide). No fade
   * handshake is needed.
   *
   * Anything that has to reach the server before the game goes away registers
   * with `registerExitTask`, which the arcade waits on here. A game that leaves
   * that to its own unmount loses the write when a player walks off and the
   * idle reset fires.
   */
  onExit: () => void
  /**
   * Shared, pre-warmed demo stage powering the "How to play" tutorial. `null`
   * if the stage couldn't be created (e.g. no WebGL2). Games hide the tutorial
   * affordance in that case.
   */
  demoStage: DemoStageController | null
  /**
   * A lease over the arcade's shared camera, scoped to the game region. Most
   * games ignore it (they render at `camera.home()`). A game that zooms into
   * its region, framing sub-rects, drives it and the arcade reclaims it on
   * exit. See {@link ArcadeCamera}.
   */
  camera: ArcadeCamera
  /**
   * A lease over the arcade's shared sky, ocean and clouds. Most games ignore
   * it and draw over the sky as usual.
   *
   * A 3D game has to hide it: the depth-tested 3D pass runs before every 2D
   * layer, so the sky covers its whole scene. Hide it behind your own menu
   * rather than during the launcher pan, or the change is visible as a blink.
   * The arcade restores it on exit. See {@link ArcadeBackdrop}.
   */
  backdrop: ArcadeBackdrop
  /**
   * The game region: an anchor node at its top-left, the world rect actually
   * visible at the current canvas aspect, and the inset the booth's corner
   * gesture reserves. Kept current on resize, so a game pins its overlays to
   * `region.anchor`, sizes them to `region.rect`, and relayouts from
   * `region.onResize`. See {@link GameRegion}.
   */
  region: GameRegion
}

/**
 * A game the arcade can launch. `component` is mounted into the GAME region
 * when the player taps Play. It receives {@link GameProps} and builds its own
 * scene subtree + overlays, tearing them down on unmount.
 */
export interface GameModule {
  meta: GameMeta
  component: Component<GameProps>
  /**
   * Render a finished game's record to a printable JPEG label. Each game owns
   * its own label design (Jezzball's badge won't look like Connect Four's), so
   * this lives per-game rather than once for the whole arcade display. Omit
   * entirely if this game doesn't print. The arcade display's
   * `formatGameRecord` gates the attendant "Games" panel's Print button on
   * whether this is present, and dispatches here by `record.gameId` when it
   * is.
   */
  renderLabelForRecord?(
    record: GameRecord,
    ctx: LabelRenderContext,
  ): Promise<Blob>
  /**
   * Render a representative preview label for the attendant printer panel. Omit
   * alongside `renderLabelForRecord` if this game doesn't print.
   */
  renderPreviewLabel?(ctx: PreviewLabelContext): Promise<Blob>
}
