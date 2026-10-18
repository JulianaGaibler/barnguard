# web

The kiosk SPA. Vite + Svelte 5 + TypeScript. The engine and its docs live
under [`src/stargazer/`](src/stargazer/README.md); this README covers the
booth-specific conventions.

Adding an arcade game: [`docs/adding-a-game.md`](docs/adding-a-game.md) covers
the engine, the arcade shell, the conventions every game follows, and the
optional pieces a game can use.

Writing the age verification story:
[`docs/writing-a-story.md`](docs/writing-a-story.md) covers the story module,
its screens and flags, and the checks that run on it.

Dithering art with the brand's bitmap look: [`docs/dither.md`](docs/dither.md)
covers the effect, its presets and settings, and how it runs on each backend.

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

Engine-wide:

| Param | Values | Effect |
| --- | --- | --- |
| `?display=<id>` | `age-verification`, `arcade`, `enterprise` | Which display to boot. |
| `?debug=` | `hud`, `perf` | Opens the debug overlay. |
| `?msaa=` | `0`, `2`, `4`, `8` | Multisample count, default 4. |
| `?gfx=` | `webgpu`, `webgl2` | Forces a backend instead of picking one. |
| `?demo=<name>` | | Boots a sandbox scene instead of a display. |
| `?dither` | `?dither&preset=halftoneSphere&source=sphere` | Opens the dither tuning page instead of a display. See [`docs/dither.md`](docs/dither.md). |

Arcade launcher sky. The background tracks the real sun over the booth, so
these pin it to a point in the cycle you would otherwise have to wait for:

| Param | Example | Effect |
| --- | --- | --- |
| `?time=HH:MM` | `?time=05:30` | Freezes at that wall clock in the booth's zone. |
| `?date=MM-DD` | `?date=12-21` | Combines with `?time` to preview another point in the year. |
| `?sun=<deg>` | `?sun=-6` | Freezes at an effective sun elevation, for landing on a stop. |

`?time` and `?date` resolve against the timezone the daemon reports, not the
machine's, so a preview means the same thing from anywhere.

The attendant booth menu has a Sky section with a time-of-day slider that
overrides all of these at runtime. It rests on the booth's live clock while the
sky follows the sun, and dragging it pins the sky and scrubs the day. "Follow
the sun" releases it.

Age verification story, in development builds only:

| Param | Example | Effect |
| --- | --- | --- |
| `?node=<id>` | `?node=final-choice` | Opens the story at that screen, by the shortest path. |
| `?flags=<a,b>` | `?flags=strict,checks` | With `?node`, takes a path that sets these flags. |
