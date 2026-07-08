<script lang="ts" module>
  export interface DebugSelectOption<V> {
    /** Machine value passed back through `onChange`. */
    value: V
    /** Display text. */
    label: string
  }

  /**
   * `<hr>` separator between options. Chromium 119+ / Safari 17.5+ / Firefox
   * 122+ render this as a native divider inside the picker; older browsers
   * ignore it, so option order still reads correctly.
   */
  export interface DebugSelectDivider {
    divider: true
  }

  export type DebugSelectItem<V> = DebugSelectOption<V> | DebugSelectDivider
</script>

<script lang="ts" generics="V extends string | number">
  interface Props {
    label: string
    options: readonly DebugSelectItem<V>[]
    value: V
    onChange: (next: V) => void
    /** Short chip shown on the left, matching `ToggleButton`'s hint. */
    hint?: string
    disabled?: boolean
  }

  let {
    label,
    options,
    value,
    onChange,
    hint,
    disabled = false,
  }: Props = $props()

  // Numeric options end up as `<option value="0">` string attributes at the
  // DOM level. HTML has no notion of a "number" value. Serialise the
  // incoming `value` prop to the same string form so `<select>` correctly
  // pre-selects the matching option, then convert back to the caller's
  // native type in the change handler.
  const valueStr = $derived(String(value))
  const isNumeric = $derived.by(() => {
    const first = options.find(
      (o): o is DebugSelectOption<V> => !('divider' in o),
    )
    return first !== undefined && typeof first.value === 'number'
  })

  function handleChange(e: Event): void {
    const target = e.currentTarget as HTMLSelectElement
    const raw = target.value
    const next = (isNumeric ? Number(raw) : raw) as V
    // No preventDefault / no `blur()`, the browser's native `<select>` needs
    // to keep default behaviour on pointerdown to open its dropdown. An
    // over-eager `blur` inside the handler also races with the picker close
    // animation on some browsers.
    onChange(next)
  }
</script>

<label class="debug-select" class:disabled>
  <span class="head">
    {#if hint}<kbd class="hint">{hint}</kbd>{/if}
    <span class="label">{label}</span>
  </span>
  <select class="control" {disabled} value={valueStr} onchange={handleChange}>
    {#each options as opt, i ('divider' in opt ? `__hr-${i}` : opt.value)}
      {#if 'divider' in opt}
        <hr />
      {:else}
        <option value={String(opt.value)}>{opt.label}</option>
      {/if}
    {/each}
  </select>
</label>

<style lang="sass">
  // Stacked layout, label on top, full-width select below. Row-based
  // layouts blow out horizontally when an option string is long (e.g.
  // "Overdraw heatmap") and the narrow debug panel can't accommodate a
  // wide native picker. Stacking is dense enough at font-size 11 that
  // vertical space isn't an issue and the select is always exactly the
  // panel width.
  .debug-select
    display: flex
    flex-direction: column
    gap: 4px
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

  .control
    width: 100%
    box-sizing: border-box
    background: rgba(0, 0, 0, 0.35)
    color: #fff
    font: inherit
    font-size: 11px
    border: 1px solid rgba(255, 255, 255, 0.25)
    border-radius: 3px
    padding: 3px 6px
    cursor: pointer

    &:disabled
      cursor: not-allowed

    option
      background: #1a1a1a
      color: #fff
</style>
