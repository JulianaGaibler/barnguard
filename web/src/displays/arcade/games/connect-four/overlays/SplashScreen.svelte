<!--
  Connect Four main screen, shown while the session is idle (no board on the
  canvas). Faint per-side score watermarks flank a centered column: title plus
  mode buttons. Choosing "1 Player" swaps the buttons for a difficulty step. A
  "Return to Launcher" pill hands control back to the arcade. After a decisive
  game the winner's watermark bumps.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import Button from '@src/core/ui/Button.svelte'
  import RobotIcon from '@src/displays/arcade/RobotIcon.svelte'
  import { CF_STRINGS as t } from '../strings'
  import type { Difficulty, GameMode, MatchScore, Player } from '../game'

  interface Props {
    matchScore: MatchScore
    /** Player whose score just ticked up (bumps on mount), or null. */
    bumpTeam: Player | null
    onStart: (mode: GameMode) => void
    onExit: () => void
  }
  const { matchScore, bumpTeam, onStart, onExit }: Props = $props()

  let step = $state<'main' | 'difficulty'>('main')
  let bumpL = $state(false)
  let bumpR = $state(false)

  onMount(() => {
    if (bumpTeam === 1) bumpL = true
    else if (bumpTeam === 2) bumpR = true
  })

  function startAi(difficulty: Difficulty): void {
    onStart({ kind: 'ai', difficulty })
  }
</script>

<div class="splash" transition:fade={{ duration: 200 }}>
  <div class="splash__score splash__score--l" class:splash__score--bump={bumpL}>
    {matchScore.teamL}
  </div>
  <div class="splash__score splash__score--r" class:splash__score--bump={bumpR}>
    {matchScore.teamR}
  </div>

  <div class="splash__center">
    <h1 class="splash__title">{t.title}</h1>
    {#if step === 'main'}
      <div class="splash__modes">
        <Button variant="surface" onclick={() => (step = 'difficulty')}>
          {t.onePlayer}
        </Button>
        <Button variant="surface" onclick={() => onStart({ kind: '2p' })}>
          {t.twoPlayers}
        </Button>
      </div>
    {:else}
      <div class="splash__modes">
        <Button variant="surface" onclick={() => startAi('easy')}
          >{t.easy}</Button
        >
        <Button variant="surface" onclick={() => startAi('medium')}
          >{t.medium}</Button
        >
        <Button variant="surface" onclick={() => startAi('hard')}
          >{t.hard}</Button
        >
        <Button variant="ghost" small onclick={() => (step = 'main')}
          >{t.back}</Button
        >
      </div>
    {/if}
  </div>

  <div class="splash__return">
    <Button variant="surface" shape="pill" small onclick={onExit}>
      {#snippet leadingIcon()}<RobotIcon />{/snippet}
      {t.returnToLauncher}
    </Button>
  </div>
</div>

<style lang="sass">
  .splash
    position: absolute
    inset: 0
    pointer-events: none

  .splash__center
    position: absolute
    inset: 0
    display: flex
    flex-direction: column
    align-items: center
    justify-content: center
    gap: var(--space-32)

  .splash__title
    margin: 0
    @include tint.type-class(display)
    color: var(--color-text)

  .splash__modes
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-16)
    pointer-events: auto

  .splash__score
    position: absolute
    inset-block-start: 50%
    transform: translateY(-50%)
    @include tint.type-class(watermark)
    color: var(--color-text)
    opacity: 0.14
    user-select: none

  .splash__score--l
    inset-inline-start: 8%

  .splash__score--r
    inset-inline-end: 8%

  .splash__score--bump
    animation: splash-bump 0.6s cubic-bezier(0.16, 1, 0.3, 1)

  @keyframes splash-bump
    0%
      transform: translateY(-50%) scale(1)
      opacity: 0.14
    35%
      transform: translateY(-50%) scale(1.35)
      opacity: 0.4
    100%
      transform: translateY(-50%) scale(1)
      opacity: 0.14

  .splash__return
    position: absolute
    inset-block-end: var(--space-48)
    inset-inline-start: 50%
    transform: translateX(-50%)
    pointer-events: auto
</style>
