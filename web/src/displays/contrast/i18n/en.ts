import { coreEn } from '@src/i18n/coreLocales'
import type { ContrastMessages } from './types'

/** English strings, the only language this display ships. */
export const en: ContrastMessages = {
  ...coreEn,
  app: {
    title: 'Contrast',
  },
  banner: {
    left: 'FIREFOX UX',
    right: 'COLOR CONTRAST',
  },
  splash: {
    title: 'How bad is the contrast?',
    premise: 'Become a designer and guess how accessible color contrasts are.',
    play: 'Play',
  },
  manifesto: {
    title: ['The Mozilla', 'Manifesto'],
    blocks: [
      {
        kind: 'paragraph',
        text: 'The internet is becoming an increasingly important part of our lives.',
      },
      {
        kind: 'paragraph',
        text: 'The Mozilla project is a global community of people who believe that openness, innovation, and opportunity are key to the continued health of the internet. We have worked together since 1998 to ensure that the internet is developed in a way that benefits everyone. We are best known for creating the Mozilla Firefox web browser.',
      },
      {
        kind: 'paragraph',
        text: 'The Mozilla project uses a community-based approach to create world-class open source software and to develop new types of collaborative activities. We create communities of people involved in making the internet experience better for all of us.',
      },
      {
        kind: 'paragraph',
        text: 'As a result of these efforts, we have distilled a set of principles that we believe are critical for the internet to continue to benefit the public good as well as commercial aspects of life. We set out these principles below.',
      },
      {
        kind: 'paragraph',
        text: 'The goals for the Manifesto are to:',
      },
      {
        kind: 'item',
        text: 'articulate a vision for the internet that Mozilla participants want Mozilla Foundation to pursue;',
      },
      {
        kind: 'item',
        text: 'speak to people whether or not they have a technical background;',
      },
      {
        kind: 'item',
        text: 'make Mozilla contributors proud of what we’re doing and motivate us to continue; and',
      },
      {
        kind: 'item',
        text: 'provide a framework for other people to advance this vision of the internet.',
      },
      {
        kind: 'paragraph',
        text: 'These principles will not come to life on their own. People are needed to make the internet open and participatory - people acting as individuals, working together in groups, and leading others. Mozilla Foundation is committed to advancing the principles set out in the Mozilla Manifesto. We invite others to join us and make the internet an ever better place for everyone.',
      },
    ],
  },
  game: {
    correct: 'Correct!',
    incorrect: 'Incorrect',
    timeout: 'Out of time',
    actual: 'ACTUAL',
    yourPick: 'YOUR PICK',
    levels: {
      1: 'Poor contrast',
      2: 'Acceptable contrast',
      3: 'Good contrast',
    },
    score: (points) => `Score ${points}`,
    seconds: (left) => `${left} seconds left`,
    announceCorrect: 'Correct',
    announceWrong: (answer) => `Incorrect. The answer was ${answer}`,
    announceTimeout: (answer) => `Out of time. The answer was ${answer}`,
  },
  gameOver: {
    words: ['Game', 'over'],
    best: (score) => `High-Score ${score}`,
    newBest: 'New high score!',
    close: 'Close',
    retry: 'Retry',
    butWas: ['but', 'was'],
    idleReturning: 'Returning to the start',
    announce: (score) => `Game over. You scored ${score}`,
  },
  algorithmPanel: {
    algorithm: 'Contrast algorithm',
    apca: 'APCA',
    wcag: 'WCAG 2',
    note: 'Changing it ends the game in progress.',
  },
}
