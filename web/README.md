# web

The kiosk SPA. Vite + Svelte 5 + TypeScript. The engine and its docs live
under [`src/stargazer/`](src/stargazer/README.md); this README covers the
booth-specific conventions.

## Text

All user-facing text lives in `src/i18n/`. Components read from `$t.*`
instead of inlining strings.

## Styles

SASS with shared tokens auto-prepended as the `tint` namespace. Any
`<style lang="sass">` block can use `tint.$size-16`, `tint.type-class(...)`,
etc. without an explicit `@use`. The prepend is configured in
`vite.config.ts` and mirrored for Svelte component styles in
`svelte.config.js`.

## Dev URL params

The stargazer engine reads a few URL params (`?debug=hud`, `?renderer=canvas2d`,
`?msaa=N`, `?demo=<name>`). See [`src/stargazer/README.md`](src/stargazer/README.md)
for the full list.
