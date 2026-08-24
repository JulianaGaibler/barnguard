<!--
  Two-player result: a winner banner over the shared versus panel, which owns
  the leaderboard flow for both seats.

  Both seats post to the same board as a solo run of the same mode. The two
  buffers shared one piece sequence and never interfered, so each player played
  the game a solo player plays and their scores belong on the same ladder.
-->
<script lang="ts">
  import GameOverVersusPanel, {
    type VersusSide,
  } from '@src/displays/arcade/leaderboard/GameOverVersusPanel.svelte'
  import { ACCENT_VS, COLORS } from '../game/tuning'
  import { BUFFER_OVERFLOW_STRINGS as t } from '../strings'
  import { boardIdFor } from '../leaderboards'
  import type { ModeKind } from '../game/types'

  interface Props {
    mode: ModeKind
    winner: 0 | 1 | 2
    scoreA: number
    scoreB: number
    onPlayAgain: () => void
    onMenu: () => void
    onFinalize?: (names: { a: string; b: string }) => void | Promise<unknown>
  }
  const {
    mode,
    winner,
    scoreA,
    scoreB,
    onPlayAgain,
    onMenu,
    onFinalize,
  }: Props = $props()

  const sides = $derived<readonly [VersusSide, VersusSide]>([
    { id: 'a', label: t.playerOne, color: ACCENT_VS[1], score: scoreA },
    { id: 'b', label: t.playerTwo, color: ACCENT_VS[2], score: scoreB },
  ])
</script>

<GameOverVersusPanel
  display={boardIdFor(mode)}
  {sides}
  {onPlayAgain}
  {onMenu}
  {onFinalize}
>
  {#snippet banner()}
    <h2 class="over__title">
      {#if winner === 0}
        <span style="color: {COLORS.ink}">{t.versusTie}</span>
      {:else}
        <span style="color: {winner === 1 ? ACCENT_VS[1] : ACCENT_VS[2]}">
          {t.versusWin(winner === 1 ? t.playerOne : t.playerTwo)}
        </span>
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
