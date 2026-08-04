<!--
  Data Control main menu. Thin config over the shared `MenuScreen`; all colour
  comes from the game's `themeTokens`, so this stays presentation-free. The
  right side of the region is left for the in-engine menu preview.
-->
<script lang="ts">
  import RobotIcon from '@src/displays/arcade/RobotIcon.svelte'
  import LeaderboardIcon from '@src/displays/arcade/leaderboard/LeaderboardIcon.svelte'
  import MenuScreen from '@src/displays/arcade/menu/MenuScreen.svelte'
  import type { MenuItem } from '@src/displays/arcade/menu/types'
  import { DATA_CONTROL_STRINGS as t } from '../strings'

  interface Props {
    onPlay: () => void
    onExit: () => void
    onHowToPlay?: () => void
    onOpenLeaderboard?: () => void
  }
  const { onPlay, onExit, onHowToPlay, onOpenLeaderboard }: Props = $props()

  const items = $derived.by<MenuItem[]>(() => {
    const list: MenuItem[] = [
      { label: t.play, variant: 'primary', onSelect: onPlay },
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
</script>

<MenuScreen title={t.title} {items} />
