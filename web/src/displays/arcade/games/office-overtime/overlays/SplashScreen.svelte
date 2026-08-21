<!--
  Office Overtime main menu. Thin config over the shared `MenuScreen`; the
  in-engine preview to the right belongs to `OfficeOvertimeGame`.
-->
<script lang="ts">
  import RobotIcon from '@src/displays/arcade/RobotIcon.svelte'
  import MenuScreen from '@src/displays/arcade/menu/MenuScreen.svelte'
  import type { MenuItem } from '@src/displays/arcade/menu/types'
  import { OO_STRINGS as t } from '../strings'
  import type { Difficulty, GameMode } from '../game'

  interface Props {
    onStart: (mode: GameMode) => void
    onExit: () => void
    /** Absent when the shared demo stage is unavailable. */
    onHowToPlay?: () => void
  }
  const { onStart, onExit, onHowToPlay }: Props = $props()

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
</script>

<MenuScreen title={t.title} {items} backLabel={t.back} />
