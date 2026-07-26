import type { DisplayManifest } from '@src/core/display'
import { arcadeTheme } from './theme'
import ArcadeScreen from './ArcadeScreen.svelte'
import { arcadeLocales, ARCADE_DEFAULT_LANGUAGE } from './i18n'
import { asArcade } from './game-log'
import { GAMES } from './games/registry'

const GAME_BY_ID = new Map(GAMES.map((g) => [g.meta.id, g]))

// The leaderboard is scoped per arcade game (its `display` param is a
// `GameMeta.id`, not this manifest's own `id`) — reuse the same per-game
// opt-in flag the in-game leaderboard UI already checks.
const LEADERBOARD_IDS = GAMES.filter((g) => g.meta.supportsLeaderboard).map(
  (g) => g.meta.id,
)

/**
 * The arcade display: a launcher "main screen" that hosts three games
 * (Jezzball, Connect Four, Orbo) on the stargazer engine. Every finished game
 * is recorded to the game log (see each game's `recordArcadeGame` call) for
 * attendant visibility in the "Games" panel.
 *
 * Printing is opt-in per game, not per display: each label design is
 * game-specific, so `renderLabelForRecord`/`renderPreviewLabel` live on the
 * `GameModule` itself (see `GameModule.ts`) and this display just dispatches to
 * the right game by `record.gameId`. None of the three games has a label
 * renderer wired up yet, so every record currently comes back `printable:
 * false` and the dispatch below never actually fires — but a game only needs to
 * implement those two methods on its own module to start printing; no change
 * here.
 */
export const arcade: DisplayManifest = {
  id: 'arcade',
  name: 'Arcade',
  theme: arcadeTheme,
  root: ArcadeScreen,
  locales: arcadeLocales,
  defaultLanguage: ARCADE_DEFAULT_LANGUAGE,
  leaderboardIds: LEADERBOARD_IDS,

  formatGameRecord(record) {
    const g = asArcade(record)
    return {
      label: `${g.gameId.toUpperCase()} · ${g.mode}${g.winner ? ` · ${g.winner}` : ''}`,
      playerName: g.playerName,
      highScore: g.wasGameHigh ? 'category' : null,
      printable: GAME_BY_ID.get(g.gameId)?.renderLabelForRecord !== undefined,
      reprintMeta: { score: g.score, highScore: g.wasGameHigh },
    }
  },

  async renderLabelForRecord(record, ctx) {
    const g = asArcade(record)
    const game = GAME_BY_ID.get(g.gameId)
    if (!game?.renderLabelForRecord) {
      throw new Error(`arcade: "${g.gameId}" has no label renderer`)
    }
    return game.renderLabelForRecord(record, ctx)
  },
}
