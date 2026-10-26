import type { DisplayManifest } from '@src/core/display'
import AgeVerificationScreen from './ui/AgeVerificationScreen.svelte'
import { ageVerificationTheme } from './theme'
import {
  AGE_VERIFICATION_DEFAULT_LANGUAGE,
  ageVerificationLocales,
} from './i18n'

/** Stable id for the URL parameter and the server `display` tag. */
export const DISPLAY_ID = 'age-verification'

/**
 * A choose-your-own-adventure about age verification laws. It records nothing
 * and prints nothing.
 */
const ageVerification: DisplayManifest = {
  id: DISPLAY_ID,
  name: 'Age Verification',
  theme: ageVerificationTheme,
  root: AgeVerificationScreen,
  install: {},
  locales: ageVerificationLocales,
  defaultLanguage: AGE_VERIFICATION_DEFAULT_LANGUAGE,
  // The display never logs a game, so the Games panel never has one to show.
  formatGameRecord: () => ({
    label: '',
    highScore: null,
    printable: false,
    reprintMeta: { highScore: false },
  }),
}

export default ageVerification
