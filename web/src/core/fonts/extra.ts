/**
 * The faces only some displays use: Azeret Mono, Geist, Bungee, Raleway,
 * Sniglet, Sorts Mill Goudy and Bagnard. Importing this module loads their
 * sheet, and a display hands the specs to its manifest's `fontSpecs` so the
 * boot gate waits for them.
 *
 * A display built on its own leaves these files out unless it imports this.
 */
import '@src/styles/fonts-extra.scss'

export { EXTRA_FONT_SPECS } from './index'
