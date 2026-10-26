# Contrast

`?display=contrast`: "How bad is the contrast?" A card with a random
background and text color comes in, and the player rates it with a thumbs-down
(poor), one thumbs-up (good) or two (great). Each round lasts 10 seconds. A wrong
answer or a timeout ends the run, and the score is the number of rounds
answered right. It needs no server, so it can be installed on an iPad
([`installing-as-an-app.md`](installing-as-an-app.md)).

## Algorithms

The attendant booth menu switches between APCA (the default) and WCAG 2. The
choice is saved and ends the game in progress.

| Level    | APCA \|Lc\| | WCAG ratio |
| -------- | ----------- | ---------- |
| 1, poor  | below 76.5  | below 4.5  |
| 2, good  | 76.5 to 90  | 4.5 to 7   |
| 3, great | 90 and up   | 7 and up   |

A pair within 5 Lc (APCA) or 0.25 (WCAG) of a threshold is never dealt, so no
answer is a coin flip. The APCA math is a local port in `game/apca.ts` and
carries the W3 license notice. Replace it with the `apca-w3` package if that is
preferred.

Cards use the fixed color list in `game/colorList.ts` (the same list as the
website's tool), loaded as its own chunk.

## Splash examples

The three cards on the splash start as fixed examples and then change one at a
time, every 1.8 seconds, each blending to a random pair of its own level
(`newExample` in `game/examples.ts`). A pair is only used when both algorithms
rate it the same and clear of a boundary, so the splash never shows an answer
the game would call wrong, whichever algorithm is on. A poor card also keeps
its thumbs visible. The cycling stops while the splash is leaving.

## High scores

One per algorithm, on the device: `bg.contrast.highscore.apca` and
`bg.contrast.highscore.wcag`. The algorithm is `bg.contrast.algorithm`.

## Layout

Everything is drawn on one canvas with stargazer. The frame is 1080 high and
between 1440 and 2400 wide, so a 4:3 iPad shows the Figma layout and a wider
screen shows more of the neighboring cards. A portrait window letterboxes the
1440 by 1080 frame. `ui/layout.ts` holds every box and `ui/motion.ts` every
duration. Animations tween a progress number and read the layout each frame,
so a resize during a zoom lands in the right place.

A card with too little contrast against the screen (WCAG ratio below 3) gets a
faint outline on the splash, between rounds and in the game over strip.

## Installed app

Installed, the page sits under a solid black status bar (see
[`installing-as-an-app.md`](installing-as-an-app.md)), and the display draws
inverted rounded corners at its top left and right so it looks like a rounded
screen set into the bar. They are black to match the bar: the `black` status bar
style on iOS and `theme_color` in `manifest-contrast.webmanifest` on Android.
Change them together.

## Installed app

Installed, the page sits under the iOS status bar, which shows the display's own
ink color (`black` status bar style, see
[`installing-as-an-app.md`](installing-as-an-app.md)). The display draws
inverted rounded corners at its top left and right in that color, so it looks
like a rounded screen set into the bar.

## Accessibility

The buttons are mirrored into the screen reader tree with `node.a11y`. The
engine's proxies are hidden and 1 px, so explore by touch does not find a
button where it is drawn. Activation works by the screen reader's own controls.

## Dev aids

`?screen=`, `?rounds=` and `?seed=` ([README](../README.md#dev-url-params)).
