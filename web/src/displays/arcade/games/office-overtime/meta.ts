import type { GameModule } from '../GameModule'
import OfficeOvertimeGame from './OfficeOvertimeGame.svelte'

export const officeOvertimeModule: GameModule = {
  meta: {
    id: 'office-overtime',
    title: 'Office Overtime',
    description:
      'Hire nine people into a 3x3 org from two shared shortlists. Every hire pays out once and scores at the end, so the org you build is the score you get.',
    players: '1-2',
    thumbColor: '#eceae4',
    // The board's light #F7F6F0 palette. The full role set is overridden rather
    // than a subset: unset roles fall through to the arcade's pink chrome, which
    // would leave purple card shadows and a purple accent on the pale board.
    themeTokens: {
      surface: '#f7f6f0',
      surfaceCard: '#ffffff',
      surfaceInverse: '#2b2620',
      scrim: '#2b262099',
      text: '#2b2620',
      textSecondary: '#6b6157',
      textInverse: '#ffffff',
      title: '#c2402f',
      border: '#e0ddd3',
      accent: '#c2402f',
      teamA: '#2f7d4f',
      teamB: '#c2402f',
      actionPrimary: '#2f7d4f',
      actionPrimaryText: '#ffffff',
      actionPrimaryHover: '#286c44',
      actionPrimaryActive: '#215a39',
      actionSecondary: '#eceae4',
      actionSecondaryText: '#2b2620',
      actionSecondaryHover: '#e0ddd3',
      actionSecondaryActive: '#d3cfc2',
      shadowCard: 'rgba(43, 38, 32, 0.14)',
      shadowPanel: 'rgba(43, 38, 32, 0.2)',
      gradientPlay: 'linear-gradient(120deg, #f8f7f2, #f2f0e8)',
      gradientResult: 'linear-gradient(120deg, #ffffff, #f2f0e8)',
    },
  },
  component: OfficeOvertimeGame,
}
