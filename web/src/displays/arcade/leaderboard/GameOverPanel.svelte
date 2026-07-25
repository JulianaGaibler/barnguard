<!-- Reusable end-of-run shell: a game supplies its own score display via the
     `scoreDisplay` snippet; this owns the card/scrim chrome, the leaderboard
     entry flow, and the exit buttons. The name field stays editable for as
     long as the panel is open — the score is only submitted at the moment
     the player leaves (Play again / Main menu), and only if a name was
     entered by then. -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { Snippet } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import Button from '@src/core/ui/Button.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import OnScreenKeyboardField from '@src/core/ui/OnScreenKeyboardField.svelte'
  import {
    fetchLeaderboard,
    submitScore,
    type LeaderboardEntry,
  } from '@src/core/leaderboard/leaderboardClient'
  import { t } from '../i18n'
  import LeaderboardList from './LeaderboardList.svelte'

  const MAX_ROWS = 50
  const CONTEXT_ROWS = 2
  const NAME_MAX_LEN = 6

  interface Props {
    display: string
    /** The qualifying score attempt. Omit, or <= 0, to skip the leaderboard
     * flow entirely (a 2p match result, or a game with no high score). */
    score?: number
    onPlayAgain: () => void
    onMenu: () => void
    /**
     * Fired exactly once, whenever the panel is about to go away (a button,
     * or the arcade-wide swipe escape tearing it down) — with whatever name
     * was typed, or `''` if the player never opened the keyboard. Lets the
     * caller attach the name to its own game-log record, which it can only
     * finalize once name entry either happens or is skipped.
     */
    onFinalize?: (name: string) => void
    /** Game-specific score presentation, rendered at the top of the card. */
    scoreDisplay: Snippet
  }
  const { display, score, onPlayAgain, onMenu, onFinalize, scoreDisplay }: Props = $props()

  type Stage = 'loading' | 'unavailable' | 'closed' | 'entering'
  let stage = $state<Stage>('loading')
  let entries = $state<LeaderboardEntry[]>([])
  let name = $state('')
  let kbOpen = $state(false)
  let exiting = $state(false)

  // While the keyboard is open, spell out every letter slot ("YAI__") so
  // typing progress reads clearly; closed, it's just the plain name.
  const pendingDisplay = $derived(
    kbOpen ? name.toUpperCase().padEnd(NAME_MAX_LEN, '_') : undefined,
  )

  onMount(() => {
    if (score === undefined || score <= 0) {
      stage = 'closed'
      return
    }
    fetchLeaderboard(display, MAX_ROWS)
      .then((list) => {
        entries = list
        const qualifies = list.length < MAX_ROWS || score > list[MAX_ROWS - 1].score
        stage = qualifies ? 'entering' : 'closed'
      })
      .catch(() => {
        stage = 'unavailable'
      })
  })

  // Guards against submitting twice: once from whichever exit path runs
  // first (a button, or the arcade-wide "return to launcher" swipe gesture
  // tearing this down without going through either button), and once more
  // from the teardown that follows it.
  let submitted = false
  async function saveIfNeeded(): Promise<void> {
    if (submitted) return
    submitted = true
    onFinalize?.(name)
    if (stage !== 'entering' || !name || score === undefined) return
    await submitScore(display, name, score).catch(() => {})
  }

  async function exit(cb: () => void): Promise<void> {
    exiting = true
    await saveIfNeeded()
    cb()
  }

  onDestroy(() => {
    saveIfNeeded()
  })
</script>

<div class="over" transition:fade={{ duration: 180 }}>
  <div class="over__card" transition:scale={{ start: 0.92, duration: 180 }}>
    <Surface tone="light">
      <div class="over__body">
        {@render scoreDisplay()}

        {#if stage === 'unavailable'}
          <p class="over__note">{$t.arcade.leaderboard.unavailable}</p>
        {/if}

        {#if stage === 'entering'}
          <div class="over__leaderboard">
            <LeaderboardList
              {entries}
              pending={{ name, score: score ?? 0, display: pendingDisplay }}
              pendingAction={{
                label: name ? '' : $t.arcade.leaderboard.enterNameToSave,
                onClick: () => (kbOpen = true),
              }}
              contextRows={CONTEXT_ROWS}
            />
            <OnScreenKeyboardField
              bind:value={name}
              bind:open={kbOpen}
              showTrigger={false}
              maxLength={NAME_MAX_LEN}
              closeLabel={$t.arcade.leaderboard.closeKeyboard}
            />
            <p class="over__hint">
              {name ? $t.arcade.leaderboard.willBeSavedAs(name.toUpperCase()) : $t.arcade.leaderboard.wontBeSaved}
            </p>
          </div>
        {/if}

        <div class="over__actions">
          <Button variant="primary" disabled={exiting} onclick={() => exit(onPlayAgain)}>
            {$t.arcade.leaderboard.playAgain}
          </Button>
          <Button variant="outline" disabled={exiting} onclick={() => exit(onMenu)}>
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
