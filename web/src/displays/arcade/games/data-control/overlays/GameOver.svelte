<!--
  End-of-run screen: the duo-card layout from the original game, a dark loss
  card with the reason-specific failure animation on the left, and the score +
  leaderboard entry on the right. The two cards sitting side by side is why
  this lays itself out rather than composing `GameOverPanel`. The leaderboard
  flow itself is the shared one, so it cannot drift from the other games.
-->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import type { EngineHost } from '@src/stargazer'
  import Button from '@src/core/ui/Button.svelte'
  import OnScreenKeyboardField from '@src/core/ui/OnScreenKeyboardField.svelte'
  import { formatScore } from '@src/displays/arcade/leaderboard/formatScore'
  import {
    CONTEXT_ROWS,
    NAME_MAX_LEN,
    NameEntry,
  } from '@src/displays/arcade/leaderboard/nameEntry.svelte'
  import { registerExitTask } from '@src/displays/arcade/exitTasks'
  import LeaderboardList from '../../../leaderboard/LeaderboardList.svelte'
  import { t as arcadeT } from '../../../i18n'
  import { mountGameOverStage } from '../game/gameOver/mountGameOverStage'
  import { DATA_CONTROL_STRINGS as S } from '../strings'
  import type { GameOverReason } from '../game'
  import { DATA_CONTROL_BOARD_ID } from '../leaderboards'

  interface Props {
    reason: GameOverReason
    /** Escape heading (radians). Only meaningful for `'exitedGermany'`. */
    escapeHeadingRad?: number
    score: number
    host: EngineHost
    onPlayAgain: () => void
    onMenu: () => void
    /** Fired exactly once on exit with the entered name (or ''). */
    onFinalize?: (name: string) => void | Promise<unknown>
  }
  const {
    reason,
    escapeHeadingRad,
    score,
    host,
    onPlayAgain,
    onMenu,
    onFinalize,
  }: Props = $props()

  const t = arcadeT
  const reasonMessage = $derived(
    reason === 'exitedGermany' ? S.gameOverExited : S.gameOverCollision,
  )

  // The card is built at game over and the run is over, so the entry takes the
  // values it opens with. `untrack` says that is deliberate.
  const entry = untrack(
    () => new NameEntry({ display: DATA_CONTROL_BOARD_ID, score, onFinalize }),
  )
  let exiting = $state(false)

  onMount(() => entry.start())
  // So the arcade can flush a typed-but-unconfirmed name before it tears the
  // game down, rather than leaving it to the un-awaited unmount below.
  onMount(() => registerExitTask(entry.save))
  onDestroy(() => {
    void entry.save()
  })

  async function exit(cb: () => void): Promise<void> {
    exiting = true
    await entry.save()
    cb()
  }
</script>

<div class="over" transition:fade={{ duration: 240 }}>
  <div class="over__row">
    <section class="over__card over__loss">
      <h2 class="over__loss-title">{S.gameOver}</h2>
      <canvas
        class="over__loss-canvas"
        aria-hidden="true"
        use:mountGameOverStage={{ host, reason, escapeHeadingRad }}
      ></canvas>
      <p class="over__loss-message">{reasonMessage}</p>
    </section>

    <section class="over__card over__score">
      <div class="over__score-head">
        <span class="over__score-big">{formatScore(score)}</span>
        <span class="over__score-label">{S.score}</span>
      </div>

      {#if entry.stage === 'unavailable'}
        <p class="over__note">{$t.arcade.leaderboard.unavailable}</p>
      {/if}

      {#if entry.stage === 'entering'}
        <div class="over__leaderboard">
          <LeaderboardList
            entries={entry.entries}
            pending={{ name: entry.name, score, display: entry.pending }}
            pendingAction={{
              label: entry.name ? '' : $t.arcade.leaderboard.enterNameToSave,
              onClick: () => (entry.keyboardOpen = true),
            }}
            contextRows={CONTEXT_ROWS}
          />
        </div>
      {/if}
    </section>
  </div>

  {#if entry.stage === 'entering'}
    <OnScreenKeyboardField
      bind:value={entry.name}
      bind:open={entry.keyboardOpen}
      showTrigger={false}
      maxLength={NAME_MAX_LEN}
      closeLabel={$t.arcade.leaderboard.closeKeyboard}
    />
  {/if}

  <div class="over__actions">
    <Button
      variant="primary"
      disabled={exiting}
      onclick={() => exit(onPlayAgain)}
    >
      {$t.arcade.leaderboard.playAgain}
    </Button>
    <Button variant="outline" disabled={exiting} onclick={() => exit(onMenu)}>
      {$t.arcade.leaderboard.menu}
    </Button>
  </div>
</div>

<style lang="sass">
  .over
    position: absolute
    inset: 0
    display: flex
    flex-direction: column
    align-items: center
    justify-content: center
    gap: var(--space-24)
    background: var(--color-scrim)
    pointer-events: auto
    z-index: var(--z-overlay)

  .over__row
    --card-h: min(52vh, 32rem)
    --card-w: calc(var(--card-h) * 490 / 645)
    display: flex
    gap: var(--space-16)
    align-items: stretch

  .over__card
    box-sizing: border-box
    height: var(--card-h)
    width: var(--card-w)
    flex: 0 0 auto
    border-radius: var(--radius-panel, 1rem)
    overflow: hidden
    position: relative

  .over__loss
    background: var(--color-surface)
    color: var(--color-text)
    display: flex
    flex-direction: column
    align-items: center
    justify-content: space-between
    padding-block: var(--space-48)
    padding-inline: var(--space-32)
    gap: var(--space-16)

  .over__loss-title
    @include tint.type-class(headline-sm)
    margin: 0
    text-align: center
    position: relative
    z-index: 1

  .over__loss-canvas
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    display: block
    pointer-events: none

  .over__loss-message
    @include tint.type-class(body-bold)
    text-align: center
    margin: 0
    color: var(--color-text-secondary)
    max-width: 22ch
    position: relative
    z-index: 1

  .over__score
    background: var(--color-surface-card)
    color: var(--color-text)
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-16)
    padding-block: var(--space-48) var(--space-32)
    padding-inline: var(--space-24)

  .over__score-head
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-4)

  .over__score-big
    @include tint.type-class(display)
    font-weight: 800
    line-height: 1
    color: var(--color-accent)

  .over__score-label
    @include tint.type-class(label-lg)
    text-transform: uppercase
    letter-spacing: 0.08em
    color: var(--color-text-secondary)

  .over__note
    margin: 0
    color: var(--color-text-secondary)

  .over__leaderboard
    display: flex
    flex-direction: column
    align-items: stretch
    gap: var(--space-16)
    width: 100%

  .over__actions
    display: flex
    justify-content: center
    align-items: stretch
    gap: var(--space-16)
</style>
