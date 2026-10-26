import type { DisplayManifest } from '@src/core/display'
import ContrastScreen from './ui/ContrastScreen.svelte'
import AttendantPanel from './ui/AttendantPanel.svelte'
import { contrastTheme } from './theme'
import { CONTRAST_DEFAULT_LANGUAGE, contrastLocales } from './i18n'

/** Stable id for the URL parameter and the server `display` tag. */
export const DISPLAY_ID = 'contrast'

/**
 * A guessing game about color contrast. It needs no server: high scores are
 * kept on the device, and it logs and prints nothing.
 */
const contrast: DisplayManifest = {
  id: DISPLAY_ID,
  name: 'Contrast',
  theme: contrastTheme,
  root: ContrastScreen,
  install: { statusBarStyle: 'black' },
  locales: contrastLocales,
  defaultLanguage: CONTRAST_DEFAULT_LANGUAGE,
  attendantPanel: AttendantPanel,
  // The display never logs a game, so the Games panel never has one to show.
  formatGameRecord: () => ({
    label: '',
    highScore: null,
    printable: false,
    reprintMeta: { highScore: false },
  }),
}

export default contrast
