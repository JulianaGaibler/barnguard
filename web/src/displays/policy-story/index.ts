import type { DisplayManifest } from '@src/core/display'
import JumpPanel from './ui/JumpPanel.svelte'
import PolicyStoryScreen from './ui/PolicyStoryScreen.svelte'
import { policyStoryTheme } from './theme'
import { POLICY_STORY_DEFAULT_LANGUAGE, policyStoryLocales } from './i18n'

/** Stable id for the URL parameter and the server `display` tag. */
export const DISPLAY_ID = 'policy-story'

/**
 * A choose-your-own-adventure that opens as a questionnaire about age
 * verification laws and turns into a short life story. It records nothing and
 * prints nothing.
 */
const policyStory: DisplayManifest = {
  id: DISPLAY_ID,
  name: 'Policy Story',
  theme: policyStoryTheme,
  root: PolicyStoryScreen,
  install: {},
  attendantPanel: JumpPanel,
  locales: policyStoryLocales,
  defaultLanguage: POLICY_STORY_DEFAULT_LANGUAGE,
  // The display never logs a game, so the Games panel never has one to show.
  formatGameRecord: () => ({
    label: '',
    highScore: null,
    printable: false,
    reprintMeta: { highScore: false },
  }),
}

export default policyStory
