/**
 * The display's artwork. A screen with nothing here draws without it, so the
 * layout can be checked before the art lands.
 */

import logos from './assets/logos.svg?url'
import splash from './assets/splash.json?url'

/** The splash animation, a Lottie JSON file, which loops. */
export const SPLASH_ANIMATION_URL: string | null = splash

/** The OSPR and Mozilla logos, in white, for the corner of the splash panel. */
export const LOGOS_URL: string = logos
