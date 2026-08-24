import type { DisplayManifest } from '@src/core/display'
import { arcadeTheme } from './theme'
import ArcadeScreen from './ArcadeScreen.svelte'
import SkyPanel from './attendant/SkyPanel.svelte'
import { arcadeLocales, ARCADE_DEFAULT_LANGUAGE } from './i18n'
import { asArcade } from './game-log'
import { GAMES } from './games/registry'

const GAME_BY_ID = new Map(GAMES.map((g) => [g.meta.id, g]))

// The leaderboard is scoped per arcade game, and a game with modes that do not
// compare keeps one board per mode, so this is a flat list of every board every
// game declares rather than one id per game.
const LEADERBOARD_IDS = GAMES.flatMap((g) =>
  (g.meta.leaderboards ?? []).map((b) => b.id),
)

/**
 * The arcade display: a launcher "main screen" that hosts the games in
 * `games/registry` on the stargazer engine. Every finished game is recorded to
 * the game log (see each game's `recordArcadeGame` call) for attendant
 * visibility in the "Games" panel.
 *
 * Printing is opt-in per game, not per display: each label design is
 * game-specific, so `renderLabelForRecord`/`renderPreviewLabel` live on the
 * `GameModule` itself (see `GameModule.ts`) and this display just dispatches to
 * the right game by `record.gameId`. None of the five games has a label
 * renderer wired up yet, so every record currently comes back `printable:
 * false` and the dispatch below never actually fires. A game only needs to
 * implement those two methods on its own module to start printing.
 */
export const arcade: DisplayManifest = {
  id: 'arcade',
  name: 'Arcade',
  theme: arcadeTheme,
  root: ArcadeScreen,
  attendantPanel: SkyPanel,
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
