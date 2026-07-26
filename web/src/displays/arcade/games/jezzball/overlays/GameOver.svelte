<!-- End-of-run screen: jezzball's own score display, composed with the
     shared `GameOverPanel` for the leaderboard entry flow. -->
<script lang="ts">
  import GameOverPanel from '@src/displays/arcade/leaderboard/GameOverPanel.svelte'
  import ScoreFrame from './ScoreFrame.svelte'
  import { ACCENT_SOLO } from '../game/tuning'
  import type { TextSegment } from '../game/types'

  interface Props {
    /** 2p match-result title (winner/tie). Unused for solo — pass `[]`. */
    title: TextSegment[]
    /** 2p match-result score. Unused for solo — pass `[]`. */
    score: TextSegment[]
    /** Solo run's score, to try against the leaderboard. Omit for 2p. */
    leaderboardScore?: number
    onPlayAgain: () => void
    onMenu: () => void
    /** Passed straight through to `GameOverPanel` — see its own doc comment. */
    onFinalize?: (name: string) => void
  }
  const {
    title,
    score,
    leaderboardScore,
    onPlayAgain,
    onMenu,
    onFinalize,
  }: Props = $props()
</script>

<GameOverPanel
  display="jezzball"
  score={leaderboardScore}
  {onPlayAgain}
  {onMenu}
  {onFinalize}
>
  {#snippet scoreDisplay()}
    {#if leaderboardScore !== undefined}
      <ScoreFrame score={leaderboardScore} color={ACCENT_SOLO.primary} />
    {:else}
      <h2 class="over__title">
        {#each title as seg (seg.text)}<span style="color: {seg.color}"
            >{seg.text}</span
          >{/each}
      </h2>
      <p class="over__score">
        {#each score as seg (seg.text)}<span style="color: {seg.color}"
            >{seg.text}</span
          >{/each}
      </p>
    {/if}
  {/snippet}
</GameOverPanel>

<style lang="sass">
  .over__title
    margin: 0
    @include tint.type-class(headline)
    letter-spacing: 0.06em

  .over__score
    margin: 0
    @include tint.type-class(headline-sm)
</style>
