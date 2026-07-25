<!--
  JezzBall main menu. Thin config over the shared `MenuScreen` (Valve-style left
  rail); all color comes from the game's `themeTokens`, so this stays presentation-
  free. The right side of the region is left for an in-engine preview.
-->
<script lang="ts">
  import RobotIcon from '@src/displays/arcade/RobotIcon.svelte'
  import LeaderboardIcon from '@src/displays/arcade/leaderboard/LeaderboardIcon.svelte'
  import MenuScreen from '@src/displays/arcade/menu/MenuScreen.svelte'
  import type { MenuItem } from '@src/displays/arcade/menu/types'
  import { JEZZBALL_STRINGS as t } from '../strings'
  import type { GameMode } from '../game/types'

  interface Props {
    onStart: (mode: GameMode) => void
    onExit: () => void
    onHowToPlay?: () => void
    onOpenLeaderboard?: () => void
  }
  const { onStart, onExit, onHowToPlay, onOpenLeaderboard }: Props = $props()

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
          ? { icon: LeaderboardIcon, ariaLabel: t.openLeaderboard, onSelect: onOpenLeaderboard }
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
</script>

<MenuScreen title={t.title} {items} />
