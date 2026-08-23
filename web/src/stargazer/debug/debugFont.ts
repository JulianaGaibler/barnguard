/**
 * The debug overlays' typeface.
 *
 * Stargazer is a library and has no view of the app's theme, so the debug
 * renderers cannot reach a font role. They share this constant instead, which
 * keeps every overlay on one face.
 */
export const DEBUG_MONO = 'ui-monospace, "SF Mono", Menlo, monospace'

/** A CSS `font` shorthand for the debug face at `px`. */
export const debugFont = (px: number): string => `${px}px ${DEBUG_MONO}`
