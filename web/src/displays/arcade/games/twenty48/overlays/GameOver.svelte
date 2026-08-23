<!--
  Solo result. The shared `GameOverPanel` owns the whole leaderboard flow; this
  supplies only how 2048 presents a score.
-->
<script lang="ts">
  import GameOverPanel from '@src/displays/arcade/leaderboard/GameOverPanel.svelte'
  import { ACCENT_SOLO } from '../game/tuning'
  import ScoreFrame from './ScoreFrame.svelte'

  interface Props {
    score: number
    bestTile: number
    onPlayAgain: () => void
    onMenu: () => void
    onFinalize?: (name: string) => void
  }
  const { score, bestTile, onPlayAgain, onMenu, onFinalize }: Props = $props()
</script>

<GameOverPanel display="2048" {score} {onPlayAgain} {onMenu} {onFinalize}>
  {#snippet scoreDisplay()}
    <ScoreFrame {score} {bestTile} color={ACCENT_SOLO} />
  {/snippet}
</GameOverPanel>
