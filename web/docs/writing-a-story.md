# Writing a story

The age verification display tells a choose-your-own-adventure story. A visitor
reads a scenario, makes a series of choices, sees what they lead to, and reaches
a conclusion. This guide is for whoever turns the writers' draft into the story
module.

The story lives in `src/displays/age-verification/story/story.ts`. It's plain
TypeScript data, so the type checker and the tests catch most mistakes before
the story reaches the booth.

The `policy-story` display is a copy of this one, opened with
`?display=policy-story`. Its story is in `src/displays/policy-story/story/story.ts`.
It has no Back or Home button, and its answers have a small square with no
letter. Its tests use a separate story in `story/fixture.ts`, so the story text
can change without touching them. After the progress row goes, a choice's
answers sit under the text, side by side when the screen is wide enough. The
text, the answers and the Continue button are centered, and the answers and the
button are plain text in the action color that underlines on hover. The next
section lists what its story format adds. A screen can also set `agitation`, 0
to 1, which scales how much a shaking mood such as the fight shakes. Start it at
0 and raise it screen by screen, and the background moves slowly at first and
quickly only at the top. Each mood can carry rects and circles drawn as halftone dots, in `ui/moods.ts`. They
fade out and back in slowly and grow and shrink a little. A circle in the middle
of the screen sits behind the text, and only the fight uses one.
The attendant menu has a "Jump to section" list for the same display. Its entries
are in `story/sections.ts`, and each opens the story by the shortest path to that
screen, so flags it reads start at whatever that path sets.

## Basic usage

A story is a set of screens, called nodes, each with an id. Every node except an
ending says where it leads. The story starts at the node named by `start`.

```ts
import { defineStory } from './types'

export const story = defineStory({
  start: 'scenario',
  nodes: {
    scenario: {
      kind: 'scene',
      body: ['The city has changed.', 'Most people accepted it.'],
      next: 'first-choice',
    },
    'first-choice': {
      kind: 'choice',
      body: ['What do you do?'],
      options: [
        { id: 'act', label: 'Do something.', next: 'the-end' },
        { id: 'wait', label: 'Wait and see.', next: 'the-end' },
      ],
    },
    'the-end': {
      kind: 'ending',
      title: 'The end',
      body: ['That was the story.'],
    },
  },
})
```

Each string in `body` is one paragraph.

### Kinds of screens

There are four kinds of node:

- **`scene`:** text with a Continue button. The opening scenario is a scene.
- **`choice`:** text on the left and two to four answers on the right, lettered
  A to D. Tapping an answer moves on.
- **`moment`:** text with a Continue button, marked with a star. Use a moment
  for a consequence of the last choice, or for an event in the world. The
  progress row shows a moment as a star.
- **`ending`:** an optional title and text, with a Start over button. The run
  stops here.

A scene, a moment, or an ending can have an illustration. Import the image and
give it alternative text:

```ts
import courtroom from '../assets/courtroom.svg?url'

// in a node
illustration: { src: courtroom, alt: 'A judge reading a ruling' },
```

On a portrait screen, such as a phone, the picture sits above the text in a wide
box that is about 830 design pixels across and 40 percent of the content height
tall. The display fits the image inside the box without cropping it. A picture
that reads well in a square or a wide box works on both layouts.

The display draws the image dithered. To change how, add `dither` to the
illustration, as the name of a preset or as settings laid over the display's own:

```ts
illustration: { src: courtroom, alt: 'A judge reading a ruling', dither: 'halftoneSphere' },
illustration: { src: courtroom, alt: 'A judge reading a ruling', dither: { cellSize: 8, dot: 'circle' } },
```

A preset brings its own colors. [`dither.md`](dither.md) lists the presets and
settings.

The splash screen isn't part of the story. Its title is in `i18n/en.ts`, one
line per entry so it breaks where the design does, and its animation is set in
`assets.ts`.

### Answer ids

Each answer has an `id` that's unique within its choice. The display records
which answer a visitor picked by this id, so keep it stable. Changing the label
is fine.

### Check your work

Run the story tests:

```sh
npx vitest run src/displays/age-verification
```

They fail if:

- a `next` or `to` names a node that doesn't exist
- the story loops back on itself
- a node can't be reached from the start
- a choice has fewer than two or more than four answers, or two answers share an
  id
- a list of routes can end without a match
- a flag is read but never set

A flag that's set but never read fails the test too, since it usually means a
typo.

A link to a missing node also fails to compile. The message names the missing
node as a missing property:

```text
Property 'the-ned' is missing in type '{ ... }'
```

To look at one screen without playing up to it, open the display with `?node=`:

```text
http://localhost:5173/?display=age-verification&node=first-choice
```

The display walks the shortest path to that node, so Back and the progress row
work as they would for a visitor. This works only in development builds.

## Advanced usage

### Paths that meet again

The story is a graph, not a tree. Two answers can lead to the same node, and so
can two whole branches. Paths can split and join as often as the story needs, as
long as none of them loops back to a node it already passed.

When paths join, the node they join at can't tell which way the visitor came.
Use flags for anything later screens need to remember.

### Flags

An answer can set flags with `sets`. A flag stays set for the rest of the run.
Going back past the answer unsets it.

```ts
{ id: 'strict', label: 'Check everyone.', sets: ['strict'], next: 'merge' },
```

Flags are read through conditions:

| Condition                     | Holds when                               |
| ----------------------------- | ---------------------------------------- |
| `{ flag: 'strict' }`          | the flag is set                          |
| `{ not: { flag: 'strict' } }` | the flag isn't set                       |
| `{ all: [a, b] }`             | every condition in the list holds        |
| `{ any: [a, b] }`             | at least one condition in the list holds |

### Conditional paragraphs

A paragraph can show only when a condition holds. This is how a screen that
several paths reach can still speak to the visitor's own choices:

```ts
body: [
  'The law passes.',
  { when: { flag: 'strict' }, text: 'Just as you wanted.' },
],
```

### Routes that depend on flags

`next` can be a list of routes instead of one id. The display picks the first
route whose condition holds. The last route has no `when`, so there's always
somewhere to go:

```ts
next: [
  { when: { all: [{ flag: 'strict' }, { flag: 'checks' }] }, to: 'locked-down' },
  { when: { flag: 'lenient' }, to: 'parents-decide' },
  { to: 'open-web' },
],
```

This is the usual way to pick an ending: every path reaches the last choice, and
the flags decide which conclusion follows.

### Text length

The text is set in CSS pixels by the width of the window: 20 on a phone, 28 on
a laptop and 32 on a 1920 pixel screen, and a few words alone on a screen are
set larger. If the text does not fit its box, it shrinks, by up to a quarter,
and then the box scrolls. Answers are set a little smaller than the text. The
tests don't measure text. Open every changed screen with `?node=` and check that
it fits, on a wide window and on a phone.

### Window shape

The screens are designed for 16:9 and adapt to any other window, such as a
browser with dev tools open. The progress row stays near the top, the buttons
near the bottom, and the content row stays 1664 design pixels wide in the
middle. A wider window adds margin. A taller one adds space to the content,
whose columns center their contents, so the line counts above hold at every
shape. The background and the pictures follow the window's corners and the right
column. A screen with only text sets it in a wider column, 980 design pixels
across. On a portrait window the answers get the height their text needs, and
the text above them gets the rest. `src/displays/age-verification/ui/layout.ts`
has the numbers.

### Keeping the place

The path so far is saved in the browser after every screen. Reloading the page
opens the story on the screen the visitor reached, with a "Start over" button
at the top. Going home, an ending, the idle reset and the attendant's Stop game
all forget the place. A saved path that no longer fits the story is dropped.

## See also

- `src/displays/age-verification/story/types.ts`, the shape of a story
- `src/displays/age-verification/story/validate.ts`, the checks the tests run
- [`adding-a-game.md`](adding-a-game.md), for the shared kiosk pieces such as
  the idle reset

## Motion

Screen transitions are tuned in one file, `src/displays/age-verification/ui/motion.ts`. It holds every duration, distance and stagger, and the background poses. The text, the right column and the buttons arrive together and the answers follow closely, so raise `spread` and `tileStagger` only a little.

## The policy story format

A screen of the `policy-story` story can carry more than the screens above. The
fields are in `story/types.ts`.

- `label` is a time marker above the text, such as `June. 5 months to the
election.` It shows on its own for a moment before the text.
- `reply` on an answer is what comes back for it. It shows above the text of the
  next screen, set like the text and running into it. It can hold conditional
  paragraphs. Where the
  next screen opens with a new label, make the reply its own screen instead,
  with `button` for its words.
- `prompt` on a choice is an instruction under the text, such as `Choose who you
meet first.`
- `button` names the single button of a scene or a moment, and `sets` on it sets
  flags when it is pressed. `buttonStyle` is `plain`, `small` or `thought`, which
  is italic.
- A flag written `key=value`, such as `name=June`, is a remembered choice with a
  value. Text can read it as `{name}`, and a condition can test `name=June`.
  Give each value its own flag and read it somewhere, because the tests fail
  on a flag that nothing reads.
- A paragraph can be a list of parts, which are joined with a space, so one
  sentence can change with a flag.
- To bring a screen back with an answer missing, write a second copy of it, as
  `5.01b` is in the story. A story with a cycle does not validate.
- `dropsTrail` on a screen removes the progress row for the rest of the story.

### Moods and timing

`mood` names a look from `ui/moods.ts`: the color behind the text, the color of
the text and the buttons, and two fields of halftone dots. A mood holds until a
later screen on the path names another, and the display blends between them.
The tests keep the text readable on every background, in every mood and part of
the way between any two.

`pace` sets how a screen's lines arrive: `together` shows them all at once,
`beats` shows them one after another, and `slow` leaves longer between them. A
reply comes first, then a beat, then the text. `hold` is the seconds the button
and the answers wait after the last line. `cut` shows a screen at once, with no
slide or fade.

An `ending` with `fadeOut` fades the display to black when its button is
pressed, stays dark for a moment, and returns to the splash.

### Looking at a screen

`?node=` opens the story at a screen, and `?flags=` lists the flags the path
must have set, as in
`?display=policy-story&node=6.06&flags=snack=cookies,called`. The search covers
every combination of a screen and its flags, so it finds a path however long the
story is.
