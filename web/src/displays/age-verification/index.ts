import type { DisplayManifest } from '@src/core/display'
import AttendantPanel from './attendant/AttendantPanel.svelte'
import AgeVerificationScreen from './ui/AgeVerificationScreen.svelte'
import { ageVerificationTheme } from './theme'
import {
  AGE_VERIFICATION_DEFAULT_LANGUAGE,
  ageVerificationLocales,
} from './i18n'

/** Stable id for the URL parameter and the server `display` tag. */
export const DISPLAY_ID = 'age-verification'

/**
 * A choose-your-own-adventure about age verification laws, ending on a sign-up
 * form. The sign-ups stay on the device for the attendant to export, and the
 * display prints nothing.
 */
const ageVerification: DisplayManifest = {
  id: DISPLAY_ID,
  name: 'Age Verification',
  theme: ageVerificationTheme,
  root: AgeVerificationScreen,
  install: {},
  attendantPanel: AttendantPanel,
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
