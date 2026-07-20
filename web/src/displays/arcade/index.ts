import type { DisplayManifest } from '@src/core/display'
import { arcadeTheme } from './theme'
import ArcadeScreen from './ArcadeScreen.svelte'
import { arcadeLocales, ARCADE_DEFAULT_LANGUAGE } from './i18n'
import { blankLabelBlob } from './label'

/**
 * The arcade display: a launcher "main screen" that hosts multiple games on the
 * stargazer engine (currently only Orbo). No printing / no high-score
 * persistence, so the printer/record manifest callbacks are safe stubs — in
 * normal play only `renderPreviewLabel` can fire (from the attendant panel).
 */
export const arcade: DisplayManifest = {
  id: 'arcade',
  name: 'Arcade',
  theme: arcadeTheme,
  root: ArcadeScreen,
  locales: arcadeLocales,
  defaultLanguage: ARCADE_DEFAULT_LANGUAGE,

  formatGameRecord() {
    return {
      label: 'ARCADE',
      highScore: null,
      reprintMeta: { highScore: false },
    }
  },

  async renderLabelForRecord(): Promise<Blob> {
    return blankLabelBlob()
  },

  async renderPreviewLabel(): Promise<Blob> {
    return blankLabelBlob()
  },
}
