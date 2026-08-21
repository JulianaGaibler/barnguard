<!--
  End-of-match screen for 2p: a winner banner over two side-by-side columns,
  one per player, each showing that player's final score and — if it qualifies —
  a windowed leaderboard with an inline name-entry row.

  Both entries share a SINGLE on-screen keyboard: opening one side's keyboard
  closes the other, so only one `OnScreenKeyboard` is ever mounted at a time
  (each mounts its own `window` keydown listener, which would otherwise type the
  same key into both names). Players take turns; tapping a row activates that
  side. Each qualifying score is submitted independently on exit, and both names
  are handed back via `onFinalize` for the game log.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import Button from '@src/core/ui/Button.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import OnScreenKeyboardField from '@src/core/ui/OnScreenKeyboardField.svelte'
  import {
    fetchLeaderboard,
    submitScore,
    type LeaderboardEntry,
  } from '@src/core/leaderboard/leaderboardClient'
  import { t } from '@src/displays/arcade/i18n'
  import LeaderboardList from '@src/displays/arcade/leaderboard/LeaderboardList.svelte'
  import { formatScore } from '@src/displays/arcade/leaderboard/formatScore'
  import { ACCENT_VS, COLORS } from '../game/tuning'
  import { JEZZBALL_STRINGS as S } from '../strings'

  const DISPLAY = 'jezzball'
  const MAX_ROWS = 50
  const CONTEXT_ROWS = 2
  const NAME_MAX_LEN = 6

  interface Props {
    winner: 0 | 1 | 2
    pointsA: number
    pointsB: number
    onPlayAgain: () => void
    onMenu: () => void
    /** Fired exactly once on exit with both entered names (or ''). */
    onFinalize?: (names: { a: string; b: string }) => void
  }
  const {
    winner,
    pointsA,
    pointsB,
    onPlayAgain,
    onMenu,
    onFinalize,
  }: Props = $props()

  type Stage = 'loading' | 'unavailable' | 'ready'
  let stage = $state<Stage>('loading')
  let entries = $state<LeaderboardEntry[]>([])

  let nameA = $state('')
  let nameB = $state('')
  let kbOpenA = $state(false)
  let kbOpenB = $state(false)
  let exiting = $state(false)

  function qualifies(score: number): boolean {
    if (score <= 0) return false
    return entries.length < MAX_ROWS || score > entries[MAX_ROWS - 1].score
  }
  const qualA = $derived(stage === 'ready' && qualifies(pointsA))
  const qualB = $derived(stage === 'ready' && qualifies(pointsB))

  // While a side's keyboard is open, spell out every letter slot ("YAI___") so
  // typing progress reads clearly; otherwise fall back to the plain name.
  const pendingDisplayA = $derived(
    kbOpenA ? nameA.toUpperCase().padEnd(NAME_MAX_LEN, '_') : undefined,
  )
  const pendingDisplayB = $derived(
    kbOpenB ? nameB.toUpperCase().padEnd(NAME_MAX_LEN, '_') : undefined,
  )

  onMount(() => {
    fetchLeaderboard(DISPLAY, MAX_ROWS)
      .then((list) => {
        entries = list
        stage = 'ready'
      })
      .catch(() => {
        stage = 'unavailable'
      })
  })

  // One keyboard at a time: opening a side closes the other.
  function openA(): void {
    kbOpenB = false
    kbOpenA = true
  }
  function openB(): void {
    kbOpenA = false
    kbOpenB = true
  }

  // Submit both qualifying scores at most once, on whichever exit path runs
  // first (a button, or the arcade-wide swipe teardown), then guarded after.
  let submitted = false
  async function saveIfNeeded(): Promise<void> {
    if (submitted) return
    submitted = true
    onFinalize?.({ a: nameA, b: nameB })
    if (stage !== 'ready') return
    const jobs: Array<Promise<unknown>> = []
    if (qualA && nameA) jobs.push(submitScore(DISPLAY, nameA, pointsA).catch(() => {}))
    if (qualB && nameB) jobs.push(submitScore(DISPLAY, nameB, pointsB).catch(() => {}))
    await Promise.all(jobs)
  }

  async function exit(cb: () => void): Promise<void> {
    exiting = true
    await saveIfNeeded()
    cb()
  }

  onDestroy(() => {
    void saveIfNeeded()
  })
</script>

<div class="over" transition:fade={{ duration: 180 }}>
  <div class="over__card" transition:scale={{ start: 0.92, duration: 180 }}>
    <Surface tone="light">
      <div class="over__body">
        <h2 class="over__title">
          {#if winner === 0}
            <span style="color: {COLORS.ink}">{S.tie}</span>
          {:else}
            <span
              style="color: {winner === 1
                ? ACCENT_VS[1].primary
                : ACCENT_VS[2].primary}">
              {winner === 1 ? S.player1 : S.player2}
            </span>
            <span style="color: {COLORS.ink}"> {S.winsSuffix}</span>
          {/if}
        </h2>

        {#if stage === 'unavailable'}
          <p class="over__note">{$t.arcade.leaderboard.unavailable}</p>
        {/if}

        <div class="over__cols">
          {#each [{ id: 'a', label: S.player1, color: ACCENT_VS[1].primary, score: pointsA, qual: qualA, name: nameA, display: pendingDisplayA, open: openA }, { id: 'b', label: S.player2, color: ACCENT_VS[2].primary, score: pointsB, qual: qualB, name: nameB, display: pendingDisplayB, open: openB }] as col (col.id)}
            <section class="over__col">
              <h3 class="over__player" style="color: {col.color}">
                {col.label}
              </h3>
              {#if col.qual}
                <LeaderboardList
                  {entries}
                  pending={{
                    name: col.name,
                    score: col.score,
                    display: col.display,
                  }}
                  pendingAction={{
                    label: col.name ? '' : $t.arcade.leaderboard.enterNameToSave,
                    onClick: col.open,
                  }}
                  contextRows={CONTEXT_ROWS}
                />
                <p class="over__hint">
                  {col.name
                    ? $t.arcade.leaderboard.willBeSavedAs(col.name.toUpperCase())
                    : $t.arcade.leaderboard.wontBeSaved}
                </p>
              {:else}
                <div class="over__final" style="color: {col.color}">
                  {formatScore(col.score)}
                </div>
              {/if}
            </section>
          {/each}
        </div>

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

  <!-- One shared keyboard, driven by two fields that are never open at once. -->
  <OnScreenKeyboardField
    bind:value={nameA}
    bind:open={kbOpenA}
    showTrigger={false}
    maxLength={NAME_MAX_LEN}
    closeLabel={$t.arcade.leaderboard.closeKeyboard}
  />
  <OnScreenKeyboardField
    bind:value={nameB}
    bind:open={kbOpenB}
    showTrigger={false}
    maxLength={NAME_MAX_LEN}
    closeLabel={$t.arcade.leaderboard.closeKeyboard}
  />
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

  .over__title
    margin: 0
    @include tint.type-class(headline)
    letter-spacing: 0.06em

  .over__note
    margin: 0
    color: var(--color-text-secondary)

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
