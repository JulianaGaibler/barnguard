<!--
  Orbo main menu. Thin config over the shared `MenuScreen`: builds the button
  items + optional running score and lets `MenuScreen` render the Valve-style
  left rail. The in-engine preview on the right is owned by `OrboGame`.
-->
<script lang="ts">
  import RobotIcon from '@src/displays/arcade/RobotIcon.svelte'
  import MenuScreen from '@src/displays/arcade/menu/MenuScreen.svelte'
  import type { MenuItem, MenuScore } from '@src/displays/arcade/menu/types'
  import { ORBO_STRINGS as t } from '../strings'
  import { TEAM_COLORS } from '../game/tuning'
  import type { GameMode, MatchScore, TeamId } from '../game'

  interface Props {
    matchScore: MatchScore
    /** Side whose score just ticked up (pulses its tile), or null. */
    bumpTeam: TeamId | null
    onStart: (mode: GameMode) => void
    onExit: () => void
    /**
     * Open the "How to play" tutorial. Absent when the demo stage is
     * unavailable.
     */
    onHowToPlay?: () => void
  }
  const { matchScore, bumpTeam, onStart, onExit, onHowToPlay }: Props = $props()

  const items = $derived.by<MenuItem[]>(() => {
    const list: MenuItem[] = [
      { label: t.mode1v1, variant: 'primary', onSelect: () => onStart('1v1') },
      { label: t.mode2v2, variant: 'primary', onSelect: () => onStart('2v2') },
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
    leftColor: TEAM_COLORS[0],
    rightColor: TEAM_COLORS[1],
  })
  const bump = $derived<'left' | 'right' | null>(
    bumpTeam === 0 ? 'left' : bumpTeam === 1 ? 'right' : null,
  )
</script>

<MenuScreen title={t.title} {items} {score} {bump} />
