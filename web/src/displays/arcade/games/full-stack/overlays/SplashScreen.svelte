<!--
  Full Stack main menu. Thin config over the shared `MenuScreen`; the
  in-engine preview to the right belongs to `FullStackGame`.
-->
<script lang="ts">
  import RobotIcon from '@src/displays/arcade/RobotIcon.svelte'
  import MenuScreen from '@src/displays/arcade/menu/MenuScreen.svelte'
  import type { MenuItem, MenuScore } from '@src/displays/arcade/menu/types'
  import { FS_STRINGS as t } from '../strings'
  import type { Difficulty, GameMode } from '../game'

  interface Props {
    onStart: (mode: GameMode) => void
    onExit: () => void
    /** Absent when the shared demo stage is unavailable. */
    onHowToPlay?: () => void
    /** Matches each side has taken in the mode last played. */
    matchWins?: { a: number; b: number }
    /** Side whose tally just ticked up, which pulses their tile. */
    bumpSide?: 0 | 1 | null
  }
  const {
    onStart,
    onExit,
    onHowToPlay,
    matchWins,
    bumpSide = null,
  }: Props = $props()

  const startAi = (difficulty: Difficulty): void =>
    onStart({ kind: 'ai', difficulty })

  const items = $derived.by<MenuItem[]>(() => {
    const list: MenuItem[] = [
      {
        kind: 'submenu',
        label: t.onePlayer,
        variant: 'primary',
        heading: t.playAgainstAi,
        items: [
          {
            label: t.easy,
            variant: 'primary',
            onSelect: () => startAi('easy'),
          },
          {
            label: t.medium,
            variant: 'primary',
            onSelect: () => startAi('medium'),
          },
          {
            label: t.hard,
            variant: 'primary',
            onSelect: () => startAi('hard'),
          },
        ],
      },
      {
        label: t.twoPlayers,
        variant: 'primary',
        onSelect: () => onStart({ kind: 'versus' }),
      },
    ]
    if (onHowToPlay) {
      list.push({
        label: t.howToPlay,
        variant: 'surface',
        onSelect: onHowToPlay,
      })
    }
    list.push({
      label: t.returnToLauncher,
      variant: 'surface',
      icon: RobotIcon,
      onSelect: onExit,
    })
    return list
  })

  // Read from the theme rather than a local constant: the seat colours only
  // exist as `themeTokens`, and taking them from there means they cannot drift
  // from the ones the board itself is drawn in.
  const score = $derived<MenuScore | undefined>(
    matchWins
      ? {
          left: matchWins.a,
          right: matchWins.b,
          leftColor: 'var(--color-team-a)',
          rightColor: 'var(--color-team-b)',
        }
      : undefined,
  )
  const bump = $derived<'left' | 'right' | null>(
    bumpSide === 0 ? 'left' : bumpSide === 1 ? 'right' : null,
  )
</script>

<MenuScreen title={t.title} {items} {score} {bump} backLabel={t.back} />
