<!-- Reusable end-of-run shell: a game supplies its own score display via the
     `scoreDisplay` snippet. This owns the card/scrim chrome and the exit
     buttons, and hands the leaderboard flow to `NameEntry`. The name field
     stays editable for as long as the panel is open. The score is only
     submitted once the panel goes away, and only if a name was entered by
     then. -->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import Button from '@src/core/ui/Button.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import OnScreenKeyboardField from '@src/core/ui/OnScreenKeyboardField.svelte'
  import { registerExitTask } from '../exitTasks'
  import { t } from '../i18n'
  import LeaderboardList from './LeaderboardList.svelte'
  import { CONTEXT_ROWS, NAME_MAX_LEN, NameEntry } from './nameEntry.svelte'

  interface Props {
    display: string
    /**
     * The qualifying score attempt. Omit, or <= 0, to skip the leaderboard flow
     * entirely (a 2p match result, or a game with no high score).
     */
    score?: number
    onPlayAgain: () => void
    onMenu: () => void
    /**
     * Fired exactly once, whenever the panel is about to go away (a button, the
     * arcade-wide swipe escape, or the idle reset tearing it down), with
     * whatever name was typed, or `''` if the player never opened the keyboard.
     * Lets the caller attach the name to its own game-log record, which it can
     * only finalize once name entry either happens or is skipped. Return that
     * write to have it waited on alongside the score.
     */
    onFinalize?: (name: string) => void | Promise<unknown>
    /** Game-specific score presentation, rendered at the top of the card. */
    scoreDisplay: Snippet
  }
  const {
    display,
    score,
    onPlayAgain,
    onMenu,
    onFinalize,
    scoreDisplay,
  }: Props = $props()

  // The card is built at game over and the run is over, so the entry takes the
  // values it opens with. `untrack` says that is deliberate.
  const entry = untrack(() => new NameEntry({ display, score, onFinalize }))
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

<div class="over" transition:fade={{ duration: 180 }}>
  <div class="over__card" transition:scale={{ start: 0.92, duration: 180 }}>
    <Surface tone="light">
      <div class="over__body">
        {@render scoreDisplay()}

        {#if entry.stage === 'unavailable'}
          <p class="over__note">{$t.arcade.leaderboard.unavailable}</p>
        {/if}

        {#if entry.stage === 'entering'}
          <div class="over__leaderboard">
            <LeaderboardList
              entries={entry.entries}
              pending={{
                name: entry.name,
                score: score ?? 0,
                display: entry.pending,
              }}
              pendingAction={{
                label: entry.name ? '' : $t.arcade.leaderboard.enterNameToSave,
                onClick: () => (entry.keyboardOpen = true),
              }}
              contextRows={CONTEXT_ROWS}
            />
            <OnScreenKeyboardField
              bind:value={entry.name}
              bind:open={entry.keyboardOpen}
              showTrigger={false}
              maxLength={NAME_MAX_LEN}
              closeLabel={$t.arcade.leaderboard.closeKeyboard}
            />
            <p class="over__hint">
              {entry.name
                ? $t.arcade.leaderboard.willBeSavedAs(entry.name.toUpperCase())
                : $t.arcade.leaderboard.wontBeSaved}
            </p>
          </div>
        {/if}

        <div class="over__actions">
          <Button
            variant="primary"
            disabled={exiting}
            onclick={() => exit(onPlayAgain)}
          >
            {$t.arcade.leaderboard.playAgain}
          </Button>
          <Button
            variant="outline"
            disabled={exiting}
            onclick={() => exit(onMenu)}
          >
            {$t.arcade.leaderboard.menu}
          </Button>
        </div>
      </div>
    </Surface>
  </div>
</div>

<style lang="sass">
  .over
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    background: var(--color-scrim)
    pointer-events: auto

  // No `overflow` here on purpose: setting only one axis (e.g. `overflow-y:
  // auto` for a tall list) forces the other to a used value of `auto` too,
  // which would clip the score frame's big number where it intentionally
  // overflows its decorative shapes. The windowed mini-list keeps this card
  // short enough that vertical scrolling isn't needed either.
  .over__card
    max-width: 92vw
    max-height: 88vh

  .over__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-16)
    padding-block: var(--space-48)
    padding-inline: var(--space-64)
    text-align: center

  .over__note
    margin: 0
    color: var(--color-text-secondary)

  .over__leaderboard
    display: flex
    flex-direction: column
    align-items: stretch
    gap: var(--space-16)
    width: 24rem
    max-width: 100%

  .over__hint
    margin: 0
    @include tint.type-class(ui-small-bold)
    color: var(--color-accent)

  .over__actions
    display: flex
    gap: var(--space-16)
</style>
