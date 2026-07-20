<!--
  Booth-menu section for the visitor UI scale. The whole DOM UI is rem-based off
  one adjustable base, so this slider tunes it on the actual screen. To avoid
  reflowing the app on every drag step (low-end kiosk hardware), the committed
  value is set on release; while dragging, a full-screen calibration overlay
  previews the relative size against a fixed 1-inch reference and a sample touch
  target, so the technician can judge tappability, not just legibility.
-->
<script lang="ts">
  import { DebugSection } from '@src/stargazer/debug/ui'
  import Button from '@src/core/ui/Button.svelte'
  import {
    uiScale,
    setUiScale,
    resetUiScale,
    UI_SCALE_MIN,
    UI_SCALE_MAX,
    UI_SCALE_STEP,
  } from '@src/core/ui/uiScale'

  let pending = $state($uiScale)
  let dragging = $state(false)

  function onInput(e: Event): void {
    pending = Number((e.currentTarget as HTMLInputElement).value)
    dragging = true
  }
  function onChange(e: Event): void {
    setUiScale(Number((e.currentTarget as HTMLInputElement).value))
    dragging = false
  }
  function reset(): void {
    resetUiScale()
    pending = 1
    dragging = false
  }
</script>

<DebugSection title="Display" open>
  <div class="ds-row">
    <span class="ds-label">UI scale</span>
    <span class="ds-value">×{pending.toFixed(2)}</span>
  </div>
  <input
    class="ds-slider"
    type="range"
    min={UI_SCALE_MIN}
    max={UI_SCALE_MAX}
    step={UI_SCALE_STEP}
    value={$uiScale}
    oninput={onInput}
    onchange={onChange}
  />
  <button type="button" class="debug-btn" onclick={reset}>Reset to 100%</button>
</DebugSection>

{#if dragging}
  <div class="cal" aria-hidden="true">
    <div class="cal__box">
      <div class="cal__ref"><span>1 in</span></div>
      <div class="cal__sample" style="transform: scale({pending})">
        <Button variant="primary">Tap target</Button>
      </div>
      <div class="cal__value">×{pending.toFixed(2)}</div>
    </div>
  </div>
{/if}

<style lang="sass">
  .ds-row
    display: flex
    align-items: baseline
    justify-content: space-between

  .ds-value
    font-variant-numeric: tabular-nums
    opacity: 0.7

  .ds-slider
    width: 100%
    margin-block: 6px

  // Full-screen preview shown only while dragging. Fixed physical reference
  // (CSS inch) beside a scaled sample control.
  .cal
    position: fixed
    inset: 0
    z-index: 2000
    display: flex
    align-items: center
    justify-content: center
    background: rgba(6, 8, 12, 0.6)
    pointer-events: none

  .cal__box
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-24)
    color: var(--color-text-inverse)

  .cal__ref
    width: 1in
    height: 1in
    border: 2px dashed rgba(255, 255, 255, 0.7)
    display: flex
    align-items: center
    justify-content: center
    font-size: 0.75rem

  .cal__value
    @include tint.type-class(headline)
</style>
