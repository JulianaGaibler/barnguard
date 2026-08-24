<!--
  Two-player result: a winner banner over the shared versus panel, which owns
  the leaderboard flow for both seats.
-->
<script lang="ts">
  import GameOverVersusPanel, {
    type VersusSide,
  } from '@src/displays/arcade/leaderboard/GameOverVersusPanel.svelte'
  import { ACCENT_VS, COLORS } from '../game/tuning'
  import { TWENTY48_STRINGS as t } from '../strings'
  import { TWENTY48_BOARD_ID } from '../leaderboards'

  interface Props {
    winner: 0 | 1 | 2
    scoreA: number
    scoreB: number
    onPlayAgain: () => void
    onMenu: () => void
    onFinalize?: (names: { a: string; b: string }) => void | Promise<unknown>
  }
  const { winner, scoreA, scoreB, onPlayAgain, onMenu, onFinalize }: Props =
    $props()

  const sides = $derived<readonly [VersusSide, VersusSide]>([
    { id: 'a', label: t.player1, color: ACCENT_VS[1], score: scoreA },
    { id: 'b', label: t.player2, color: ACCENT_VS[2], score: scoreB },
  ])
</script>

<GameOverVersusPanel
  display={TWENTY48_BOARD_ID}
  {sides}
  {onPlayAgain}
  {onMenu}
  {onFinalize}
>
  {#snippet banner()}
    <h2 class="over__title">
      {#if winner === 0}
        <span style="color: {COLORS.ink}">{t.tie}</span>
      {:else}
        <span style="color: {winner === 1 ? ACCENT_VS[1] : ACCENT_VS[2]}">
          {winner === 1 ? t.player1 : t.player2}
        </span>
        <span style="color: {COLORS.ink}"> {t.winsSuffix}</span>
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
