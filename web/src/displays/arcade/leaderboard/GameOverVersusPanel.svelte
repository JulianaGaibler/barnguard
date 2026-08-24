<!--
  End-of-match screen for two players: a banner over two side-by-side columns,
  one per player, each showing that player's final score and, if it qualifies, a
  windowed leaderboard with an inline name-entry row.

  Both columns share a SINGLE on-screen keyboard. Each `OnScreenKeyboard` mounts
  its own `window` keydown listener, so two of them open at once would type every
  key into both names. One `focus` value rather than a flag per side makes that
  structural: there is nowhere for a second open keyboard to be recorded. The
  focused column is ringed and its pending row spells out its letter slots, so
  on a screen two people share it is obvious which name is receiving keys.

  Each qualifying score is submitted independently on exit, and both names go
  back through `onFinalize` for the caller's game log.
-->
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
  import { registerExitTask } from '../exitTasks'
  import { t } from '../i18n'
  import LeaderboardList from './LeaderboardList.svelte'
  import { formatScore } from './formatScore'

  /** One seat's identity and result. */
  export interface VersusSide {
    id: 'a' | 'b'
    label: string
    color: string
    score: number
  }

  const MAX_ROWS = 50
  const CONTEXT_ROWS = 2
  const NAME_MAX_LEN = 6

  interface Props {
    display: string
    sides: readonly [VersusSide, VersusSide]
    /** The winner or tie banner. Each game owns its own copy and colors. */
    banner: Snippet
    onPlayAgain: () => void
    onMenu: () => void
    /**
     * Fired exactly once on exit, with whatever names were entered. Return the
     * caller's own write to have it waited on alongside the scores.
     */
    onFinalize?: (names: { a: string; b: string }) => void | Promise<unknown>
  }
  const { display, sides, banner, onPlayAgain, onMenu, onFinalize }: Props =
    $props()

  type Stage = 'loading' | 'unavailable' | 'ready'
  let stage = $state<Stage>('loading')
  let entries = $state<LeaderboardEntry[]>([])
  let names = $state<{ a: string; b: string }>({ a: '', b: '' })
  /** Which side the one keyboard belongs to, or null when it is closed. */
  let focus = $state<'a' | 'b' | null>(null)
  let exiting = $state(false)

  function qualifies(score: number): boolean {
    if (score <= 0) return false
    return entries.length < MAX_ROWS || score > entries[MAX_ROWS - 1].score
  }

  /** The server's own key: trimmed, lowercased, cut to the field's length. */
  const normalized = (name: string): string =>
    name.trim().toLowerCase().slice(0, NAME_MAX_LEN)

  /**
   * Both players typed the same name and both scores would post.
   *
   * A board keeps one row per name, so the second submission would overwrite
   * the first only if it were higher, and otherwise vanish with no feedback.
   * Two people at one booth reaching for the same three letters is common
   * enough to say something about rather than silently drop a score.
   */
  const sameName = $derived(
    stage === 'ready' &&
      names.a !== '' &&
      normalized(names.a) === normalized(names.b) &&
      qualifies(sides[0].score) &&
      qualifies(sides[1].score),
  )

  /** While a side has the keyboard, spell out its letter slots ("YAI___"). */
  function pendingDisplay(id: 'a' | 'b'): string | undefined {
    if (focus !== id) return undefined
    return names[id].toUpperCase().padEnd(NAME_MAX_LEN, '_')
  }

  onMount(() => {
    fetchLeaderboard(display, MAX_ROWS)
      .then((list) => {
        entries = list
        stage = 'ready'
      })
      .catch(() => {
        stage = 'unavailable'
      })
  })

  // Submit both qualifying scores at most once, on whichever exit path runs
  // first (a button, the arcade-wide swipe, or the idle reset tearing this
  // down), then guarded against the teardown that follows it.
  let submitted = false
  async function saveIfNeeded(): Promise<void> {
    if (submitted) return
    submitted = true
    const logged = onFinalize?.({ ...names })
    if (stage !== 'ready') {
      await logged
      return
    }
    // Under one shared name the board can only hold the higher score, so send
    // that one alone. Sending both would leave the outcome to whichever request
    // the server happened to apply last.
    const posting = sameName
      ? [sides[0].score >= sides[1].score ? sides[0] : sides[1]]
      : sides
    const jobs: unknown[] = [logged]
    for (const side of posting) {
      const name = names[side.id]
      if (name && qualifies(side.score)) {
        jobs.push(submitScore(display, name, side.score).catch(() => {}))
      }
    }
    await Promise.all(jobs)
  }

  async function exit(cb: () => void): Promise<void> {
    exiting = true
    await saveIfNeeded()
    cb()
  }

  // So the arcade can flush names typed but never confirmed with a button
  // before it tears the game down, rather than leaving it to the un-awaited
  // unmount below.
  onMount(() => registerExitTask(saveIfNeeded))

  onDestroy(() => {
    void saveIfNeeded()
  })
</script>

<div class="over" transition:fade={{ duration: 180 }}>
  <div class="over__card" transition:scale={{ start: 0.92, duration: 180 }}>
    <Surface tone="light">
      <div class="over__body">
        {@render banner()}

        {#if stage === 'unavailable'}
          <p class="over__note">{$t.arcade.leaderboard.unavailable}</p>
        {/if}

        <div class="over__cols">
          {#each sides as side (side.id)}
            <section class="over__col">
              <h3 class="over__player" style="color: {side.color}">
                {side.label}
              </h3>
              {#if stage === 'ready' && qualifies(side.score)}
                <LeaderboardList
                  {entries}
                  pending={{
                    name: names[side.id],
                    score: side.score,
                    display: pendingDisplay(side.id),
                  }}
                  pendingAction={{
                    label: names[side.id]
                      ? ''
                      : $t.arcade.leaderboard.enterNameToSave,
                    onClick: () => (focus = side.id),
                  }}
                  focused={focus === side.id}
                  contextRows={CONTEXT_ROWS}
                />
                <p class="over__hint">
                  {names[side.id]
                    ? $t.arcade.leaderboard.willBeSavedAs(
                        names[side.id].toUpperCase(),
                      )
                    : $t.arcade.leaderboard.wontBeSaved}
                </p>
              {:else}
                <div class="over__final" style="color: {side.color}">
                  {formatScore(side.score)}
                </div>
              {/if}
            </section>
          {/each}
        </div>

        {#if sameName}
          <p class="over__warn">{$t.arcade.leaderboard.sameName}</p>
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

  <!-- One keyboard, whichever side currently holds the focus. -->
  {#each sides as side (side.id)}
    <OnScreenKeyboardField
      bind:value={names[side.id]}
      open={focus === side.id}
      onOpenChange={(open) => {
        if (open) focus = side.id
        else if (focus === side.id) focus = null
      }}
      showTrigger={false}
      caption={side.label}
      maxLength={NAME_MAX_LEN}
      closeLabel={$t.arcade.leaderboard.closeKeyboard}
    />
  {/each}
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

  .over__card
    max-width: 92vw
    max-height: 88vh

  .over__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-16)
    padding-block: var(--space-48)
    padding-inline: var(--space-48)
    text-align: center

  .over__note
    margin: 0
    color: var(--color-text-secondary)

  .over__warn
    margin: 0
    @include tint.type-class(ui-small-bold)
    color: var(--color-accent)
    text-align: center

  .over__cols
    display: flex
    gap: var(--space-32)
    align-items: flex-start
    justify-content: center

  .over__col
    display: flex
    flex-direction: column
    align-items: stretch
    gap: var(--space-12)
    width: 20rem
    max-width: 42vw

  .over__player
    margin: 0
    @include tint.type-class(headline-sm)
    letter-spacing: 0.04em

  .over__final
    @include tint.type-class(display)
    font-weight: 800
    line-height: 1
    padding-block: var(--space-24)
    font-variant-numeric: tabular-nums

  .over__hint
    margin: 0
    @include tint.type-class(ui-small-bold)
    color: var(--color-accent)
    min-height: 1.2em

  .over__actions
    display: flex
    gap: var(--space-16)
</style>
