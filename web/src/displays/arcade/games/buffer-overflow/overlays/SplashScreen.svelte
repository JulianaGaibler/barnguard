<!--
  Buffer Overflow's main menu. Thin config over the shared `MenuScreen`, so all
  color comes from the game's `themeTokens` and this stays presentation-free.
  The right side of the region is left for the in-engine preview.

  Each mode opens a seat-count submenu rather than listing all four
  combinations, which keeps the root panel to two real choices. `MenuSubmenu`
  holds actions only, so the nesting stops one level down and the mode has to be
  the outer choice.
-->
<script lang="ts">
  import RobotIcon from '@src/displays/arcade/RobotIcon.svelte'
  import LeaderboardIcon from '@src/displays/arcade/leaderboard/LeaderboardIcon.svelte'
  import MenuScreen from '@src/displays/arcade/menu/MenuScreen.svelte'
  import type {
    MenuAction,
    MenuItem,
    MenuScore,
  } from '@src/displays/arcade/menu/types'
  import { t as arcadeT } from '@src/displays/arcade/i18n'
  import { BUFFER_OVERFLOW_STRINGS as t } from '../strings'
  import { ACCENT_VS, type GameMode, type ModeKind } from '../game'

  interface Props {
    onStart: (mode: GameMode) => void
    onExit: () => void
    onHowToPlay?: () => void
    onOpenLeaderboard?: () => void
    /** Rounds each seat has taken in the mode last played. */
    versusWins?: { a: number; b: number }
    /** The seat whose tally just moved, which pulses their tile. */
    bumpPlayer?: 1 | 2 | null
  }
  const {
    onStart,
    onExit,
    onHowToPlay,
    onOpenLeaderboard,
    versusWins,
    bumpPlayer = null,
  }: Props = $props()

  const seatItems = (kind: ModeKind): MenuAction[] => [
    { label: t.players1, onSelect: () => onStart({ kind, players: 1 }) },
    { label: t.players2, onSelect: () => onStart({ kind, players: 2 }) },
  ]

  const items = $derived.by<MenuItem[]>(() => {
    const list: MenuItem[] = [
      {
        kind: 'submenu',
        label: t.modeUptime,
        heading: t.chooseSeats,
        items: seatItems('uptime'),
      },
      {
        kind: 'submenu',
        label: t.modeCountdown,
        heading: t.chooseSeats,
        items: seatItems('countdown'),
      },
    ]
    if (onHowToPlay) {
      list.push({
        label: $arcadeT.arcade.tutorial.title,
        variant: 'surface',
        onSelect: onHowToPlay,
        trailing: onOpenLeaderboard
          ? {
              icon: LeaderboardIcon,
              ariaLabel: $arcadeT.arcade.leaderboard.openLeaderboard,
              onSelect: onOpenLeaderboard,
            }
          : undefined,
      })
    }
    list.push({
      label: $arcadeT.arcade.returnToLauncher,
      variant: 'surface',
      icon: RobotIcon,
      onSelect: onExit,
    })
    return list
  })

  const score = $derived<MenuScore | undefined>(
    versusWins
      ? {
          left: versusWins.a,
          right: versusWins.b,
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
