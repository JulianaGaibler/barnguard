<!--
  Solo result. The shared `GameOverPanel` owns the whole leaderboard flow; this
  supplies only which board the run belongs to and how the score is presented.

  The board depends on the mode, and the panel reads `display` once on mount, so
  the caller keys this on the mode to force a remount rather than letting a mode
  change slip a score onto the wrong ladder.
-->
<script lang="ts">
  import GameOverPanel from '@src/displays/arcade/leaderboard/GameOverPanel.svelte'
  import { accentForLevel } from '../game/tuning'
  import { BUFFER_OVERFLOW_STRINGS as t } from '../strings'
  import { boardIdFor } from '../leaderboards'
  import type { EndReason, ModeKind } from '../game/types'
  import ScoreFrame from './ScoreFrame.svelte'

  interface Props {
    mode: ModeKind
    reason: EndReason
    score: number
    lines: number
    level: number
    onPlayAgain: () => void
    onMenu: () => void
    onFinalize?: (name: string) => void | Promise<unknown>
  }
  const {
    mode,
    reason,
    score,
    lines,
    level,
    onPlayAgain,
    onMenu,
    onFinalize,
  }: Props = $props()

  const title = $derived(reason === 'timeUp' ? t.timeUpTitle : t.overflowTitle)
  // The crash line names the fault. The plain summary under it is what keeps
  // the result legible to a player who does not write software.
  const detail = $derived(
    `${reason === 'timeUp' ? t.timeUpDetail : t.overflowDetail} · ${t.soloSummary(lines, level)}`,
  )
</script>

<GameOverPanel
  display={boardIdFor(mode)}
  {score}
  {onPlayAgain}
  {onMenu}
  {onFinalize}
>
  {#snippet scoreDisplay()}
    <ScoreFrame {score} {title} {detail} color={accentForLevel(level)} />
  {/snippet}
</GameOverPanel>
