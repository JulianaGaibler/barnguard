# Writing a story

The age verification display tells a choose-your-own-adventure story. A visitor
reads a scenario, makes a series of choices, sees what they lead to, and reaches
a conclusion. This guide is for whoever turns the writers' draft into the story
module.

The story lives in `src/displays/age-verification/story/story.ts`. It's plain
TypeScript data, so the type checker and the tests catch most mistakes before
the story reaches the booth.

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

The splash screen isn't part of the story. Its title and intro are in
`i18n/en.ts`, and its animation is set in `assets.ts`.

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

The left column has room for about fourteen lines of body text. An answer has
room for about three lines when a choice has three answers, and two lines when
it has four. The tests don't measure text. Open every changed screen with
`?node=` and check that it fits.

## See also

- `src/displays/age-verification/story/types.ts`, the shape of a story
- `src/displays/age-verification/story/validate.ts`, the checks the tests run
- [`adding-a-game.md`](adding-a-game.md), for the shared kiosk pieces such as
  the idle reset
