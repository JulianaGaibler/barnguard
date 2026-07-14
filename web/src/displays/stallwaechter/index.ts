import type {
  DisplayManifest,
  LabelRenderContext,
  PreviewLabelContext,
} from '@src/core/display'
import type { GameRecord } from '@src/core/game-log/gameLogClient'
import {
  asStallwaechter,
  fetchStallwaechterHighScores,
  type StallwaechterGameRecord,
} from './game-log'
import { stallwaechterTheme } from './theme'
import GameScreen from './overlays/GameScreen.svelte'
import SelectedStatePreview from './attendant/SelectedStatePreview.svelte'
import {
  stallwaechterLocales,
  STALLWAECHTER_DEFAULT_LANGUAGE,
} from './i18n'
import { renderLabel, type LabelInput } from './label'
import type { StallwaechterMessages } from './i18n/types'
import { squarePxFrom } from '@src/core/print/canvas'
import type { StateId } from './game'

/**
 * Translate a persisted `GameRecord` (server shape) into a `LabelInput` (the
 * shape the local label renderer wants). Called by the attendant reprint flow.
 */
async function recordToLabelInput(record: GameRecord): Promise<LabelInput> {
  const narrow: StallwaechterGameRecord = asStallwaechter(record)
  const highScores = await fetchStallwaechterHighScores()
  return {
    reason:
      narrow.reason === 'exited_germany' ? 'exitedGermany' : 'collision',
    stateId: narrow.stateId as StateId,
    score: narrow.score,
    isOverallHigh: narrow.wasOverallHigh,
    isStateHigh: narrow.wasStateHigh,
    highScores,
    escapeHeadingRad: narrow.escapeHeadingRad,
    printedAt: new Date(),
  }
}

export const stallwaechter: DisplayManifest = {
  formatGameRecord(record) {
    const g = asStallwaechter(record)
    const highScore = g.wasOverallHigh
      ? 'overall'
      : g.wasStateHigh
        ? 'category'
        : null
    return {
      label: g.stateId.toUpperCase(),
      highScore,
      reprintMeta: {
        stateId: g.stateId,
        score: g.score,
        highScore: g.wasOverallHigh || g.wasStateHigh,
      },
    }
  },
  id: 'stallwaechter',
  name: 'Stallwächter 2026',
  theme: stallwaechterTheme,
  root: GameScreen,
  selectionPreview: SelectedStatePreview,
  locales: stallwaechterLocales,
  defaultLanguage: STALLWAECHTER_DEFAULT_LANGUAGE,

  async renderLabelForRecord(
    record: GameRecord,
    ctx: LabelRenderContext,
  ): Promise<Blob> {
    const input = await recordToLabelInput(record)
    return renderLabel(input, {
      // The manifest boundary types `messages` as the core shape; internally
      // this display renders its own message keys and narrows here (the
      // active-display invariant guarantees the extra sections are present).
      messages: ctx.messages as unknown as StallwaechterMessages,
      size: squarePxFrom(ctx.tapeWidthMm),
    })
  },

  async renderPreviewLabel(ctx: PreviewLabelContext): Promise<Blob> {
    const input: LabelInput = {
      reason: 'exitedGermany',
      stateId: 'BE',
      score: 42,
      isOverallHigh: ctx.highScore,
      isStateHigh: ctx.highScore,
      highScores: { display: 'stallwaechter', overall: 42, byState: { BE: 42 } },
    }
    return renderLabel(input, {
      // The manifest boundary types `messages` as the core shape; internally
      // this display renders its own message keys and narrows here (the
      // active-display invariant guarantees the extra sections are present).
      messages: ctx.messages as unknown as StallwaechterMessages,
      size: squarePxFrom(ctx.tapeWidthMm),
    })
  },
}
