<!--
  JezzBall's two-player result: a winner banner over the shared versus panel,
  which owns the leaderboard flow for both seats.
-->
<script lang="ts">
  import GameOverVersusPanel, {
    type VersusSide,
  } from '@src/displays/arcade/leaderboard/GameOverVersusPanel.svelte'
  import { ACCENT_VS, COLORS } from '../game/tuning'
  import { JEZZBALL_STRINGS as S } from '../strings'
  import { JEZZBALL_BOARD_ID } from '../leaderboards'

  interface Props {
    winner: 0 | 1 | 2
    pointsA: number
    pointsB: number
    onPlayAgain: () => void
    onMenu: () => void
    /** Fired exactly once on exit with both entered names (or ''). */
    onFinalize?: (names: { a: string; b: string }) => void | Promise<unknown>
  }
  const { winner, pointsA, pointsB, onPlayAgain, onMenu, onFinalize }: Props =
    $props()

  const sides = $derived<readonly [VersusSide, VersusSide]>([
    { id: 'a', label: S.player1, color: ACCENT_VS[1].primary, score: pointsA },
    { id: 'b', label: S.player2, color: ACCENT_VS[2].primary, score: pointsB },
  ])
</script>

<GameOverVersusPanel
  display={JEZZBALL_BOARD_ID}
  {sides}
  {onPlayAgain}
  {onMenu}
  {onFinalize}
>
  {#snippet banner()}
    <h2 class="over__title">
      {#if winner === 0}
        <span style="color: {COLORS.ink}">{S.tie}</span>
      {:else}
        <span
          style="color: {winner === 1
            ? ACCENT_VS[1].primary
            : ACCENT_VS[2].primary}"
        >
          {winner === 1 ? S.player1 : S.player2}
        </span>
        <span style="color: {COLORS.ink}"> {S.winsSuffix}</span>
      {/if}
    </h2>
  {/snippet}
</GameOverVersusPanel>

<style lang="sass">
  .over__title
    margin: 0
    @include tint.type-class(headline)
    letter-spacing: 0.06em
</style>
