/**
 * The display's artwork. A screen with nothing here draws without it, so the
 * layout can be checked before the art lands.
 */

import logos from './assets/logos.svg?url'
import splash from './assets/splash.json?url'
import qrMozillaBlog from './assets/qr/mozilla-blog.png?url'
import qrProjectSyndicate from './assets/qr/project-syndicate.png?url'

/** The splash animation, a Lottie JSON file, which loops. */
export const SPLASH_ANIMATION_URL: string | null = splash

/** The OSPR and Mozilla logos, in white, for the corner of the splash panel. */
export const LOGOS_URL: string = logos

/** QR codes for further reading, shown beside the sign-up form. */
export const QR_MOZILLA_BLOG: string = qrMozillaBlog
export const QR_PROJECT_SYNDICATE: string = qrProjectSyndicate
