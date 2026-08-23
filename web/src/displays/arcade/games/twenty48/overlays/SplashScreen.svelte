<!--
  2048's main menu. Thin config over the shared `MenuScreen`; all color comes
  from the game's `themeTokens`, so this stays presentation-free. The right side
  of the region is left for the in-engine preview.
-->
<script lang="ts">
  import RobotIcon from '@src/displays/arcade/RobotIcon.svelte'
  import LeaderboardIcon from '@src/displays/arcade/leaderboard/LeaderboardIcon.svelte'
  import MenuScreen from '@src/displays/arcade/menu/MenuScreen.svelte'
  import type { MenuItem, MenuScore } from '@src/displays/arcade/menu/types'
  import { TWENTY48_STRINGS as t } from '../strings'
  import { ACCENT_VS } from '../game/tuning'
  import type { GameMode, PlayerId } from '../game/types'

  interface Props {
    onStart: (mode: GameMode) => void
    onExit: () => void
    onHowToPlay?: () => void
    onOpenLeaderboard?: () => void
    /** Versus matches each seat has taken this visit. */
    matchWins?: { a: number; b: number }
    /** Seat whose tally just ticked up, which pulses their tile. */
    bumpPlayer?: PlayerId | null
  }
  const {
    onStart,
    onExit,
    onHowToPlay,
    onOpenLeaderboard,
    matchWins,
    bumpPlayer = null,
  }: Props = $props()

  const items = $derived.by<MenuItem[]>(() => {
    const list: MenuItem[] = [
      {
        label: t.modeSolo,
        variant: 'primary',
        onSelect: () => onStart({ kind: '1p' }),
      },
      {
        label: t.modeVersus,
        variant: 'primary',
        onSelect: () => onStart({ kind: '2p' }),
      },
    ]
    if (onHowToPlay) {
      list.push({
        label: t.howToPlay,
        variant: 'surface',
        onSelect: onHowToPlay,
        trailing: onOpenLeaderboard
          ? {
              icon: LeaderboardIcon,
              ariaLabel: t.openLeaderboard,
              onSelect: onOpenLeaderboard,
            }
          : undefined,
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
  const score = $derived<MenuScore | undefined>(
    matchWins
      ? {
          left: matchWins.a,
          right: matchWins.b,
          leftColor: ACCENT_VS[1],
          rightColor: ACCENT_VS[2],
        }
      : undefined,
  )
  const bump = $derived<'left' | 'right' | null>(
    bumpPlayer === 1 ? 'left' : bumpPlayer === 2 ? 'right' : null,
  )
</script>

<MenuScreen title={t.title} {items} {score} {bump} />
