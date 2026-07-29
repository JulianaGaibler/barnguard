<script lang="ts">
  interface Props {
    label: string
    value: number
    min: number
    max: number
    /** Increment. Default `1`. */
    step?: number
    /**
     * Fires continuously while dragging (native `input`). Use for live tuning
     * where each step is cheap to apply.
     */
    onInput?: (next: number) => void
    /**
     * Fires on release (native `change`). Use to commit an expensive change
     * once, previewing via `onInput` while the drag is in flight.
     */
    onChange?: (next: number) => void
    /** Formats the always-visible value readout. Default is the raw number. */
    format?: (v: number) => string
    /** Short chip shown on the left, matching `DebugSelect` / `ToggleButton`. */
    hint?: string
    disabled?: boolean
  }

  let {
    label,
    value,
    min,
    max,
    step = 1,
    onInput,
    onChange,
    format,
    hint,
    disabled = false,
  }: Props = $props()

  // Follow the drag position live so the readout + fill track the thumb even
  // when the caller only commits on release (`value` stays put mid-drag). Once
  // the drag ends, fall back to the caller's `value` so external changes
  // (commit, reset) flow through.
  let dragging = $state(false)
  let dragValue = $state(0)
  const current = $derived(dragging ? dragValue : value)

  // Track fill as a percentage, for the webkit gradient (Firefox uses its own
  // `::-moz-range-progress`). Clamped so an out-of-range value cannot overflow.
  const pct = $derived(
    max > min
      ? Math.max(0, Math.min(1, (current - min) / (max - min))) * 100
      : 0,
  )
  const display = $derived(format ? format(current) : String(current))

  function handleInput(e: Event): void {
    dragValue = parseFloat((e.currentTarget as HTMLInputElement).value)
    dragging = true
    onInput?.(dragValue)
  }
  function handleChange(e: Event): void {
    const next = parseFloat((e.currentTarget as HTMLInputElement).value)
    dragging = false
    onChange?.(next)
  }
</script>

<label class="debug-slider" class:disabled>
  <span class="head">
    {#if hint}<kbd class="hint">{hint}</kbd>{/if}
    <span class="label">{label}</span>
    <span class="value">{display}</span>
  </span>
  <input
    class="control"
    type="range"
    {min}
    {max}
    {step}
    value={current}
    {disabled}
    aria-label={label}
    style="--pct: {pct}%"
    oninput={handleInput}
    onchange={handleChange}
  />
</label>

<style lang="sass">
  // Boxed control matching `DebugSelect`: label + always-visible value on top,
  // the range track below. Accent blue (#60a5fa) mirrors the `DebugRow` accent.
  .debug-slider
    display: flex
    flex-direction: column
    gap: 6px
    padding: 6px 8px
    width: 100%
    box-sizing: border-box
    background: rgba(255, 255, 255, 0.05)
    border: 1px solid rgba(255, 255, 255, 0.18)
    border-radius: 4px
    color: #fff
    font-family: inherit
    font-size: 11px
    user-select: none
    -webkit-user-select: none
    touch-action: manipulation

    &:hover:not(.disabled)
      background: rgba(255, 255, 255, 0.1)
      border-color: rgba(255, 255, 255, 0.35)

    &.disabled
      opacity: 0.4

    &:not(:last-child)
      margin-bottom: 4px

  .head
    display: flex
    align-items: center
    gap: 6px

  .hint
    min-width: 2ch
    padding: 1px 4px
    font-size: 10px
    margin: 0

  .label
    flex: 1
    opacity: 0.75

  .value
    font-variant-numeric: tabular-nums
    color: #60a5fa

  // Native range, restyled to fit the dark panel. Track fill uses `--pct` on
  // webkit and the built-in progress element on Firefox.
  .control
    -webkit-appearance: none
    appearance: none
    width: 100%
    height: 12px
    margin: 0
    background: transparent
    cursor: pointer

    &:disabled
      cursor: not-allowed

    &::-webkit-slider-runnable-track
      height: 5px
      border-radius: 3px
      background: linear-gradient(to right, #60a5fa var(--pct), rgba(255, 255, 255, 0.15) var(--pct))

    &::-webkit-slider-thumb
      -webkit-appearance: none
      appearance: none
      width: 12px
      height: 12px
      margin-top: -3.5px
      border-radius: 50%
      background: #60a5fa
      border: 2px solid #12151c

    &::-moz-range-track
      height: 5px
      border-radius: 3px
      background: rgba(255, 255, 255, 0.15)

    &::-moz-range-progress
      height: 5px
      border-radius: 3px
      background: #60a5fa

    &::-moz-range-thumb
      width: 12px
      height: 12px
      border-radius: 50%
      background: #60a5fa
      border: 2px solid #12151c
</style>
