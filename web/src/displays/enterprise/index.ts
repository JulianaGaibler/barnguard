import type {
  DisplayManifest,
  LabelRenderContext,
  PreviewLabelContext,
} from '@src/core/display'
import type { GameRecord } from '@src/core/game-log/gameLogClient'
import {
  asEnterprise,
  DISPLAY_ID,
  fetchEnterpriseHighScores,
  type EnterpriseGameRecord,
} from './game-log'
import { enterpriseTheme } from './theme'
import GameScreen from './overlays/GameScreen.svelte'
import SelectedStatePreview from './attendant/SelectedStatePreview.svelte'
import { enterpriseLocales, ENTERPRISE_DEFAULT_LANGUAGE } from './i18n'
import { labelPicksOf, renderLabel, type LabelInput } from './label'
import { whenEngine } from './engineHandle'
import type { EnterpriseMessages } from './i18n/types'
import { squarePxFrom } from '@src/core/print/canvas'
import { LEGACY_MAP_ID } from './game'

/**
 * Translate a persisted `GameRecord` (server shape) into a `LabelInput` (the
 * shape the local label renderer wants). Called by the attendant reprint flow.
 */
async function recordToLabelInput(record: GameRecord): Promise<LabelInput> {
  const narrow: EnterpriseGameRecord = asEnterprise(record)
  const highScores = await fetchEnterpriseHighScores()
  return {
    reason: narrow.reason === 'exited_germany' ? 'exitedGermany' : 'collision',
    stateId: narrow.stateId,
    // The record's own map, so a reprint names the region the same way the
    // original badge did even while another map is loaded.
    mapId: narrow.mapId ?? LEGACY_MAP_ID,
    score: narrow.score,
    isOverallHigh: narrow.wasOverallHigh,
    isStateHigh: narrow.wasStateHigh,
    highScores,
    escapeHeadingRad: narrow.escapeHeadingRad,
    printedAt: new Date(),
    ...labelPicksOf(narrow),
  }
}

export const enterprise: DisplayManifest = {
  formatGameRecord(record) {
    const g = asEnterprise(record)
    const highScore = g.wasOverallHigh
      ? 'overall'
      : g.wasStateHigh
        ? 'category'
        : null
    return {
      label: g.stateId.toUpperCase(),
      highScore,
      printable: true,
      reprintMeta: {
        stateId: g.stateId,
        score: g.score,
        highScore: g.wasOverallHigh || g.wasStateHigh,
      },
    }
  },
  id: DISPLAY_ID,
  name: 'Firefox Enterprise',
  theme: enterpriseTheme,
  root: GameScreen,
  attendantPanel: SelectedStatePreview,
  // One board per map, so the attendant can moderate both.
  leaderboardIds: ['enterprise-eu', 'enterprise-de'],
  locales: enterpriseLocales,
  defaultLanguage: ENTERPRISE_DEFAULT_LANGUAGE,

  async renderLabelForRecord(
    record: GameRecord,
    ctx: LabelRenderContext,
  ): Promise<Blob> {
    const input = await recordToLabelInput(record)
    return renderLabel(await whenEngine(), input, {
      // The manifest boundary types `messages` as the core shape. Internally
      // this display renders its own message keys and narrows here (the
      // active-display invariant guarantees the extra sections are present).
      messages: ctx.messages as unknown as EnterpriseMessages,
      size: squarePxFrom(ctx.tapeWidthMm),
    })
  },

  async renderPreviewLabel(ctx: PreviewLabelContext): Promise<Blob> {
    const input: LabelInput = {
      reason: 'exitedGermany',
      mapId: LEGACY_MAP_ID,
      stateId: 'BE',
      score: 42,
      isOverallHigh: ctx.highScore,
      isStateHigh: ctx.highScore,
      highScores: {
        display: DISPLAY_ID,
        byMap: { [LEGACY_MAP_ID]: 42 },
        byState: { [LEGACY_MAP_ID]: { BE: 42 } },
      },
    }
    return renderLabel(await whenEngine(), input, {
      // The manifest boundary types `messages` as the core shape. Internally
      // this display renders its own message keys and narrows here (the
      // active-display invariant guarantees the extra sections are present).
      messages: ctx.messages as unknown as EnterpriseMessages,
      size: squarePxFrom(ctx.tapeWidthMm),
    })
  },
}
