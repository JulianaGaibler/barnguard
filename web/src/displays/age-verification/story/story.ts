/**
 * The story the booth tells.
 *
 * Placeholder copy until the policy team's text lands. It shows every kind of
 * screen, a branch that merges back, a conditional paragraph, and endings
 * picked by flags. See `web/docs/writing-a-story.md`.
 */
import { defineStory } from './types'

export const story = defineStory({
  start: 'scenario',
  nodes: {
    scenario: {
      kind: 'scene',
      body: [
        "Once the city used to pulse with energy. Dirty and dangerous, but alive and wonderful. Now it's something else.",
        "The changes came slowly at first. Most didn't realize, or didn't care, and accepted them.",
      ],
      next: 'first-choice',
    },
    'first-choice': {
      kind: 'choice',
      body: [
        'Placeholder: the first decision. Lawmakers want to keep young people away from parts of the web.',
      ],
      options: [
        {
          id: 'strict',
          label: 'Placeholder: check the age of everyone, everywhere.',
          sets: ['strict'],
          next: 'strict-consequence',
        },
        {
          id: 'lenient',
          label: 'Placeholder: leave it to parents and devices.',
          sets: ['lenient'],
          next: 'second-choice',
        },
        {
          id: 'wait',
          label: 'Placeholder: wait and see what other countries do.',
          next: 'second-choice',
        },
      ],
    },
    'strict-consequence': {
      kind: 'moment',
      body: [
        'Placeholder: a consequence of the strict answer, before the paths meet again.',
      ],
      next: 'second-choice',
    },
    'second-choice': {
      kind: 'choice',
      body: [
        'Placeholder: the second decision, which every path reaches.',
        {
          when: { flag: 'strict' },
          text: 'Placeholder: a paragraph only visitors who chose the strict answer see.',
        },
      ],
      options: [
        {
          id: 'event',
          label: 'Placeholder: an answer that leads to an event.',
          next: 'news-event',
        },
        {
          id: 'skip',
          label: 'Placeholder: an answer that goes straight on.',
          next: 'final-choice',
        },
      ],
    },
    'news-event': {
      kind: 'moment',
      body: ['Placeholder: something happens in the world.'],
      next: 'final-choice',
    },
    'final-choice': {
      kind: 'choice',
      body: ['Placeholder: the last decision.'],
      options: [
        {
          id: 'checks',
          label: 'Placeholder: add checks to every app store.',
          sets: ['checks'],
          next: [
            {
              when: { all: [{ flag: 'strict' }, { flag: 'checks' }] },
              to: 'locked-down',
            },
            { to: 'open-web' },
          ],
        },
        {
          id: 'none',
          label: 'Placeholder: add no new checks.',
          next: 'open-web',
        },
      ],
    },
    'locked-down': {
      kind: 'ending',
      title: 'Placeholder: a locked-down web',
      body: [
        'Placeholder: the conclusion for visitors who chose strict checks twice.',
      ],
    },
    'open-web': {
      kind: 'ending',
      title: 'Placeholder: an open web',
      body: [
        'Placeholder: the conclusion every other path reaches.',
        {
          when: { flag: 'lenient' },
          text: 'Placeholder: a paragraph for visitors who left it to parents.',
        },
      ],
    },
  },
})

export type StoryNodeId = keyof typeof story.nodes
