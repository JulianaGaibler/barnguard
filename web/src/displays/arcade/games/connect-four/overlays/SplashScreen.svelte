<!--
  Connect Four main menu. Thin config over the shared `MenuScreen`: builds the
  button items (with the "1 Player" → difficulty submenu) + optional running
  score. The in-engine preview on the right is owned by `ConnectFourGame`.
-->
<script lang="ts">
  import RobotIcon from '@src/displays/arcade/RobotIcon.svelte'
  import MenuScreen from '@src/displays/arcade/menu/MenuScreen.svelte'
  import type { MenuItem, MenuScore } from '@src/displays/arcade/menu/types'
  import { CF_STRINGS as t } from '../strings'
  import { PLAYER_COLORS } from '../game/tuning'
  import type { Difficulty, GameMode, MatchScore, Player } from '../game'

  interface Props {
    matchScore: MatchScore
    /** Player whose score just ticked up (pulses its tile), or null. */
    bumpTeam: Player | null
    onStart: (mode: GameMode) => void
    onExit: () => void
    /**
     * Open the "How to play" tutorial. Absent when the demo stage is
     * unavailable.
     */
    onHowToPlay?: () => void
  }
  const { matchScore, bumpTeam, onStart, onExit, onHowToPlay }: Props = $props()

  function startAi(difficulty: Difficulty): void {
    onStart({ kind: 'ai', difficulty })
  }

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
        onSelect: () => onStart({ kind: '2p' }),
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

  const score = $derived<MenuScore>({
    left: matchScore.teamL,
    right: matchScore.teamR,
    leftColor: PLAYER_COLORS[1],
    rightColor: PLAYER_COLORS[2],
  })
  const bump = $derived<'left' | 'right' | null>(
    bumpTeam === 1 ? 'left' : bumpTeam === 2 ? 'right' : null,
  )
</script>

<MenuScreen title={t.title} {items} {score} {bump} backLabel={t.back} />
