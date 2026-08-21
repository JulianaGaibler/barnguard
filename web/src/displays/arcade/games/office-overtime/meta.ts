import type { GameModule } from '../GameModule'
import OfficeOvertimeGame from './OfficeOvertimeGame.svelte'

export const officeOvertimeModule: GameModule = {
  meta: {
    id: 'office-overtime',
    title: 'Office Overtime',
    description:
      'Hire nine people into a 3x3 org from two shared shortlists. Every hire pays out once and scores at the end, so the org you build is the score you get.',
    players: '1-2',
    thumbColor: '#e4d7bf',
    // Warm meeting-room palette. The full role set is overridden rather than a
    // subset: unset roles fall through to the arcade's pink chrome, which would
    // leave purple card shadows and a purple accent on a warm board.
    themeTokens: {
      surface: '#f2ece1',
      surfaceCard: '#fbf7ef',
      surfaceInverse: '#2b2620',
      scrim: '#2b262099',
      text: '#2b2620',
      textSecondary: '#6b6157',
      textInverse: '#fbf7ef',
      title: '#c2402f',
      border: '#d3c6b0',
      accent: '#c2402f',
      teamA: '#2f7d4f',
      teamB: '#c2402f',
      actionPrimary: '#2f7d4f',
      actionPrimaryText: '#fbf7ef',
      actionPrimaryHover: '#286c44',
      actionPrimaryActive: '#215a39',
      actionSecondary: '#e4d7bf',
      actionSecondaryText: '#2b2620',
      actionSecondaryHover: '#d8c9ad',
      actionSecondaryActive: '#c9b998',
      shadowCard: 'rgba(80, 60, 30, 0.18)',
      shadowPanel: 'rgba(80, 60, 30, 0.24)',
      gradientPlay: 'linear-gradient(120deg, #f2ece1, #d9cdb8)',
      gradientResult: 'linear-gradient(120deg, #fbf7ef, #e4d7bf)',
    },
  },
  component: OfficeOvertimeGame,
}
