<!--
  Arcade-wide escape hatch. While a game is mounted, swiping down from the top
  edge of the screen slides in a "Return to Launcher" pill. Tapping it arms a
  confirm step (dark circular ✓ / ✗ animate in beside the pill); ✓ returns to
  the launcher, ✗ (or a tap anywhere else) dismisses it. If left untouched, the
  pill hides itself again after a few seconds.

  This is the permanent fallback — games also expose their own return UI, which
  calls the same `onExit` the arcade passes here.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { t } from './i18n'
  import RobotIcon from './RobotIcon.svelte'

  interface Props {
    /** True while a game is mounted; gates the gesture + rendering. */
    active: boolean
    /** Confirmed → hand control back to the arcade (return to launcher). */
    onConfirm: () => void
  }
  const { active, onConfirm }: Props = $props()

  let revealed = $state(false)
  let armed = $state(false)

  // Downward-swipe tracking. Non-capturing window listeners so gameplay input
  // (stargazer's own pointer handling) is never blocked.
  let tracking = false
  let startX = 0
  let startY = 0
  /** Down-swipe must begin within this fraction of the viewport height. */
  const TOP_ZONE_FRAC = 0.12
  /** Vertical travel (px) that commits the reveal. */
  const REVEAL_DIST = 72
  /** Hide the revealed pill again after this long without interaction. */
  const IDLE_HIDE_MS = 4000

  function reset(): void {
    revealed = false
    armed = false
    tracking = false
  }

  function onPointerDown(e: PointerEvent): void {
    if (!active || revealed) return
    if (e.clientY <= window.innerHeight * TOP_ZONE_FRAC) {
      tracking = true
      startX = e.clientX
      startY = e.clientY
    }
  }
  function onPointerMove(e: PointerEvent): void {
    if (!tracking) return
    const dy = e.clientY - startY
    const dx = e.clientX - startX
    // Commit on a mostly-vertical downward drag.
    if (dy > REVEAL_DIST && dy > Math.abs(dx)) {
      revealed = true
      tracking = false
    }
  }
  function onPointerUp(): void {
    tracking = false
  }

  // Reset whenever the hatch becomes unavailable (game unmounted).
  $effect(() => {
    if (!active) reset()
  })

  // Auto-hide the revealed pill after a spell of no interaction. Paused while the
  // confirm step is armed (the technician is mid-decision); the timer restarts
  // whenever `revealed`/`armed` change, so re-arming or re-revealing extends it.
  $effect(() => {
    if (!revealed || armed) return
    const id = setTimeout(reset, IDLE_HIDE_MS)
    return () => clearTimeout(id)
  })

  onMount(() => {
    const opts = { passive: true } as const
    window.addEventListener('pointerdown', onPointerDown, opts)
    window.addEventListener('pointermove', onPointerMove, opts)
    window.addEventListener('pointerup', onPointerUp, opts)
    window.addEventListener('pointercancel', onPointerUp, opts)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  })
</script>

{#if active}
  <div class="rtl" class:rtl--revealed={revealed} class:rtl--armed={armed}>
    <!-- Tap-away catcher: only interactive once revealed. -->
    {#if revealed}
      <button class="rtl__scrim" aria-label={$t.arcade.cancel} onclick={reset}
      ></button>
    {/if}

    <div class="rtl__dock">
      <!-- Both confirm buttons sit BEHIND the pill (z-index) and slide out from
           behind it to the right when armed. -->
      <div class="rtl__confirm">
        <button
          class="rtl__circle rtl__circle--yes"
          aria-label={$t.arcade.confirm}
          onclick={() => {
            reset()
            onConfirm()
          }}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path
              fill="currentColor"
              d="M13.72 4.443a.75.75 0 1 1 1.06 1.06l-6.43 6.43a2.75 2.75 0 0 1-3.888 0L1.22 8.693A.751.751 0 0 1 2.28 7.63l3.241 3.241a1.25 1.25 0 0 0 1.768 0z"
            />
          </svg>
        </button>
        <button
          class="rtl__circle rtl__circle--no"
          aria-label={$t.arcade.cancel}
          onclick={reset}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path
              fill="currentColor"
              d="M12.72 3.22a.75.75 0 1 1 1.06 1.06L9.56 8.5l4.22 4.22a.75.75 0 1 1-1.06 1.06L8.5 9.56l-4.22 4.22a.75.75 0 1 1-1.06-1.06L7.44 8.5 3.22 4.28a.75.75 0 1 1 1.06-1.06L8.5 7.44z"
            />
          </svg>
        </button>
      </div>

      <button class="rtl__pill" onclick={() => (armed = true)}>
        <span class="rtl__pill-icon" aria-hidden="true">
          <RobotIcon size={20} />
        </span>
        <span>{$t.arcade.returnToLauncher}</span>
      </button>
    </div>
  </div>
{/if}

<style lang="sass">
  .rtl
    position: absolute
    inset: 0
    pointer-events: none
    z-index: var(--z-overlay)

  .rtl__scrim
    position: absolute
    inset: 0
    border: none
    padding: 0
    background: transparent
    pointer-events: auto
    cursor: default

  // Dock shrinks to the pill and is centered at the top. Its transform carries
  // both the reveal (slide down) and the armed shift (pill slides left to make
  // room as the confirm buttons emerge from behind it).
  .rtl__dock
    position: absolute
    inset-block-start: var(--space-24)
    inset-inline-start: 50%
    // Hidden just above the top edge; slides in when revealed.
    transform: translateX(-50%) translateY(calc(-100% - var(--space-48)))
    transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)

  .rtl--revealed .rtl__dock
    transform: translateX(-50%) translateY(0)

  // Armed: nudge the whole dock left so the pill + emerged buttons read centered.
  .rtl--revealed.rtl--armed .rtl__dock
    transform: translateX(calc(-50% - 3.75rem)) translateY(0)

  .rtl__pill
    position: relative
    z-index: 2
    display: inline-flex
    align-items: center
    flex-shrink: 0
    gap: var(--space-8)
    pointer-events: auto
    cursor: pointer
    border: none
    border-radius: var(--radius-pill)
    padding-block: var(--space-12)
    padding-inline: var(--space-24)
    @include tint.type-class(pill)
    color: var(--color-text)
    background: var(--color-surface-card)
    box-shadow: var(--color-shadow-card)
    white-space: nowrap

    &:active
      filter: brightness(0.95)

  .rtl__pill-icon
    display: inline-flex
    align-items: center

  // Buttons tucked behind the pill's right edge (z-index 1), revealed by sliding
  // out to the right when armed.
  .rtl__confirm
    position: absolute
    inset-block-start: 50%
    inset-inline-start: 100%
    z-index: 1
    display: flex
    align-items: center
    gap: var(--space-12)
    opacity: 0
    transform: translate(-100%, -50%)
    pointer-events: none
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease

  .rtl--armed .rtl__confirm
    opacity: 1
    transform: translate(var(--space-12), -50%)
    pointer-events: auto

  .rtl__circle
    display: inline-flex
    align-items: center
    justify-content: center
    flex-shrink: 0
    width: var(--space-48)
    height: var(--space-48)
    border-radius: var(--radius-pill)
    border: none
    cursor: pointer
    color: var(--color-text-inverse)
    background: var(--color-surface-inverse)

    &:active
      filter: brightness(1.35)

  @media (forced-colors: active)
    .rtl__pill, .rtl__circle
      forced-color-adjust: none
      border: 2px solid ButtonText
</style>
